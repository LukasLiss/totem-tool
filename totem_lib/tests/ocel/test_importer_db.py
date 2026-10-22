"""What `import_ocel_db` leaves on disk when an import into `db_path` fails."""

import json
import sys
from pathlib import Path

import duckdb
import pytest

# Make the totem_lib `src` layout importable in raw-pytest invocations.
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.ocel.importer_db import import_ocel_db
from totem_lib.ocel.validation import OCELValidationException

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"
SOURCE = TEST_DATA / "resource_aware_orders.json"


def _event_count(path) -> int:
    conn = duckdb.connect(str(path), read_only=True)
    try:
        return conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    finally:
        conn.close()


@pytest.fixture
def existing_db(tmp_path):
    """A database someone else already imported to the target path."""
    target = tmp_path / "log.duckdb"
    import_ocel_db(str(SOURCE), db_path=str(target)).close()
    return target


def test_failed_import_keeps_an_existing_database(existing_db):
    events = _event_count(existing_db)

    with pytest.raises(duckdb.Error):
        import_ocel_db(str(SOURCE), db_path=str(existing_db))

    assert _event_count(existing_db) == events


def test_failed_import_keeps_a_database_that_is_open_elsewhere(existing_db):
    # How the backend hit this: its registry holds every log open read-only,
    # so importing over one fails on the connection, not on the schema.
    reader = duckdb.connect(str(existing_db), read_only=True)
    try:
        with pytest.raises(duckdb.Error):
            import_ocel_db(str(SOURCE), db_path=str(existing_db))
        assert existing_db.exists()
        assert reader.execute("SELECT COUNT(*) FROM events").fetchone()[0] > 0
    finally:
        reader.close()
    assert _event_count(existing_db) > 0


def test_failed_import_removes_the_database_it_created(tmp_path):
    # Valid JSON, so the target is created before strict mode rejects it.
    event = {"type": "a", "time": "2023-01-01T10:00:00Z", "relationships": []}
    source = tmp_path / "duplicate_events.json"
    source.write_text(json.dumps({
        "events": [{"id": "e1", **event}, {"id": "e1", **event}],
        "objects": [],
    }))
    target = tmp_path / "log.duckdb"

    with pytest.raises(OCELValidationException):
        import_ocel_db(str(source), db_path=str(target), strict_mode=True)

    assert not target.exists()
    assert not Path(f"{target}.wal").exists()


def test_import_accepts_a_path_object():
    db = import_ocel_db(SOURCE)
    try:
        assert db.query("SELECT COUNT(*) AS n FROM events")["n"][0] == 22
    finally:
        db.close()
