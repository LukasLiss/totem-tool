import os
import tempfile

import duckdb
import pytest

from totem_lib.ocel import (
    EventColumnError,
    OcelDuckDB,
    event_column_summary,
    list_event_columns,
    validate_event_column_name,
    write_event_column,
    write_event_columns_to_file,
)
from totem_lib.ocel.ocel_duckdb import create_ocel_schema


def _log_conn(event_attr_cols=()):
    conn = duckdb.connect(":memory:")
    create_ocel_schema(conn, list(event_attr_cols), [])
    placeholders = ", ".join("?" for _ in range(3 + len(event_attr_cols)))
    conn.executemany(
        f"INSERT INTO events VALUES ({placeholders})",
        [
            ("e1", "a", 1, *([None] * len(event_attr_cols))),
            ("e2", "b", 2, *([None] * len(event_attr_cols))),
            ("e3", "c", 3, *([None] * len(event_attr_cols))),
        ],
    )
    conn.executemany("INSERT INTO objects VALUES (?, ?)", [("o1", "order")])
    conn.executemany(
        "INSERT INTO event_object VALUES (?, ?, NULL)",
        [("e1", "o1"), ("e2", "o1"), ("e3", "o1")],
    )
    return conn


@pytest.mark.parametrize("name", ["execution", "process execution", "exec_id-1", "case.id"])
def test_valid_column_names(name):
    assert validate_event_column_name(name) == name


@pytest.mark.parametrize("name", ["", "a" * 65, 'bad"quote', "semi;colon", None, 12])
def test_invalid_column_names_are_rejected(name):
    with pytest.raises(EventColumnError):
        validate_event_column_name(name)


@pytest.mark.parametrize("name", ["event_id", "activity", "Timestamp_Unix"])
def test_fixed_columns_cannot_be_overwritten(name):
    with pytest.raises(EventColumnError, match="fixed column"):
        validate_event_column_name(name)


def test_list_event_columns_excludes_fixed_columns():
    conn = _log_conn(["cost"])
    assert list_event_columns(conn) == ["cost"]


def test_write_creates_fills_and_resets_column():
    conn = _log_conn()
    assert write_event_column(conn, "execution", {"e1": "x", "e2": "x", "e3": None}) == 2
    assert list_event_columns(conn) == ["execution"]
    assert conn.execute(
        'SELECT event_id, "execution" FROM events ORDER BY event_id'
    ).fetchall() == [("e1", "x"), ("e2", "x"), ("e3", None)]
    assert event_column_summary(conn, "execution") == {
        "name": "execution",
        "non_null_count": 2,
        "distinct_count": 1,
    }

    # Writing again replaces the whole column: e1 loses its value.
    assert write_event_column(conn, "execution", {"e3": "y"}) == 1
    assert conn.execute(
        'SELECT event_id, "execution" FROM events ORDER BY event_id'
    ).fetchall() == [("e1", None), ("e2", None), ("e3", "y")]

    # Unknown event ids are ignored; the fixed columns are untouched.
    assert write_event_column(conn, "execution", {"nope": "z"}) == 0
    assert conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 3


def test_summary_of_unknown_column_raises():
    conn = _log_conn()
    with pytest.raises(EventColumnError, match="does not exist"):
        event_column_summary(conn, "missing")


def test_write_columns_to_file_and_reload_as_attribute():
    conn = _log_conn()
    db = OcelDuckDB._from_prepared_connection(conn, [], [])
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "log.duckdb")
        db.save(path)
        db.close()

        counts = write_event_columns_to_file(
            path, {"execution": {"e1": "c1", "e2": "c1"}, "variant": {"e1": "v0"}}
        )
        assert counts == {"execution": 2, "variant": 1}

        reloaded = OcelDuckDB.load(path, read_only=True)
        try:
            assert reloaded._event_attr_cols == ["execution", "variant"]
            assert reloaded.conn.execute(
                'SELECT "execution", "variant" FROM events WHERE event_id = \'e1\''
            ).fetchone() == ("c1", "v0")
        finally:
            reloaded.close()

        with pytest.raises(EventColumnError):
            write_event_columns_to_file(path, {"event_id": {}})
