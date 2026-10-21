import datetime as dt
import random

import numpy as np
import pytest

from tests.assets.ocel_helpers import (
    event as _event,
)
from tests.assets.ocel_helpers import (
    make_ocel as _make_ocel,
)
from tests.assets.ocel_helpers import (
    obj as _object,
)
from totem_lib.simulation.utils.resource_calendar import (
    WEEKDAYS,
    ShiftPattern,
    assign_shift_calendars,
    available_seconds_between,
    calendar_distance,
    cluster_shift_patterns,
    discover_individual_calendars,
    discover_shift_patterns,
    pooled_type_calendars,
    smoothed_calendar_distance,
    type_calendar_from_patterns,
    wall_clock_end_for_available,
)

UTC = dt.timezone.utc
# 2024-01-01 is a Monday.
BASE_MONDAY = dt.datetime(2024, 1, 1, tzinfo=UTC)


def _ts(week: int = 0, weekday: int = 0, hour: int = 0) -> int:
    """Unix seconds for a slot `week` weeks after the base Monday, on `weekday`/`hour`."""
    t = BASE_MONDAY + dt.timedelta(weeks=week, days=weekday, hours=hour)
    return int(t.timestamp())


def _workday_calendar() -> dict:
    """Mon–Fri 08:00–18:00 available (prob 1.0), everything else off."""
    cal = {day: [0.0] * 24 for day in WEEKDAYS}
    for day in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]:
        for h in range(8, 18):
            cal[day][h] = 1.0
    return cal


def _shift_calendar(start: int, end: int) -> dict:
    """A Mon–Fri ``[start, end)`` binary calendar matrix."""
    cal = {day: [0.0] * 24 for day in WEEKDAYS}
    for day in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]:
        for h in range(start, end):
            cal[day][h] = 1.0
    return cal


def _slots_calendar(slots: dict[str, list[int]], level: float = 1.0) -> dict:
    """A calendar matrix holding ``level`` in the given ``{weekday: [hours]}`` slots."""
    cal = {day: [0.0] * 24 for day in WEEKDAYS}
    for day, hours in slots.items():
        for h in hours:
            cal[day][h] = level
    return cal


def _flat(cal: dict) -> np.ndarray:
    """The calendar as the flat 7*24 vector the distance functions take."""
    return np.array([cal[d][h] for d in WEEKDAYS for h in range(24)])


def _individual(ocel, resource_types=None, **kwargs) -> dict:
    """Individual calendars with the participation thresholds relaxed, so the
    small logs used here are not filtered out before the semantics are checked."""
    kwargs.setdefault("min_resource_events", 1)
    kwargs.setdefault("min_resource_weeks", 1)
    return discover_individual_calendars(ocel, resource_types or ["Worker"], **kwargs)


def _derived_type_calendar(ocel, rtype: str = "Worker") -> dict:
    """The type calendar as the model derives it: the share-weighted mean of the
    type's shift patterns, which equals the plain mean over its resources."""
    individual = _individual(ocel, [rtype])
    return type_calendar_from_patterns(cluster_shift_patterns(individual[rtype]))


def _shift_events(rid: str, hours: list[int], weeks: int, start_week: int = 0):
    """One Load event per weekday/hour in ``hours`` for ``weeks`` consecutive weeks."""
    events = []
    for w in range(start_week, start_week + weeks):
        for d in range(5):
            for h in hours:
                events.append(
                    _event(
                        f"{rid}_{w}_{d}_{h}",
                        "Load",
                        _ts(week=w, weekday=d, hour=h),
                        ["obj", rid],
                    )
                )
    return events


# --- discover_individual_calendars: happy path ---
def test_calendar_single_resource_single_slot():
    """r1 (Worker) appears every Monday at 10:00 for 3 weeks -> P=1.0 there, 0 elsewhere."""
    ocel = _make_ocel(
        [
            _event("e1", "Load", _ts(week=0, weekday=0, hour=10), ["obj", "r1"]),
            _event("e2", "Load", _ts(week=1, weekday=0, hour=10), ["obj", "r1"]),
            _event("e3", "Load", _ts(week=2, weekday=0, hour=10), ["obj", "r1"]),
        ],
        [_object("obj", "Order"), _object("r1", "Worker")],
    )
    cal = _individual(ocel)["Worker"]["r1"]

    assert cal["Monday"][10] == 1.0
    assert cal["Monday"][9] == 0.0
    assert cal["Tuesday"][10] == 0.0


