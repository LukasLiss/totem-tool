"""Tests for the object-centric evaluation measures."""
from tests.assets.ocel_helpers import make_ocel, event, obj
from totem_lib.simulation.evaluation.object_centric import (
    object_count,
    object_count_distance,
    cardinality_distribution,
    cardinality_distribution_distance,
    object_lifecycle_distribution,
    object_lifecycle_distance,
    object_graph_edit_distance,
)
import math
import pytest

def _order_with_items(n_items):
    """One execution: a single Create event holding 1 Order and n_items Items."""
    item_ids = [f"i{k}" for k in range(n_items)]
    objs = [obj("o1", "Order")] + [obj(i, "Item") for i in item_ids]
    return make_ocel([event("e1", "Create", 0, ["o1"] + item_ids)], objs)


def test_object_count_and_distance():
    actual = _order_with_items(2)
    assert object_count(actual) == {"Item": 2, "Order": 1}

    d = object_count_distance(actual, _order_with_items(0))
    assert d["Item"]["abs_diff"] == 2
    assert d["Order"]["abs_diff"] == 0

    assert d["Item"]["rel_diff"] == 1.0
    assert d["Order"]["rel_diff"] == 0.0


def test_cardinality_distribution_and_distance():
    card = cardinality_distribution(_order_with_items(2))
    assert card[("Order", "Item")] == {2: 1}   # the one Order co-occurs with 2 Items
    assert card[("Item", "Order")] == {1: 2}   # each of the 2 Items co-occurs with 1 Order

    dist = cardinality_distribution_distance(_order_with_items(2), _order_with_items(3))
    assert dist[("Order", "Item")] == 1.0      # cardinality 2 vs 3
    assert dist[("Order", "Order")] == 0.0

def test_cardinality_distribution_records_missing_related_type_as_zero():
    log = make_ocel(
        [
            event("e1", "Create", 0, ["o1", "i1"]),
            event("e2", "Create", 100, ["o2"]),
        ],
        [
            obj("o1", "Order"),
            obj("o2", "Order"),
            obj("i1", "Item"),
        ],
    )

    card = cardinality_distribution(log)

    assert card[("Order", "Item")] == {1: 1, 0: 1}

def test_object_lifecycle_distribution_and_distance():
    actual = make_ocel([event("e1", "A", 0, ["o1"]), event("e2", "B", 100, ["o1"])], [obj("o1", "Order")])
    assert object_lifecycle_distribution(actual)["Order"] == {"lengths": [2], "times_s": [100]}

    simulated = make_ocel([event("e1", "A", 0, ["o1"]), event("e2", "B", 300, ["o1"])], [obj("o1", "Order")])
    d = object_lifecycle_distance(actual, simulated)
    assert d["Order"]["length_1wd"] == 0.0       # both length 2
    assert d["Order"]["time_s_1wd"] == 200.0     # 100s vs 300s

def test_object_lifecycle_distance_missing_type_is_inf():
    actual = make_ocel(
        [event("e1", "A", 0, ["o1"])],
        [obj("o1", "Order")],
    )
    simulated = make_ocel([], [])

    d = object_lifecycle_distance(actual, simulated)

    assert math.isinf(d["Order"]["length_1wd"])
    assert math.isinf(d["Order"]["time_s_1wd"])


def test_graph_edit_distance():
    a = make_ocel([event("e1", "A", 0, ["o1"]), event("e2", "B", 100, ["o1"])], [obj("o1", "T")])
    b = make_ocel([event("e1", "A", 0, ["o1"]), event("e2", "C", 100, ["o1"])], [obj("o1", "T")])
    assert object_graph_edit_distance(a, a) == pytest.approx(0.0)
    assert object_graph_edit_distance(a, b) == pytest.approx(1.0)

def test_graph_edit_distance_symmetric():
    actual = make_ocel(
        [
            event("e1", "A", 0, ["o1"]),
        ],
        [obj("o1", "T")],
    )

    simulated = make_ocel(
        [
            event("e1", "A", 0, ["o1"]),
            event("e2", "B", 100, ["o2"]),
        ],
        [obj("o1", "T"), obj("o2", "T")],
    )

    assert object_graph_edit_distance(actual, simulated) == pytest.approx(0.25)
    assert object_graph_edit_distance(simulated, actual) == pytest.approx(0.25)
