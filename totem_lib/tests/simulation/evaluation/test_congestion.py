"""Tests for the congestion distance measures."""
from tests.assets.ocel_helpers import make_ocel, event, obj
from totem_lib.simulation.evaluation.congestion import (
    cycle_time_distribution_distance,
    cycle_time_summary,
    interarrival_time_distribution_distance,
    execution_arrival_distribution_distance,
    execution_arrival_count_distance,
    variant_arrival_distribution_distance,
    variant_arrival_count_distance,
)
import pytest

HOUR = 3600


def _arrivals(times):
    """One single-event execution per timestamp (disjoint objects, same variant)."""
    events = [event(f"e{i}", "A", t, [f"o{i}"]) for i, t in enumerate(times)]
    objects = [obj(f"o{i}", "T") for i in range(len(times))]
    return make_ocel(events, objects)


def test_cycle_time_distribution_distance_in_hours():
    actual = make_ocel([event("e1", "A", 0, ["o1"]), event("e2", "B", 2 * HOUR, ["o1"])], [obj("o1", "T")])
    simulated = make_ocel([event("e1", "A", 0, ["o1"]), event("e2", "B", 4 * HOUR, ["o1"])], [obj("o1", "T")])
    assert cycle_time_distribution_distance(actual, simulated) == 2.0


def test_cycle_time_summary():
    log = make_ocel([event("e1", "A", 0, ["o1"]), event("e2", "B", 2 * HOUR, ["o1"])], [obj("o1", "T")])
    assert cycle_time_summary(log) == {"mean_s": 7200.0, "std_s": 0.0, "min_s": 7200, "max_s": 7200, "count": 1}


def test_interarrival_time_distribution_distance():
    actual = _arrivals([0, 1 * HOUR, 2 * HOUR])     # gaps 1h, 1h
    simulated = _arrivals([0, 2 * HOUR, 4 * HOUR])  # gaps 2h, 2h
    assert interarrival_time_distribution_distance(actual, simulated) == 1.0


def test_arrival_count_penalizes_magnitude_while_rate_does_not():
    # Both logs put all arrivals in hour-bin 0, but with different counts.
    actual = _arrivals([0, 100])
    simulated = _arrivals([200])
    assert execution_arrival_distribution_distance(actual, simulated) == 0.0  # normalized: timing only
    assert execution_arrival_count_distance(actual, simulated) == 1.0         # L1: 2 vs 1


def test_variant_arrival_distribution_missing_variant_penalty():
    actual = make_ocel([event("e1", "X", 0, ["o1"])], [obj("o1", "T")])
    simulated = make_ocel([event("e1", "Y", 0, ["o1"])], [obj("o1", "T")])
    assert variant_arrival_distribution_distance(actual, simulated) == 24.0


def test_variant_arrival_count_distance():
    actual = _arrivals([0, 100])  # 2 executions of variant "A" in bin 0
    simulated = _arrivals([200])  # 1 execution of variant "A" in bin 0
    assert variant_arrival_count_distance(actual, simulated) == 1.0


def test_identical_logs_are_zero():
    log = _arrivals([0, HOUR, 2 * HOUR])
    assert cycle_time_distribution_distance(log, log) == 0.0
    assert interarrival_time_distribution_distance(log, log) == 0.0
    assert execution_arrival_distribution_distance(log, log) == 0.0
    assert execution_arrival_count_distance(log, log) == 0.0
    assert variant_arrival_distribution_distance(log, log) == 0.0
    assert variant_arrival_count_distance(log, log) == 0.0

def test_cycle_time_distribution_is_continuous_not_hour_binned():
    actual = make_ocel(
        [
            event("e1", "A", 0, ["o1"]),
            event("e2", "B", 30 * 60, ["o1"]),
        ],
        [obj("o1", "T")],
    )
    simulated = make_ocel(
        [
            event("e1", "A", 0, ["o1"]),
            event("e2", "B", 50 * 60, ["o1"]),
        ],
        [obj("o1", "T")],
    )

    assert cycle_time_distribution_distance(actual, simulated) == pytest.approx(20 / 60)

def test_interarrival_with_single_execution_each_is_zero():
    actual = _arrivals([0])
    simulated = _arrivals([10 * HOUR])

    assert interarrival_time_distribution_distance(actual, simulated) == 0.0

def test_variant_arrival_distribution_same_variant_shifted_time():
    actual = _arrivals([0])
    simulated = _arrivals([3 * HOUR])

    assert variant_arrival_distribution_distance(actual, simulated) == 3.0