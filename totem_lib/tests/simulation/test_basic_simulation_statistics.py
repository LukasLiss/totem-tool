"""Unit tests for the basic simulation statistics learned from the source log.

These functions in ``basic_simulation_statistics`` feed the simulation model:

- ``variant_arrival_distribution`` — when cases of a variant arrive (weekday/hour).
- ``resource_distribution_of_variants`` — how many resources of each type an
  activity uses per invocation.
- ``activity_delay_distribution`` — the inter-event delays driving the duration
  model (its playout side is covered by
  ``test_activity_duration_model_delays_successor`` in
  ``test_simulation_integration.py``).
"""

import datetime as dt

import networkx as nx
import pytest

from tests.assets.ocel_helpers import event as _event
from tests.assets.ocel_helpers import make_ocel
from tests.assets.ocel_helpers import obj as _object
from totem_lib.simulation.utils.basic_simulation_statistics import (
    activity_delay_distribution,
    resource_distribution_of_variants,
    variant_arrival_distribution,
)
from totem_lib.variants.ocvariants import Variant, Variants

UTC = dt.timezone.utc


# --- test scaffolding ---


def _ts(*args):
    """Unix seconds for a UTC datetime given as (year, month, day, hour, ...)."""
    return int(dt.datetime(*args, tzinfo=UTC).timestamp())


def _variants(executions):
    """A single-variant collection over the given executions (lists of event ids)."""
    variant = Variant(
        vid="v0", support=len(executions), executions=executions, graph=nx.DiGraph()
    )
    return Variants([variant]), variant


# --- variant_arrival_distribution ---


def test_variant_arrival_uses_case_start_binned_by_weekday_and_hour():
    """Arrival = earliest event of an execution. One execution starts Monday 10:00,
    the other Wednesday 14:00; later events must not move the bin.
    """
    events = [
        _event("s1", "A", _ts(2024, 1, 1, 10), ["o1"]),  # Mon start of exec1
        _event("l1", "B", _ts(2024, 1, 1, 11), ["o1"]),  # Mon later event of exec1
        _event("s2", "A", _ts(2024, 1, 3, 14), ["o2"]),  # Wed start of exec2
        _event("l2", "B", _ts(2024, 1, 3, 15), ["o2"]),  # Wed later event of exec2
    ]
    objects = [_object("o1", "Order"), _object("o2", "Order")]
    # Later event listed first: the min (case start), not the first, must win.
    variants, variant = _variants([["l1", "s1"], ["l2", "s2"]])

    stats = variant_arrival_distribution(make_ocel(events, objects), variants)[variant]

    assert stats["weekday_counts"] == {"Monday": 1, "Wednesday": 1}
    assert stats["weekday_probabilities"] == {"Monday": 0.5, "Wednesday": 0.5}
    assert stats["hourly_counts"] == {"Monday": {10: 1}, "Wednesday": {14: 1}}
    assert stats["hourly_probabilities"] == {
        "Monday": {10: 1.0},
        "Wednesday": {14: 1.0},
    }


def test_variant_arrival_avg_per_hour_divides_by_observed_weekday_count():
    """``avg_arrivals_per_hour`` normalizes the arrival count by how many times the
    weekday occurs in the observation window — distinct from the raw count.
    """
    events = [
        _event("e1", "A", _ts(2024, 1, 1, 10), ["o1"]),  # Monday, week 1
        _event("e2", "A", _ts(2024, 1, 8, 10), ["o2"]),  # Monday, week 2
    ]
    objects = [_object("o1", "Order"), _object("o2", "Order")]
    variants, variant = _variants([["e1"], ["e2"]])

    stats = variant_arrival_distribution(make_ocel(events, objects), variants)[variant]

    # Two Monday-10:00 arrivals; the log spans two Mondays (Jan 1 and Jan 8), so the
    # average per hour is 2 arrivals / 2 observed Mondays = 1.0, not the count of 2.
    assert stats["weekday_counts"]["Monday"] == 2
    assert stats["hourly_counts"]["Monday"] == {10: 2}
    assert stats["avg_arrivals_per_hour"]["Monday"] == {10: 1.0}


# --- resource_distribution_of_variants ---


