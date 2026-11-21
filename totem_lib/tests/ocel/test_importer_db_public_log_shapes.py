"""
DuckDB importer on two shapes found in public OCEL 2.0 logs.

1. SQLite object tables without an ``ocel_time`` column (SAP P2P collection log,
   Zenodo 10.5281/zenodo.18334009). OCEL 2.0 allows this when attributes never
   change; the values are then initial values at time 0. The importer used to
   select ``ocel_time`` unconditionally and failed with a BinderException.
2. XML events whose relations are written as ``<objects><object object-id=.../>``
   instead of ``<relationship>`` (Angular GitHub commits log). The importer
   ignored them, leaving ``event_object`` empty, and mistook each nested
   ``<object>`` for the end of a top-level object.

Small synthetic files mimic both shapes; the counts are compared with the
Polars importer, which reads both correctly.
"""

import sqlite3

import pytest

from totem_lib import import_ocel
from totem_lib.ocel import importer_db
from totem_lib.ocel.importer_db import import_ocel_db


def _count(db, table: str) -> int:
    return db.conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]


# ---------------------------------------------------------------------------
# SQLite: object tables without ocel_time
# ---------------------------------------------------------------------------

def _build_sqlite_without_object_time(path) -> None:
    con = sqlite3.connect(path)
    con.executescript(
        """
        CREATE TABLE event (ocel_id TEXT PRIMARY KEY, ocel_type TEXT);
        CREATE TABLE event_map_type (ocel_type TEXT, ocel_type_map TEXT);
        CREATE TABLE event_object (ocel_event_id TEXT, ocel_object_id TEXT,
                                   ocel_qualifier TEXT);
        CREATE TABLE object (ocel_id TEXT PRIMARY KEY, ocel_type TEXT);
        CREATE TABLE object_map_type (ocel_type TEXT, ocel_type_map TEXT);
        CREATE TABLE object_object (ocel_source_id TEXT, ocel_target_id TEXT,
                                    ocel_qualifier TEXT);
        CREATE TABLE event_CreatePO (ocel_id TEXT, ocel_time TEXT, resource TEXT);

        -- Like the SAP collection logs: no ocel_time, with and without attributes.
        CREATE TABLE object_Ebeln (ocel_id TEXT);
        CREATE TABLE object_Ebelnebelp (ocel_id TEXT, matnr TEXT, netpr TEXT);

        INSERT INTO event_map_type VALUES ('Create PO', 'CreatePO');
        INSERT INTO object_map_type VALUES ('EBELN', 'Ebeln'), ('EBELN_EBELP', 'Ebelnebelp');
        INSERT INTO object VALUES ('po1', 'EBELN'), ('po1-10', 'EBELN_EBELP'),
                                  ('po1-20', 'EBELN_EBELP');
        INSERT INTO object_Ebeln VALUES ('po1');
        INSERT INTO object_Ebelnebelp VALUES ('po1-10', 'M-1', '12.5'), ('po1-20', 'M-2', NULL);
        INSERT INTO event VALUES ('e1', 'Create PO'), ('e2', 'Create PO');
        INSERT INTO event_CreatePO VALUES ('e1', '2024-01-01T10:00:00Z', 'alice'),
                                          ('e2', '2024-01-02T10:00:00Z', 'bob');
        INSERT INTO event_object VALUES ('e1', 'po1', ''), ('e1', 'po1-10', ''),
                                        ('e2', 'po1', ''), ('e2', 'po1-20', '');
        """
    )
    con.commit()
    con.close()


@pytest.fixture(scope="module")
def sqlite_without_object_time(tmp_path_factory):
    path = tmp_path_factory.mktemp("no_obj_time") / "log.sqlite"
    _build_sqlite_without_object_time(path)
    return str(path)


@pytest.fixture(params=["scanner", "python"])
def sqlite_reader(request, monkeypatch):
    """Run each SQLite test through both staging paths."""
    if request.param == "python":
        monkeypatch.setattr(importer_db, "_load_sqlite_scanner", lambda conn: False)
    elif not importer_db._load_sqlite_scanner(importer_db.duckdb.connect()):
        pytest.skip("sqlite_scanner extension not available")
    return request.param


