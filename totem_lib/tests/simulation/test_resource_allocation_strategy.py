from tests.assets.ocel_helpers import event as _event
from tests.assets.ocel_helpers import make_ocel, obj
from totem_lib.simulation.utils.resource_allocation_strategy import (
    calculate_resource_allocation_strategy,
    count_allocation_evidence,
    select_allocation_strategy,
)
from totem_lib.simulation.utils.resource_calendar import WEEKDAYS


def _flat_calendar(prob: float) -> dict:
    """A Worker calendar with the same availability probability in every slot."""
    return {"Worker": {day: [prob] * 24 for day in WEEKDAYS}}


def _cd(value: float) -> dict:
    """A single-sample cooldown entry: every quantile of it is ``value``."""
    return {"samples": [float(value)]}


def _evidence(ocel, *args, rt="Worker", **kwargs) -> dict:
    """The non-zero entries of one type's evidence counts."""
    counts = count_allocation_evidence(ocel, *args, **kwargs).get(rt, {})
    return {k: v for k, v in counts.items() if v}


def _workers(n: int):
    """Workers r1..rn registered at t=0/10/20/..., so the idle order is r1..rn."""
    return (
        [_event(f"e{i}", "A", (i - 1) * 10, [], [f"r{i}"]) for i in range(1, n + 1)],
        [obj(f"r{i}", "Worker") for i in range(1, n + 1)],
    )


class _Variant:
    """Minimal hashable stand-in for a Variant: just its executions."""

    def __init__(self, *executions):
        self.executions = list(executions)


# --- classification ---
def test_classify_front_pick_is_fifo():
    """r1 idle since t=0, r2 since t=10. Picking r1 (idle longest) → FIFO."""
    events, objects = _workers(2)
    events.append(_event("e3", "A", 100, [], ["r1"]))
    assert _evidence(make_ocel(events, objects)) == {"first_seen": 2, "FIFO": 1}


def test_classify_back_pick_is_lifo():
    """Picking r2 (most recently idle) → LIFO."""
    events, objects = _workers(2)
    events.append(_event("e3", "A", 100, [], ["r2"]))
    assert _evidence(make_ocel(events, objects)) == {"first_seen": 2, "LIFO": 1}


def test_classify_middle_pick_is_other():
    """Queue [r1, r2, r3]; picking r2 is neither front nor back → other."""
    events, objects = _workers(3)
    events.append(_event("e4", "A", 100, [], ["r2"]))
    assert _evidence(make_ocel(events, objects)) == {"first_seen": 3, "other": 1}


def test_classify_single_candidate_is_no_choice():
    """Only r1 is registered: the pick had no alternative and is not evidence."""
    ocel = make_ocel(
        [_event("e1", "A", 0, [], ["r1"]), _event("e2", "A", 50, [], ["r1"])],
        [obj("r1", "Worker")],
    )
    assert _evidence(ocel) == {"first_seen": 1, "no_choice": 1}


def test_classify_first_appearance_not_counted():
    """A resource's very first event is not evidence: it was not yet registered."""
    ocel = make_ocel([_event("e1", "A", 0, [], ["r1"])], [obj("r1", "Worker")])
    assert _evidence(ocel) == {"first_seen": 1}


def test_classify_all_tied_is_no_choice():
    """r1 and r2 leave the same event without cooldown, so they are idle since
    the same second. Either pick is consistent with FIFO and LIFO → no_choice."""
    ocel = make_ocel(
        [
            _event("e1", "A", 0, [], ["r1", "r2"]),
            _event("e2", "A", 100, [], ["r2"]),
        ],
        [obj("r1", "Worker"), obj("r2", "Worker")],
    )
    assert _evidence(ocel) == {"first_seen": 1, "no_choice": 1}


def test_classify_tie_at_boundary_independent_of_queue_order():
    """r1 idle since t=0, r2 and r3 both since t=10. Picking either r2 or r3 is
    LIFO under some tie-break, whichever of them the queue lists first."""
    objects = [obj(f"r{i}", "Worker") for i in range(1, 4)]
    for pick in ("r2", "r3"):
        events = [
            _event("e1", "A", 0, [], ["r1"]),
            _event("e2", "A", 10, [], ["r2", "r3"]),
            _event("e3", "A", 100, [], [pick]),
        ]
        assert _evidence(make_ocel(events, objects)) == {"first_seen": 2, "LIFO": 1}


