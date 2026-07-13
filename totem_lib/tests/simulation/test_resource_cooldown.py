import datetime as dt

from tests.assets.ocel_helpers import (
    make_ocel as _make_ocel,
    event as _event,
    obj as _object,
)
from totem_lib.simulation.utils.resource_calendar import WEEKDAYS
import random

from totem_lib.simulation.utils.resource_statistics import (
    resource_cooldown_distribution,
    sample_cooldown,
)

UTC = dt.timezone.utc


def _ts(day: int = 1, hour: int = 0) -> int:
    """Unix seconds for 2024-01-`day` `hour`:00 UTC (2024-01-01 is a Monday)."""
    return int(dt.datetime(2024, 1, day, hour, tzinfo=UTC).timestamp())


def _workday_calendar() -> dict:
    """Mon–Fri 08:00–18:00 available (prob 1.0), everything else off."""
    cal = {d: [0.0] * 24 for d in WEEKDAYS}
    for d in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]:
        for h in range(8, 18):
            cal[d][h] = 1.0
    return cal


def test_basic_cooldown_single_resource():
    """
    r1 (type Worker) appears at Load (t=0) then at Unload (t=100).
    Expected: cooldown of 100 seconds attributed to activity "Load".
    """
    ocel = _make_ocel(
        [
            _event("e1", "Load", 0, ["r1"]),
            _event("e2", "Unload", 100, ["r1"]),
        ],
        [_object("r1", "Worker")],
    )
    result = resource_cooldown_distribution(ocel, ["Worker"], ["Load", "Unload"])

    assert "Load" in result
    assert "Unload" not in result
    assert "Worker" in result["Load"]
    assert result["Load"]["Worker"]["min_duration_s"] == 100
    assert result["Load"]["Worker"]["max_duration_s"] == 100
    assert result["Load"]["Worker"]["sample_count"] == 1


def test_untracked_activity_closes_interval():
    """
    r1 appears at Load (t=0), Drive (t=50, not tracked), Unload (t=100).
    Drive closes the Load interval (duration=50) but does not open a new one.
    Unload then opens a new interval that is never closed.
    Expected: Load cooldown = 50s, no entry for Unload (only one open, unclosed interval).
    """
    ocel = _make_ocel(
        [
            _event("e1", "Load", 0, ["r1"]),
            _event("e2", "Drive", 50, ["r1"]),
            _event("e3", "Unload", 100, ["r1"]),
        ],
        [_object("r1", "Worker")],
    )
    result = resource_cooldown_distribution(ocel, ["Worker"], ["Load", "Unload"])

    assert result["Load"]["Worker"]["min_duration_s"] == 50
    assert result["Load"]["Worker"]["max_duration_s"] == 50
    assert "Unload" not in result


def test_untracked_object_type_skipped():
    """
    r1 is type Forklift (tracked), r2 is type Truck (not in objects_to_analyze).
    r2 must not appear in the result at all.
    """
    ocel = _make_ocel(
        [
            _event("e1", "Load", 0, ["r1", "r2"]),
            _event("e2", "Unload", 100, ["r1", "r2"]),
        ],
        [_object("r1", "Forklift"), _object("r2", "Truck")],
    )
    result = resource_cooldown_distribution(ocel, ["Forklift"], ["Load", "Unload"])

    assert "Truck" not in result.get("Load", {})


def test_events_out_of_order_sorted_correctly():
    """
    Events are stored in reverse order in the OCEL.
    The algorithm must sort by timestamp first so durations are correct.
    """
    ocel = _make_ocel(
        [
            _event("e2", "Unload", 200, ["r1"]),
            _event("e1", "Load", 100, ["r1"]),
        ],
        [_object("r1", "Forklift")],
    )
    result = resource_cooldown_distribution(ocel, ["Forklift"], ["Load", "Unload"])

    assert result["Load"]["Forklift"]["min_duration_s"] == 100
    assert result["Load"]["Forklift"]["max_duration_s"] == 100


def test_resource_appears_only_once_not_in_result():
    """
    r1 appears in only one event — no closed interval.
    Expected: no entry for r1's type in the result.
    """
    ocel = _make_ocel(
        [_event("e1", "Load", 0, ["r1"])],
        [_object("r1", "Forklift")],
    )
    result = resource_cooldown_distribution(ocel, ["Forklift"], ["Load"])

    assert result.get("Load", {}).get("Forklift") is None


