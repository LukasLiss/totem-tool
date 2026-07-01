"""
Tests for the polars-side `.duckdb` OCEL importer.

Two correctness oracles:

1. **Self-consistent round-trip** — importing `container_logistics.duckdb`
   must yield an `ObjectCentricEventLog` whose row counts and aggregate sets
   match what a direct DuckDB query of the same file reports. (We can't
   round-trip against `container_logistics.json` here because the bundled
   `.duckdb` was generated from a *normalised* version of the log — object
   types and activities have spaces removed — so the two sources legitimately
   disagree on labels.)

2. **Validation** — pointing the importer at a DuckDB file that is *not* an
   OCEL DB (no expected tables) must raise `ValueError`, not silently return
   a broken/empty OCEL.
"""

from __future__ import annotations

import sys
from pathlib import Path

import duckdb
import pytest

# Make the totem_lib `src` layout importable in raw-pytest invocations.
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.ocel import ObjectCentricEventLog
from totem_lib.ocel.importer import import_ocel
from totem_lib.ocel.importer_duckdb import (
    import_ocel_from_duckdb,
    load_events_from_duckdb,
    load_objects_from_duckdb,
    load_object_attributes_from_duckdb,
)


TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"
DUCKDB_SOURCE = TEST_DATA / "container_logistics.duckdb"


# ---------------------------------------------------------------------------
# Self-consistent round-trip
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def duckdb_ocel() -> ObjectCentricEventLog:
    """OCEL loaded via the new polars importer (no post-filtering)."""
    return import_ocel_from_duckdb(str(DUCKDB_SOURCE))


@pytest.fixture(scope="module")
def duckdb_truth() -> dict:
    """Ground-truth aggregates queried directly from the DuckDB file."""
    conn = duckdb.connect(str(DUCKDB_SOURCE), read_only=True)
    try:
        n_events = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        n_objects = conn.execute("SELECT COUNT(*) FROM objects").fetchone()[0]
        activities = {
            r[0]
            for r in conn.execute(
                "SELECT DISTINCT activity FROM events"
            ).fetchall()
        }
        obj_types = {
            r[0]
            for r in conn.execute(
                "SELECT DISTINCT obj_type FROM objects"
            ).fetchall()
        }
        n_rel = conn.execute("SELECT COUNT(*) FROM event_object").fetchone()[0]
    finally:
        conn.close()
    return {
        "n_events": n_events,
        "n_objects": n_objects,
        "activities": activities,
        "obj_types": obj_types,
        "n_rel": n_rel,
    }


class TestRoundTrip:
    def test_returns_ocel(self, duckdb_ocel: ObjectCentricEventLog) -> None:
        assert isinstance(duckdb_ocel, ObjectCentricEventLog)

    def test_event_count(
        self, duckdb_ocel: ObjectCentricEventLog, duckdb_truth: dict
    ) -> None:
        assert len(duckdb_ocel.events) == duckdb_truth["n_events"]

    def test_object_count(
        self, duckdb_ocel: ObjectCentricEventLog, duckdb_truth: dict
    ) -> None:
        assert len(duckdb_ocel.objects) == duckdb_truth["n_objects"]

    def test_activity_set(
        self, duckdb_ocel: ObjectCentricEventLog, duckdb_truth: dict
    ) -> None:
        seen = set(duckdb_ocel.events["_activity"].to_list())
        assert seen == duckdb_truth["activities"]

    def test_object_type_set(
        self, duckdb_ocel: ObjectCentricEventLog, duckdb_truth: dict
    ) -> None:
        seen = set(duckdb_ocel.objects["_objType"].to_list())
        assert seen == duckdb_truth["obj_types"]

    def test_event_object_relations_preserved(
        self, duckdb_ocel: ObjectCentricEventLog, duckdb_truth: dict
    ) -> None:
        """Total number of (event, obj) pairs across all event lists must match."""
        total = sum(
            len(objs)
            for objs in duckdb_ocel.events["_objects"].to_list()
        )
        assert total == duckdb_truth["n_rel"]

    def test_events_schema_columns(
        self, duckdb_ocel: ObjectCentricEventLog
    ) -> None:
        """All expected polars columns are present (order-agnostic)."""
        assert set(duckdb_ocel.events.columns) == {
            "_eventId",
            "_activity",
            "_timestampUnix",
            "_objects",
            "_qualifiers",
            "_attributes",
        }

    def test_objects_schema_columns(
        self, duckdb_ocel: ObjectCentricEventLog
    ) -> None:
        assert set(duckdb_ocel.objects.columns) == {
            "_objId",
            "_objType",
            "_targetObjects",
            "_qualifiers",
        }

    def test_object_attributes_schema_columns(
        self, duckdb_ocel: ObjectCentricEventLog
    ) -> None:
        assert set(duckdb_ocel.object_attributes.columns) == {
            "_objId",
            "_timestampUnix",
            "_jsonObjAttributes",
        }


# ---------------------------------------------------------------------------
# Validation — non-OCEL DuckDB files
# ---------------------------------------------------------------------------

class TestValidation:
    def test_raises_on_non_ocel_duckdb(self, tmp_path) -> None:
        """A random DuckDB file lacking OCEL tables must produce a clear error."""
        bogus = tmp_path / "bogus.duckdb"
        conn = duckdb.connect(str(bogus))
        conn.execute("CREATE TABLE foo (x INTEGER)")
        conn.close()

        with pytest.raises(ValueError, match="not a valid OCEL DuckDB"):
            import_ocel_from_duckdb(str(bogus))

    def test_validation_applies_to_each_loader(self, tmp_path) -> None:
        """All three loader entry points must validate, not just the top-level."""
        bogus = tmp_path / "bogus2.duckdb"
        conn = duckdb.connect(str(bogus))
        conn.execute("CREATE TABLE foo (x INTEGER)")
        conn.close()

        for loader in (
            load_events_from_duckdb,
            load_objects_from_duckdb,
            load_object_attributes_from_duckdb,
        ):
            with pytest.raises(ValueError, match="not a valid OCEL DuckDB"):
                loader(str(bogus))


# ---------------------------------------------------------------------------
# Dispatcher integration
# ---------------------------------------------------------------------------

class TestDispatcher:
    def test_import_ocel_routes_duckdb(self) -> None:
        """`import_ocel('something.duckdb')` must dispatch to the new importer."""
        ocel = import_ocel(str(DUCKDB_SOURCE))
        assert isinstance(ocel, ObjectCentricEventLog)
        assert len(ocel.events) > 0
        assert len(ocel.objects) > 0
