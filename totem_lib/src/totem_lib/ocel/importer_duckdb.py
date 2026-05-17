"""
Polars importer for `.duckdb` OCEL files.

Reverses the work done by `OcelDuckDB.save`: takes a `.duckdb` file produced
by the DuckDB-backed OCEL pipeline and re-materialises a polars-backed
`ObjectCentricEventLog`, matching exactly the dataframe schemas that the
other format importers (json/xml/sqlite/csv) produce.

This lets the existing polars-based algorithm pipeline accept `.duckdb` as a
first-class upload format. Direct use of `OcelDuckDB` by the backend (so that
algorithms run against the DuckDB connection without round-tripping to polars)
is a separate, larger migration and is intentionally out of scope here.

Public API
----------

- `load_events_from_duckdb(db_path)        -> pl.DataFrame`
- `load_objects_from_duckdb(db_path)       -> pl.DataFrame`
- `load_object_attributes_from_duckdb(...) -> pl.DataFrame`
- `import_ocel_from_duckdb(db_path)        -> ObjectCentricEventLog`

The three loader functions mirror the per-format pattern used elsewhere in
this package (`load_events_from_sqlite`, `load_objects_from_json`, ...).
"""

from __future__ import annotations

from typing import List, Tuple

import duckdb
import polars as pl

from .ocel import (
    EVENTS_SCHEMA,
    OBJECTS_SCHEMA,
    OBJECT_ATTRIBUTE_SCHEMA,
    ObjectCentricEventLog,
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_REQUIRED_TABLES = {
    "events",
    "objects",
    "event_object",
    "object_relations",
    "object_attribute_history",
}

_FIXED_EVENT_COLS = {"event_id", "activity", "timestamp_unix"}
_FIXED_OBJ_COLS = {"obj_id", "obj_type"}


def _open(db_path: str) -> duckdb.DuckDBPyConnection:
    """Open a DuckDB file read-only and validate it looks like an OCEL DB."""
    conn = duckdb.connect(db_path, read_only=True)
    present = {
        r[0]
        for r in conn.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'main'"
        ).fetchall()
    }
    missing = _REQUIRED_TABLES - present
    if missing:
        conn.close()
        raise ValueError(
            "File is not a valid OCEL DuckDB: missing tables: "
            f"{sorted(missing)}"
        )
    return conn


def _discover_attr_cols(
    conn: duckdb.DuckDBPyConnection,
) -> Tuple[List[str], List[str]]:
    """
    Return (event_attr_cols, obj_attr_cols) — the dynamic attribute columns
    on `events` / `objects` (everything except the fixed schema columns),
    in `ordinal_position` order so the JSON payload is deterministic.
    """
    event_cols = [
        r[0]
        for r in conn.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'events' ORDER BY ordinal_position"
        ).fetchall()
    ]
    obj_cols = [
        r[0]
        for r in conn.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'objects' ORDER BY ordinal_position"
        ).fetchall()
    ]
    return (
        [c for c in event_cols if c not in _FIXED_EVENT_COLS],
        [c for c in obj_cols if c not in _FIXED_OBJ_COLS],
    )


def _attrs_to_json_sql(table_alias: str, attr_cols: List[str]) -> str:
    """
    Produce a SQL expression that packs `attr_cols` from `table_alias` into a
    JSON object string. If `attr_cols` is empty, return a literal empty
    string so the polars `_attributes` column stays Utf8.

    DuckDB's `to_json(struct_pack(...))` is the standard idiom; it preserves
    NULLs as `null` in the JSON output, which the downstream `OcelDuckDB`
    rebuild path tolerates.
    """
    if not attr_cols:
        return "''"
    fields = ", ".join(f'"{c}" := {table_alias}."{c}"' for c in attr_cols)
    return f"to_json(struct_pack({fields}))::VARCHAR"


# ---------------------------------------------------------------------------
# Public loaders
# ---------------------------------------------------------------------------