def test_classify_two_types_independently():
    """Workers and Companies are counted per type: w1 idle longest → FIFO for
    Workers; c2 idle most recently → LIFO for Companies."""
    ocel = make_ocel(
        [
            _event("e1", "A", 0, [], ["w1", "c1"]),
            _event("e2", "A", 10, [], ["w2", "c2"]),
            _event("e3", "A", 100, [], ["w1", "c2"]),
        ],
        [
            obj("w1", "Worker"),
            obj("w2", "Worker"),
            obj("c1", "Company"),
            obj("c2", "Company"),
        ],
    )
    assert _evidence(ocel) == {"first_seen": 2, "FIFO": 1}
    assert _evidence(ocel, rt="Company") == {"first_seen": 2, "LIFO": 1}


# --- cooldowns ---
def test_cooldown_excludes_resource_from_candidates():
    """
    r1 has a 200s cooldown, so at t=50 only r2 is idle and its pick has no
    alternative. Without the cooldown r1 would also be idle and r2 would score
    as LIFO.
    """
    cooldowns = {"LongTask": {"Worker": _cd(200)}, "ShortTask": {"Worker": _cd(0)}}
    ocel = make_ocel(
        [
            _event("e1", "LongTask", 0, [], ["r1"]),
            _event("e2", "ShortTask", 10, [], ["r2"]),
            _event("e3", "ShortTask", 50, [], ["r2"]),
        ],
        [obj("r1", "Worker"), obj("r2", "Worker")],
    )
    assert _evidence(ocel, cooldowns) == {"first_seen": 2, "no_choice": 1}
    assert _evidence(ocel) == {"first_seen": 2, "LIFO": 1}


# --- calendar consistency ---
def test_calendar_discounts_cooldown_to_wallclock():
    """
    The cooldown is calendar-discounted working time, so under a 0.5 calendar a
    100s cooldown stretches to 200s wall-clock: at t=150 r1 is still cooling and
    the replay disagrees with the log. Without the calendar r1 is idle at t=100.
    """
    cooldowns = {"LongTask": {"Worker": _cd(100)}, "ShortTask": {"Worker": _cd(0)}}
    ocel = make_ocel(
        [
            _event("e1", "LongTask", 0, [], ["r1"]),
            _event("e2", "ShortTask", 150, [], ["r1"]),
        ],
        [obj("r1", "Worker")],
    )
    assert _evidence(ocel, cooldowns) == {"first_seen": 1, "no_choice": 1}
    assert _evidence(ocel, cooldowns, calendars=_flat_calendar(0.5)) == {
        "first_seen": 1,
        "not_idle": 1,
    }


def test_calendar_offshift_resource_not_idle():
    """A type that is never present (all-zero calendar) has no candidates, so a
    pick of it disagrees with the replay. Without the calendar it scores FIFO."""
    events, objects = _workers(2)
    events.append(_event("e3", "A", 100, [], ["r1"]))
    ocel = make_ocel(events, objects)
    assert _evidence(ocel) == {"first_seen": 2, "FIFO": 1}
    assert _evidence(ocel, calendars=_flat_calendar(0.0)) == {
        "first_seen": 2,
        "not_idle": 1,
    }


def test_calendar_per_resource_overrides_type():
    """
    A resource's own calendar wins over its type calendar. With r1 off shift its
    pick disagrees with the replay; with r2 off shift the queue is [r1, r3] and
    picking r1 is FIFO.
    """
    events, objects = _workers(3)
    events.append(_event("e4", "A", 100, [], ["r1"]))
    ocel = make_ocel(events, objects)
    off = {day: [0.0] * 24 for day in WEEKDAYS}
    on = _flat_calendar(1.0)
    assert _evidence(ocel, calendars={**on, "r1": off}) == {
        "first_seen": 3,
        "not_idle": 1,
    }
    assert _evidence(ocel, calendars={**on, "r2": off}) == {"first_seen": 3, "FIFO": 1}


