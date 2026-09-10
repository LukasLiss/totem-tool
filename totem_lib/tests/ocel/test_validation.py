import json
import sys
from pathlib import Path
import pytest

# Make the totem_lib `src` layout importable in raw-pytest invocations.
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.ocel.importer_db import import_ocel_db
from totem_lib.ocel.validation import OCELValidationException

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
