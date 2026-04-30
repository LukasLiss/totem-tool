"""
Correctness tests: totemDiscovery (Polars-based) vs totemDiscovery_db (DuckDB-based).

Both algorithms are loaded from the same JSON source file so that activity names,
object types, and all other fields are identical going into both implementations.
The Polars path uses import_ocel(); the DB path uses import_ocel_db().
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.ocel.importer import import_ocel
from totem_lib.ocel.importer_db import import_ocel_db
from totem_lib.totem.totem import totemDiscovery
from totem_lib.totem.totem_db import totemDiscovery_db

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"

DATASETS = [
    pytest.param(TEST_DATA / "order-management.json", id="order-management"),
    pytest.param(TEST_DATA / "container_logistics.json", id="container_logistics"),
]


@pytest.fixture(scope="module", params=DATASETS)
def both_totems(request):
    source: Path = request.param
    ocel = import_ocel(str(source))
    db = import_ocel_db(str(source))
    totem_polars = totemDiscovery(ocel)
    totem_db = totemDiscovery_db(db)
    db.close()
    return totem_polars, totem_db


class TestTempgraph:
    def test_nodes(self, both_totems):
        t1, t2 = both_totems
        assert t1.tempgraph["nodes"] == t2.tempgraph["nodes"]

    def test_dependent_edges(self, both_totems):
        t1, t2 = both_totems
        assert t1.tempgraph["D"] == t2.tempgraph["D"]

    def test_initiating_edges(self, both_totems):
        t1, t2 = both_totems
        assert t1.tempgraph["I"] == t2.tempgraph["I"]

    def test_parallel_edges(self, both_totems):
        # Parallel relations are undirected — normalise to frozensets before comparing.
        t1, t2 = both_totems
        p1 = {frozenset(e) for e in t1.tempgraph["P"]}
        p2 = {frozenset(e) for e in t2.tempgraph["P"]}
        assert p1 == p2


class TestCardinalities:
    def test_cardinalities_keys(self, both_totems):
        t1, t2 = both_totems
        assert set(t1.cardinalities.keys()) == set(t2.cardinalities.keys())

    def test_cardinalities_values(self, both_totems):
        t1, t2 = both_totems
        for key in t1.cardinalities:
            assert t1.cardinalities[key] == t2.cardinalities[key], (
                f"Cardinality mismatch for {key}: "
                f"polars={t1.cardinalities[key]}, db={t2.cardinalities[key]}"
            )


class TestMetadata:
    def test_type_relations(self, both_totems):
        t1, t2 = both_totems
        assert t1.type_relations == t2.type_relations

    def test_all_event_types(self, both_totems):
        t1, t2 = both_totems
        assert t1.all_event_types == t2.all_event_types

    def test_object_type_to_event_types(self, both_totems):
        t1, t2 = both_totems
        assert t1.object_type_to_event_types == t2.object_type_to_event_types