def test_sqlite_object_tables_without_time_import(sqlite_without_object_time, sqlite_reader):
    db = import_ocel_db(sqlite_without_object_time)
    try:
        assert _count(db, "events") == 2
        assert _count(db, "objects") == 3
        assert _count(db, "event_object") == 4
        rows = db.conn.execute(
            "SELECT obj_id, timestamp_unix, matnr, netpr FROM object_attribute_history "
            "ORDER BY obj_id"
        ).fetchall()
        # Attributes without a time are initial values (time 0).
        assert rows == [("po1-10", 0, "M-1", "12.5"), ("po1-20", 0, "M-2", None)]
    finally:
        db.close()


def test_sqlite_without_object_time_matches_polars(sqlite_without_object_time, sqlite_reader):
    ocel = import_ocel(sqlite_without_object_time)
    db = import_ocel_db(sqlite_without_object_time)
    try:
        assert _count(db, "events") == ocel.events.height
        assert _count(db, "objects") == ocel.objects.height
        assert _count(db, "event_object") == ocel.events["_objects"].list.len().sum()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# XML: event relations written as <objects><object object-id=.../>
# ---------------------------------------------------------------------------

_XML_NESTED_OBJECT_RELATIONS = """<?xml version='1.0' encoding='UTF-8'?>
<log>
  <object-types>
    <object-type name="branches"><attributes/></object-type>
    <object-type name="files"><attributes/></object-type>
  </object-types>
  <event-types>
    <event-type name="fix">
      <attributes><attribute name="author_name" type="string"/></attributes>
    </event-type>
  </event-types>
  <objects>
    <object id="main" type="branches"><attributes/><objects/></object>
    <object id="17.x" type="branches"><attributes/><objects/></object>
    <object id="src/a.ts" type="files">
      <attributes><attribute name="size" time="1970-01-01T00:00:00Z">10</attribute></attributes>
      <objects><relationship object-id="main" qualifier="on"/></objects>
    </object>
  </objects>
  <events>
    <event id="c1" type="fix" time="2024-01-01T10:00:00+00:00">
      <attributes><attribute name="author_name">Ada</attribute></attributes>
      <objects>
        <object object-id="main" qualifier="None"/>
        <object object-id="17.x" qualifier="None"/>
        <object object-id="src/a.ts" qualifier="None"/>
      </objects>
    </event>
    <event id="c2" type="fix" time="2024-01-02T10:00:00-07:00">
      <attributes><attribute name="author_name">Grace</attribute></attributes>
      <objects>
        <object object-id="main" qualifier="None"/>
      </objects>
    </event>
  </events>
</log>
"""


@pytest.fixture(scope="module")
def xml_nested_object_relations(tmp_path_factory):
    path = tmp_path_factory.mktemp("xml_nested") / "log.xml"
    path.write_text(_XML_NESTED_OBJECT_RELATIONS, encoding="utf-8")
    return str(path)


def test_xml_nested_object_relations_import(xml_nested_object_relations):
    db = import_ocel_db(xml_nested_object_relations)
    try:
        assert _count(db, "events") == 2
        assert sorted(db.conn.execute("SELECT obj_id, obj_type FROM objects").fetchall()) == [
            ("17.x", "branches"), ("main", "branches"), ("src/a.ts", "files"),
        ]
        assert sorted(db.conn.execute(
            "SELECT event_id, obj_id, qualifier FROM event_object").fetchall()) == [
            ("c1", "17.x", "None"), ("c1", "main", "None"),
            ("c1", "src/a.ts", "None"), ("c2", "main", "None"),
        ]
        # Object-level relations and attributes are still read.
        assert db.conn.execute(
            "SELECT source_obj_id, target_obj_id FROM object_relations").fetchall() == [
            ("src/a.ts", "main"),
        ]
        assert _count(db, "object_attribute_history") == 1
    finally:
        db.close()


def test_xml_nested_object_relations_match_polars(xml_nested_object_relations):
    ocel = import_ocel(xml_nested_object_relations)
    db = import_ocel_db(xml_nested_object_relations)
    try:
        assert _count(db, "events") == ocel.events.height
        assert _count(db, "objects") == ocel.objects.height
        assert _count(db, "event_object") == ocel.events["_objects"].list.len().sum()
    finally:
        db.close()