def test_partial_presence_reads_against_the_busiest_peer():
    """r1 works Mon 10:00 in 2 of the 4 weeks that carried work there, r2 in all
    four. r2 defines what full presence looks like in that slot, so r1 reads
    0.5 -- both the demand share and the comparison with r2 agree here."""
    events = []
    for w in range(4):
        events.append(
            _event(f"r2_{w}", "Load", _ts(week=w, weekday=0, hour=10), ["obj", "r2"])
        )
    for w in (0, 3):
        events.append(
            _event(f"r1_{w}", "Load", _ts(week=w, weekday=0, hour=10), ["obj", "r1"])
        )
    objects = [
        _object("obj", "Order"),
        _object("r1", "Worker"),
        _object("r2", "Worker"),
    ]
    ocel = _make_ocel(events, objects)

    individual = _individual(ocel)["Worker"]
    assert individual["r2"]["Monday"][10] == 1.0
    assert individual["r1"]["Monday"][10] == 0.5


def test_calendar_type_is_average_all_resources_present():
    """Both Workers present in the (single) observed week -> type average = 1.0."""
    ocel = _make_ocel(
        [
            _event("e1", "Load", _ts(week=0, weekday=0, hour=10), ["obj", "r1", "r2"]),
        ],
        [_object("obj", "Order"), _object("r1", "Worker"), _object("r2", "Worker")],
    )
    assert _derived_type_calendar(ocel)["Monday"][10] == 1.0


def test_calendar_type_is_average_partial_presence():
    """r1 active Mon 10:00 in both observed weeks, r2 only in the first.

    c_r1 = 1.0 and c_r2 = 0.5, so the type is their *average* 0.75 (NOT the
    union, which would read 1.0).
    """
    ocel = _make_ocel(
        [
            _event("e1", "Load", _ts(week=0, weekday=0, hour=10), ["obj", "r1"]),
            _event("e2", "Load", _ts(week=1, weekday=0, hour=10), ["obj", "r1"]),
            _event("e3", "Load", _ts(week=0, weekday=0, hour=10), ["obj", "r2"]),
            # r2 is still observed in week 1, just not at Mon 10:00.
            _event("e4", "Load", _ts(week=1, weekday=1, hour=8), ["obj", "r2"]),
        ],
        [_object("obj", "Order"), _object("r1", "Worker"), _object("r2", "Worker")],
    )
    assert _derived_type_calendar(ocel)["Monday"][10] == 0.75


def test_calendar_individual_uses_own_observation_window():
    """A resource is measured against its own window: r2 joins in week 2 of a
    4-week log and is fully present in its slot rather than diluted.

    r1 is the case where conditioning on demand matters: of the three weeks that
    carried work at Mon 10:00 inside r1's window it acted in two (2/3), which is
    more than the 0.5 the comparison with the busier r2 would give.
    """
    ocel = _make_ocel(
        [
            _event("e1", "Load", _ts(week=0, weekday=0, hour=10), ["obj", "r1"]),
            _event("e2", "Load", _ts(week=3, weekday=0, hour=10), ["obj", "r1"]),
            _event("e3", "Load", _ts(week=2, weekday=0, hour=10), ["obj", "r2"]),
            _event("e4", "Load", _ts(week=3, weekday=0, hour=10), ["obj", "r2"]),
        ],
        [_object("obj", "Order"), _object("r1", "Worker"), _object("r2", "Worker")],
    )
    individual = _individual(ocel)

    assert individual["Worker"]["r1"]["Monday"][10] == 2 / 3
    assert individual["Worker"]["r2"]["Monday"][10] == 1.0
    # A type without observed resources maps to an empty dict, not a KeyError.
    assert _individual(ocel, ["Worker", "Crane"])["Crane"] == {}


# --- demand conditioning and the relative estimate ---
def _work_events(rid, hours, weeks, activity="Load", weekday=0, other_rid=None):
    """One event per listed hour, on `weekday`, for `weeks` consecutive weeks."""
    events = []
    for w in range(weeks):
        for h in hours:
            objs = ["obj", rid] if other_rid is None else ["obj", rid, other_rid]
            events.append(
                _event(
                    f"{rid}_{activity}_{w}_{h}",
                    activity,
                    _ts(week=w, weekday=weekday, hour=h),
                    objs,
                )
            )
    return events


