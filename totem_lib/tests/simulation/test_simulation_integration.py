"""End-to-end effect tests for the individual simulation-model components.

Each section drives the full ``VariantPlayoutStrategy.run`` and asserts that one
model component (calendars, the resource pool, constraints + violation degree,
cooldowns, the arrival distribution, activity durations) actually changes the
simulated outcome in the expected way.

Determinism: runs are seeded and the scenarios are built so the asserted effect
is structural (an activity can/cannot fire, a resource must/must not be reused),
not a fragile probabilistic margin.
"""

import datetime as dt
import json
import random
from collections import defaultdict

import networkx as nx
import numpy as np

from totem_lib.simulation.simulation import (
    OCProcessAreaSimulationConfiguration,
    OCProcessAreaSimulationModel,
    VariantPlayoutStrategy,
    _CalendarGate,
)
from totem_lib.simulation.utils.resource_calendar import WEEKDAYS

UTC = dt.timezone.utc
START = dt.datetime(2024, 1, 1, 10, 0, tzinfo=UTC)  # Monday 10:00
HOUR = 3600


def _cd(value: float) -> dict:
    """A degenerate (single-value) cooldown histogram: ``sample_cooldown`` always
    returns ``value``, keeping cooldown-driven runs deterministic in tests."""
    return {"bin_edges": [float(value), float(value)], "bin_counts": [1]}


# --- test scaffolding ---


class _Variant:
    """Minimal variant: a node-labelled DiGraph plus a ``support`` attribute.

    ``nodes`` maps node id -> activity label; ``edges`` is a list of
    ``(src, dst, object_type, [object_ids])`` used both for the DFG structure
    (predecessor gating) and to seed the instance's objects.
    """

    def __init__(self, nodes, edges=None):
        self.graph = nx.DiGraph()
        for nid, label in nodes.items():
            self.graph.add_node(nid, label=label)
        for src, dst, otype, objs in edges or []:
            self.graph.add_edge(src, dst, type=otype, objects=list(objs))
        self.support = 1


def _single(activity="Load"):
    """One-activity variant (node ``n0``)."""
    return _Variant({"n0": activity})


def _chain(a="A", b="B"):
    """Two-activity variant ``a -> b`` carrying one Order object."""
    return _Variant({"n0": a, "n1": b}, [("n0", "n1", "Order", ["o1"])])


def _slot_arrivals(variant, rate=5.0, weekday="Monday", hour=10):
    """Arrivals concentrated in a single weekday/hour slot."""
    return {variant: {"avg_arrivals_per_hour": {weekday: {hour: rate}}}}


def _flat_arrivals(variant, rate):
    """Constant arrival rate in every weekday/hour slot."""
    per_hour = {h: rate for h in range(24)}
    return {variant: {"avg_arrivals_per_hour": {day: per_hour for day in WEEKDAYS}}}


def _needs(activity_to_types):
    """Build a needed-resources map: {activity: {res_type: count}} -> engine form."""
    return {
        act: {
            rtype: {"count_distribution": {count: 1.0}}
            for rtype, count in types.items()
        }
        for act, types in activity_to_types.items()
    }


def _build_model(
    variant,
    *,
    needed,
    arrivals=None,
    constraints=None,
    cooldowns=None,
    allocation=None,
    delays=None,
    config=None,
    type_calendars=None,
):
    return OCProcessAreaSimulationModel(
        playout_strategy=VariantPlayoutStrategy(
            [variant], arrivals or _slot_arrivals(variant)
        ),
        resource_constraints=constraints or {},
        resource_allocation_strategy=allocation or {},
        resource_cooldown_distribution=cooldowns or {},
        totem_model=None,
        needed_resources_per_activity={variant: needed},
        simulation_config=config or OCProcessAreaSimulationConfiguration(),
        source_log_start_unix=int(START.timestamp()),
        activity_delays=delays or {},
        type_calendars=type_calendars,
    )


def _run(model, *, pool, duration_s=HOUR, tick_s=60, seed=42):
    random.seed(seed)
    np.random.seed(seed)
    return model.run(sim_duration_s=duration_s, resource_pool=pool, tick_size_s=tick_s)


def _records(ocel):
    """Flatten the simulated OCEL into per-event dicts.

    Event ids are ``sim_e_{instance}_{node}``; resources live in the JSON
    ``_attributes`` under ``process_area_resources``.
    """
    rows = []
    for r in ocel.events.iter_rows(named=True):
        _, _, inst, node = r["_eventId"].split("_", 3)
        attrs = json.loads(r["_attributes"]) if r["_attributes"] else {}
        rows.append(
            {
                "inst": inst,
                "node": node,
                "activity": r["_activity"],
                "ts": r["_timestampUnix"],
                "resources": attrs.get("process_area_resources", []),
            }
        )
    return rows


