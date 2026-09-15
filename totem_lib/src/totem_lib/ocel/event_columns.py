"""
Derived per-event columns on a DuckDB-backed event log.

The ``events`` table carries one VARCHAR column per event attribute (see
:func:`~.ocel_duckdb.create_ocel_schema`). Analyses can add their own columns
in the same style -- the first use case is storing process execution ids so
that every event of one execution carries the same id and later components
can replay exactly those executions.

Column names follow the same rules as attribute names in the OCEL editor so
the quoted-identifier SQL below stays trivially injection-safe.
"""

from __future__ import annotations

import re
from typing import Dict, List, Mapping, Optional

import duckdb
import polars as pl

#: Columns every ``events`` table has; they can never be (over)written.
FIXED_EVENT_COLUMNS = ("event_id", "activity", "timestamp_unix")

_COLUMN_NAME_RE = re.compile(r"^[A-Za-z0-9_ .:+#/()\[\]-]{1,64}$")


class EventColumnError(ValueError):
    """User-facing validation error for derived event columns."""


def validate_event_column_name(name: object) -> str:
    """Return ``name`` if it is a usable column name, else raise."""
    if not isinstance(name, str) or not _COLUMN_NAME_RE.match(name):
        raise EventColumnError(
            f"Invalid column name {name!r}. Use 1-64 characters: "
            "letters, digits, spaces and _.:-+#/()[]"
        )
    if name.lower() in FIXED_EVENT_COLUMNS:
        raise EventColumnError(
            f"{name!r} is a fixed column of the events table and cannot be overwritten."
        )
    return name


def _quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def list_event_columns(conn: duckdb.DuckDBPyConnection) -> List[str]:
    """Names of the non-fixed (attribute / derived) columns of ``events``."""
    rows = conn.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = 'events' ORDER BY ordinal_position"
    ).fetchall()
    return [r[0] for r in rows if r[0] not in FIXED_EVENT_COLUMNS]


def event_column_summary(conn: duckdb.DuckDBPyConnection, column: str) -> Dict[str, object]:
    """``{"name", "non_null_count", "distinct_count"}`` for one events column."""
    if column not in list_event_columns(conn):
        raise EventColumnError(f"Column {column!r} does not exist on the events table.")
    non_null, distinct = conn.execute(
        f"SELECT COUNT({_quote(column)}), COUNT(DISTINCT {_quote(column)}) FROM events"
    ).fetchone()
    return {"name": column, "non_null_count": int(non_null), "distinct_count": int(distinct)}


def write_event_column(
    conn: duckdb.DuckDBPyConnection,
    column: str,
    values: Mapping[str, Optional[str]],
) -> int:
    """
    Store ``values`` (``event_id -> value``) in the events column ``column``.

    The column is created (VARCHAR) if it does not exist yet, reset to NULL
    for every event, and then filled from ``values``; ``None`` values and
    events not present in ``values`` stay NULL. Returns the number of events
    that carry a value afterwards (ids in ``values`` that match no event are
    ignored).

    ``conn`` must be a read-write connection.
    """
    name = validate_event_column_name(column)
    quoted = _quote(name)
    conn.execute(f"ALTER TABLE events ADD COLUMN IF NOT EXISTS {quoted} VARCHAR")
    conn.execute(f"UPDATE events SET {quoted} = NULL")

    rows = [(event_id, value) for event_id, value in values.items() if value is not None]
    if not rows:
        return 0

    frame = pl.DataFrame(
        {
            "event_id": [r[0] for r in rows],
            "value": [str(r[1]) for r in rows],
        },
        schema={"event_id": pl.Utf8, "value": pl.Utf8},
    )
    conn.register("_event_column_values", frame)
    try:
        conn.execute(
            f"UPDATE events SET {quoted} = v.value "
            "FROM _event_column_values v WHERE events.event_id = v.event_id"
        )
    finally:
        conn.unregister("_event_column_values")
    return int(conn.execute(f"SELECT COUNT({quoted}) FROM events").fetchone()[0])


def write_event_columns_to_file(
    db_path: str, columns: Mapping[str, Mapping[str, Optional[str]]]
) -> Dict[str, int]:
    """
    Open the DuckDB file read-write, write every column in ``columns`` and
    close the connection again. Returns ``column -> assigned event count``.

    A read-write open is exclusive, so any other handle on the same file
    (including a read-only one held by the same process) must be closed first.
    """
    for column in columns:
        validate_event_column_name(column)
    conn = duckdb.connect(db_path)
    try:
        return {
            column: write_event_column(conn, column, values)
            for column, values in columns.items()
        }
    finally:
        conn.close()