def test_slot_is_scored_against_the_weeks_that_carried_work():
    """A worker faces work at 10:00 in only 3 of 10 observed weeks and takes it
    every time. The weeks without work must not count against it, so the slot
    reads 1.0 rather than 3/10."""
    events = _work_events("r1", [8], weeks=10)  # observed across 10 weeks
    events += _work_events("r1", [10], weeks=3, activity="Inspect")
    ocel = _make_ocel(events, [_object("obj", "Order"), _object("r1", "Worker")])

    cal = _individual(ocel)["Worker"]["r1"]
    assert cal["Monday"][10] == 1.0
    assert cal["Monday"][8] == 1.0


def test_missed_work_still_lowers_the_slot():
    """Conditioning on demand does not hand out presence: r1 took only one of
    the four weeks that carried work at Mon 10:00, while r2 took all four."""
    events = []
    for w in range(4):
        events.append(
            _event(f"r2_{w}", "Inspect", _ts(week=w, weekday=0, hour=10), ["obj", "r2"])
        )
    events.append(
        _event("r1_0", "Inspect", _ts(week=0, weekday=0, hour=10), ["obj", "r1"])
    )
    events += _work_events("r1", [8], weeks=4)
    objects = [
        _object("obj", "Order"),
        _object("r1", "Worker"),
        _object("r2", "Worker"),
    ]
    ocel = _make_ocel(events, objects)

    assert _individual(ocel)["Worker"]["r1"]["Monday"][10] == 0.25


def test_the_busiest_resource_of_a_slot_defines_full_presence():
    """A consequence of taking the maximum of the two estimates: whoever tops a
    slot reads 1.0 there, so a type with a single resource gets a calendar of
    the slots it was ever seen in."""
    ocel = _make_ocel(
        _work_events("r1", [9], weeks=2) + _work_events("r1", [14], weeks=8),
        [_object("obj", "Order"), _object("r1", "Worker")],
    )
    cal = _individual(ocel)["Worker"]["r1"]
    assert cal["Monday"][9] == 1.0
    assert cal["Monday"][14] == 1.0


def test_slots_the_type_never_faced_work_in_stay_empty():
    ocel = _make_ocel(
        _work_events("r1", [8], weeks=4),
        [_object("obj", "Order"), _object("r1", "Worker")],
    )
    cal = _individual(ocel)["Worker"]["r1"]
    assert cal["Monday"][3] == 0.0
    assert cal["Sunday"][8] == 0.0


def test_rotating_resources_are_lifted_by_the_relative_estimate():
    """Two workers alternate on the same Monday 09:00 task. Demand-conditioned
    each reads 0.5, but neither is part-time — measured against the busiest of
    the type they read 1.0."""
    events = []
    for w in range(8):
        rid = "r1" if w % 2 == 0 else "r2"
        events.append(
            _event(f"e{w}", "Load", _ts(week=w, weekday=0, hour=9), ["obj", rid])
        )
    objects = [
        _object("obj", "Order"),
        _object("r1", "Worker"),
        _object("r2", "Worker"),
    ]
    ocel = _make_ocel(events, objects)

    individual = _individual(ocel)["Worker"]
    assert individual["r1"]["Monday"][9] == 1.0
    assert individual["r2"]["Monday"][9] == 1.0


def test_relative_estimate_keeps_a_genuinely_rarer_resource_lower():
    """r2 shows up in a quarter of the weeks r1 does; the pool comparison must
    not inflate it to the busiest resource's level."""
    events = _work_events("r1", [9], weeks=8)
    events += [
        _event(f"r2_{w}", "Load", _ts(week=w, weekday=0, hour=9), ["obj", "r2"])
        for w in range(2)
    ]
    events += _work_events("r2", [14], weeks=8, activity="Inspect")
    objects = [
        _object("obj", "Order"),
        _object("r1", "Worker"),
        _object("r2", "Worker"),
    ]
    ocel = _make_ocel(events, objects)

    individual = _individual(ocel)["Worker"]
    assert individual["r1"]["Monday"][9] == 1.0
    assert individual["r2"]["Monday"][9] == 0.25


# --- participation thresholds: when the log says too little ---
def test_resource_below_the_event_threshold_gets_no_calendar():
    """Three events over three weeks describe no weekly rhythm, so the resource
    is left without a calendar instead of getting one made of noise."""
    ocel = _make_ocel(
        _work_events("r1", [9], weeks=3),
        [_object("obj", "Order"), _object("r1", "Worker")],
    )
    assert discover_individual_calendars(ocel, ["Worker"]) == {"Worker": {}}
    assert (
        "r1"
        in discover_individual_calendars(ocel, ["Worker"], min_resource_events=3)[
            "Worker"
        ]
    )