def test_calendar_per_resource_cooldown_reinflation():
    """
    The cooldown re-inflation uses the resource's own calendar: with r1 on a
    0.5 calendar its 100s cooldown ends at t=200, so it is not idle at t=150,
    while the always-on type calendar alone frees it at t=100.
    """
    cooldowns = {"LongTask": {"Worker": _cd(100)}, "ShortTask": {"Worker": _cd(0)}}
    ocel = make_ocel(
        [
            _event("e1", "LongTask", 0, [], ["r1"]),
            _event("e2", "ShortTask", 150, [], ["r1"]),
        ],
        [obj("r1", "Worker")],
    )
    on = _flat_calendar(1.0)
    half = _flat_calendar(0.5)["Worker"]
    assert _evidence(ocel, cooldowns, calendars=on) == {
        "first_seen": 1,
        "no_choice": 1,
    }
    assert _evidence(ocel, cooldowns, calendars={**on, "r1": half}) == {
        "first_seen": 1,
        "not_idle": 1,
    }


# --- multiple resources of one type per event ---
def test_multi_front_positions_score_fifo():
    """Queue [r1, r2, r3, r4]; the event takes the two idle longest → FIFO."""
    events, objects = _workers(4)
    events.append(_event("e5", "A", 100, [], ["r1", "r2"]))
    assert _evidence(make_ocel(events, objects)) == {"first_seen": 4, "FIFO": 1}


def test_multi_back_positions_score_lifo():
    """Queue [r1, r2, r3, r4]; the event takes the two most recent → LIFO."""
    events, objects = _workers(4)
    events.append(_event("e5", "A", 100, [], ["r3", "r4"]))
    assert _evidence(make_ocel(events, objects)) == {"first_seen": 4, "LIFO": 1}


def test_multi_mixed_positions_score_other():
    """Queue [r1, r2, r3, r4]; taking r1 and r3 is neither block → other."""
    events, objects = _workers(4)
    events.append(_event("e5", "A", 100, [], ["r1", "r3"]))
    assert _evidence(make_ocel(events, objects)) == {"first_seen": 4, "other": 1}


def test_multi_taking_all_candidates_is_no_choice():
    """Two workers idle, the event needs both: no alternative assignment."""
    events, objects = _workers(2)
    events.append(_event("e3", "A", 100, [], ["r1", "r2"]))
    assert _evidence(make_ocel(events, objects)) == {"first_seen": 2, "no_choice": 1}


def test_multi_every_assigned_resource_gets_a_cooldown():
    """
    All resources an event consumes go on their own cooldown — not just the first.

      e4 t=100: "Big" takes r1+r2 from [r1, r2, r3] → FIFO; both busy until 1100.
      e5 t=200, e6 t=300: only r3 is idle → no_choice.

    Were r2 left idle since t=10, e5 would see [r2, r3] and score r3 as LIFO.
    """
    cooldowns = {"Big": {"Worker": _cd(1000)}, "Small": {"Worker": _cd(0)}}
    ocel = make_ocel(
        [
            _event("e1", "Small", 0, [], ["r1"]),
            _event("e2", "Small", 10, [], ["r2"]),
            _event("e3", "Small", 20, [], ["r3"]),
            _event("e4", "Big", 100, [], ["r1", "r2"]),
            _event("e5", "Small", 200, [], ["r3"]),
            _event("e6", "Small", 300, [], ["r3"]),
        ],
        [obj("r1", "Worker"), obj("r2", "Worker"), obj("r3", "Worker")],
    )
    assert _evidence(ocel, cooldowns) == {"first_seen": 3, "FIFO": 1, "no_choice": 2}


def test_multi_partial_candidacy_not_idle():
    """r2 is on a 1000s cooldown when e3 claims r1 and r2 together: the replay
    disagrees with the log and the event is not counted."""
    cooldowns = {"Big": {"Worker": _cd(1000)}, "Small": {"Worker": _cd(0)}}
    ocel = make_ocel(
        [
            _event("e1", "Small", 0, [], ["r1"]),
            _event("e2", "Big", 10, [], ["r2"]),
            _event("e3", "Small", 100, [], ["r1", "r2"]),
        ],
        [obj("r1", "Worker"), obj("r2", "Worker")],
    )
    assert _evidence(ocel, cooldowns) == {"first_seen": 2, "not_idle": 1}


