"""Tests for the control-flow (n-gram) distances."""

import pytest

from tests.assets.ocel_helpers import event, make_ocel, obj
from totem_lib.simulation.evaluation.control_flow import (
    n_gram_distance_absolute,
    n_gram_distance_relative,
)


def _ab_executions(prefix, n):
    """n disjoint executions, each the activity sequence A -> B."""
    events, objects = [], []
    for i in range(n):
        oid = f"{prefix}{i}"
        events += [
            event(f"{prefix}a{i}", "A", 0, [oid]),
            event(f"{prefix}b{i}", "B", 100, [oid]),
        ]
        objects.append(obj(oid, "T"))
    return make_ocel(events, objects)


def test_relative_ignores_volume_but_absolute_does_not():
    actual = _ab_executions("x", 1)
    simulated = _ab_executions("y", 2)  # same shape, twice the volume
    assert (
        n_gram_distance_absolute(actual, simulated) == 1 / 3
    )  # count mismatch penalized
    assert (
        n_gram_distance_relative(actual, simulated) == 0.0
    )  # same relative frequencies


def test_identical_logs_are_zero():
    log = _ab_executions("x", 1)
    assert n_gram_distance_absolute(log, log) == 0.0
    assert n_gram_distance_relative(log, log) == 0.0


def test_different_logs_are_nonzero():
    actual = make_ocel(
        [
            event("e1", "A", 0, ["o1"]),
            event("e2", "B", 100, ["o1"]),
            event("e3", "C", 100, ["o1"]),
        ],
        [obj("o1", "T")],
    )
    simulated = make_ocel(
        [
            event("e1", "A", 0, ["o1"]),
            event("e2", "B", 100, ["o1"]),
            event("e3", "D", 100, ["o1"]),
        ],
        [obj("o1", "T")],
    )

    assert n_gram_distance_absolute(actual, simulated) == 0.5
    assert n_gram_distance_relative(actual, simulated) == 0.5


def test_relative_completely_different_sequences_is_one():
    actual = make_ocel(
        [
            event("e1", "A", 0, ["o1"]),
            event("e2", "B", 100, ["o1"]),
        ],
        [obj("o1", "T")],
    )
    simulated = make_ocel(
        [
            event("e1", "C", 0, ["o1"]),
            event("e2", "D", 100, ["o1"]),
        ],
        [obj("o1", "T")],
    )

    assert n_gram_distance_relative(actual, simulated) == pytest.approx(1.0)


def test_events_are_sorted_by_timestamp():
    actual = make_ocel(
        [
            event("e2", "B", 100, ["o1"]),
            event("e1", "A", 0, ["o1"]),
        ],
        [obj("o1", "T")],
    )
    expected = make_ocel(
        [
            event("e1", "A", 0, ["o1"]),
            event("e2", "B", 100, ["o1"]),
        ],
        [obj("o1", "T")],
    )

    assert n_gram_distance_absolute(actual, expected) == 0.0
    assert n_gram_distance_relative(actual, expected) == 0.0


def test_n_gram_distance_with_n_3():
    actual = make_ocel(
        [
            event("e1", "A", 0, ["o1"]),
            event("e2", "B", 100, ["o1"]),
            event("e3", "C", 200, ["o1"]),
        ],
        [obj("o1", "T")],
    )
    simulated = make_ocel(
        [
            event("e1", "A", 0, ["o1"]),
            event("e2", "B", 100, ["o1"]),
            event("e3", "D", 200, ["o1"]),
        ],
        [obj("o1", "T")],
    )

    assert n_gram_distance_absolute(actual, simulated, n=3) == pytest.approx(0.6)
    assert n_gram_distance_relative(actual, simulated, n=3) == pytest.approx(0.6)


def test_n_must_be_positive():
    log = _ab_executions("x", 1)
    with pytest.raises(ValueError):
        n_gram_distance_absolute(log, log, n=0)
    with pytest.raises(ValueError):
        n_gram_distance_relative(log, log, n=0)