def test_resource_seen_in_too_few_weeks_gets_no_calendar():
    """Plenty of events, but all inside a single week — a weekly pattern cannot
    be told apart from one busy day."""
    ocel = _make_ocel(
        _work_events("r1", list(range(8, 20)), weeks=1),
        [_object("obj", "Order"), _object("r1", "Worker")],
    )
    assert discover_individual_calendars(ocel, ["Worker"]) == {"Worker": {}}
    assert discover_individual_calendars(ocel, ["Worker"], min_resource_weeks=1)[
        "Worker"
    ]


def test_dropped_resources_do_not_set_the_relative_baseline():
    """A resource that fails the thresholds must not become the busiest of its
    type. r3 is seen once, in a single week, which would make its rate 1.0 and
    drag the peak down from r1's 0.6; dropped, r1 tops the slot itself."""
    events = [
        _event(f"r1_{w}", "Load", _ts(week=w, weekday=0, hour=9), ["obj", "r1"])
        for w in (0, 2, 4)
    ]
    events += [
        _event(f"r2_{w}", "Load", _ts(week=w, weekday=0, hour=9), ["obj", "r2"])
        for w in (0, 2)
    ]
    # Keeps r2 above the thresholds and its window as long as r1's.
    events.append(
        _event("r2_4", "Load", _ts(week=4, weekday=0, hour=10), ["obj", "r2"])
    )
    events.append(_event("r3_1", "Load", _ts(week=1, weekday=0, hour=9), ["obj", "r3"]))
    objects = [
        _object("obj", "Order"),
        _object("r1", "Worker"),
        _object("r2", "Worker"),
        _object("r3", "Worker"),
    ]
    ocel = _make_ocel(events, objects)

    individual = discover_individual_calendars(
        ocel, ["Worker"], min_resource_events=3, min_resource_weeks=2
    )["Worker"]
    assert set(individual) == {"r1", "r2"}
    # r1 acted in 3 of its 5 observed weeks, r2 in 2 — r1 sets the peak.
    assert individual["r1"]["Monday"][9] == 1.0
    assert individual["r2"]["Monday"][9] == pytest.approx(0.4 / 0.6)


def test_relative_estimate_needs_a_peer_group():
    """A type with one qualifying resource has no peer group: the resource would
    be its own peak and read 1.0 in every slot it ever acted in, on a single
    observation, bypassing min_slot_support. The relative estimate is therefore
    only formed from two peers on, so a lone resource rests on the
    demand-conditioned one — here 3 of the 4 weeks that carried work in the slot."""
    events = [
        _event(f"r1_{w}", "Load", _ts(week=w, weekday=0, hour=9), ["obj", "r1"])
        for w in (0, 2, 4)
    ]
    events.append(_event("r2_1", "Load", _ts(week=1, weekday=0, hour=9), ["obj", "r2"]))
    objects = [
        _object("obj", "Order"),
        _object("r1", "Worker"),
        _object("r2", "Worker"),
    ]
    ocel = _make_ocel(events, objects)

    individual = discover_individual_calendars(
        ocel, ["Worker"], min_resource_events=3, min_resource_weeks=2
    )["Worker"]
    assert set(individual) == {"r1"}
    assert individual["r1"]["Monday"][9] == pytest.approx(0.75)


# --- discover_individual_calendars: edge cases ---
def test_calendar_empty_log_returns_empty():
    ocel = _make_ocel([], [])
    assert _individual(ocel) == {"Worker": {}}


# --- pooled fallback: one calendar for a type nobody qualifies in ---
def _thin_pool(n_resources: int, weeks: int):
    """`n_resources` objects that each appear briefly, but together cover every
    week of the log in the same two morning slots."""
    events, objects = [], [_object("obj", "Order")]
    for i in range(n_resources):
        rid = f"r{i}"
        objects.append(_object(rid, "Worker"))
        for w in range(weeks):
            if w % n_resources != i:
                continue
            for h in (8, 9):
                events.append(
                    _event(
                        f"{rid}_{w}_{h}",
                        "Load",
                        _ts(week=w, weekday=0, hour=h),
                        ["obj", rid],
                    )
                )
    return _make_ocel(events, objects)


def test_pooled_calendar_pools_the_types_objects():
    """No single resource is observed often enough, but together they show a
    clear Monday morning slot."""
    ocel = _thin_pool(n_resources=4, weeks=8)
    assert discover_individual_calendars(ocel, ["Worker"]) == {"Worker": {}}

    pooled = pooled_type_calendars(ocel, ["Worker"])["Worker"]
    assert pooled["Monday"][8] == 1.0
    assert pooled["Monday"][9] == 1.0
    assert pooled["Monday"][10] == 0.0


