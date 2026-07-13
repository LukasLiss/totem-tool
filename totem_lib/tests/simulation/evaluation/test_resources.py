"""Tests for the resource-oriented evaluation measures."""

from tests.assets.ocel_helpers import event, make_ocel, obj
from totem_lib.simulation.evaluation.resources import (
    resource_distribution,
    resource_distribution_distance,
    resource_utilization_rate,
)


def _worker_log():
    """r1 (Worker) participates in Load (t=0) and Unload (t=100); window = 100s."""
    return make_ocel(
        [
            event("e1", "Load", 0, ["o1"], resources=["r1"]),
            event("e2", "Unload", 100, ["o1"], resources=["r1"]),
        ],
        [obj("o1", "Order"), obj("r1", "Worker")],
    )


def test_resource_distribution_counts_participations():
    d = resource_distribution(_worker_log())
    assert d["Worker"]["n_resources"] == 1
    assert d["Worker"]["n_event_participations"] == 2
    assert d["Worker"]["events_per_resource"] == {"r1": 2}


def test_resource_distribution_counts_multiple_resources_in_same_event():
    log = make_ocel(
        [
            event("e1", "Load", 0, ["o1"], resources=["r1", "r2"]),
        ],
        [
            obj("o1", "Order"),
            obj("r1", "Worker"),
            obj("r2", "Worker"),
        ],
    )

    d = resource_distribution(log)

    assert d["Worker"]["n_resources"] == 2
    assert d["Worker"]["n_event_participations"] == 2
    assert d["Worker"]["events_per_resource"] == {"r1": 1, "r2": 1}


def test_resource_distribution_multiple_resource_types():
    log = make_ocel(
        [
            event("e1", "Load", 0, ["o1"], resources=["r1", "m1"]),
        ],
        [
            obj("o1", "Order"),
            obj("r1", "Worker"),
            obj("m1", "Machine"),
        ],
    )

    d = resource_distribution(log)

    assert d["Worker"]["n_resources"] == 1
    assert d["Machine"]["n_resources"] == 1
    assert d["Worker"]["events_per_resource"] == {"r1": 1}
    assert d["Machine"]["events_per_resource"] == {"m1": 1}


def test_resource_distribution_distance_per_type():
    simulated = make_ocel(
        [event("e1", "Load", 0, ["o1"], resources=["r1"])],
        [obj("o1", "Order"), obj("r1", "Worker")],
    )
    d = resource_distribution_distance(_worker_log(), simulated)
    assert d["Worker"]["n_resources_actual"] == 1
    assert d["Worker"]["events_per_resource_1wd"] == 1.0  # participations 2 vs 1


def test_resource_utilization_busy_time_measured_from_log():
    # r1 participates at t=0 and t=100, so it is occupied for the whole 100s
    # window: busy_s = last - first = 100, utilization = 1.0.
    util = resource_utilization_rate(_worker_log())
    assert util["observation_window_s"] == 100
    assert util["per_resource"]["r1"]["busy_s"] == 100.0
    assert util["per_resource"]["r1"]["n_events"] == 2
    assert util["per_resource"]["r1"]["utilization"] == 1.0
    assert util["per_type"]["Worker"]["mean_utilization"] == 1.0


def test_resource_single_participation_is_zero_busy():
    # A resource seen in only one event has no measurable occupation span.
    log = make_ocel(
        [
            event("e1", "Load", 0, ["o1"], resources=["r1"]),
            event("e2", "Unload", 100, ["o1"], resources=["r2"]),
        ],
        [obj("o1", "Order"), obj("r1", "Worker"), obj("r2", "Worker")],
    )
    util = resource_utilization_rate(log)
    assert util["per_resource"]["r1"]["busy_s"] == 0.0
    assert util["per_resource"]["r1"]["utilization"] == 0.0
    assert util["per_resource"]["r1"]["n_events"] == 1


def test_resource_partial_utilization():
    # Window is 100s. r1 spans t=0..50 (busy 50 → util 0.5); r2 spans the whole
    # window t=0..100 (busy 100 → util 1.0).
    log = make_ocel(
        [
            event("e1", "A", 0, ["o1"], resources=["r1"]),
            event("e2", "A", 50, ["o1"], resources=["r1"]),
            event("e3", "A", 0, ["o1"], resources=["r2"]),
            event("e4", "A", 100, ["o1"], resources=["r2"]),
        ],
        [obj("o1", "Order"), obj("r1", "Worker"), obj("r2", "Worker")],
    )
    util = resource_utilization_rate(log)
    assert util["observation_window_s"] == 100
    assert util["per_resource"]["r1"]["utilization"] == 0.5
    assert util["per_resource"]["r2"]["utilization"] == 1.0
    assert util["per_type"]["Worker"]["mean_utilization"] == 0.75
