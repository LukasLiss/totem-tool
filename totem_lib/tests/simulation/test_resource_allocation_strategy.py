from tests.assets.ocel_helpers import event as _event
from tests.assets.ocel_helpers import make_ocel, obj
from totem_lib.simulation.utils.resource_calendar import WEEKDAYS
from totem_lib.simulation.utils.resource_statistics import (
    calculate_resource_allocation_strategy,
)


def _flat_calendar(prob: float) -> dict:
    """A Worker calendar with the same availability probability in every slot."""
    return {"Worker": {day: [prob] * 24 for day in WEEKDAYS}}


def _cd(value: float) -> dict:
    """A degenerate (single-value) cooldown histogram: sampling always returns
    ``value``, so cooldown-dependent replays stay deterministic in tests."""
    return {"bin_edges": [float(value), float(value)], "bin_counts": [1]}


def test_fifo_strategy():
    """
    r1 freed at t=0, r2 freed at t=10. Next event picks r1 (earliest) → FIFO.
    """
    ocel = make_ocel(
        [
            _event("e1", "A", 0, [], ["r1"]),
            _event("e2", "A", 10, [], ["r2"]),
            _event(
                "e3", "A", 100, [], ["r1"]
            ),  # r1 is at pos=0 (earliest freed) → FIFO
        ],
        [obj("r1", "Worker"), obj("r2", "Worker")],
    )
    result = calculate_resource_allocation_strategy(ocel)
    assert result["Worker"] == "FIFO"


def test_lifo_strategy():
    """
    r1 freed at t=0, r2 freed at t=10. Next event picks r2 (most recently freed) → LIFO.
    """
    ocel = make_ocel(
        [
            _event("e1", "A", 0, [], ["r1"]),
            _event("e2", "A", 10, [], ["r2"]),
            _event("e3", "A", 100, [], ["r2"]),  # r2 is at pos=1 (last) → LIFO
        ],
        [obj("r1", "Worker"), obj("r2", "Worker")],
    )
    result = calculate_resource_allocation_strategy(ocel)
    assert result["Worker"] == "LIFO"


def test_random_strategy():
    """
    r1 freed at t=0, r2 at t=10, r3 at t=20. Next event picks r2 (middle) → random.
    """
    ocel = make_ocel(
        [
            _event("e1", "A", 0, [], ["r1"]),
            _event("e2", "A", 10, [], ["r2"]),
            _event("e3", "A", 20, [], ["r3"]),
            _event("e4", "A", 100, [], ["r2"]),  # r2 at pos=1 in [r1, r2, r3] → random
        ],
        [obj("r1", "Worker"), obj("r2", "Worker"), obj("r3", "Worker")],
    )
    result = calculate_resource_allocation_strategy(ocel)
    assert result["Worker"] == "random"


def test_single_candidate_scores_fifo():
    """
    Only one resource is in the idle queue (n=1). Should always count as FIFO.
    """
    ocel = make_ocel(
        [
            _event("e1", "A", 0, [], ["r1"]),
            _event("e2", "A", 50, [], ["r1"]),  # r1 is the only candidate → n=1 → FIFO
        ],
        [obj("r1", "Worker")],
    )
    result = calculate_resource_allocation_strategy(ocel)
    assert result["Worker"] == "FIFO"


def test_first_event_not_scored():
    """
    A resource's very first event: it is not yet in the idle queue.
    No score is counted and the result must be empty (no crash).
    """
    ocel = make_ocel(
        [_event("e1", "A", 0, [], ["r1"])],
        [obj("r1", "Worker")],
    )
    result = calculate_resource_allocation_strategy(ocel)
    assert result == {}


def test_cooldown_excludes_resource_from_candidates():
    """
    r1 has cooldown=200s, r2 has cooldown=0s (different activities).
    At t=50, r1 is still cooling (available at t=200) so only r2 is a candidate.
    Without the cooldown r1 would also be present and r2 would score as LIFO;
    with the cooldown r2 is the single candidate and scores FIFO.
    """
    cooldowns = {
        "LongTask": {"Worker": _cd(200)},
        "ShortTask": {"Worker": _cd(0)},
    }
    ocel = make_ocel(
        [
            _event("e1", "LongTask", 0, [], ["r1"]),  # r1 available again at t=200
            _event("e2", "ShortTask", 10, [], ["r2"]),  # r2 available again at t=10
            _event(
                "e3", "ShortTask", 50, [], ["r2"]
            ),  # r1 not available (200 > 50) → only r2 → FIFO
        ],
        [obj("r1", "Worker"), obj("r2", "Worker")],
    )
    result = calculate_resource_allocation_strategy(ocel, resource_cooldowns=cooldowns)
    assert result["Worker"] == "FIFO"