def test_shift_patterns_fall_back_to_the_pooled_calendar():
    """The fallback enters as a single pattern covering the whole type, so every
    simulated instance receives it."""
    ocel = _thin_pool(n_resources=4, weeks=8)

    _, patterns = discover_shift_patterns(ocel, ["Worker"])
    assert len(patterns["Worker"]) == 1
    pattern = patterns["Worker"][0]
    assert pattern.share == 1.0
    assert pattern.member_ids == []
    assert pattern.probability["Monday"][8] == 1.0
    assert all(v == 0.0 for day in WEEKDAYS for v in pattern.spread[day])

    _, without = discover_shift_patterns(ocel, ["Worker"], pooled_fallback=False)
    assert without["Worker"] == []


def test_pooled_calendar_is_withheld_without_evidence():
    """A log too short to judge any slot yields no calendar at all. An all-zero
    calendar would read as permanently unavailable rather than as unknown."""
    ocel = _thin_pool(n_resources=2, weeks=1)
    assert pooled_type_calendars(ocel, ["Worker"]) == {}

    _, patterns = discover_shift_patterns(ocel, ["Worker"])
    assert patterns["Worker"] == []


def test_pooled_calendar_skips_unobserved_types():
    ocel = _thin_pool(n_resources=4, weeks=8)
    assert "Crane" not in pooled_type_calendars(ocel, ["Worker", "Crane"])
    assert pooled_type_calendars(_make_ocel([], []), ["Worker"]) == {}


# --- available_seconds_between: working-time content of a span ---
def test_available_seconds_empty_calendar_is_wallclock():
    assert available_seconds_between(None, 0, 3600) == 3600.0
    assert available_seconds_between({}, 100, 700) == 600.0


def test_available_seconds_zero_or_negative_span():
    cal = _workday_calendar()
    assert (
        available_seconds_between(cal, _ts(weekday=0, hour=9), _ts(weekday=0, hour=9))
        == 0.0
    )
    assert (
        available_seconds_between(cal, _ts(weekday=0, hour=10), _ts(weekday=0, hour=9))
        == 0.0
    )


def test_available_seconds_full_within_working_hours():
    cal = _workday_calendar()
    # Monday 09:00 -> 12:00, all inside the working window.
    got = available_seconds_between(
        cal, _ts(weekday=0, hour=9), _ts(weekday=0, hour=12)
    )
    assert got == 3 * 3600


def test_available_seconds_spans_offhours_overnight():
    cal = _workday_calendar()
    # Monday 17:00 -> Tuesday 09:00: only Mon 17-18 and Tue 08-09 count.
    got = available_seconds_between(
        cal, _ts(weekday=0, hour=17), _ts(weekday=1, hour=9)
    )
    assert got == 2 * 3600


def test_available_seconds_spans_weekend():
    cal = _workday_calendar()
    # Friday 16:00 -> Monday 09:00: Fri 16-18 (2h) + Mon 08-09 (1h) = 3h.
    got = available_seconds_between(
        cal, _ts(weekday=4, hour=16), _ts(week=1, weekday=0, hour=9)
    )
    assert got == 3 * 3600


def test_available_seconds_fractional_probability():
    cal = {day: [0.0] * 24 for day in WEEKDAYS}
    cal["Monday"][10] = 0.5
    got = available_seconds_between(
        cal, _ts(weekday=0, hour=10), _ts(weekday=0, hour=11)
    )
    assert got == 0.5 * 3600


# --- wall_clock_end_for_available: inverse of available_seconds_between ---
def test_wall_clock_end_empty_calendar_is_wallclock():
    assert wall_clock_end_for_available(None, 0, 3600) == 3600
    assert wall_clock_end_for_available({}, 100, 600) == 700


def test_wall_clock_end_zero_or_negative_work_returns_start():
    cal = _workday_calendar()
    start = _ts(weekday=0, hour=9)
    assert wall_clock_end_for_available(cal, start, 0) == start
    assert wall_clock_end_for_available(cal, start, -50) == start


def test_wall_clock_end_within_working_hours():
    cal = _workday_calendar()
    # Monday 09:00 + 2h available, all inside the working window -> Monday 11:00.
    got = wall_clock_end_for_available(cal, _ts(weekday=0, hour=9), 2 * 3600)
    assert got == _ts(weekday=0, hour=11)