# --- resource constraints ---
def _constrained_log(b_resources: list[str]):
    """
    r1, r2, r3 registered in executions x1-x3. Execution x4 runs A on r1 at
    t=100 (FIFO from [r1, r2, r3]) and then B on ``b_resources`` at t=200, when
    the idle order is [r2@10, r3@20, r1@100].
    """
    events, objects = _workers(3)
    events.append(_event("e4", "A", 100, [], ["r1"]))
    events.append(_event("e5", "B", 200, [], b_resources))
    variant = _Variant(["e1"], ["e2"], ["e3"], ["e4", "e5"])
    return make_ocel(events, objects), variant


def _b_after_a(ctype: str) -> dict:
    """Constraints relating B's workers to A's workers in the same execution."""
    return {"B": {"A": {"Worker": ctype}}}


def test_constraint_disjoint_removes_candidates():
    """B must not reuse A's worker, so r1 leaves B's queue [r2, r3, r1]: picking
    r3 turns from the middle (other) into the back (LIFO)."""
    ocel, variant = _constrained_log(["r3"])
    assert _evidence(ocel) == {"first_seen": 3, "FIFO": 1, "other": 1}
    assert _evidence(
        ocel, variants=[variant], resource_constraints={variant: _b_after_a("disjoint")}
    ) == {"first_seen": 3, "FIFO": 1, "LIFO": 1}


def test_constraint_superset_forced_resource_is_not_a_choice():
    """B must include A's worker r1, so only the second pick r2 is a choice: it
    is the front of the free queue [r2, r3] → FIFO. Unconstrained, {r1, r2} is
    neither block of [r2, r3, r1] → other."""
    ocel, variant = _constrained_log(["r1", "r2"])
    assert _evidence(ocel) == {"first_seen": 3, "FIFO": 1, "other": 1}
    assert _evidence(
        ocel, variants=[variant], resource_constraints={variant: _b_after_a("superset")}
    ) == {"first_seen": 3, "FIFO": 2}


def test_constraint_superset_omitted_resource_is_violation():
    """B must include A's worker r1 but the log only assigns r2: the strict
    playout never produces this assignment, so it is no evidence."""
    ocel, variant = _constrained_log(["r2"])
    assert _evidence(
        ocel, variants=[variant], resource_constraints={variant: _b_after_a("superset")}
    ) == {"first_seen": 3, "FIFO": 1, "constraint_violation": 1}


def test_constraint_same_resource_leaves_no_choice():
    """B must reuse A's worker r1: the constraint fully determines the pick."""
    ocel, variant = _constrained_log(["r1"])
    assert _evidence(
        ocel,
        variants=[variant],
        resource_constraints={variant: _b_after_a("same_resource")},
    ) == {"first_seen": 3, "FIFO": 1, "no_choice": 1}


def test_constraint_violation_not_counted():
    """B must reuse A's worker r1 but the log picks r3: the observed assignment
    breaks the mined constraint and is no evidence about the strategy."""
    ocel, variant = _constrained_log(["r3"])
    assert _evidence(
        ocel,
        variants=[variant],
        resource_constraints={variant: _b_after_a("same_resource")},
    ) == {"first_seen": 3, "FIFO": 1, "constraint_violation": 1}


def test_constraint_fallback_applies_to_unmined_variants():
    """A variant absent from the per-variant constraints uses the fallback."""
    ocel, variant = _constrained_log(["r3"])
    assert _evidence(
        ocel,
        variants=[variant],
        resource_constraints={},
        fallback_constraints=_b_after_a("disjoint"),
    ) == {"first_seen": 3, "FIFO": 1, "LIFO": 1}


def test_constraint_scoped_to_execution():
    """A's worker in another execution does not constrain B."""
    ocel, _ = _constrained_log(["r3"])
    variant = _Variant(["e1"], ["e2"], ["e3"], ["e4"], ["e5"])
    assert _evidence(
        ocel, variants=[variant], resource_constraints={variant: _b_after_a("disjoint")}
    ) == {"first_seen": 3, "FIFO": 1, "other": 1}


