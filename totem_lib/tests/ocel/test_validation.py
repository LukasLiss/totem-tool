import json
import shutil
import sqlite3
import sys
from pathlib import Path
import pytest

# Make the totem_lib `src` layout importable in raw-pytest invocations.
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.ocel.importer_db import import_ocel_db
from totem_lib.ocel.validation import OCELValidationException

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"

def test_json_strict_mode_rejects_duplicate_events(tmp_path):
    log_data = {
        "events": [
            {
                "id": "e1",
                "type": "create_order",
                "time": "2023-01-01T10:00:00Z",
                "relationships": [{"objectId": "o1"}]
            },
            {
                "id": "e1",  # duplicate ID
                "type": "create_order",
                "time": "2023-01-01T10:05:00Z",
                "relationships": [{"objectId": "o1"}]
            }
        ],
        "objects": [
            {
                "id": "o1",
                "type": "Order",
                "relationships": []
            }
        ]
    }
    log_file = tmp_path / "dup_log.json"
    log_file.write_text(json.dumps(log_data), encoding="utf-8")

    # Importing with strict_mode=True should raise OCELValidationException
    with pytest.raises(OCELValidationException) as exc_info:
        import_ocel_db(str(log_file), strict_mode=True)
    
    assert any("duplicate Event ID 'e1'" in err for err in exc_info.value.errors)

    # Importing with strict_mode=False (default) should pass
    db = import_ocel_db(str(log_file), strict_mode=False)
    # The duplicate should have been resolved/ignored
    assert db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 1
    db.close()


def test_sqlite_strict_mode_accepts_valid_log():
    # Regression: the bulk SQLite importer detached the source database before
    # the strict duplicate-ID check read from it, so every strict import failed.
    db = import_ocel_db(str(TEST_DATA / "container_logistics.sqlite"), strict_mode=True)
    assert db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] > 0
    db.close()


def test_sqlite_strict_mode_rejects_duplicate_events(tmp_path):
    log_file = tmp_path / "dup_log.sqlite"
    shutil.copy(TEST_DATA / "container_logistics.sqlite", log_file)

    # Reuse an event ID from one activity table in another activity table.
    con = sqlite3.connect(log_file)
    dup_id, dup_time = con.execute(
        'SELECT ocel_id, ocel_time FROM "event_BookVehicles" LIMIT 1'
    ).fetchone()
    con.execute(
        'INSERT INTO "event_CollectGoods" (ocel_id, ocel_time) VALUES (?, ?)',
        (dup_id, dup_time),
    )
    con.commit()
    con.close()

    with pytest.raises(OCELValidationException) as exc_info:
        import_ocel_db(str(log_file), strict_mode=True)

    assert any(f"duplicate Event ID '{dup_id}'" in err for err in exc_info.value.errors)
