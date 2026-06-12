"""
The naive self-join OC-DFG (ablation baseline) must produce exactly the same
graph as the window-function implementation.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.dfg.ocdfg_db import OCDFGDb
from totem_lib.dfg.ocdfg_db_naive import OCDFGDbNaive
from totem_lib.generator import generate_synthetic_ocel
from totem_lib.ocel.importer_db import import_ocel_db

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"


def assert_same_graph(g1, g2):
    assert set(g1.nodes()) == set(g2.nodes())
    for n in g1.nodes():
        assert g1.nodes[n] == g2.nodes[n], f"node attrs differ for {n}"
    assert set(g1.edges()) == set(g2.edges())
    for u, v in g1.edges():
        assert g1.edges[u, v] == g2.edges[u, v], f"edge attrs differ for {u}->{v}"


@pytest.mark.parametrize("dataset", ["container_logistics.json"])
def test_naive_equals_window_on_real_log(dataset):
    db = import_ocel_db(str(TEST_DATA / dataset))
    try:
        assert_same_graph(
            OCDFGDb.from_ocel_db(db), OCDFGDbNaive.from_ocel_db(db)
        )
    finally:
        db.close()


def test_naive_equals_window_on_synthetic_log():
    with generate_synthetic_ocel(
        n_types=3, objects_per_type=100, events_per_object=8, seed=11
    ) as db:
        assert_same_graph(OCDFGDb.from_ocel_db(db), OCDFGDbNaive.from_ocel_db(db))


def test_naive_equals_window_with_type_filter():
    with generate_synthetic_ocel(
        n_types=3, objects_per_type=100, events_per_object=8, seed=12
    ) as db:
        assert_same_graph(
            OCDFGDb.from_ocel_db(db, object_types=["ot0", "ot1"]),
            OCDFGDbNaive.from_ocel_db(db, object_types=["ot0", "ot1"]),
        )