def test_two_resource_types_scored_independently():
    """
    Workers and Companies are tracked and scored independently.
    w1 freed first → FIFO for Workers; c2 freed last → LIFO for Companies.
    """
    ocel = make_ocel(
        [
            _event("e1", "A", 0, [], ["w1", "c1"]),
            _event("e2", "A", 10, [], ["w2", "c2"]),
            _event(
                "e3", "A", 100, [], ["w1", "c2"]
            ),  # w1=pos 0 (FIFO), c2=pos 1/last (LIFO)
        ],
        [
            obj("w1", "Worker"),
            obj("w2", "Worker"),
            obj("c1", "Company"),
            obj("c2", "Company"),
        ],
    )
    result = calculate_resource_allocation_strategy(ocel)
    assert result["Worker"] == "FIFO"
    assert result["Company"] == "LIFO"


def test_majority_strategy_wins():
    """
    Over 4 scored events, FIFO occurs 3 times and LIFO once → FIFO wins.

    Queue state walkthrough (no cooldown):
      e1 t=0:   r1 used, not in queue yet — no score. Queue: r1@0
      e2 t=10:  r2 used, not in queue yet — no score. Queue: r1@0, r2@10
      e3 t=100: candidates [(0,r1),(10,r2)]. r1 chosen → pos=0 → FIFO. Queue: r2@10, r1@100
      e4 t=200: candidates [(10,r2),(100,r1)]. r2 chosen → pos=0 → FIFO. Queue: r1@100, r2@200
      e5 t=300: candidates [(100,r1),(200,r2)]. r1 chosen → pos=0 → FIFO. Queue: r2@200, r1@300
      e6 t=400: candidates [(200,r2),(300,r1)]. r1 chosen → pos=1 (last) → LIFO.
    Scores: FIFO=3, LIFO=1 → FIFO wins.
    """
    ocel = make_ocel(
        [
            _event("e1", "A", 0, [], ["r1"]),
            _event("e2", "A", 10, [], ["r2"]),
            _event("e3", "A", 100, [], ["r1"]),
            _event("e4", "A", 200, [], ["r2"]),
            _event("e5", "A", 300, [], ["r1"]),
            _event("e6", "A", 400, [], ["r1"]),
        ],
        [obj("r1", "Worker"), obj("r2", "Worker")],
    )
    result = calculate_resource_allocation_strategy(ocel)
    assert result["Worker"] == "FIFO"


# --- calendar consistency ---
def test_calendar_discounts_cooldown_to_wallclock():
    """
    The cooldown is calendar-discounted working time, so under a 0.5 calendar a
    100s cooldown stretches to 200s wall-clock. r1 does LongTask at t=0; at t=150
    it is still cooling (idle again at t=200, not t=100), so it is not a candidate
    and the event goes unscored. Without the calendar r1 is idle at t=100 and the
    event scores FIFO.
    """
    cooldowns = {
        "LongTask": {"Worker": _cd(100)},
        "ShortTask": {"Worker": _cd(0)},
    }
    ocel = make_ocel(
        [
            _event("e1", "LongTask", 0, [], ["r1"]),
            _event("e2", "ShortTask", 150, [], ["r1"]),
        ],
        [obj("r1", "Worker")],
    )
    assert calculate_resource_allocation_strategy(ocel, cooldowns) == {"Worker": "FIFO"}
    assert (
        calculate_resource_allocation_strategy(
            ocel, cooldowns, calendars=_flat_calendar(0.5)
        )
        == {}
    )


