"""Tests for the OC-DFG token animation steps (ocdfg_flows_from_ocel_db)."""

import sys
from collections import Counter
from pathlib import Path

import duckdb
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.dfg.ocdfg_db import NewOCDFGDb
from totem_lib.dfg.ocdfg_flows import ocdfg_flows_from_ocel_db
from totem_lib.ocel.importer_db import import_ocel_db
from totem_lib.ocel.ocel_duckdb import OcelDuckDB, create_ocel_schema

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"
DATASET = TEST_DATA / "container_logistics.json"


def _db(events, objects, relations):
    """A synthetic in-memory log: events (id, activity, ts), objects (id, type), (event, object)."""
    conn = duckdb.connect(":memory:")
    create_ocel_schema(conn, [], [])
    conn.executemany("INSERT INTO events VALUES (?, ?, ?)", events)
    conn.executemany("INSERT INTO objects VALUES (?, ?)", objects)
    conn.executemany("INSERT INTO event_object VALUES (?, ?, NULL)", relations)
    return OcelDuckDB._from_prepared_connection(conn, [], [])


@pytest.fixture
def small_db():
    # o1 (order): create@0 -> pack@100 -> ship@100 (same timestamp: 0 s step)
    # i1, i2 (item): pack@100 -> ship@400; i2 also pick@50 before pack
    # i3 (item): only one event, so no step
    db = _db(
        events=[
            ("e1", "create", 0),
            ("e2", "pick", 50),
            ("e3", "pack", 100),
            ("e4", "ship", 100),
            ("e5", "ship", 400),
            ("e6", "pick", 500),
        ],
        objects=[("o1", "order"), ("i1", "item"), ("i2", "item"), ("i3", "item")],
        relations=[
            ("e1", "o1"),
            ("e3", "o1"),
            ("e4", "o1"),
            ("e2", "i2"),
            ("e3", "i1"),
            ("e3", "i2"),
            ("e5", "i1"),
            ("e5", "i2"),
            ("e6", "i3"),
        ],
    )
    yield db
    db.conn.close()


def _steps(result):
    """Decode the column-oriented result into (object_type, source, target, start, duration) rows."""
    acts = result["activities"]
    types = result["object_types"]
    obj_types = result["objects"]["type"]
    f = result["flows"]
    return [
        (types[obj_types[o]], acts[s], acts[t], start, dur)
        for o, s, t, start, dur in zip(f["object"], f["source"], f["target"], f["start"], f["duration"])
    ]


def test_steps_of_a_small_log(small_db):
    result = ocdfg_flows_from_ocel_db(small_db)
    assert sorted(_steps(result)) == sorted([
        ("order", "create", "pack", 0, 100),
        ("order", "pack", "ship", 100, 0),
        ("item", "pick", "pack", 50, 50),
        ("item", "pack", "ship", 100, 300),
        ("item", "pack", "ship", 100, 300),
    ])
    # i3 has a single event: no step, and it is not counted.
    assert result["total_objects"] == 3
    assert result["objects"]["variant_rank"] is None


def test_steps_are_sorted_by_start(small_db):
    starts = ocdfg_flows_from_ocel_db(small_db)["flows"]["start"]
    assert starts == sorted(starts)


def test_object_type_filter(small_db):
    result = ocdfg_flows_from_ocel_db(small_db, object_types=["order"])
    assert {row[0] for row in _steps(result)} == {"order"}
    assert result["total_objects"] == 1


def test_variant_ranks(small_db):
    result = ocdfg_flows_from_ocel_db(small_db, variant_ranks=True)
    objects = result["objects"]
    types = result["object_types"]
    ranks = {}
    for index, (type_index, rank) in enumerate(zip(objects["type"], objects["variant_rank"])):
        ranks.setdefault(types[type_index], []).append(rank)
    # order: one variant. items with steps: i1 (pack, ship) and i2 (pick, pack, ship)
    # are each one object of their variant; i3 (pick) has no step.
    assert ranks["order"] == [1]
    assert sorted(ranks["item"]) in ([1, 2], [1, 3], [2, 3])
    assert all(r >= 1 for r in objects["variant_rank"])


def test_empty_result():
    db = _db(events=[("e1", "a", 0)], objects=[("o1", "t")], relations=[("e1", "o1")])
    try:
        result = ocdfg_flows_from_ocel_db(db, variant_ranks=True)
        assert result["flows"]["object"] == []
        assert result["total_objects"] == 0
        assert result["objects"]["variant_rank"] == []
    finally:
        db.conn.close()


def _dfg_activity_arc_weights(graph):
    """(object type, source, target) -> weight of every arc between two activities."""
    weights = {}
    for u, v, otype, data in graph.edges(keys=True, data=True):
        if str(u).startswith(("__start__:", "__end__:")) or str(v).startswith(("__start__:", "__end__:")):
            continue
        weights[(otype, u, v)] = data["weight"]
    return weights


@pytest.mark.parametrize("object_types", [None, ["order"]])
def test_steps_add_up_to_the_dfg_arcs_small(small_db, object_types):
    graph = NewOCDFGDb.from_ocel_db(small_db, object_types=object_types)
    counts = Counter((t, s, g) for t, s, g, _, _ in _steps(ocdfg_flows_from_ocel_db(small_db, object_types=object_types)))
    assert dict(counts) == _dfg_activity_arc_weights(graph)


def test_steps_add_up_to_the_dfg_arcs_dataset():
    db = import_ocel_db(str(DATASET))
    try:
        graph = NewOCDFGDb.from_ocel_db(db)
        result = ocdfg_flows_from_ocel_db(db, variant_ranks=True)
        counts = Counter((t, s, g) for t, s, g, _, _ in _steps(result))
        assert dict(counts) == _dfg_activity_arc_weights(graph)
        assert all(d >= 0 for d in result["flows"]["duration"])
        assert len(result["objects"]["variant_rank"]) == result["total_objects"]
    finally:
        db.close()
