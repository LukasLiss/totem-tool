"""Tests for the DuckDB-backed OCPN discovery (`discover_ocpn_db`).

Uses a hand-crafted order/item log modeled after the running example of
van der Aalst & Berti, "Discovering Object-Centric Petri Nets", plus an
integration test on a real example log.
"""

from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from totem_lib.ocel.importer_db import import_ocel_db
from totem_lib.ocel.ocel_duckdb import OcelDuckDB, create_ocel_schema
from totem_lib.ocpn import discover_ocpn_db

TOTEM_LIB_DIR = Path(__file__).resolve().parents[2]
CONTAINER_LOGISTICS = TOTEM_LIB_DIR / "example_data" / "ContainerLogistics.json"


# ---------------------------------------------------------------------------
# Fixture: the paper's order/item example
#
#   order o1 with items i1, i2:  place order -> pick item (x2) -> complete order
#   order o2 with item  i3:      place order -> pick item      -> complete order
#
# Expected per-type nets: order = seq(place order, complete order),
# item = seq(place order, pick item, complete order). "place order" and
# "complete order" sometimes involve two items, so their item arcs are
# variable; the order arcs are not.
# ---------------------------------------------------------------------------


@pytest.fixture()
def paper_ocel_db():
    conn = duckdb.connect(":memory:")
    create_ocel_schema(conn, [], [])
    events = [
        ("e1", "place order", 1),
        ("e2", "pick item", 2),
        ("e3", "pick item", 3),
        ("e4", "complete order", 4),
        ("e5", "place order", 5),
        ("e6", "pick item", 6),
        ("e7", "complete order", 7),
    ]
    objects = [
        ("o1", "order"),
        ("o2", "order"),
        ("i1", "item"),
        ("i2", "item"),
        ("i3", "item"),
    ]
    relations = [
        ("e1", "o1"),
        ("e1", "i1"),
        ("e1", "i2"),
        ("e2", "i1"),
        ("e3", "i2"),
        ("e4", "o1"),
        ("e4", "i1"),
        ("e4", "i2"),
        ("e5", "o2"),
        ("e5", "i3"),
        ("e6", "i3"),
        ("e7", "o2"),
        ("e7", "i3"),
    ]
    conn.executemany("INSERT INTO events VALUES (?, ?, ?)", events)
    conn.executemany("INSERT INTO objects VALUES (?, ?)", objects)
    conn.executemany(
        "INSERT INTO event_object VALUES (?, ?, NULL)", relations
    )
    db = OcelDuckDB._from_prepared_connection(conn, [], [])
    yield db
    db.close()


def _assert_valid_model(model: dict) -> None:
    assert model["format"] == "ocpn"
    assert model["version"] == 1
    assert isinstance(model["name"], str)
    place_ids = {p["id"] for p in model["places"]}
    transition_ids = {t["id"] for t in model["transitions"]}
    assert len(place_ids) == len(model["places"])
    assert len(transition_ids) == len(model["transitions"])
    assert not (place_ids & transition_ids)
    type_names = {ot["name"] for ot in model["objectTypes"]}
    for place in model["places"]:
        assert place["objectType"] in type_names
    arc_ids = set()
    for arc in model["arcs"]:
        arc_ids.add(arc["id"])
        source_is_place = arc["source"] in place_ids
        target_is_place = arc["target"] in place_ids
        assert source_is_place != target_is_place, "arcs must be bipartite"
        assert arc["source"] in place_ids | transition_ids
        assert arc["target"] in place_ids | transition_ids
    assert len(arc_ids) == len(model["arcs"])


def test_paper_example_structure(paper_ocel_db):
    model = discover_ocpn_db(paper_ocel_db, name="paper example")
    _assert_valid_model(model)

    assert [ot["name"] for ot in model["objectTypes"]] == ["item", "order"]

    labels = [t["label"] for t in model["transitions"] if not t.get("silent")]
    assert sorted(labels) == ["complete order", "pick item", "place order"]
    # Shared transitions: each activity appears exactly once in the model.
    assert len(labels) == len(set(labels))

    # Both per-type nets are plain sequences, so no silent transitions and
    # exactly source -> ... -> sink places per type.
    assert all(not t.get("silent") for t in model["transitions"])
    item_places = [p for p in model["places"] if p["objectType"] == "item"]
    order_places = [p for p in model["places"] if p["objectType"] == "order"]
    assert len(item_places) == 4
    assert len(order_places) == 3
    for places in (item_places, order_places):
        assert sum(1 for p in places if p.get("initial")) == 1
        assert sum(1 for p in places if p.get("final")) == 1


def test_paper_example_variable_arcs(paper_ocel_db):
    model = discover_ocpn_db(paper_ocel_db)
    place_type = {p["id"]: p["objectType"] for p in model["places"]}
    label_of = {t["id"]: t.get("label") for t in model["transitions"]}

    for arc in model["arcs"]:
        if arc["source"] in place_type:
            obj_type, transition = place_type[arc["source"]], arc["target"]
        else:
            obj_type, transition = place_type[arc["target"]], arc["source"]
        label = label_of[transition]
        expected_variable = obj_type == "item" and label in (
            "place order",
            "complete order",
        )
        assert bool(arc.get("variable")) == expected_variable, (
            f"arc {arc['id']} ({label} / {obj_type})"
        )


def test_object_type_filter(paper_ocel_db):
    model = discover_ocpn_db(paper_ocel_db, object_types=["order"])
    _assert_valid_model(model)
    assert [ot["name"] for ot in model["objectTypes"]] == ["order"]
    labels = sorted(t["label"] for t in model["transitions"])
    assert labels == ["complete order", "place order"]


def test_deterministic(paper_ocel_db):
    first = discover_ocpn_db(paper_ocel_db)
    second = discover_ocpn_db(paper_ocel_db)
    assert first == second


# ---------------------------------------------------------------------------
# Integration with a real example log
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not CONTAINER_LOGISTICS.exists(), reason="example data not available"
)
def test_container_logistics_end_to_end():
    db = import_ocel_db(str(CONTAINER_LOGISTICS))
    try:
        model = discover_ocpn_db(db, timeout_s=None)
        _assert_valid_model(model)
        assert model["places"]
        assert model["transitions"]
        assert model["arcs"]

        # Every activity of the log must appear as a transition label.
        activities = {
            row[0]
            for row in db.conn.execute(
                "SELECT DISTINCT activity FROM events"
            ).fetchall()
        }
        labels = {t.get("label") for t in model["transitions"] if t.get("label")}
        assert labels == activities

        # Every object type with events must contribute typed places.
        types_with_places = {p["objectType"] for p in model["places"]}
        assert types_with_places == {
            row[0]
            for row in db.conn.execute(
                "SELECT DISTINCT o.obj_type FROM objects o "
                "JOIN event_object eo ON eo.obj_id = o.obj_id"
            ).fetchall()
        }
    finally:
        db.close()


@pytest.mark.skipif(
    not CONTAINER_LOGISTICS.exists(), reason="example data not available"
)
def test_timeout_trips_on_tiny_budget():
    db = import_ocel_db(str(CONTAINER_LOGISTICS))
    try:
        with pytest.raises(TimeoutError):
            discover_ocpn_db(db, timeout_s=0.001)
        # The connection must stay usable after an interrupted run.
        model = discover_ocpn_db(db, timeout_s=None)
        _assert_valid_model(model)
    finally:
        db.close()