def _by_instance(ocel):
    """Group events by instance id: {inst: {activity: record}}."""
    grouped = defaultdict(dict)
    for rec in _records(ocel):
        grouped[rec["inst"]][rec["activity"]] = rec
    return grouped


def _activities(ocel):
    return set(ocel.events["_activity"].to_list())


# --- resource calendars ---


def test_calendar_all_on_lets_activity_fire():
    """A Worker calendar that is on in every slot behaves like no gate at all."""
    variant = _single("Load")
    cals = {"Worker": {day: [1.0] * 24 for day in WEEKDAYS}}
    model = _build_model(
        variant, needed=_needs({"Load": {"Worker": 1}}), type_calendars=cals
    )
    ocel, finished, spawned = _run(model, pool={"Worker": 2})
    assert spawned > 0
    assert finished > 0
    assert ocel.events.height > 0


def test_calendar_all_off_blocks_activity():
    """An all-off Worker calendar means the Worker is never on shift, so the
    Worker-requiring activity can never fire even though arrivals happen."""
    variant = _single("Load")
    cals = {"Worker": {day: [0.0] * 24 for day in WEEKDAYS}}
    model = _build_model(
        variant, needed=_needs({"Load": {"Worker": 1}}), type_calendars=cals
    )
    ocel, finished, spawned = _run(model, pool={"Worker": 2})
    assert spawned > 0  # same arrivals as the all-on run
    assert finished == 0  # but no instance can obtain a Worker
    assert ocel.events.height == 0


def test_calendar_absent_matches_all_on():
    """Without calendars the gate is inert -> identical outcome to an all-on one."""
    variant = _single("Load")
    needed = _needs({"Load": {"Worker": 1}})
    _, fin_none, spawn_none = _run(
        _build_model(variant, needed=needed, type_calendars=None), pool={"Worker": 2}
    )
    cals = {"Worker": {day: [1.0] * 24 for day in WEEKDAYS}}
    _, fin_on, spawn_on = _run(
        _build_model(variant, needed=needed, type_calendars=cals), pool={"Worker": 2}
    )
    assert spawn_none == spawn_on
    assert fin_none == fin_on and fin_none > 0


# --- resource pool availability ---


def test_pool_sufficient_when_demand_met():
    """One Worker suffices for an activity that needs exactly one."""
    variant = _single("Load")
    model = _build_model(variant, needed=_needs({"Load": {"Worker": 1}}))
    _, finished, spawned = _run(model, pool={"Worker": 1})
    assert spawned > 0 and finished > 0


def test_pool_too_small_blocks_activity():
    """An activity needing two Workers can never fire from a pool of one, but
    fires once the pool is large enough (same arrivals, same seed)."""
    needed = _needs({"Load": {"Worker": 2}})
    _, fin_small, spawned = _run(
        _build_model(_single("Load"), needed=needed), pool={"Worker": 1}
    )
    _, fin_ok, _ = _run(
        _build_model(_single("Load"), needed=needed), pool={"Worker": 2}
    )
    assert spawned > 0
    assert fin_small == 0
    assert fin_ok > 0


# --- resource constraints & violation degree ---


def test_disjoint_constraint_blocks_second_activity_when_strict():
    """B is disjoint from A on Worker. With a single Worker and strict enforcement
    (violation degree 0), B can never obtain a Worker different from A's -> only A
    ever fires and no instance completes."""
    variant = _chain("A", "B")
    model = _build_model(
        variant,
        needed=_needs({"A": {"Worker": 1}, "B": {"Worker": 1}}),
        constraints={variant: {"B": {"A": {"Worker": "disjoint"}}}},
    )
    ocel, finished, spawned = _run(model, pool={"Worker": 1})
    assert spawned > 0
    assert finished == 0
    assert _activities(ocel) == {"A"}  # B is starved by the disjoint constraint


def test_violation_degree_one_ignores_constraint():
    """The same disjoint scenario with violation degree 1 skips constraints
    entirely, so B reuses the single Worker and instances complete."""
    variant = _chain("A", "B")
    model = _build_model(
        variant,
        needed=_needs({"A": {"Worker": 1}, "B": {"Worker": 1}}),
        constraints={variant: {"B": {"A": {"Worker": "disjoint"}}}},
        config=OCProcessAreaSimulationConfiguration(
            resource_constraint_violation_degree=1.0
        ),
    )
    ocel, finished, spawned = _run(model, pool={"Worker": 1})
    assert finished > 0
    assert _activities(ocel) == {"A", "B"}


