"""
The naive (lazy-aggregation) TOTeM variant must produce exactly the same
model as totemDiscovery_db.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.generator import generate_synthetic_ocel
from totem_lib.ocel.importer_db import import_ocel_db
from totem_lib.totem.totem_db import totemDiscovery_db
from totem_lib.totem.totem_db_naive import totemDiscovery_db_naive

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"


def assert_same_totem(t1, t2):
    assert t1.tempgraph["nodes"] == t2.tempgraph["nodes"]
    assert t1.tempgraph["D"] == t2.tempgraph["D"]
    assert t1.tempgraph["I"] == t2.tempgraph["I"]
    assert {frozenset(e) for e in t1.tempgraph["P"]} == {
        frozenset(e) for e in t2.tempgraph["P"]
    }
    assert t1.cardinalities == t2.cardinalities
    assert t1.type_relations == t2.type_relations
    assert t1.all_event_types == t2.all_event_types
    assert t1.object_type_to_event_types == t2.object_type_to_event_types


@pytest.mark.parametrize("dataset", ["container_logistics.json"])
def test_naive_equals_optimized_on_real_log(dataset):
    db = import_ocel_db(str(TEST_DATA / dataset))
    try:
        assert_same_totem(totemDiscovery_db(db), totemDiscovery_db_naive(db))
    finally:
        db.close()


def test_naive_equals_optimized_on_synthetic_log():
    with generate_synthetic_ocel(
        n_types=3, objects_per_type=100, events_per_object=8, seed=21
    ) as db:
        assert_same_totem(totemDiscovery_db(db), totemDiscovery_db_naive(db))