def test_wall_clock_end_spans_offhours_overnight():
    cal = _workday_calendar()
    # Monday 17:00 + 2h available: Mon 17-18 (1h), then skip to Tue 08-09 (1h).
    got = wall_clock_end_for_available(cal, _ts(weekday=0, hour=17), 2 * 3600)
    assert got == _ts(weekday=1, hour=9)


def test_wall_clock_end_fractional_probability():
    cal = {day: [0.0] * 24 for day in WEEKDAYS}
    cal["Monday"][10] = 0.5
    # 0.5h of available time accrues at rate 0.5 -> a full wall-clock hour.
    got = wall_clock_end_for_available(cal, _ts(weekday=0, hour=10), 0.5 * 3600)
    assert got == _ts(weekday=0, hour=11)


def test_wall_clock_end_roundtrips_available_seconds_between():
    cal = _workday_calendar()
    start = _ts(weekday=4, hour=16)  # Friday 16:00
    end = _ts(week=1, weekday=0, hour=9)  # next Monday 09:00
    work = available_seconds_between(cal, start, end)
    assert wall_clock_end_for_available(cal, start, work) == end


# --- calendar_distance: fuzzy Jaccard between calendars ---
def test_calendar_distance_identical_disjoint_offset():
    morning = np.array([1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0])
    afternoon = np.array([0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0])
    shifted = np.array([0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0])
    assert calendar_distance(morning, morning) == 0.0
    assert calendar_distance(morning, afternoon) == 1.0
    # One hour moved: 2 differing slots over a union of 5.
    assert calendar_distance(morning, shifted) == 2 / 5
    assert calendar_distance(np.zeros(3), np.zeros(3)) == 0.0


# --- smoothed_calendar_distance: temporal neighbourhood ---
def test_smoothed_distance_without_smoothing_matches_the_raw_distance():
    a = _flat(_slots_calendar({"Monday": [7]}))
    b = _flat(_slots_calendar({"Monday": [8]}))
    assert calendar_distance(a, b) == 1.0
    assert smoothed_calendar_distance(a, b, smoothing_hours=0.0) == 1.0


def test_smoothed_distance_grows_with_the_temporal_gap():
    """One hour away is nearer than two, and another weekday stays disjoint.

    The default threshold 0.5 separates the neighbouring hour from the rest.
    """
    ref = _flat(_slots_calendar({"Monday": [7]}))
    next_hour = _flat(_slots_calendar({"Monday": [8]}))
    two_hours = _flat(_slots_calendar({"Monday": [9]}))
    other_day = _flat(_slots_calendar({"Friday": [10]}))

    d_next = smoothed_calendar_distance(ref, next_hour)
    d_two = smoothed_calendar_distance(ref, two_hours)
    assert d_next < d_two
    assert d_next < 0.5 < d_two
    assert smoothed_calendar_distance(ref, other_day) == 1.0


def test_smoothed_distance_wraps_around_the_week():
    """Sunday 23:00 and Monday 00:00 are neighbouring hours, not a week apart."""
    sunday_late = _flat(_slots_calendar({"Sunday": [23]}))
    monday_early = _flat(_slots_calendar({"Monday": [0]}))
    within_day = smoothed_calendar_distance(
        _flat(_slots_calendar({"Monday": [7]})),
        _flat(_slots_calendar({"Monday": [8]})),
    )
    across = smoothed_calendar_distance(sunday_late, monday_early)
    assert abs(across - within_day) < 1e-12


def test_smoothed_distance_keeps_distinct_shifts_and_levels_apart():
    """The blur must not pull real alternatives together: adjacent blocks, early
    vs. late and weekday vs. weekend stay above the threshold, and a difference
    in presence level is untouched by it."""
    morning = _flat(_shift_calendar(8, 12))
    afternoon = _flat(_shift_calendar(12, 16))
    early = _flat(_shift_calendar(7, 15))
    late = _flat(_shift_calendar(14, 22))
    weekend = _flat(_slots_calendar({"Saturday": range(8, 16), "Sunday": range(8, 16)}))
    half_present = _flat(_slots_calendar({d: range(8, 12) for d in WEEKDAYS[:5]}, 0.5))

    assert smoothed_calendar_distance(morning, afternoon) > 0.5
    assert smoothed_calendar_distance(early, late) > 0.5
    assert smoothed_calendar_distance(morning, weekend) == 1.0
    assert abs(smoothed_calendar_distance(morning, half_present) - 0.5) < 1e-12