def test_multiple_resources_same_type_aggregated():
    """
    r1 and r2 are both type Forklift.
    r1: cooldown 100s, r2: cooldown 200s.
    Expected: Forklift stats based on both samples → mean=150, sample_count=2.
    """
    ocel = _make_ocel(
        [
            _event("e1", "Load", 0, ["r1"]),
            _event("e2", "Load", 0, ["r2"]),
            _event("e3", "Unload", 100, ["r1"]),
            _event("e4", "Unload", 200, ["r2"]),
        ],
        [_object("r1", "Forklift"), _object("r2", "Forklift")],
    )
    result = resource_cooldown_distribution(ocel, ["Forklift"], ["Load", "Unload"])

    stats = result["Load"]["Forklift"]
    assert stats["sample_count"] == 2
    assert sum(stats["bin_counts"]) == 2
    assert stats["min_duration_s"] == 100
    assert stats["max_duration_s"] == 200


def test_multiple_cooldown_intervals_same_resource():
    """
    r1 appears three times: Load(t=0) → Unload(t=100) → Load(t=300).
    Expected:
      - "Load"   Forklift: one interval of 100s
      - "Unload" Forklift: one interval of 200s
    """
    ocel = _make_ocel(
        [
            _event("e1", "Load", 0, ["r1"]),
            _event("e2", "Unload", 100, ["r1"]),
            _event("e3", "Load", 300, ["r1"]),
        ],
        [_object("r1", "Forklift")],
    )
    result = resource_cooldown_distribution(ocel, ["Forklift"], ["Load", "Unload"])

    assert result["Load"]["Forklift"]["min_duration_s"] == 100
    assert result["Load"]["Forklift"]["max_duration_s"] == 100
    assert result["Unload"]["Forklift"]["min_duration_s"] == 200
    assert result["Unload"]["Forklift"]["max_duration_s"] == 200


def test_multiple_resources_different_types():
    """
    r1 (Forklift) and r2 (Crane) both tracked, both appear in the same events.
    Expected: separate stats per resource type, both with cooldown 120s.
    """
    ocel = _make_ocel(
        [
            _event("e1", "Load", 0, ["r1", "r2"]),
            _event("e2", "Unload", 120, ["r1", "r2"]),
        ],
        [_object("r1", "Forklift"), _object("r2", "Crane")],
    )
    result = resource_cooldown_distribution(
        ocel, ["Forklift", "Crane"], ["Load", "Unload"]
    )

    assert result["Load"]["Forklift"]["min_duration_s"] == 120
    assert result["Load"]["Forklift"]["max_duration_s"] == 120
    assert result["Load"]["Crane"]["min_duration_s"] == 120
    assert result["Load"]["Crane"]["max_duration_s"] == 120


def test_empty_log_returns_empty_result():
    """
    Tests that an empty OCEL results in an empty distribution, without errors.
    Expected: empty dict.
    """
    ocel = _make_ocel([], [])
    result = resource_cooldown_distribution(ocel, ["Worker"], ["Load"])
    assert dict(result) == {}


def test_empty_objects_to_analyze_returns_empty():
    """
    Tests that an empty list of objects to analyze results in an empty distribution.
    Expected: empty dict.
    """
    ocel = _make_ocel(
        [
            _event("e1", "Load", 0, ["r1"]),
            _event("e2", "Unload", 100, ["r1"]),
        ],
        [_object("r1", "Worker")],
    )
    result = resource_cooldown_distribution(ocel, [], ["Load", "Unload"])
    assert dict(result) == {}


def test_empty_activities_returns_empty():
    """
    Tests that an empty list of activities results in an empty distribution.
    Expected: empty dict.
    """
    ocel = _make_ocel(
        [
            _event("e1", "Load", 0, ["r1"]),
            _event("e2", "Unload", 100, ["r1"]),
        ],
        [_object("r1", "Worker")],
    )
    result = resource_cooldown_distribution(ocel, ["Worker"], [])
    assert dict(result) == {}


def test_multiple_intervals_same_activity_aggregated():
    """
    Tests that multiple cooldown intervals interrupted by other activities are correctly aggregated.
    r1 (Forklift) appears at Load two times and Move should not be calculated, but used as end of the interval.
    Expected: Load cooldown = [100s, 200s], mean=150s, sample_count=2.
    """
    ocel = _make_ocel(
        [
            _event("e1", "Load", 0, ["r1"]),
            _event("e2", "Move", 100, ["r1"]),
            _event("e3", "Load", 200, ["r1"]),
            _event("e4", "Move", 400, ["r1"]),
        ],
        [_object("r1", "Forklift")],
    )
    result = resource_cooldown_distribution(ocel, ["Forklift"], ["Load"])

    stats = result["Load"]["Forklift"]
    assert stats["sample_count"] == 2
    assert sum(stats["bin_counts"]) == 2
    assert stats["min_duration_s"] == 100
    assert stats["max_duration_s"] == 200


def test_same_timestamp_results_in_zero_duration():
    """
    Test handling of events with the same timestamp for the same resource.
    Expected: cooldown of 0 seconds attributed to the activity, no errors.
    """
    ocel = _make_ocel(
        [
            _event("e1", "Load", 100, ["r1"]),
            _event("e2", "Unload", 100, ["r1"]),
        ],
        [_object("r1", "Worker")],
    )
    result = resource_cooldown_distribution(ocel, ["Worker"], ["Load", "Unload"])
    assert result["Load"]["Worker"]["min_duration_s"] == 0
    assert result["Load"]["Worker"]["max_duration_s"] == 0


