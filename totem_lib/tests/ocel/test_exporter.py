"""Tests for the OCEL 2.0 exporter (`totem_lib.ocel.exporter`)."""

from __future__ import annotations

import json
import sqlite3
import xml.etree.ElementTree as ET

import pytest

from totem_lib.ocel.exporter import _iso, _table_suffixes, export_ocel2
from totem_lib.ocel.importer import import_ocel
from totem_lib.ocel.importer_db import import_ocel_db

LOG = {
    "objectTypes": [
        {"name": "order", "attributes": [{"name": "price", "type": "string"}]},
        {"name": "item", "attributes": []},
    ],
    "eventTypes": [
        {"name": "place order", "attributes": [{"name": "channel", "type": "string"}]},
        {"name": "pay order", "attributes": []},
        {"name": "heartbeat", "attributes": []},
    ],
    "objects": [
        {
            "id": "o1",
            "type": "order",
            "attributes": [
                {"name": "price", "time": "1970-01-01T00:00:00Z", "value": "10"},
                {"name": "price", "time": "2024-01-02T00:00:00Z", "value": "12"},
            ],
            "relationships": [{"objectId": "i1", "qualifier": "contains"}],
        },
        {"id": "i1", "type": "item", "attributes": [], "relationships": []},
        # referenced by no event
        {"id": "i2", "type": "item", "attributes": [], "relationships": []},
    ],
    "events": [
        {
            "id": "e1",
            "type": "place order",
            "time": "2024-01-01T10:00:00Z",
            "attributes": [{"name": "channel", "value": "web"}],
            "relationships": [
                {"objectId": "o1", "qualifier": "placed"},
                {"objectId": "i1", "qualifier": ""},
            ],
        },
        {
            "id": "e2",
            "type": "pay order",
            "time": "2024-01-03T10:00:00Z",
            "attributes": [],
            "relationships": [{"objectId": "o1", "qualifier": ""}],
        },
        # related to no object
        {"id": "e3", "type": "heartbeat", "time": "2024-01-04T00:00:00Z",
         "attributes": [], "relationships": []},
    ],
}


@pytest.fixture()
def ocel_db(tmp_path):
    source = tmp_path / "source.json"
    source.write_text(json.dumps(LOG))
    db = import_ocel_db(str(source))
    yield db
    db.close()


def _tables(db):
    def rows(sql):
        return sorted(db.conn.execute(sql).fetchall())

    return {
        "events": rows("SELECT event_id, activity, timestamp_unix FROM events"),
        "event_attributes": rows("SELECT event_id, channel FROM events"),
        "objects": rows("SELECT obj_id, obj_type FROM objects"),
        "e2o": rows("SELECT event_id, obj_id, coalesce(qualifier, '') FROM event_object"),
        "o2o": rows(
            "SELECT source_obj_id, target_obj_id, coalesce(qualifier, '') FROM object_relations"
        ),
        "history": rows("SELECT obj_id, timestamp_unix, price FROM object_attribute_history"),
    }


def test_json_document(ocel_db, tmp_path):
    dest = export_ocel2(ocel_db.conn, str(tmp_path / "out.json"), "json")
    doc = json.loads(open(dest, encoding="utf-8").read())

    assert {t["name"] for t in doc["eventTypes"]} == {"place order", "pay order", "heartbeat"}
    assert {t["name"]: t["attributes"] for t in doc["objectTypes"]}["order"] == [
        {"name": "price", "type": "string"}
    ]
    # Every event and object is kept, also without relationships.
    assert [e["id"] for e in doc["events"]] == ["e1", "e2", "e3"]
    assert {o["id"] for o in doc["objects"]} == {"o1", "i1", "i2"}

    e1 = doc["events"][0]
    assert e1["time"] == "2024-01-01T10:00:00Z"
    assert e1["attributes"] == [{"name": "channel", "value": "web"}]
    assert e1["relationships"] == [
        {"objectId": "i1", "qualifier": ""},
        {"objectId": "o1", "qualifier": "placed"},
    ]
    o1 = next(o for o in doc["objects"] if o["id"] == "o1")
    assert o1["attributes"] == [
        {"name": "price", "time": "1970-01-01T00:00:00Z", "value": "10"},
        {"name": "price", "time": "2024-01-02T00:00:00Z", "value": "12"},
    ]
    assert o1["relationships"] == [{"objectId": "i1", "qualifier": "contains"}]