def test_disjoint_constraint_uses_distinct_resources_when_feasible():
    """With two Workers the strict disjoint constraint is satisfiable: within each
    instance A and B must be served by different Workers."""
    variant = _chain("A", "B")
    model = _build_model(
        variant,
        needed=_needs({"A": {"Worker": 1}, "B": {"Worker": 1}}),
        constraints={variant: {"B": {"A": {"Worker": "disjoint"}}}},
    )
    ocel, finished, _ = _run(model, pool={"Worker": 2})
    assert finished > 0
    completed = [
        acts for acts in _by_instance(ocel).values() if "A" in acts and "B" in acts
    ]
    assert completed
    for acts in completed:
        assert set(acts["A"]["resources"]).isdisjoint(acts["B"]["resources"])


# --- resource cooldown ---


def test_cooldown_delays_reuse_of_the_same_resource():
    """A same_resource constraint forces B onto A's exact Worker; a cooldown after
    A therefore blocks B until the cooldown elapses. The A->B gap must exceed the
    cooldown, whereas without a cooldown B follows almost immediately.

    Isolating the cooldown per instance (via same_resource) makes the gap
    independent of arrival timing and pool contention.
    """
    cooldown_s = 600
    needed = _needs({"A": {"Worker": 1}, "B": {"Worker": 1}})
    constraints_same = {"B": {"A": {"Worker": "same_resource"}}}

    def run_with(cooldowns):
        variant = _chain("A", "B")
        model = _build_model(
            variant,
            needed=needed,
            constraints={variant: constraints_same},
            cooldowns=cooldowns,
        )
        ocel, _, _ = _run(model, pool={"Worker": 2}, duration_s=2 * HOUR)
        return [
            acts["B"]["ts"] - acts["A"]["ts"]
            for acts in _by_instance(ocel).values()
            if "A" in acts and "B" in acts
        ]

    with_cd = run_with({"A": {"Worker": _cd(cooldown_s)}})
    without_cd = run_with({})

    assert with_cd and without_cd
    # cooldown run: B waits out the (exact) cooldown before reusing A's Worker.
    assert all(gap >= cooldown_s - 60 for gap in with_cd)
    # no cooldown: A's Worker frees immediately, B follows within a tick or two.
    assert all(gap < cooldown_s for gap in without_cd)


def test_cooldown_burns_only_during_available_hours():
    """A calendar off block *inside* a cooldown extends the wall-clock block.

    The cooldown is working time, so an absence in the middle of it (here the
    Worker is off Monday 11:00-12:00) must pause the countdown and push the reuse
    past the off hour: a 2h cooldown starting in hour 10 frees the Worker at 13:00
    (2 working hours 10-11 + 12-13), a 3h A->B gap, versus a flat 2h gap when the
    Worker is always on. A generous pool removes contention so the gap is purely
    the per-resource cooldown burn-down.
    """
    cooldown_s = 2 * HOUR
    needed = _needs({"A": {"Worker": 1}, "B": {"Worker": 1}})
    constraints_same = {"B": {"A": {"Worker": "same_resource"}}}
    cooldowns = {"A": {"Worker": _cd(cooldown_s)}}

    on = [1.0] * 24
    off_at_11 = [1.0] * 24
    off_at_11[11] = 0.0
    all_on = {"Worker": {day: list(on) for day in WEEKDAYS}}
    off_block = {"Worker": {day: list(off_at_11) for day in WEEKDAYS}}

    def run_with(type_calendars):
        variant = _chain("A", "B")
        model = _build_model(
            variant,
            needed=needed,
            constraints={variant: constraints_same},
            cooldowns=cooldowns,
            type_calendars=type_calendars,
        )
        # Plenty of Workers -> no queueing; each B reuses its own A's Worker.
        ocel, _, _ = _run(model, pool={"Worker": 50}, duration_s=5 * HOUR)
        return [
            acts["B"]["ts"] - acts["A"]["ts"]
            for acts in _by_instance(ocel).values()
            if "A" in acts and "B" in acts
        ]

    all_on_gaps = run_with(all_on)
    off_block_gaps = run_with(off_block)

    assert all_on_gaps and off_block_gaps
    # Always on: the gap is the flat 2h cooldown (± tick jitter).
    assert all(cooldown_s - 120 <= gap <= cooldown_s + 240 for gap in all_on_gaps)
    # Off block inside the cooldown: the countdown skips the missing hour, so the
    # Worker frees ~1h later and every reuse gap grows by roughly that hour.
    assert min(off_block_gaps) > max(all_on_gaps) + HOUR - 240