def test_smoothed_distance_recognizes_a_sparsely_observed_same_shift():
    """Two resources seen at 7/9/11 and 8/10/12 work the same morning; slot-wise
    they look fully disjoint, which is what sparse observation does to the
    event-based estimator."""
    a = _flat(_slots_calendar({"Monday": [7, 9, 11]}))
    b = _flat(_slots_calendar({"Monday": [8, 10, 12]}))
    assert calendar_distance(a, b) == 1.0
    assert smoothed_calendar_distance(a, b) < 0.5


# --- cluster_shift_patterns: shifts become patterns ---
def test_cluster_two_disjoint_shifts_give_two_patterns():
    """Mornings vs. afternoons are distance 1 -> two patterns; shares follow the
    head count and the mean of an all-identical cluster is binary."""
    cals = {
        "m1": _shift_calendar(8, 12),
        "m2": _shift_calendar(8, 12),
        "m3": _shift_calendar(8, 12),
        "a1": _shift_calendar(12, 16),
    }
    patterns = cluster_shift_patterns(cals, distance_threshold=0.5)

    assert [p.share for p in patterns] == [0.75, 0.25]
    assert patterns[0].member_ids == ["m1", "m2", "m3"]
    assert patterns[1].member_ids == ["a1"]
    assert patterns[0].probability["Monday"][9] == 1.0
    assert patterns[0].probability["Monday"][13] == 0.0
    assert patterns[1].probability["Monday"][13] == 1.0
    # All members agree -> no spread anywhere.
    assert all(v == 0.0 for day in WEEKDAYS for v in patterns[0].spread[day])


def test_cluster_offset_shifts_merge_with_fuzzy_edges():
    """08–12 and 09–13 are distance 0.4 < 0.5 -> one pattern whose mean is 0.5
    at the edge hours and whose spread is non-zero only there."""
    cals = {"r1": _shift_calendar(8, 12), "r2": _shift_calendar(9, 13)}
    patterns = cluster_shift_patterns(cals, distance_threshold=0.5)

    assert len(patterns) == 1
    p = patterns[0]
    assert p.share == 1.0
    assert p.probability["Monday"][8] == 0.5
    assert p.probability["Monday"][10] == 1.0
    assert p.probability["Monday"][12] == 0.5
    assert p.spread["Monday"][8] == 0.5
    assert p.spread["Monday"][10] == 0.0


def test_cluster_threshold_zero_keeps_offset_shifts_apart():
    cals = {"r1": _shift_calendar(8, 12), "r2": _shift_calendar(9, 13)}
    assert len(cluster_shift_patterns(cals, distance_threshold=0.0)) == 2


def test_cluster_merges_neighbouring_hours_only_with_smoothing():
    cals = {
        "r1": _slots_calendar({"Monday": [7]}),
        "r2": _slots_calendar({"Monday": [8]}),
    }
    assert len(cluster_shift_patterns(cals)) == 1
    assert len(cluster_shift_patterns(cals, smoothing_hours=0.0)) == 2


def test_cluster_pattern_summary_is_free_of_the_blur():
    """The blur decides who groups; the pattern itself is the raw slot-wise mean,
    so no presence leaks into the hours around the observed ones."""
    cals = {
        "r1": _slots_calendar({"Monday": [7]}),
        "r2": _slots_calendar({"Monday": [8]}),
    }
    p = cluster_shift_patterns(cals)[0]
    assert p.probability["Monday"][7] == 0.5
    assert p.probability["Monday"][8] == 0.5
    assert p.probability["Monday"][6] == 0.0
    assert p.probability["Monday"][9] == 0.0
    assert p.spread["Monday"][7] == 0.5


def test_cluster_single_and_empty():
    assert cluster_shift_patterns({}) == []
    patterns = cluster_shift_patterns({"r1": _shift_calendar(8, 12)})
    assert len(patterns) == 1
    assert patterns[0].share == 1.0
    assert patterns[0].member_ids == ["r1"]


def test_shift_pattern_dict_roundtrip():
    p = cluster_shift_patterns({"r1": _shift_calendar(8, 12)})[0]
    restored = ShiftPattern.from_dict(p.to_dict())
    assert restored.probability == p.probability
    assert restored.spread == p.spread
    assert restored.share == p.share
    assert restored.member_ids == p.member_ids