def test_calendar_offshift_type_not_scored():
    """
    A resource type that is never present (all-zero calendar) is excluded as a
    candidate at every event, so no queue position is ever scored. The same log
    without a calendar scores FIFO.
    """
    ocel = make_ocel(
        [
            _event("e1", "A", 0, [], ["r1"]),
            _event("e2", "A", 10, [], ["r2"]),
            _event("e3", "A", 100, [], ["r1"]),
        ],
        [obj("r1", "Worker"), obj("r2", "Worker")],
    )
    assert calculate_resource_allocation_strategy(ocel) == {"Worker": "FIFO"}
    assert (
        calculate_resource_allocation_strategy(ocel, calendars=_flat_calendar(0.0))
        == {}
    )


# --- multiple resources of one type per event ---
def _four_workers():
    """Four workers freed at t=0/10/20/30, so the idle queue is [r1, r2, r3, r4]."""
    return (
        [
            _event("e1", "A", 0, [], ["r1"]),
            _event("e2", "A", 10, [], ["r2"]),
            _event("e3", "A", 20, [], ["r3"]),
            _event("e4", "A", 30, [], ["r4"]),
        ],
        [obj(f"r{i}", "Worker") for i in range(1, 5)],
    )


def test_multi_front_positions_score_fifo():
    """
    One event consumes two workers at once. Queue is [r1, r2, r3, r4]; the event
    takes the two front-most (positions 0,1) → FIFO.
    """
    events, objects = _four_workers()
    events.append(_event("e5", "A", 100, [], ["r1", "r2"]))
    result = calculate_resource_allocation_strategy(make_ocel(events, objects))
    assert result["Worker"] == "FIFO"


def test_multi_back_positions_score_lifo():
    """
    Queue is [r1, r2, r3, r4]; the event takes the two back-most
    (positions 2,3) → LIFO.
    """
    events, objects = _four_workers()
    events.append(_event("e5", "A", 100, [], ["r3", "r4"]))
    result = calculate_resource_allocation_strategy(make_ocel(events, objects))
    assert result["Worker"] == "LIFO"


def test_multi_mixed_positions_score_random():
    """
    Queue is [r1, r2, r3, r4]; the event takes positions 0 and 2 — neither the
    front block nor the back block → random.
    """
    events, objects = _four_workers()
    events.append(_event("e5", "A", 100, [], ["r1", "r3"]))
    result = calculate_resource_allocation_strategy(make_ocel(events, objects))
    assert result["Worker"] == "random"


def test_multi_every_assigned_resource_gets_a_cooldown():
    """
    All resources an event consumes leave the idle queue and re-enter it with
    their own cooldown — not just the first one.

    Queue state walkthrough:
      e1 t=0:   r1 first use, unscored.            Queue: r1@0
      e2 t=10:  r2 first use, unscored.            Queue: r1@0, r2@10
      e3 t=20:  r3 first use, unscored.            Queue: r1@0, r2@10, r3@20
      e4 t=100: "Big" takes r1+r2 from [r1,r2,r3] → positions 0,1 → FIFO.
                Both go on a 1000s cooldown.       Queue: r3@20, r1@1100, r2@1100
      e5 t=200: only r3 is idle → n=1 → FIFO.      Queue: r1@1100, r2@1100, r3@200
      e6 t=300: only r3 is idle → n=1 → FIFO.
    Scores: FIFO=3 → FIFO.

    Were r2 left in the queue at @10, e5 and e6 would see it as free and score r3
    as the last of two candidates → LIFO=2 against FIFO=1, flipping the result.
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
    result = calculate_resource_allocation_strategy(ocel, resource_cooldowns=cooldowns)
    assert result["Worker"] == "FIFO"


def test_multi_partial_candidacy_not_scored():
    """
    An event requires a resource the replay still considers busy: r2 is on a
    1000s cooldown from e2 when e3 claims r1 and r2 together. Only r1 is in the
    queue, so the queue positions are not evidence about the strategy and the
    event goes unscored.
    """
    cooldowns = {"Big": {"Worker": _cd(1000)}, "Small": {"Worker": _cd(0)}}
    ocel = make_ocel(
        [
            _event("e1", "Small", 0, [], ["r1"]),
            _event("e2", "Big", 10, [], ["r2"]),
            _event("e3", "Small", 100, [], ["r1", "r2"]),
        ],
        [obj("r1", "Worker"), obj("r2", "Worker")],
    )
    assert calculate_resource_allocation_strategy(ocel, cooldowns) == {}