def load_events_from_duckdb(db_path: str) -> pl.DataFrame:
    """
    Load events from a `.duckdb` OCEL file into a polars DataFrame matching
    `EVENTS_SCHEMA` (_eventId, _activity, _timestampUnix, _objects,
    _qualifiers, _attributes).

    Args:
        db_path: Path to a `.duckdb` file produced by `OcelDuckDB.save()` or
                 by `import_ocel_db(..., db_path=...)`.

    Returns:
        Polars DataFrame with the events.

    Raises:
        ValueError: If the file does not look like an OCEL DuckDB.
    """
    conn = _open(db_path)
    try:
        event_attr_cols, _ = _discover_attr_cols(conn)
        attrs_expr = _attrs_to_json_sql("e", event_attr_cols)
        sql = f"""
            SELECT
                e.event_id       AS "_eventId",
                e.activity       AS "_activity",
                e.timestamp_unix AS "_timestampUnix",
                COALESCE(eo.objects,    CAST([] AS VARCHAR[])) AS "_objects",
                COALESCE(eo.qualifiers, CAST([] AS VARCHAR[])) AS "_qualifiers",
                {attrs_expr} AS "_attributes"
            FROM events e
            LEFT JOIN (
                SELECT
                    event_id,
                    LIST(obj_id    ORDER BY obj_id) AS objects,
                    LIST(qualifier ORDER BY obj_id) AS qualifiers
                FROM event_object
                GROUP BY event_id
            ) eo USING (event_id)
            ORDER BY e.event_id
        """
        df = conn.execute(sql).pl()
    finally:
        conn.close()
    return df.cast(EVENTS_SCHEMA)  # type: ignore[arg-type]


def load_objects_from_duckdb(db_path: str) -> pl.DataFrame:
    """
    Load objects + object-to-object relations from a `.duckdb` OCEL file
    into a polars DataFrame matching `OBJECTS_SCHEMA`
    (_objId, _objType, _targetObjects, _qualifiers).
    """
    conn = _open(db_path)
    try:
        sql = """
            SELECT
                o.obj_id   AS "_objId",
                o.obj_type AS "_objType",
                COALESCE(r.targets,    CAST([] AS VARCHAR[])) AS "_targetObjects",
                COALESCE(r.qualifiers, CAST([] AS VARCHAR[])) AS "_qualifiers"
            FROM objects o
            LEFT JOIN (
                SELECT
                    source_obj_id,
                    LIST(target_obj_id ORDER BY target_obj_id) AS targets,
                    LIST(qualifier     ORDER BY target_obj_id) AS qualifiers
                FROM object_relations
                GROUP BY source_obj_id
            ) r ON r.source_obj_id = o.obj_id
            ORDER BY o.obj_id
        """
        df = conn.execute(sql).pl()
    finally:
        conn.close()
    return df.cast(OBJECTS_SCHEMA)  # type: ignore[arg-type]


def load_object_attributes_from_duckdb(db_path: str) -> pl.DataFrame:
    """
    Load `object_attribute_history` from a `.duckdb` OCEL file into a polars
    DataFrame matching `OBJECT_ATTRIBUTE_SCHEMA`
    (_objId, _timestampUnix, _jsonObjAttributes).

    If there are no object-attribute columns in the schema, returns an empty
    DataFrame with the right shape (still typed correctly).
    """
    conn = _open(db_path)
    try:
        _, obj_attr_cols = _discover_attr_cols(conn)
        if not obj_attr_cols:
            # No attribute columns — return empty frame matching the schema.
            return pl.DataFrame(schema=OBJECT_ATTRIBUTE_SCHEMA)

        attrs_expr = _attrs_to_json_sql("h", obj_attr_cols)
        sql = f"""
            SELECT
                h.obj_id         AS "_objId",
                h.timestamp_unix AS "_timestampUnix",
                {attrs_expr}     AS "_jsonObjAttributes"
            FROM object_attribute_history h
            ORDER BY h.obj_id, h.timestamp_unix
        """
        df = conn.execute(sql).pl()
    finally:
        conn.close()
    return df.cast(OBJECT_ATTRIBUTE_SCHEMA)  # type: ignore[arg-type]


def import_ocel_from_duckdb(db_path: str) -> ObjectCentricEventLog:
    """
    Import a `.duckdb` OCEL file into a polars-backed `ObjectCentricEventLog`.

    Reads every table (events, event_object, objects, object_relations,
    object_attribute_history) and packs dynamic attribute columns back into
    the polars `_attributes` / `_jsonObjAttributes` JSON strings, producing
    an OCEL indistinguishable from one imported via the original source.

    Raises:
        ValueError: If the file does not look like an OCEL DuckDB (missing
                    one of the required tables).
    """
    events_df = load_events_from_duckdb(db_path)
    objects_df = load_objects_from_duckdb(db_path)
    object_attributes_df = load_object_attributes_from_duckdb(db_path)
    return ObjectCentricEventLog(
        events=events_df,
        objects=objects_df,
        object_attributes=object_attributes_df,
    )