# --- discover_shift_patterns: end to end from a log ---
def test_discover_shift_patterns_from_log():
    """Two morning workers and one afternoon worker over three weeks."""
    events = (
        _shift_events("m1", [8, 9, 10, 11], weeks=3)
        + _shift_events("m2", [8, 9, 10, 11], weeks=3)
        + _shift_events("a1", [12, 13, 14, 15], weeks=3)
    )
    objects = [
        _object("obj", "Order"),
        _object("m1", "Worker"),
        _object("m2", "Worker"),
        _object("a1", "Worker"),
    ]
    ocel = _make_ocel(events, objects)
    individual, patterns = discover_shift_patterns(ocel, ["Worker", "Crane"])

    assert set(individual["Worker"]) == {"m1", "m2", "a1"}
    assert patterns["Crane"] == []
    worker = patterns["Worker"]
    assert [p.member_ids for p in worker] == [["m1", "m2"], ["a1"]]
    assert worker[0].probability["Tuesday"][9] == 1.0
    assert worker[1].probability["Tuesday"][14] == 1.0

    # The type calendar is the share-weighted mean of the patterns and equals the
    # plain mean over the individual calendars.
    mean = type_calendar_from_patterns(worker)
    assert mean["Tuesday"][9] == 2 / 3
    assert mean["Tuesday"][14] == 1 / 3
    assert _derived_type_calendar(ocel) == mean
    assert type_calendar_from_patterns([]) is None


# --- assign_shift_calendars: instances take their pattern's calendar ---
def test_assign_gives_every_instance_the_pattern_mean_unchanged():
    """No per-instance perturbation: each instance receives the cluster mean as
    is, as an independent copy. Variation between resources comes from which
    pattern they draw, not from noise inside one."""
    patterns = [
        p.to_dict()
        for p in cluster_shift_patterns(
            {"r1": _shift_calendar(8, 12), "r2": _shift_calendar(9, 13)}
        )
    ]
    assert len(patterns) == 1
    pool = {"Worker": ["Worker_1", "Worker_2", "Worker_3"]}

    assigned = assign_shift_calendars(pool, {"Worker": patterns}, random.Random(1))

    for rid in pool["Worker"]:
        assert assigned[rid] == patterns[0]["probability"]
    assert assigned["Worker_1"] == assigned["Worker_3"]
    # The instance owns its calendar; editing it leaves the pattern untouched.
    assigned["Worker_1"]["Monday"][8] = 0.0
    assert patterns[0]["probability"]["Monday"][8] == 0.5


# --- assign_shift_calendars: the pool follows the mixture ---
def test_assign_shift_calendars_proportional_and_shuffled():
    patterns = [
        p.to_dict()
        for p in cluster_shift_patterns(
            {
                "m1": _shift_calendar(8, 12),
                "m2": _shift_calendar(8, 12),
                "m3": _shift_calendar(8, 12),
                "a1": _shift_calendar(12, 16),
            }
        )
    ]
    pool = {"Worker": [f"Worker_{i}" for i in range(1, 9)], "Crane": ["Crane_1"]}
    assigned = assign_shift_calendars(pool, {"Worker": patterns}, random.Random(3))

    # 75/25 over 8 instances -> exactly 6 mornings and 2 afternoons.
    mornings = [rid for rid, c in assigned.items() if c["Monday"][9] == 1.0]
    afternoons = [rid for rid, c in assigned.items() if c["Monday"][13] == 1.0]
    assert len(mornings) == 6 and len(afternoons) == 2
    assert set(mornings) | set(afternoons) == set(pool["Worker"])
    # A type without patterns gets no entry (caller falls back to the type calendar).
    assert "Crane_1" not in assigned


def test_assign_shift_calendars_largest_remainder_small_pool():
    """One instance and a 75/25 mixture -> the dominant pattern, deterministically."""
    patterns = [
        {
            "probability": _shift_calendar(8, 12),
            "spread": None,
            "share": 0.75,
        },
        {
            "probability": _shift_calendar(12, 16),
            "spread": None,
            "share": 0.25,
        },
    ]
    for seed in range(5):
        assigned = assign_shift_calendars(
            {"Worker": ["Worker_1"]}, {"Worker": patterns}, random.Random(seed)
        )
        assert assigned["Worker_1"]["Monday"][9] == 1.0
    # Three instances: 2.25 / 0.75 -> 2 + 1.
    assigned = assign_shift_calendars(
        {"Worker": ["Worker_1", "Worker_2", "Worker_3"]},
        {"Worker": patterns},
        random.Random(0),
    )
    assert sum(c["Monday"][9] for c in assigned.values()) == 2
    assert sum(c["Monday"][13] for c in assigned.values()) == 1