# --- calendar-aware cooldowns: off hours discounted from occupation ---


def test_cooldown_discounts_calendar_offhours():
    """With a workday calendar the weekend absence is discounted from the cooldown.

    Friday 16:00 -> Monday 09:00 spans ~65h wall-clock but only Fri 16-18 (2h)
    plus Mon 08-09 (1h) of working time, so the occupation cooldown is 3h.
    """
    ocel = _make_ocel(
        [
            _event("e1", "Load", _ts(day=5, hour=16), ["r1"]),  # Friday 16:00
            _event("e2", "Unload", _ts(day=8, hour=9), ["r1"]),  # Monday 09:00
        ],
        [_object("r1", "Worker")],
    )
    result = resource_cooldown_distribution(
        ocel, ["Worker"], ["Load", "Unload"], calendars={"Worker": _workday_calendar()}
    )
    assert result["Load"]["Worker"]["min_duration_s"] == 3 * 3600
    assert result["Load"]["Worker"]["max_duration_s"] == 3 * 3600


def test_cooldown_calendar_missing_type_falls_back_to_wallclock():
    """A resource type without a calendar entry keeps the raw wall-clock gap."""
    ocel = _make_ocel(
        [
            _event("e1", "Load", _ts(day=5, hour=16), ["r1"]),
            _event("e2", "Unload", _ts(day=8, hour=9), ["r1"]),
        ],
        [_object("r1", "Worker")],
    )
    result = resource_cooldown_distribution(
        ocel,
        ["Worker"],
        ["Load", "Unload"],
        calendars={"OtherType": _workday_calendar()},
    )
    expected = _ts(day=8, hour=9) - _ts(day=5, hour=16)
    assert result["Load"]["Worker"]["min_duration_s"] == expected
    assert result["Load"]["Worker"]["max_duration_s"] == expected


# --- empirical histogram + sampling ---


def test_histogram_single_value_is_degenerate_bin():
    """One interval yields a zero-width bin and sampling returns that value."""
    ocel = _make_ocel(
        [
            _event("e1", "Load", 0, ["r1"]),
            _event("e2", "Unload", 100, ["r1"]),
        ],
        [_object("r1", "Worker")],
    )
    entry = resource_cooldown_distribution(ocel, ["Worker"], ["Load"])["Load"]["Worker"]
    assert entry["bin_edges"] == [100.0, 100.0]
    assert entry["bin_counts"] == [1]
    rng = random.Random(0)
    assert all(sample_cooldown(entry, rng) == 100.0 for _ in range(20))


def test_sample_cooldown_draws_within_observed_range():
    """Samples from a multi-interval histogram stay within [min, max]."""
    ocel = _make_ocel(
        [
            _event("e1", "Load", 0, ["r1"]),
            _event("e2", "Load", 0, ["r2"]),
            _event("e3", "Load", 0, ["r3"]),
            _event("e4", "Unload", 100, ["r1"]),
            _event("e5", "Unload", 300, ["r2"]),
            _event("e6", "Unload", 900, ["r3"]),
        ],
        [_object(f"r{i}", "Worker") for i in (1, 2, 3)],
    )
    entry = resource_cooldown_distribution(ocel, ["Worker"], ["Load"])["Load"]["Worker"]
    assert entry["sample_count"] == 3
    assert sum(entry["bin_counts"]) == 3
    rng = random.Random(0)
    draws = [sample_cooldown(entry, rng) for _ in range(200)]
    assert all(100.0 <= d <= 900.0 for d in draws)


def test_sample_cooldown_empty_entry_is_zero():
    """An entry without a histogram yields no cooldown."""
    assert sample_cooldown({}) == 0.0
    assert sample_cooldown({"bin_edges": [], "bin_counts": []}) == 0.0


def test_sample_cooldown_range_restricts_draw():
    """A [select_min_s, select_max_s] band excludes values outside it."""
    entry = {
        "bin_edges": [0.0, 100.0, 200.0, 300.0],
        "bin_counts": [10, 10, 10],
        "select_min_s": 100.0,
        "select_max_s": 200.0,
    }
    rng = random.Random(0)
    draws = [sample_cooldown(entry, rng) for _ in range(300)]
    assert all(100.0 <= d <= 200.0 for d in draws)


def test_sample_cooldown_empty_range_is_zero():
    """A band that overlaps no bin mass yields no cooldown."""
    entry = {
        "bin_edges": [0.0, 100.0],
        "bin_counts": [5],
        "select_min_s": 200.0,
        "select_max_s": 300.0,
    }
    assert sample_cooldown(entry) == 0.0