# --- arrival distribution ---


def test_no_arrivals_produces_empty_log():
    """An arrival distribution of zero everywhere spawns nothing."""
    variant = _single("Load")
    arrivals = _slot_arrivals(variant, rate=0.0)
    model = _build_model(
        variant, needed=_needs({"Load": {"Worker": 1}}), arrivals=arrivals
    )
    ocel, finished, spawned = _run(model, pool={"Worker": 1})
    assert spawned == 0 and finished == 0 and ocel.events.height == 0


def test_higher_arrival_rate_spawns_more_instances():
    """A tenfold arrival rate spawns markedly more instances over the same span.

    The activity needs no resources, so spawning is decoupled from the pool and
    every arrival immediately completes.
    """
    variant = _single("Load")
    needed = _needs({"Load": {}})  # resource-free activity
    _, _, spawn_low = _run(
        _build_model(variant, needed=needed, arrivals=_flat_arrivals(variant, 1.0)),
        pool={},
        duration_s=24 * HOUR,
    )
    _, _, spawn_high = _run(
        _build_model(variant, needed=needed, arrivals=_flat_arrivals(variant, 10.0)),
        pool={},
        duration_s=24 * HOUR,
    )
    assert spawn_low > 0
    assert spawn_high > 3 * spawn_low


# --- activity durations ---


def test_activity_duration_model_delays_successor():
    """With the duration model on, B is held back by a sampled inter-activity
    delay; with it off, B fires on the next tick. Resource-free so the gap is
    pure timing.
    """
    delay_s = 1800
    needed = _needs({"A": {}, "B": {}})
    delays = {"B": [delay_s]}

    def gaps(config):
        variant = _chain("A", "B")
        model = _build_model(variant, needed=needed, delays=delays, config=config)
        ocel, _, _ = _run(model, pool={}, duration_s=2 * HOUR)
        return [
            acts["B"]["ts"] - acts["A"]["ts"]
            for acts in _by_instance(ocel).values()
            if "A" in acts and "B" in acts
        ]

    on = gaps(OCProcessAreaSimulationConfiguration(model_activity_durations=True))
    off = gaps(OCProcessAreaSimulationConfiguration(model_activity_durations=False))

    assert on and off
    assert all(gap >= delay_s - 60 for gap in on)
    assert all(gap < delay_s for gap in off)


# --- calendar gate: one realized schedule per (resource, hour) ---


def test_gate_cooldown_end_skips_absent_hours():
    """A deterministic (p in {0,1}) calendar: the cooldown burns present hours and
    pauses on absent ones. Start Monday 10:00, hour 11 off, 2h cooldown -> the
    Worker frees at 13:00 (working hours 10-11 and 12-13)."""
    on = [1.0] * 24
    on[11] = 0.0
    cals = {"Worker": {day: list(on) for day in WEEKDAYS}}
    gate = _CalendarGate(cals, {})
    start = int(START.timestamp())  # Monday 10:00, hour-aligned
    end = gate.cooldown_end("Worker_1", "Worker", start, 2 * HOUR)
    assert end == start + 3 * HOUR


def test_gate_cooldown_end_is_wallclock_without_a_calendar():
    """No calendar for the resource (or an inactive gate) -> flat wall-clock."""
    start = int(START.timestamp())
    assert _CalendarGate({}, {}).cooldown_end("Worker_1", "Worker", start, 1234) == (
        start + 1234
    )
    active_other = _CalendarGate({"Other": {day: [1.0] * 24 for day in WEEKDAYS}}, {})
    assert active_other.cooldown_end("Worker_1", "Worker", start, 1234) == start + 1234


def test_gate_hour_decision_is_stable_and_shared_with_cooldown():
    """A fractional-p slot is drawn once per (resource, hour): repeated allocation
    checks never re-flip within the hour, and the cooldown burn-down reuses the
    exact same realized bit rather than drawing independently."""
    cals = {"Worker": {day: [0.5] * 24 for day in WEEKDAYS}}
    random.seed(7)
    gate = _CalendarGate(cals, {})
    start = int(START.timestamp())
    hour = start // 3600
    first = gate.is_available("Worker_1", "Worker", hour, start)
    assert all(
        gate.is_available("Worker_1", "Worker", hour, start) == first for _ in range(50)
    )
    gate.cooldown_end("Worker_1", "Worker", start, 5 * HOUR)
    assert gate._shift[("Worker_1", hour)] == first
