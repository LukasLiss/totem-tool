"""Tests for the count- and size-based summary measures."""
import math

from tests.assets.ocel_helpers import make_ocel, event, obj
from totem_lib.simulation.evaluation.counts import count_summary, count_summary_distance


def _counts_log():
    """2 executions of variant Create->Ship + 1 single-event execution Create."""
    return make_ocel(
        [
            event("e1", "Create", 0,   ["o1"]),
            event("e2", "Ship",   100, ["o1"]),
            event("e3", "Create", 200, ["o2"]),
            event("e4", "Ship",   300, ["o2"]),
            event("e5", "Create", 400, ["o3"]),
        ],
        [obj("o1", "Order"), obj("o2", "Order"), obj("o3", "Order")],
    )


def test_count_summary_totals_and_averages():
    s = count_summary(_counts_log())
    assert s["n_executions"] == 3
    assert s["n_events"] == 5
    assert s["n_variants"] == 2
    assert s["avg_events_per_execution"] == 5 / 3
    assert s["avg_events_per_variant"] == 1.5      
    assert s["avg_executions_per_variant"] == 1.5 


def test_count_summary_distance_abs_and_rel():
    simulated = make_ocel(
        [event("e1", "Create", 0, ["o1"]), event("e2", "Ship", 100, ["o1"])],
        [obj("o1", "Order")],
    )
    d = count_summary_distance(_counts_log(), simulated)
    assert d["n_executions"] == {"actual": 3, "simulated": 1, "abs_diff": 2, "rel_diff": 2 / 3}
    assert d["n_events"]["abs_diff"] == 3


def test_count_summary_distance_rel_diff_nan_when_actual_zero():
    empty = make_ocel([], [])
    nonempty = make_ocel([event("e1", "A", 0, ["o1"])], [obj("o1", "T")])
    d = count_summary_distance(empty, nonempty)
    assert d["n_events"]["abs_diff"] == 1
    assert math.isnan(d["n_events"]["rel_diff"])
