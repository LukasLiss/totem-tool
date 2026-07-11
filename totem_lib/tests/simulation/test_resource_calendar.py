import datetime as dt

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
    ResourceCalendar,
    available_seconds_between,
    discover_resource_calendars,
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


# --- ResourceCalendar dataclass ---
def test_resource_calendar_constructor_and_roundtrip():
    cal = ResourceCalendar("Forklift", "type")
    assert cal.identifier == "Forklift"
    assert cal.type == "type"
    cal.probability["Monday"][10] = 0.5
    restored = ResourceCalendar.from_dict(cal.to_dict())
    assert restored.identifier == "Forklift"
    assert restored.type == "type"
    assert restored.get_probability("Monday", 10) == 0.5


# --- discover_resource_calendars: happy path ---
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
    type_cals = discover_resource_calendars(ocel, ["Worker"])

    assert "Worker" in type_cals
    assert type_cals["Worker"].get_probability("Monday", 10) == 1.0
    assert type_cals["Worker"].get_probability("Monday", 9) == 0.0
    assert type_cals["Worker"].get_probability("Tuesday", 10) == 0.0


def test_calendar_partial_weeks_probability():
    """r1 active Mon 10:00 in 2 of 4 observed weeks -> P=0.5."""
    ocel = _make_ocel(
        [
            _event("e1", "Load", _ts(week=0, weekday=0, hour=10), ["obj", "r1"]),
            _event("e2", "Load", _ts(week=2, weekday=0, hour=10), ["obj", "r1"]),
            # Two more weeks observed via activity on other slots.
            _event("e3", "Load", _ts(week=1, weekday=1, hour=8), ["obj", "r1"]),
            _event("e4", "Load", _ts(week=3, weekday=1, hour=8), ["obj", "r1"]),
        ],
        [_object("obj", "Order"), _object("r1", "Worker")],
    )
    type_cals = discover_resource_calendars(ocel, ["Worker"])

    # 4 distinct weeks observed in total; Mon/10 active in 2 -> 0.5.
    assert type_cals["Worker"].get_probability("Monday", 10) == 0.5
    # Tue/08 active in the other 2 -> 0.5.
    assert type_cals["Worker"].get_probability("Tuesday", 8) == 0.5


def test_calendar_type_is_average_all_resources_present():
    """Both Workers present in the (single) observed week -> type average = 1.0."""
    ocel = _make_ocel(
        [
            _event("e1", "Load", _ts(week=0, weekday=0, hour=10), ["obj", "r1", "r2"]),
        ],
        [_object("obj", "Order"), _object("r1", "Worker"), _object("r2", "Worker")],
    )
    type_cals = discover_resource_calendars(ocel, ["Worker"])

    assert type_cals["Worker"].get_probability("Monday", 10) == 1.0


def test_calendar_type_is_average_partial_presence():
    """r1 present Mon 10:00 in week 0, r2 in week 1 (2 observed weeks).

    Each individual resource is active 1 of 2 weeks -> P=0.5 each. The type is the
    *average* across its resources -> 0.5 (NOT the union, which would read 1.0).
    """
    ocel = _make_ocel(
        [
            _event("e1", "Load", _ts(week=0, weekday=0, hour=10), ["obj", "r1"]),
            _event("e2", "Load", _ts(week=1, weekday=0, hour=10), ["obj", "r2"]),
        ],
        [_object("obj", "Order"), _object("r1", "Worker"), _object("r2", "Worker")],
    )
    type_cals = discover_resource_calendars(ocel, ["Worker"])

    assert type_cals["Worker"].get_probability("Monday", 10) == 0.5


# --- discover_resource_calendars: edge cases ---
def test_calendar_empty_log_returns_empty():
    ocel = _make_ocel([], [])
    type_cals = discover_resource_calendars(ocel, ["Worker"])
    assert type_cals == {}


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