def test_xml_document(ocel_db, tmp_path):
    dest = export_ocel2(ocel_db.conn, str(tmp_path / "out.xml"), "xml")
    root = ET.parse(dest).getroot()

    assert root.tag == "log"
    assert [e.get("id") for e in root.findall("./events/event")] == ["e1", "e2", "e3"]
    e1 = root.find("./events/event[@id='e1']")
    assert e1.get("time") == "2024-01-01T10:00:00Z"
    assert e1.find("./attributes/attribute[@name='channel']").text == "web"
    assert {
        (r.get("object-id"), r.get("qualifier")) for r in e1.findall("./objects/relationship")
    } == {("o1", "placed"), ("i1", "")}
    prices = root.findall("./objects/object[@id='o1']/attributes/attribute")
    assert [(a.get("time"), a.text) for a in prices] == [
        ("1970-01-01T00:00:00Z", "10"),
        ("2024-01-02T00:00:00Z", "12"),
    ]


@pytest.mark.parametrize("fmt", ["json", "xml"])
def test_round_trip_through_duckdb_importer(ocel_db, tmp_path, fmt):
    dest = export_ocel2(ocel_db.conn, str(tmp_path / f"out.{fmt}"), fmt)
    reimported = import_ocel_db(dest)
    try:
        assert _tables(reimported) == _tables(ocel_db)
    finally:
        reimported.close()


def test_sqlite_layout(ocel_db, tmp_path):
    dest = export_ocel2(ocel_db.conn, str(tmp_path / "out.sqlite"), "sqlite")
    con = sqlite3.connect(dest)
    try:
        assert sorted(con.execute("SELECT * FROM event_map_type").fetchall()) == [
            ("heartbeat", "Heartbeat"),
            ("pay order", "PayOrder"),
            ("place order", "PlaceOrder"),
        ]
        assert con.execute("SELECT COUNT(*) FROM event").fetchone()[0] == 3
        assert con.execute("SELECT COUNT(*) FROM object").fetchone()[0] == 3
        assert con.execute(
            "SELECT ocel_id, ocel_time, channel FROM event_PlaceOrder"
        ).fetchall() == [("e1", "2024-01-01T10:00:00Z", "web")]
        # Initial values on a row at the epoch, later ones as change rows.
        assert con.execute(
            "SELECT ocel_time, price, ocel_changed_field FROM object_Order ORDER BY ocel_time"
        ).fetchall() == [
            ("1970-01-01T00:00:00Z", "10", None),
            ("2024-01-02T00:00:00Z", "12", "price"),
        ]
        # Objects without attributes still get their initial row.
        assert sorted(con.execute("SELECT ocel_id FROM object_Item").fetchall()) == [
            ("i1",), ("i2",)
        ]
        assert sorted(con.execute("SELECT * FROM event_object").fetchall()) == [
            ("e1", "i1", ""), ("e1", "o1", "placed"), ("e2", "o1", ""),
        ]
        assert con.execute("SELECT * FROM object_object").fetchall() == [
            ("o1", "i1", "contains")
        ]
    finally:
        con.close()


def test_sqlite_readable_by_polars_importer(ocel_db, tmp_path):
    dest = export_ocel2(ocel_db.conn, str(tmp_path / "out.sqlite"), "sqlite")
    ocel = import_ocel(dest)
    # The Polars importer drops the event without objects, as for any source.
    assert sorted(ocel.events["_eventId"].to_list()) == ["e1", "e2"]
    assert sorted(ocel.events["_activity"].to_list()) == ["pay order", "place order"]


def test_existing_file_is_replaced(ocel_db, tmp_path):
    dest = tmp_path / "out.json"
    dest.write_text("stale")
    export_ocel2(ocel_db.conn, str(dest), "json")
    assert json.loads(dest.read_text())["events"]


def test_unknown_format(ocel_db, tmp_path):
    with pytest.raises(ValueError, match="Unsupported OCEL 2.0 format"):
        export_ocel2(ocel_db.conn, str(tmp_path / "out.csv"), "csv")


def test_table_suffixes_are_unique_ignoring_case():
    assert _table_suffixes(["receive order", "Receive-Order", "receiveorder", "!!"]) == {
        "receive order": "ReceiveOrder",
        "Receive-Order": "ReceiveOrder2",
        "receiveorder": "Receiveorder3",
        "!!": "Type",
    }


def test_iso_timestamps():
    assert _iso(0) == "1970-01-01T00:00:00Z"
    assert _iso(1704103200) == "2024-01-01T10:00:00Z"
    assert _iso(-1) == "1969-12-31T23:59:59Z"