def test_resource_distribution_counts_per_type_over_all_invocations():
    """Per activity and resource type, the count distribution is P(count) over *all*
    invocations — an invocation not using a type contributes a count of 0.
    """
    events = [
        _event("e1", "A", 0, ["o1"], resources=["w1"]),
        _event("e2", "A", 10, ["o2"], resources=["w2", "m1"]),
        _event("e3", "A", 20, ["o3"], resources=["m2"]),
    ]
    objects = [_object(o, "Order") for o in ("o1", "o2", "o3")]
    obj_type_map = {"w1": "Worker", "w2": "Worker", "m1": "Machine", "m2": "Machine"}
    variants, variant = _variants([["e1"], ["e2"], ["e3"]])

    dist = resource_distribution_of_variants(
        make_ocel(events, objects), variants, obj_type_map=obj_type_map
    )[variant]["A"]

    # Worker counts across the 3 invocations: [1, 1, 0]; Machine: [0, 1, 1].
    assert dist["Worker"]["count_distribution"] == pytest.approx({1: 2 / 3, 0: 1 / 3})
    assert dist["Machine"]["count_distribution"] == pytest.approx({1: 2 / 3, 0: 1 / 3})


def test_resource_distribution_ignores_unmapped_resource_ids():
    """Resource ids absent from ``obj_type_map`` carry no type and are dropped."""
    events = [
        _event("e1", "A", 0, ["o1"], resources=["w1", "ghost"]),
        _event("e2", "A", 10, ["o2"], resources=["w1"]),
    ]
    objects = [_object("o1", "Order"), _object("o2", "Order")]
    obj_type_map = {"w1": "Worker"}  # "ghost" is unmapped
    variants, variant = _variants([["e1"], ["e2"]])

    dist = resource_distribution_of_variants(
        make_ocel(events, objects), variants, obj_type_map=obj_type_map
    )[variant]["A"]

    assert set(dist.keys()) == {"Worker"}
    assert dist["Worker"]["count_distribution"] == {1: 1.0}


# --- activity_delay_distribution (inter-event delays) ---


def test_delay_is_gap_to_predecessor_and_start_event_is_skipped():
    """A single object threads A -> B -> C. Each non-start event's delay is the
    gap to its predecessor; the start event A (no predecessor) contributes nothing.
    """
    events = [
        _event("e1", "A", 0, ["o1"]),
        _event("e2", "B", 100, ["o1"]),
        _event("e3", "C", 300, ["o1"]),
    ]
    objects = [_object("o1", "Order")]

    delays = activity_delay_distribution(make_ocel(events, objects))

    assert delays == {"B": [100], "C": [200]}
    assert "A" not in delays  # start events have no enabling predecessor


def test_enabling_time_is_the_latest_predecessor():
    """A join event C is reached via two objects. Its enabling time is the later
    of the two predecessors, so the delay is measured from that one.
    """
    events = [
        _event("e1", "A", 0, ["o1"]),
        _event("e2", "B", 200, ["o2"]),
        _event("e3", "C", 500, ["o1", "o2"]),  # join of o1 and o2
    ]
    objects = [_object("o1", "Order"), _object("o2", "Item")]

    delays = activity_delay_distribution(make_ocel(events, objects))

    assert delays == {"C": [300]}  # 500 - max(0, 200)


def test_simultaneous_events_yield_zero_delay():
    """An event sharing its predecessor's timestamp has a zero (never negative)
    delay.
    """
    events = [
        _event("e1", "A", 100, ["o1"]),
        _event("e2", "B", 100, ["o1"]),
    ]
    objects = [_object("o1", "Order")]

    delays = activity_delay_distribution(make_ocel(events, objects))

    assert delays == {"B": [0]}


def test_samples_are_pooled_per_activity_across_instances():
    """Two independent object instances each fire B; both delays land in the same
    per-activity pool.
    """
    events = [
        _event("e1", "A", 0, ["o1"]),
        _event("e2", "B", 100, ["o1"]),
        _event("e3", "A", 1000, ["o2"]),
        _event("e4", "B", 1500, ["o2"]),
    ]
    objects = [_object("o1", "Order"), _object("o2", "Order")]

    delays = activity_delay_distribution(make_ocel(events, objects))

    assert sorted(delays["B"]) == [100, 500]
    assert "A" not in delays