# --- strategy selection ---
def test_select_supported_strategy():
    assert select_allocation_strategy({"FIFO": 6, "LIFO": 1, "other": 1}) == "FIFO"
    assert select_allocation_strategy({"FIFO": 1, "LIFO": 6, "other": 1}) == "LIFO"


def test_select_below_absolute_support_is_random():
    assert select_allocation_strategy({"FIFO": 4}) == "random"
    assert select_allocation_strategy({"FIFO": 4}, min_absolute_support=4) == "FIFO"


def test_select_below_relative_support_is_random():
    """6 of 11 informative assignments (55%) is below the 60% default."""
    assert select_allocation_strategy({"FIFO": 6, "LIFO": 5}) == "random"
    assert (
        select_allocation_strategy({"FIFO": 6, "LIFO": 5}, min_relative_support=0.5)
        == "FIFO"
    )


def test_select_tie_is_random():
    assert (
        select_allocation_strategy(
            {"FIFO": 6, "LIFO": 6}, min_absolute_support=1, min_relative_support=0.0
        )
        == "random"
    )


def test_select_other_majority_is_random():
    assert select_allocation_strategy({"FIFO": 5, "other": 10}) == "random"


def test_select_no_evidence_is_random():
    assert select_allocation_strategy({}) == "random"
    assert select_allocation_strategy({"first_seen": 3, "no_choice": 9}) == "random"


def test_select_excluded_assignments_do_not_dilute_support():
    """Only informative assignments form the denominator of the relative support."""
    counts = {"FIFO": 5, "no_choice": 100, "not_idle": 50, "first_seen": 4}
    assert select_allocation_strategy(counts) == "FIFO"


# --- end to end ---
def test_strategy_alternating_workers_is_fifo():
    """Two workers take turns, so each pick is the one idle longest → 7× FIFO."""
    events, objects = _workers(2)
    for i in range(7):
        events.append(_event(f"x{i}", "A", 100 * (i + 1), [], [f"r{i % 2 + 1}"]))
    ocel = make_ocel(events, objects)
    assert _evidence(ocel) == {"first_seen": 2, "FIFO": 7}
    assert calculate_resource_allocation_strategy(ocel) == {"Worker": "FIFO"}


def test_strategy_same_worker_reused_is_lifo():
    """r2 is picked again and again while r1 stays idle → 7× LIFO."""
    events, objects = _workers(2)
    for i in range(7):
        events.append(_event(f"x{i}", "A", 100 * (i + 1), [], ["r2"]))
    ocel = make_ocel(events, objects)
    assert _evidence(ocel) == {"first_seen": 2, "LIFO": 7}
    assert calculate_resource_allocation_strategy(ocel) == {"Worker": "LIFO"}


def test_strategy_without_support_falls_back_to_random():
    """A single FIFO hit is not enough evidence, but the type is still reported."""
    events, objects = _workers(2)
    events.append(_event("e3", "A", 100, [], ["r1"]))
    ocel = make_ocel(events, objects)
    assert calculate_resource_allocation_strategy(ocel) == {"Worker": "random"}
    assert calculate_resource_allocation_strategy(ocel, min_absolute_support=1) == {
        "Worker": "FIFO"
    }


# --- busy time ---
def test_busy_time_is_high_quantile_of_cooldowns():
    """
    r1 counts as idle only once the high quantile of A's samples has passed
    (480s by default): it is still busy at t=450 but idle at t=500. With the
    median as busy time it would already be idle at t=450.
    """
    cooldowns = {"A": {"Worker": {"samples": [100.0, 200.0, 300.0, 400.0, 500.0]}}}
    objects = [obj("r1", "Worker")]
    early = make_ocel(
        [_event("e1", "A", 0, [], ["r1"]), _event("e2", "A", 450, [], ["r1"])],
        objects,
    )
    late = make_ocel(
        [_event("e1", "A", 0, [], ["r1"]), _event("e2", "A", 500, [], ["r1"])],
        objects,
    )
    assert _evidence(early, cooldowns) == {"first_seen": 1, "not_idle": 1}
    assert _evidence(late, cooldowns) == {"first_seen": 1, "no_choice": 1}
    assert _evidence(early, cooldowns, busy_quantile=0.5) == {
        "first_seen": 1,
        "no_choice": 1,
    }
