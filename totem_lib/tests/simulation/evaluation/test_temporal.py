"""Tests for the temporal event-distribution distances."""
from tests.assets.ocel_helpers import make_ocel, event, obj
from totem_lib.simulation.evaluation.temporal import (
    absolute_event_distribution_distance,
    circadian_event_distribution_distance,
    relative_event_distribution_distance,
)
import pytest
import math

HOUR = 3600


def test_absolute_event_distribution_uniform_shift():
    actual = make_ocel(
        [event("e1", "A", 0, ["o1"]), event("e2", "A", HOUR, ["o2"])],
        [obj("o1", "T"), obj("o2", "T")],
    )
    simulated = make_ocel(
        [event("e1", "A", HOUR, ["o1"]), event("e2", "A", 2 * HOUR, ["o2"])],
        [obj("o1", "T"), obj("o2", "T")],
    )
    assert absolute_event_distribution_distance(actual, simulated) == pytest.approx(1.0)  # every event shifted 1h

def test_aed_ignores_count_magnitude_when_distribution_same():
    actual = make_ocel(
        [
            event("e1", "A", 0, ["o1"]),
            event("e2", "A", 100, ["o2"]),
        ],
        [obj("o1", "T"), obj("o2", "T")],
    )

    simulated = make_ocel(
        [
            event("e1", "A", 200, ["o1"]),
        ],
        [obj("o1", "T")],
    )

    assert absolute_event_distribution_distance(actual, simulated) == pytest.approx(0.0)


def test_circadian_event_distribution_same_weekday_hour_shift():
    # 1970-01-01 (epoch 0) is a Thursday; both events fall on it. Hour 0 vs hour 2.
    actual = make_ocel([event("e1", "A", 0, ["o1"])], [obj("o1", "T")])
    simulated = make_ocel([event("e1", "A", 2 * HOUR, ["o1"])], [obj("o1", "T")])
    assert circadian_event_distribution_distance(actual, simulated) == pytest.approx(2 / 7)  # one of 7 weekdays differs by 2h
    assert circadian_event_distribution_distance(actual, actual) == pytest.approx(0.0)


def test_relative_event_distribution_relative_to_case_start():
    actual = make_ocel([event("e1", "A", 0, ["o1"]), event("e2", "B", HOUR, ["o1"])], [obj("o1", "T")])
    simulated = make_ocel([event("e1", "A", 0, ["o1"]), event("e2", "B", 2 * HOUR, ["o1"])], [obj("o1", "T")])
    # relative bins {0,1} vs {0,2}: one event matches at 0, the other is 1 bin off → EMD 0.5
    assert relative_event_distribution_distance(actual, simulated) == pytest.approx(0.5)

def test_red_ignores_absolute_shift_when_relative_timing_same():
    actual = make_ocel(
        [
            event("e1", "A", 0, ["o1"]),
            event("e2", "B", HOUR, ["o1"]),
        ],
        [obj("o1", "T")],
    )

    simulated = make_ocel(
        [
            event("e1", "A", 10 * HOUR, ["o1"]),
            event("e2", "B", 11 * HOUR, ["o1"]),
        ],
        [obj("o1", "T")],
    )

    assert relative_event_distribution_distance(actual, simulated) == pytest.approx(0.0)

def test_aed_and_red_one_empty_one_nonempty_are_inf():
    empty = make_ocel([], [])
    nonempty = make_ocel([event("e1", "A", 0, ["o1"])], [obj("o1", "T")])

    assert math.isinf(absolute_event_distribution_distance(empty, nonempty))
    assert math.isinf(relative_event_distribution_distance(empty, nonempty))
