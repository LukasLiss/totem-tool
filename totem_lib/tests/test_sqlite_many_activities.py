"""
SQLite logs with more activities than SQLite allows terms in one compound SELECT.

The Polars importer used to read every per-activity event table in a single UNION,
which SQLite rejects above 500 terms ("too many terms in compound SELECT"). The Age of
Empires log has 831 activities and could not be imported at all. These tests build a
small log with 600 activities, so they cover the batching without the 850 MB file.

The log also has no object-to-object relations, which the Polars importer could not
handle either (the Enron log has none).
"""

import sqlite3

import pytest

from totem_lib import import_ocel
from totem_lib.ocel.importer import load_events_from_sqlite
from totem_lib.ocel.importer_db import import_ocel_db

N_ACTIVITIES = 600  # above SQLite's limit of 500 compound SELECT terms
N_OBJECTS = 3


def _build_log(path) -> None:
    """A minimal OCEL 2.0 SQLite file: one event per activity, each linked to an object."""
    con = sqlite3.connect(path)
    cur = con.cursor()
    cur.executescript(
        """
        CREATE TABLE event (ocel_id TEXT PRIMARY KEY, ocel_type TEXT);
        CREATE TABLE event_map_type (ocel_type TEXT, ocel_type_map TEXT);
        CREATE TABLE event_object (ocel_event_id TEXT, ocel_object_id TEXT,
                                   ocel_qualifier TEXT);
        CREATE TABLE object (ocel_id TEXT PRIMARY KEY, ocel_type TEXT);
        CREATE TABLE object_map_type (ocel_type TEXT, ocel_type_map TEXT);
        CREATE TABLE object_object (ocel_source_id TEXT, ocel_target_id TEXT,
                                    ocel_qualifier TEXT);
        CREATE TABLE object_Item (ocel_id TEXT, ocel_time TEXT, ocel_changed_field TEXT);
        """
    )
    cur.execute("INSERT INTO object_map_type VALUES ('Item', 'Item')")
    for o in range(N_OBJECTS):
        cur.execute("INSERT INTO object VALUES (?, 'Item')", (f"o{o}",))
        cur.execute("INSERT INTO object_Item VALUES (?, '1970-01-01T00:00:00Z', NULL)",
                    (f"o{o}",))

    for a in range(N_ACTIVITIES):
        activity, table = f"Activity {a}", f"Activity{a}"
        cur.execute("INSERT INTO event_map_type VALUES (?, ?)", (activity, table))
        cur.execute(f'CREATE TABLE "event_{table}" (ocel_id TEXT, ocel_time TEXT)')
        event_id = f"e{a}"
        cur.execute("INSERT INTO event VALUES (?, ?)", (event_id, activity))
        cur.execute(
            f'INSERT INTO "event_{table}" VALUES (?, ?)',
            (event_id, f"2024-01-01T00:{a // 60:02d}:{a % 60:02d}Z"),
        )
        cur.execute("INSERT INTO event_object VALUES (?, ?, 'q')",
                    (event_id, f"o{a % N_OBJECTS}"))
    con.commit()
    con.close()


@pytest.fixture(scope="module")
def wide_log(tmp_path_factory):
    path = tmp_path_factory.mktemp("wide") / "wide.sqlite"
    _build_log(path)
    return path


def test_events_load_from_a_log_with_more_activities_than_one_union_allows(wide_log):
    events = load_events_from_sqlite(str(wide_log))
    assert events.height == N_ACTIVITIES
    assert events["_activity"].n_unique() == N_ACTIVITIES


def test_every_event_keeps_its_own_timestamp(wide_log):
    """Batches must not mix up rows: event e<a> happened <a> seconds after midnight."""
    events = load_events_from_sqlite(str(wide_log))
    midnight = 1704067200  # 2024-01-01T00:00:00Z
    for event_id, ts in zip(events["_eventId"], events["_timestampUnix"]):
        assert ts == midnight + int(event_id[1:])


def test_events_from_both_sides_of_a_batch_boundary_are_present(wide_log):
    ids = set(load_events_from_sqlite(str(wide_log))["_eventId"])
    assert {"e0", "e399", "e400", f"e{N_ACTIVITIES - 1}"} <= ids


def test_the_full_polars_import_succeeds(wide_log):
    ocel = import_ocel(str(wide_log))
    assert ocel.events.height == N_ACTIVITIES


def test_the_duckdb_import_succeeds(wide_log, tmp_path):
    db = import_ocel_db(str(wide_log), db_path=str(tmp_path / "wide.duckdb"))
    try:
        assert db.conn.execute("SELECT count(*) FROM events").fetchone()[0] == N_ACTIVITIES
    finally:
        db.close()


def test_a_log_without_object_to_object_relations_imports(wide_log):
    """
    The fixture has an empty object_object table, as the Enron log does. Its columns
    used to come back null-typed, and joining them to the object ids failed.
    """
    ocel = import_ocel(str(wide_log))
    assert ocel.objects.height == N_OBJECTS
    assert ocel.objects["_targetObjects"].list.len().sum() == 0
