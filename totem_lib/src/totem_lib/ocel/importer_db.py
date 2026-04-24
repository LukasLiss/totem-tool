"""
Direct importer: OCEL 2.0 → DuckDB.

Two import strategies are chosen automatically based on file size:

  Bulk path  (file < streaming_threshold_mb, default 200 MB):
    SQLite — DuckDB ATTACH + pure SQL pipeline (no Python row iteration)
    JSON   — json.load → Polars DataFrames → conn.register + SQL INSERT (Arrow)
    XML    — ET.parse  → Polars DataFrames → conn.register + SQL INSERT (Arrow)
    CSV    — DictReader → Polars DataFrames → conn.register + SQL INSERT (Arrow)

  Streaming path (file ≥ threshold):
    All formats use two-pass streaming with BATCH_SIZE rows per executemany call.
    The full dataset never lives in RAM simultaneously.
"""

import csv
import json
import os
import sqlite3
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import duckdb
import ijson
import polars as pl

from .ocel_duckdb import OcelDuckDB, create_ocel_schema

BATCH_SIZE = 50_000
STREAMING_THRESHOLD_MB = 200


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def import_ocel_db(
    file_path: str,
    db_path: str = ":memory:",
    streaming_threshold_mb: float = STREAMING_THRESHOLD_MB,
    graceful_import: bool = True,
) -> OcelDuckDB:
    """
    Import an OCEL 2.0 file directly into a DuckDB database.

    For files smaller than streaming_threshold_mb (default 200 MB) a fast bulk
    path is used (DuckDB ATTACH for SQLite, Arrow/Polars register for the rest).
    Larger files fall back to streaming so peak RAM stays bounded.

    Usage example::

        db = import_ocel_db("log.sqlite")
        db.conn.execute("SELECT COUNT(*) FROM events").fetchone()
        db.close()

        # Persist to disk and disable streaming for all sizes:
        db = import_ocel_db("large_log.json", db_path="out.duckdb", streaming_threshold_mb=0)

    Args:
        file_path:              Path to the OCEL 2.0 file (.sqlite, .json, .xml, .csv).
        db_path:                DuckDB target path. Defaults to ':memory:'. Pass a file
                                path (e.g. 'my_log.duckdb') to persist the database.
        streaming_threshold_mb: Files strictly below this size (MB) use the fast bulk
                                path; files at or above use streaming. Pass 0 to always
                                stream (lowest peak RAM, slowest speed).
        graceful_import:        When True (default), malformed or inconsistent data is
                                silently dropped rather than raising an error. A cleanup
                                pass runs after all data is loaded to remove dangling
                                references. Set to False to raise immediately on any
                                constraint violation.

                                Problems fixed automatically when graceful_import=True:

                                  - Duplicate event IDs: second occurrence dropped.
                                  - Duplicate object IDs: second occurrence dropped.
                                  - Duplicate (event_id, obj_id) pairs in event-object
                                    relations: duplicates dropped.
                                  - Event-object rows referencing a missing event:
                                    removed in post-load cleanup.
                                  - Event-object rows referencing a missing object:
                                    removed in post-load cleanup.
                                  - Object-relation rows where source or target object
                                    is missing: removed in post-load cleanup.
                                  - Object attribute history rows for missing objects:
                                    removed in post-load cleanup.

    Returns:
        OcelDuckDB instance backed by the populated database.
    """
    _, ext = os.path.splitext(file_path)
    fmt = ext.lower().lstrip(".")

    if fmt == "duckdb":
        return OcelDuckDB.load(file_path)

    bulk = {
        "sqlite": _import_sqlite_bulk,
        "json":   _import_json_bulk,
        "xml":    _import_xml_bulk,
        "csv":    _import_csv_bulk,
    }
    stream = {
        "sqlite": _import_sqlite,
        "json":   _import_json,
        "xml":    _import_xml,
        "csv":    _import_csv,
    }
    if fmt not in bulk:
        raise ValueError(
            f"Unsupported format '{ext}'. "
            f"Supported: {list(bulk.keys())}"
        )
    size_mb = os.path.getsize(file_path) / 1024 / 1024
    dispatchers = stream if size_mb >= streaming_threshold_mb else bulk
    return dispatchers[fmt](file_path, db_path, graceful_import)


# ---------------------------------------------------------------------------
# Bulk helpers (Arrow / conn.register path)
# ---------------------------------------------------------------------------

def _bulk_insert(
    conn: duckdb.DuckDBPyConnection,
    table: str,
    df: pl.DataFrame,
    columns: list[str],
) -> None:
    """Register a Polars DataFrame as a DuckDB virtual table and INSERT via Arrow."""
    name = f"_tmp_{table}"
    cols_sql = ", ".join(f'"{c}"' for c in columns)
    conn.register(name, df)
    conn.execute(f"INSERT INTO {table} ({cols_sql}) SELECT {cols_sql} FROM {name}")
    conn.unregister(name)


def _bulk_insert_ignore(
    conn: duckdb.DuckDBPyConnection,
    table: str,
    df: pl.DataFrame,
    columns: list[str],
) -> None:
    name = f"_tmp_{table}"
    cols_sql = ", ".join(f'"{c}"' for c in columns)
    conn.register(name, df)
    conn.execute(
        f"INSERT INTO {table} ({cols_sql}) SELECT {cols_sql} FROM {name} ON CONFLICT DO NOTHING"
    )
    conn.unregister(name)


def _graceful_cleanup(conn: duckdb.DuckDBPyConnection) -> None:
    """
    Remove dangling references after a graceful import.

    Mirrors what the Polars importer's propagate_filtering does:
    - Drop event_object rows that point to events or objects that were not
      loaded (e.g. because they were duplicates silently dropped).
    - Drop object_relations rows whose source or target is missing.
    - Drop object_attribute_history rows for missing objects.
    """
    conn.execute("""
        DELETE FROM event_object
        WHERE event_id NOT IN (SELECT event_id FROM events)
           OR obj_id   NOT IN (SELECT obj_id   FROM objects)
    """)
    conn.execute("""
        DELETE FROM object_relations
        WHERE source_obj_id NOT IN (SELECT obj_id FROM objects)
           OR target_obj_id NOT IN (SELECT obj_id FROM objects)
    """)
    conn.execute("""
        DELETE FROM object_attribute_history
        WHERE obj_id NOT IN (SELECT obj_id FROM objects)
    """)


# ---------------------------------------------------------------------------
# SQLite — bulk (DuckDB ATTACH, pure SQL pipeline)
# ---------------------------------------------------------------------------

def _import_sqlite_bulk(file_path: str, db_path: str, graceful: bool = True) -> OcelDuckDB:
    con = sqlite3.connect(file_path)
    cur = con.cursor()

    event_attr_cols = _sqlite_discover_event_attrs(cur)
    obj_attr_cols   = _sqlite_discover_obj_attrs(cur)

    cur.execute("SELECT ocel_type_map FROM event_map_type")
    activities = [r[0] for r in cur.fetchall()]

    cur.execute("SELECT ocel_type_map FROM object_map_type")
    obj_types = [r[0] for r in cur.fetchall()]

    act_cols_map: dict[str, set[str]] = {}
    for act in activities:
        cur.execute(f"PRAGMA table_info('event_{act}')")
        act_cols_map[act] = {r[1] for r in cur.fetchall()} - {"ocel_id", "ocel_time"}

    type_cols_map: dict[str, list[str]] = {}
    for ot in obj_types:
        cur.execute(f"PRAGMA table_info('object_{ot}')")
        type_cols_map[ot] = [r[1] for r in cur.fetchall() if r[1] not in ("ocel_id", "ocel_time")]

    con.close()

    conn = duckdb.connect(db_path)
    create_ocel_schema(conn, event_attr_cols, obj_attr_cols)

    abs_path = os.path.abspath(file_path)
    # Read all SQLite columns as VARCHAR so numeric attribute columns don't cause
    # type-mismatch errors in UNION ALL across per-type tables with differing schemas.
    conn.execute("SET sqlite_all_varchar = true")
    conn.execute(f"ATTACH '{abs_path}' AS src (TYPE sqlite)")

    conflict = "ON CONFLICT DO NOTHING" if graceful else ""

    _sqlite_bulk_events(conn, activities, act_cols_map, event_attr_cols, conflict)
    conn.execute(
        "INSERT INTO event_object "
        "SELECT ocel_event_id, ocel_object_id, ocel_qualifier FROM src.event_object "
        f"{conflict}"
    )
    _sqlite_bulk_objects(conn, obj_types, type_cols_map, obj_attr_cols, graceful)
    _sqlite_bulk_o2o(conn)

    conn.execute("DETACH src")

    if graceful:
        _graceful_cleanup(conn)

    return OcelDuckDB._from_prepared_connection(conn, event_attr_cols, obj_attr_cols)


def _sqlite_bulk_events(
    conn: duckdb.DuckDBPyConnection,
    activities: list[str],
    act_cols_map: dict[str, set[str]],
    event_attr_cols: list[str],
    conflict: str = "",
) -> None:
    if not activities:
        return
    ts_parts = []
    for act in activities:
        table = f"event_{act}"
        act_cols = act_cols_map[act]
        attr_selects = ", ".join(
            f'"{c}"::VARCHAR AS "{c}"' if c in act_cols else f'NULL::VARCHAR AS "{c}"'
            for c in event_attr_cols
        )
        attr_part = (", " + attr_selects) if event_attr_cols else ""
        ts_parts.append(f'SELECT ocel_id, ocel_time{attr_part} FROM src."{table}"')

    ts_union = " UNION ALL ".join(ts_parts)

    # Materialise the union into a temp table so DuckDB can resolve attribute
    # column names when tables have different per-activity attribute schemas.
    conn.execute(f"CREATE TEMP TABLE _ev_ts AS SELECT * FROM ({ts_union})")

    attr_sel = (
        ", " + ", ".join(f'ts."{c}"' for c in event_attr_cols)
    ) if event_attr_cols else ""

    conn.execute(f"""
        INSERT INTO events
        SELECT e.ocel_id                                        AS event_id,
               emt.ocel_type_map                                AS activity,
               epoch(CAST(ts.ocel_time AS TIMESTAMPTZ))::BIGINT AS timestamp_unix
               {attr_sel}
        FROM src.event e
        JOIN src.event_map_type emt ON e.ocel_type = emt.ocel_type
        JOIN _ev_ts ts              ON e.ocel_id   = ts.ocel_id
        {conflict}
    """)
    conn.execute("DROP TABLE _ev_ts")


def _sqlite_bulk_objects(
    conn: duckdb.DuckDBPyConnection,
    obj_types: list[str],
    type_cols_map: dict[str, list[str]],
    obj_attr_cols: list[str],
    graceful: bool = True,
) -> None:
    if not obj_types:
        return

    inserter = _bulk_insert_ignore if graceful else _bulk_insert

    # Read each per-type table via DuckDB's Arrow path (C++, no Python row iteration),
    # then accumulate latest attrs and history snapshots in Python dicts.
    latest_attrs: dict[str, dict[str, str]] = {}
    snapshot_map: dict[tuple[str, int], dict[str, str]] = {}

    for ot in obj_types:
        table = f"object_{ot}"
        tbl_cols = type_cols_map[ot]
        if not tbl_cols:
            continue
        col_select = ", ".join(['"ocel_id"', '"ocel_time"'] + [f'"{c}"' for c in tbl_cols])
        df = conn.execute(f'SELECT {col_select} FROM src."{table}" ORDER BY ocel_time').pl()

        for row in df.iter_rows(named=True):
            obj_id  = str(row["ocel_id"])
            ts_unix = _parse_ts(str(row["ocel_time"])) if row["ocel_time"] else 0
            attrs   = {c: str(row[c]) for c in tbl_cols if row[c] is not None}
            latest_attrs.setdefault(obj_id, {}).update(attrs)
            if obj_attr_cols and attrs:
                snapshot_map.setdefault((obj_id, ts_unix), {}).update(attrs)

    # Build objects DataFrame
    id_type_df = conn.execute("""
        SELECT o.ocel_id, emt.ocel_type_map
        FROM src.object o
        JOIN src.object_map_type emt ON o.ocel_type = emt.ocel_type
    """).pl()

    obj_ids_list   = id_type_df["ocel_id"].to_list()
    obj_types_list = id_type_df["ocel_type_map"].to_list()
    obj_attr_data: dict[str, list] = {c: [] for c in obj_attr_cols}
    for obj_id in obj_ids_list:
        latest = latest_attrs.get(obj_id, {})
        for c in obj_attr_cols:
            obj_attr_data[c].append(latest.get(c))

    objects_df = pl.DataFrame({
        "obj_id":   obj_ids_list,
        "obj_type": obj_types_list,
        **{c: pl.Series(obj_attr_data[c], dtype=pl.Utf8) for c in obj_attr_cols},
    })
    inserter(conn, "objects", objects_df, ["obj_id", "obj_type"] + obj_attr_cols)

    if obj_attr_cols and snapshot_map:
        hist_obj_ids: list[str] = []
        hist_ts: list[int] = []
        hist_attr: dict[str, list] = {c: [] for c in obj_attr_cols}
        for (obj_id, ts_unix), attrs in snapshot_map.items():
            hist_obj_ids.append(obj_id)
            hist_ts.append(ts_unix)
            for c in obj_attr_cols:
                hist_attr[c].append(attrs.get(c))
        hist_df = pl.DataFrame({
            "obj_id":         hist_obj_ids,
            "timestamp_unix": pl.Series(hist_ts, dtype=pl.Int64),
            **{c: pl.Series(hist_attr[c], dtype=pl.Utf8) for c in obj_attr_cols},
        })
        inserter(conn, "object_attribute_history", hist_df, ["obj_id", "timestamp_unix"] + obj_attr_cols)


def _sqlite_bulk_o2o(conn: duckdb.DuckDBPyConnection) -> None:
    try:
        conn.execute("""
            INSERT INTO object_relations
            SELECT ocel_source_id, ocel_target_id, ocel_qualifier
            FROM src.object_object
            ON CONFLICT DO NOTHING
        """)
    except duckdb.Error:
        pass


# ---------------------------------------------------------------------------
# JSON — bulk (json.load + Polars register)
# ---------------------------------------------------------------------------

def _import_json_bulk(file_path: str, db_path: str, graceful: bool = True) -> OcelDuckDB:
    inserter = _bulk_insert_ignore if graceful else _bulk_insert

    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    raw_events  = data.get("events",  [])
    raw_objects = data.get("objects", [])

    event_attr_cols = sorted({
        a["name"]
        for ev in raw_events
        for a in ev.get("attributes", [])
        if a.get("name")
    })
    obj_attr_cols = sorted({
        a["name"]
        for obj in raw_objects
        for a in obj.get("attributes", [])
        if a.get("name")
    })

    conn = duckdb.connect(db_path)
    create_ocel_schema(conn, event_attr_cols, obj_attr_cols)

    # ---- events ----
    ev_ids: list[str]  = []
    activities: list[str] = []
    timestamps: list[int] = []
    ev_attr: dict[str, list] = {c: [] for c in event_attr_cols}
    eo_ev_ids: list[str] = []
    eo_obj_ids: list[str] = []
    eo_quals: list[str | None] = []

    for ev in raw_events:
        ev_id = ev.get("id", "")
        ev_ids.append(ev_id)
        activities.append(ev.get("type", ""))
        timestamps.append(_parse_ts(ev.get("time", "")))
        attr_map = {
            a["name"]: str(a["value"])
            for a in ev.get("attributes", [])
            if a.get("name") and a.get("value") is not None
        }
        for c in event_attr_cols:
            ev_attr[c].append(attr_map.get(c))
        for rel in ev.get("relationships", []):
            if rel.get("objectId"):
                eo_ev_ids.append(ev_id)
                eo_obj_ids.append(rel["objectId"])
                eo_quals.append(rel.get("qualifier"))

    events_df = pl.DataFrame({
        "event_id":       ev_ids,
        "activity":       activities,
        "timestamp_unix": pl.Series(timestamps, dtype=pl.Int64),
        **{c: pl.Series(ev_attr[c], dtype=pl.Utf8) for c in event_attr_cols},
    })
    inserter(conn, "events", events_df, ["event_id", "activity", "timestamp_unix"] + event_attr_cols)

    if eo_ev_ids:
        eo_df = pl.DataFrame({
            "event_id":  eo_ev_ids,
            "obj_id":    eo_obj_ids,
            "qualifier": pl.Series(eo_quals, dtype=pl.Utf8),
        })
        inserter(conn, "event_object", eo_df, ["event_id", "obj_id", "qualifier"])

    # ---- objects ----
    obj_ids: list[str] = []
    obj_types_list: list[str] = []
    obj_attr: dict[str, list] = {c: [] for c in obj_attr_cols}
    hist_obj_ids: list[str] = []
    hist_ts: list[int] = []
    hist_attr: dict[str, list] = {c: [] for c in obj_attr_cols}
    o2o_src: list[str] = []
    o2o_tgt: list[str] = []
    o2o_qual: list[str | None] = []

    for obj in raw_objects:
        obj_id = obj.get("id", "")
        obj_ids.append(obj_id)
        obj_types_list.append(obj.get("type", ""))

        snapshots = sorted(obj.get("attributes", []), key=lambda a: a.get("time", ""))
        latest: dict[str, str] = {}
        snap_map: dict[int, dict[str, str]] = {}
        for a in snapshots:
            name = a.get("name")
            if name and name in obj_attr_cols:
                val = str(a["value"]) if a.get("value") is not None else None
                if val is not None:
                    latest[name] = val
                    snap_map.setdefault(_parse_ts(a.get("time", "")), {})[name] = val

        for c in obj_attr_cols:
            obj_attr[c].append(latest.get(c))

        for ts_unix, snap in snap_map.items():
            hist_obj_ids.append(obj_id)
            hist_ts.append(ts_unix)
            for c in obj_attr_cols:
                hist_attr[c].append(snap.get(c))

        for rel in obj.get("relationships", []):
            if rel.get("objectId"):
                o2o_src.append(obj_id)
                o2o_tgt.append(rel["objectId"])
                o2o_qual.append(rel.get("qualifier"))

    objects_df = pl.DataFrame({
        "obj_id":   obj_ids,
        "obj_type": obj_types_list,
        **{c: pl.Series(obj_attr[c], dtype=pl.Utf8) for c in obj_attr_cols},
    })
    inserter(conn, "objects", objects_df, ["obj_id", "obj_type"] + obj_attr_cols)

    if obj_attr_cols and hist_obj_ids:
        hist_df = pl.DataFrame({
            "obj_id":         hist_obj_ids,
            "timestamp_unix": pl.Series(hist_ts, dtype=pl.Int64),
            **{c: pl.Series(hist_attr[c], dtype=pl.Utf8) for c in obj_attr_cols},
        })
        inserter(conn, "object_attribute_history", hist_df, ["obj_id", "timestamp_unix"] + obj_attr_cols)

    if o2o_src:
        o2o_df = pl.DataFrame({
            "source_obj_id": o2o_src,
            "target_obj_id": o2o_tgt,
            "qualifier":     pl.Series(o2o_qual, dtype=pl.Utf8),
        })
        inserter(conn, "object_relations", o2o_df, ["source_obj_id", "target_obj_id", "qualifier"])

    if graceful:
        _graceful_cleanup(conn)

    return OcelDuckDB._from_prepared_connection(conn, event_attr_cols, obj_attr_cols)


# ---------------------------------------------------------------------------
# XML — bulk (ET.parse + Polars register)
# ---------------------------------------------------------------------------

def _import_xml_bulk(file_path: str, db_path: str, graceful: bool = True) -> OcelDuckDB:
    inserter = _bulk_insert_ignore if graceful else _bulk_insert
    tree = ET.parse(file_path)
    root = tree.getroot()

    events_elem  = root.find("events")  or []
    objects_elem = root.find("objects") or []

    event_attr_cols = sorted({
        ae.get("name")
        for ev in events_elem
        for ae in ev.findall("attribute")
        if ae.get("value") is not None and ae.get("name")
    })
    obj_attr_cols = sorted({
        ae.get("name")
        for ob in objects_elem
        for ae in ob.findall("attribute")
        if ae.get("value") is not None and ae.get("name")
    })

    conn = duckdb.connect(db_path)
    create_ocel_schema(conn, event_attr_cols, obj_attr_cols)

    # ---- events ----
    ev_ids: list[str] = []
    activities: list[str] = []
    timestamps: list[int] = []
    ev_attr: dict[str, list] = {c: [] for c in event_attr_cols}
    eo_ev_ids: list[str] = []
    eo_obj_ids: list[str] = []
    eo_quals: list[str | None] = []

    for ev_elem in events_elem:
        ev_id = ev_elem.get("id", "")
        ev_ids.append(ev_id)
        activities.append(ev_elem.get("type", ""))
        timestamps.append(_parse_ts(ev_elem.get("time", "")))
        attr_map = {
            ae.get("name"): str(ae.get("value"))
            for ae in ev_elem.findall("attribute")
            if ae.get("value") is not None and ae.get("name") in event_attr_cols
        }
        for c in event_attr_cols:
            ev_attr[c].append(attr_map.get(c))
        for obj_cont in ev_elem.findall("objects"):
            for rel in obj_cont:
                oid = rel.get("object-id")
                if oid:
                    eo_ev_ids.append(ev_id)
                    eo_obj_ids.append(oid)
                    eo_quals.append(rel.get("qualifier") or rel.get("relationship"))

    events_df = pl.DataFrame({
        "event_id":       ev_ids,
        "activity":       activities,
        "timestamp_unix": pl.Series(timestamps, dtype=pl.Int64),
        **{c: pl.Series(ev_attr[c], dtype=pl.Utf8) for c in event_attr_cols},
    })
    inserter(conn, "events", events_df, ["event_id", "activity", "timestamp_unix"] + event_attr_cols)

    if eo_ev_ids:
        eo_df = pl.DataFrame({
            "event_id":  eo_ev_ids,
            "obj_id":    eo_obj_ids,
            "qualifier": pl.Series(eo_quals, dtype=pl.Utf8),
        })
        inserter(conn, "event_object", eo_df, ["event_id", "obj_id", "qualifier"])

    # ---- objects ----
    obj_ids: list[str] = []
    obj_types_list: list[str] = []
    obj_attr: dict[str, list] = {c: [] for c in obj_attr_cols}
    hist_obj_ids: list[str] = []
    hist_ts: list[int] = []
    hist_attr: dict[str, list] = {c: [] for c in obj_attr_cols}
    o2o_src: list[str] = []
    o2o_tgt: list[str] = []
    o2o_qual: list[str | None] = []

    for ob_elem in objects_elem:
        obj_id = ob_elem.get("id", "")
        obj_ids.append(obj_id)
        obj_types_list.append(ob_elem.get("type", ""))

        snapshots = sorted(
            ob_elem.findall("attribute"),
            key=lambda ae: ae.get("time") or ""
        )
        latest: dict[str, str] = {}
        snap_map: dict[int, dict[str, str]] = {}
        for ae in snapshots:
            name = ae.get("name")
            val  = ae.get("value")
            if name and val is not None and name in obj_attr_cols:
                latest[name] = str(val)
                snap_map.setdefault(_parse_ts(ae.get("time") or ""), {})[name] = str(val)

        for c in obj_attr_cols:
            obj_attr[c].append(latest.get(c))

        for ts_unix, snap in snap_map.items():
            hist_obj_ids.append(obj_id)
            hist_ts.append(ts_unix)
            for c in obj_attr_cols:
                hist_attr[c].append(snap.get(c))

        for obj_cont in ob_elem.findall("objects"):
            for rel in obj_cont:
                tgt = rel.get("object-id")
                if tgt:
                    o2o_src.append(obj_id)
                    o2o_tgt.append(tgt)
                    o2o_qual.append(rel.get("qualifier"))

    objects_df = pl.DataFrame({
        "obj_id":   obj_ids,
        "obj_type": obj_types_list,
        **{c: pl.Series(obj_attr[c], dtype=pl.Utf8) for c in obj_attr_cols},
    })
    inserter(conn, "objects", objects_df, ["obj_id", "obj_type"] + obj_attr_cols)

    if obj_attr_cols and hist_obj_ids:
        hist_df = pl.DataFrame({
            "obj_id":         hist_obj_ids,
            "timestamp_unix": pl.Series(hist_ts, dtype=pl.Int64),
            **{c: pl.Series(hist_attr[c], dtype=pl.Utf8) for c in obj_attr_cols},
        })
        inserter(conn, "object_attribute_history", hist_df, ["obj_id", "timestamp_unix"] + obj_attr_cols)

    if o2o_src:
        o2o_df = pl.DataFrame({
            "source_obj_id": o2o_src,
            "target_obj_id": o2o_tgt,
            "qualifier":     pl.Series(o2o_qual, dtype=pl.Utf8),
        })
        inserter(conn, "object_relations", o2o_df, ["source_obj_id", "target_obj_id", "qualifier"])

    if graceful:
        _graceful_cleanup(conn)

    return OcelDuckDB._from_prepared_connection(conn, event_attr_cols, obj_attr_cols)


# ---------------------------------------------------------------------------
# CSV — bulk (DictReader + Polars register)
# ---------------------------------------------------------------------------

def _import_csv_bulk(file_path: str, db_path: str, graceful: bool = True) -> OcelDuckDB:
    inserter = _bulk_insert_ignore if graceful else _bulk_insert
    with open(file_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        rows = list(reader)

    ot_cols = [c for c in fieldnames if c.startswith("ot:")]
    ea_cols = [c for c in fieldnames if c.startswith("ea:")]
    event_attr_cols = sorted(c[3:] for c in ea_cols)
    obj_attr_cols: list[str] = []

    conn = duckdb.connect(db_path)
    create_ocel_schema(conn, event_attr_cols, obj_attr_cols)

    ev_ids: list[str] = []
    activities: list[str] = []
    timestamps: list[int] = []
    ev_attr: dict[str, list] = {c: [] for c in event_attr_cols}
    eo_ev_ids: list[str] = []
    eo_obj_ids: list[str] = []
    eo_quals: list[str | None] = []
    seen_objs: dict[str, str] = {}
    o2o_src: list[str] = []
    o2o_tgt: list[str] = []
    o2o_qual: list[str | None] = []

    def _parse_obj_cell(cell: str) -> list[tuple[str, str | None]]:
        results = []
        for part in cell.split("/"):
            part = part.strip()
            if not part:
                continue
            brace = part.find("{")
            if brace != -1:
                part = part[:brace].strip()
            if "#" in part:
                oid, qual = part.split("#", 1)
                results.append((oid.strip(), qual.strip() or None))
            else:
                results.append((part, None))
        return results

    for row in rows:
        row_id   = (row.get("id") or "").strip()
        activity = (row.get("activity") or "").strip()
        ts_unix  = _parse_ts((row.get("timestamp") or "").strip())
        is_o2o   = activity == "o2o"
        is_event = bool(activity) and not is_o2o

        if is_event:
            ev_ids.append(row_id)
            activities.append(activity)
            timestamps.append(ts_unix)
            attr_map = {c[3:]: (row.get(c) or "").strip() or None for c in ea_cols}
            for c in event_attr_cols:
                ev_attr[c].append(attr_map.get(c))
            for ot_col in ot_cols:
                obj_type = ot_col[3:]
                cell = (row.get(ot_col) or "").strip()
                for oid, qual in _parse_obj_cell(cell):
                    seen_objs.setdefault(oid, obj_type)
                    eo_ev_ids.append(row_id)
                    eo_obj_ids.append(oid)
                    eo_quals.append(qual)
        elif is_o2o:
            for ot_col in ot_cols:
                obj_type = ot_col[3:]
                for tgt_id, qual in _parse_obj_cell((row.get(ot_col) or "").strip()):
                    seen_objs.setdefault(tgt_id, obj_type)
                    o2o_src.append(row_id)
                    o2o_tgt.append(tgt_id)
                    o2o_qual.append(qual)
        else:
            for ot_col in ot_cols:
                obj_type = ot_col[3:]
                for oid, _ in _parse_obj_cell((row.get(ot_col) or "").strip()):
                    seen_objs.setdefault(oid, obj_type)

    events_df = pl.DataFrame({
        "event_id":       ev_ids,
        "activity":       activities,
        "timestamp_unix": pl.Series(timestamps, dtype=pl.Int64),
        **{c: pl.Series(ev_attr[c], dtype=pl.Utf8) for c in event_attr_cols},
    })
    inserter(conn, "events", events_df, ["event_id", "activity", "timestamp_unix"] + event_attr_cols)

    if eo_ev_ids:
        eo_df = pl.DataFrame({
            "event_id":  eo_ev_ids,
            "obj_id":    eo_obj_ids,
            "qualifier": pl.Series(eo_quals, dtype=pl.Utf8),
        })
        inserter(conn, "event_object", eo_df, ["event_id", "obj_id", "qualifier"])

    obj_rows_ids   = list(seen_objs.keys())
    obj_rows_types = [seen_objs[oid] for oid in obj_rows_ids]
    objects_df = pl.DataFrame({"obj_id": obj_rows_ids, "obj_type": obj_rows_types})
    inserter(conn, "objects", objects_df, ["obj_id", "obj_type"])

    if o2o_src:
        o2o_df = pl.DataFrame({
            "source_obj_id": o2o_src,
            "target_obj_id": o2o_tgt,
            "qualifier":     pl.Series(o2o_qual, dtype=pl.Utf8),
        })
        inserter(conn, "object_relations", o2o_df, ["source_obj_id", "target_obj_id", "qualifier"])

    if graceful:
        _graceful_cleanup(conn)

    return OcelDuckDB._from_prepared_connection(conn, event_attr_cols, obj_attr_cols)


# ---------------------------------------------------------------------------
# SQLite
# ---------------------------------------------------------------------------

def _import_sqlite(file_path: str, db_path: str, graceful: bool = True) -> OcelDuckDB:
    con = sqlite3.connect(file_path)
    cur = con.cursor()

    # --- Pass 1: discover attribute columns ---
    event_attr_cols = _sqlite_discover_event_attrs(cur)
    obj_attr_cols   = _sqlite_discover_obj_attrs(cur)

    conn = duckdb.connect(db_path)
    create_ocel_schema(conn, event_attr_cols, obj_attr_cols)

    # --- Pass 2: stream events ---
    _sqlite_insert_events(con, cur, conn, event_attr_cols, graceful)

    # --- Pass 2: stream objects ---
    _sqlite_insert_objects(con, cur, conn, obj_attr_cols, graceful)

    # --- Pass 2: stream object-to-object relations ---
    _sqlite_insert_o2o(cur, conn)

    con.close()

    if graceful:
        _graceful_cleanup(conn)

    return OcelDuckDB._from_prepared_connection(conn, event_attr_cols, obj_attr_cols)


def _sqlite_discover_event_attrs(cur: sqlite3.Cursor) -> list[str]:
    cur.execute("SELECT ocel_type_map FROM event_map_type")
    activities = [r[0] for r in cur.fetchall()]
    cols: set[str] = set()
    for act in activities:
        table = f"event_{act}"
        cur.execute(f"PRAGMA table_info('{table}')")
        for _, col_name, *_ in cur.fetchall():
            if col_name not in ("ocel_id", "ocel_time"):
                cols.add(col_name)
    return sorted(cols)


def _sqlite_discover_obj_attrs(cur: sqlite3.Cursor) -> list[str]:
    cur.execute("SELECT ocel_type_map FROM object_map_type")
    obj_types = [r[0] for r in cur.fetchall()]
    cols: set[str] = set()
    for ot in obj_types:
        table = f"object_{ot}"
        cur.execute(f"PRAGMA table_info('{table}')")
        for _, col_name, *_ in cur.fetchall():
            if col_name not in ("ocel_id", "ocel_time"):
                cols.add(col_name)
    return sorted(cols)


def _sqlite_insert_events(
    con: sqlite3.Connection,
    cur: sqlite3.Cursor,
    conn: duckdb.DuckDBPyConnection,
    event_attr_cols: list[str],
    graceful: bool = True,
) -> None:
    # Build a single query that unions all per-activity tables (for timestamps
    # and event attributes), then left-joins the event_object relation.
    cur.execute("SELECT ocel_type_map FROM event_map_type")
    activities = [r[0] for r in cur.fetchall()]

    # timestamp + attribute union across all activity tables
    ts_parts = []
    for act in activities:
        table = f"event_{act}"
        cur.execute(f"PRAGMA table_info('{table}')")
        act_cols = {r[1] for r in cur.fetchall()} - {"ocel_id", "ocel_time"}
        attr_selects = ", ".join(
            f"CAST({c!r} AS TEXT)" if c in act_cols else "NULL"
            for c in event_attr_cols
        )
        attr_part = (", " + attr_selects) if event_attr_cols else ""
        ts_parts.append(
            f"SELECT ocel_id, ocel_time{attr_part} FROM \"{table}\""
        )
    ts_union = " UNION ALL ".join(ts_parts) if ts_parts else "SELECT NULL, NULL"

    # event → object relation
    query = f"""
        SELECT
            e.ocel_id,
            emt.ocel_type_map AS activity,
            ts.ocel_time,
            eo.ocel_object_id,
            eo.ocel_qualifier
            {(',' + ','.join(f'ts."{c}"' for c in event_attr_cols)) if event_attr_cols else ''}
        FROM event e
        JOIN event_map_type emt ON e.ocel_type = emt.ocel_type
        JOIN ({ts_union}) ts ON e.ocel_id = ts.ocel_id
        LEFT JOIN event_object eo ON e.ocel_id = eo.ocel_event_id
        ORDER BY e.ocel_id
    """

    event_ph = ", ".join(["?"] * (3 + len(event_attr_cols)))
    eo_ph = "?, ?, ?"
    flusher = _flush_ignore if graceful else _flush

    event_rows: list[tuple] = []
    eo_rows: list[tuple] = []
    seen_events: set[str] = set()

    cur2 = con.cursor()
    cur2.execute(query)
    while True:
        batch = cur2.fetchmany(BATCH_SIZE)
        if not batch:
            break
        for row in batch:
            ev_id, activity, ts_str, obj_id, qualifier = row[:5]
            attr_vals = list(row[5:]) if event_attr_cols else []

            ts_unix = _parse_ts(ts_str)

            if ev_id not in seen_events:
                seen_events.add(ev_id)
                event_rows.append(tuple([ev_id, activity, ts_unix] + attr_vals))
            if obj_id:
                eo_rows.append((ev_id, obj_id, qualifier))

        if len(event_rows) >= BATCH_SIZE:
            flusher(conn, "events", event_ph, event_rows)
            event_rows = []
        if len(eo_rows) >= BATCH_SIZE:
            flusher(conn, "event_object", eo_ph, eo_rows)
            eo_rows = []

    flusher(conn, "events", event_ph, event_rows)
    flusher(conn, "event_object", eo_ph, eo_rows)


def _sqlite_insert_objects(
    con: sqlite3.Connection,
    cur: sqlite3.Cursor,
    conn: duckdb.DuckDBPyConnection,
    obj_attr_cols: list[str],
    graceful: bool = True,
) -> None:
    # Discover all object types
    cur.execute("SELECT ocel_type_map FROM object_map_type")
    obj_types = [r[0] for r in cur.fetchall()]

    # latest attribute value per object (accumulated from per-type tables)
    latest_attrs: dict[str, dict] = {}
    history_rows: list[tuple] = []

    # Accumulate snapshots as {(obj_id, ts_unix): merged_attrs_dict}
    # so duplicate (obj_id, timestamp) pairs from the same table are merged.
    snapshot_map: dict[tuple[str, int], dict[str, str]] = {}

    for ot in obj_types:
        table = f"object_{ot}"
        cur.execute(f"PRAGMA table_info('{table}')")
        tbl_cols = [r[1] for r in cur.fetchall() if r[1] not in ("ocel_id", "ocel_time")]

        col_select = ", ".join(f'"{c}"' for c in tbl_cols) if tbl_cols else "NULL"
        cur2 = con.cursor()
        cur2.execute(f'SELECT ocel_id, ocel_time, {col_select} FROM "{table}" ORDER BY ocel_time')
        for row in cur2:
            obj_id, ts_str = row[0], row[1]
            ts_unix = _parse_ts(ts_str)
            attrs = {col: str(val) for col, val in zip(tbl_cols, row[2:]) if val is not None}

            latest_attrs.setdefault(obj_id, {}).update(attrs)

            if obj_attr_cols:
                key = (obj_id, ts_unix)
                snapshot_map.setdefault(key, {}).update(attrs)

    if obj_attr_cols:
        for (obj_id, ts_unix), attrs in snapshot_map.items():
            hist_row = [obj_id, ts_unix] + [attrs.get(c) for c in obj_attr_cols]
            history_rows.append(tuple(hist_row))

    # Insert all objects from the object table
    obj_ph = ", ".join(["?"] * (2 + len(obj_attr_cols)))
    flusher = _flush_ignore if graceful else _flush
    obj_rows: list[tuple] = []

    cur.execute("""
        SELECT o.ocel_id, emt.ocel_type_map
        FROM object o
        JOIN object_map_type emt ON o.ocel_type = emt.ocel_type
    """)
    while True:
        batch = cur.fetchmany(BATCH_SIZE)
        if not batch:
            break
        for obj_id, obj_type in batch:
            latest = latest_attrs.get(obj_id, {})
            obj_rows.append(
                tuple([obj_id, obj_type] + [latest.get(c) for c in obj_attr_cols])
            )
        if len(obj_rows) >= BATCH_SIZE:
            flusher(conn, "objects", obj_ph, obj_rows)
            obj_rows = []

    flusher(conn, "objects", obj_ph, obj_rows)

    if obj_attr_cols and history_rows:
        hist_ph = ", ".join(["?"] * (2 + len(obj_attr_cols)))
        flusher(conn, "object_attribute_history", hist_ph, history_rows)


def _sqlite_insert_o2o(cur: sqlite3.Cursor, conn: duckdb.DuckDBPyConnection) -> None:
    try:
        cur.execute("SELECT ocel_source_id, ocel_target_id, ocel_qualifier FROM object_object")
    except sqlite3.OperationalError:
        return  # table may not exist in all OCEL files
    o2o_rows: list[tuple] = []
    while True:
        batch = cur.fetchmany(BATCH_SIZE)
        if not batch:
            break
        o2o_rows.extend(batch)
        if len(o2o_rows) >= BATCH_SIZE:
            _flush_ignore(conn, "object_relations", "?, ?, ?", o2o_rows)
            o2o_rows = []
    _flush_ignore(conn, "object_relations", "?, ?, ?", o2o_rows)


# ---------------------------------------------------------------------------
# JSON (ijson streaming)
# ---------------------------------------------------------------------------

def _import_json(file_path: str, db_path: str, graceful: bool = True) -> OcelDuckDB:
    # --- Pass 1: collect attribute column names ---
    event_attr_cols: set[str] = set()
    obj_attr_cols:   set[str] = set()

    with open(file_path, "rb") as f:
        for obj in ijson.items(f, "objects.item"):
            for attr in obj.get("attributes", []):
                name = attr.get("name")
                if name:
                    obj_attr_cols.add(name)
        # events may carry a vmap / attributes field
    with open(file_path, "rb") as f:
        for ev in ijson.items(f, "events.item"):
            for attr in ev.get("attributes", []):
                name = attr.get("name")
                if name:
                    event_attr_cols.add(name)

    event_attr_cols_sorted = sorted(event_attr_cols)
    obj_attr_cols_sorted   = sorted(obj_attr_cols)

    conn = duckdb.connect(db_path)
    create_ocel_schema(conn, event_attr_cols_sorted, obj_attr_cols_sorted)
    flusher = _flush_ignore if graceful else _flush

    # --- Pass 2: stream events ---
    event_ph = ", ".join(["?"] * (3 + len(event_attr_cols_sorted)))
    event_rows: list[tuple] = []
    eo_rows:    list[tuple] = []

    with open(file_path, "rb") as f:
        for ev in ijson.items(f, "events.item"):
            ev_id    = ev.get("id", "")
            activity = ev.get("type", "")
            ts_unix  = _parse_ts(ev.get("time", ""))

            attr_map: dict[str, str] = {}
            for attr in ev.get("attributes", []):
                name = attr.get("name")
                if name and name in event_attr_cols_sorted:
                    attr_map[name] = str(attr.get("value", ""))

            event_rows.append(
                tuple([ev_id, activity, ts_unix] + [attr_map.get(c) for c in event_attr_cols_sorted])
            )
            for rel in ev.get("relationships", []):
                obj_id    = rel.get("objectId")
                qualifier = rel.get("qualifier")
                if obj_id:
                    eo_rows.append((ev_id, obj_id, qualifier))

            if len(event_rows) >= BATCH_SIZE:
                flusher(conn, "events", event_ph, event_rows)
                event_rows = []
            if len(eo_rows) >= BATCH_SIZE:
                flusher(conn, "event_object", "?, ?, ?", eo_rows)
                eo_rows = []

    flusher(conn, "events", event_ph, event_rows)
    flusher(conn, "event_object", "?, ?, ?", eo_rows)

    # --- Pass 2: stream objects ---
    obj_ph   = ", ".join(["?"] * (2 + len(obj_attr_cols_sorted)))
    hist_ph  = ", ".join(["?"] * (2 + len(obj_attr_cols_sorted)))
    obj_rows:  list[tuple] = []
    hist_rows: list[tuple] = []
    o2o_rows:  list[tuple] = []

    with open(file_path, "rb") as f:
        for obj in ijson.items(f, "objects.item"):
            obj_id   = obj.get("id", "")
            obj_type = obj.get("type", "")

            # latest attribute values (chronologically last wins per key)
            snapshots = sorted(obj.get("attributes", []), key=lambda a: a.get("time", ""))
            latest: dict[str, str] = {}
            # Merge attributes sharing the same timestamp into one history row
            snap_map: dict[int, dict[str, str | None]] = {}
            for attr in snapshots:
                name = attr.get("name")
                if name and name in obj_attr_cols_sorted:
                    val_str = str(attr.get("value", ""))
                    latest[name] = val_str
                    if obj_attr_cols_sorted:
                        ts_unix = _parse_ts(attr.get("time", ""))
                        snap_map.setdefault(ts_unix, {})[name] = val_str

            for ts_unix, snap in snap_map.items():
                hist_rows.append(
                    tuple([obj_id, ts_unix] + [snap.get(c) for c in obj_attr_cols_sorted])
                )

            obj_rows.append(
                tuple([obj_id, obj_type] + [latest.get(c) for c in obj_attr_cols_sorted])
            )

            for rel in obj.get("relationships", []):
                tgt_id    = rel.get("objectId")
                qualifier = rel.get("qualifier")
                if tgt_id:
                    o2o_rows.append((obj_id, tgt_id, qualifier))

            if len(obj_rows) >= BATCH_SIZE:
                flusher(conn, "objects", obj_ph, obj_rows)
                obj_rows = []
            if hist_rows and len(hist_rows) >= BATCH_SIZE:
                flusher(conn, "object_attribute_history", hist_ph, hist_rows)
                hist_rows = []

    flusher(conn, "objects", obj_ph, obj_rows)
    if hist_rows:
        flusher(conn, "object_attribute_history", hist_ph, hist_rows)
    _flush_ignore(conn, "object_relations", "?, ?, ?", o2o_rows)

    if graceful:
        _graceful_cleanup(conn)

    return OcelDuckDB._from_prepared_connection(
        conn, event_attr_cols_sorted, obj_attr_cols_sorted
    )


# ---------------------------------------------------------------------------
# XML (ET.iterparse streaming)
# ---------------------------------------------------------------------------

def _import_xml(file_path: str, db_path: str, graceful: bool = True) -> OcelDuckDB:
    # --- Pass 1: collect attribute column names ---
    # Only collect names from data attributes (those with a "value" attr),
    # not from schema-definition attributes (those with a "type" attr only).
    event_attr_cols: set[str] = set()
    obj_attr_cols:   set[str] = set()
    _in_top_events  = False
    _in_top_objects = False
    _in_event       = False
    _in_object      = False

    for _ev, elem in ET.iterparse(file_path, events=["start", "end"]):
        if _ev == "start":
            if elem.tag == "events" and not _in_event and not _in_object:
                _in_top_events = True
            elif elem.tag == "objects" and not _in_event and not _in_object:
                _in_top_objects = True
            elif elem.tag == "event" and _in_top_events:
                _in_event = True
            elif elem.tag == "object" and _in_top_objects:
                _in_object = True
        elif _ev == "end":
            if elem.tag == "events":
                _in_top_events = False
            elif elem.tag == "objects" and not _in_event and not _in_object:
                _in_top_objects = False
            elif elem.tag == "event":
                _in_event = False
            elif elem.tag == "object":
                _in_object = False
            elif elem.tag == "attribute" and elem.get("value") is not None:
                name = elem.get("name")
                if name:
                    if _in_event:
                        event_attr_cols.add(name)
                    elif _in_object:
                        obj_attr_cols.add(name)
            elem.clear()

    event_attr_cols_sorted = sorted(event_attr_cols)
    obj_attr_cols_sorted   = sorted(obj_attr_cols)

    conn = duckdb.connect(db_path)
    create_ocel_schema(conn, event_attr_cols_sorted, obj_attr_cols_sorted)
    flusher = _flush_ignore if graceful else _flush

    # --- Pass 2: stream data ---
    event_ph = ", ".join(["?"] * (3 + len(event_attr_cols_sorted)))
    obj_ph   = ", ".join(["?"] * (2 + len(obj_attr_cols_sorted)))
    hist_ph  = ", ".join(["?"] * (2 + len(obj_attr_cols_sorted)))

    event_rows: list[tuple] = []
    eo_rows:    list[tuple] = []
    obj_rows:   list[tuple] = []
    hist_rows:  list[tuple] = []
    o2o_rows:   list[tuple] = []

    _in_top_events  = False
    _in_top_objects = False
    _in_event       = False
    _in_object      = False
    cur_event: dict = {}
    cur_obj:   dict = {}

    for _ev, elem in ET.iterparse(file_path, events=["start", "end"]):
        if _ev == "start":
            if elem.tag == "events" and not _in_event and not _in_object:
                _in_top_events = True
            elif elem.tag == "objects" and not _in_event and not _in_object:
                _in_top_objects = True
            elif elem.tag == "event" and _in_top_events:
                _in_event = True
                cur_event = {
                    "id": elem.get("id", ""),
                    "type": elem.get("type", ""),
                    "time": elem.get("time", ""),
                    "attrs": {},
                    "rels": [],
                }
            elif elem.tag == "object" and _in_top_objects:
                _in_object = True
                cur_obj = {
                    "id": elem.get("id", ""),
                    "type": elem.get("type", ""),
                    "attrs": [],
                    "rels": [],
                }

        elif _ev == "end":
            if elem.tag == "events":
                _in_top_events = False
            elif elem.tag == "objects" and not _in_event and not _in_object:
                _in_top_objects = False

            elif elem.tag == "attribute" and elem.get("value") is not None:
                name = elem.get("name")
                val  = elem.get("value")
                ts   = elem.get("time")
                if _in_event and name and name in event_attr_cols_sorted:
                    cur_event["attrs"][name] = str(val) if val is not None else None
                elif _in_object and name:
                    cur_obj["attrs"].append({"name": name, "value": val, "time": ts})

            elif elem.tag in ("relationship", "relobj"):
                oid = elem.get("object-id")
                if oid:
                    if _in_event:
                        qualifier = elem.get("qualifier") or elem.get("relationship")
                        cur_event["rels"].append((oid, qualifier))
                    elif _in_object:
                        qualifier = elem.get("qualifier")
                        cur_obj["rels"].append((oid, qualifier))

            elif elem.tag == "event":
                _in_event = False
                ev_id    = cur_event["id"]
                activity = cur_event["type"]
                ts_unix  = _parse_ts(cur_event["time"])
                attrs    = cur_event["attrs"]

                event_rows.append(
                    tuple([ev_id, activity, ts_unix] + [attrs.get(c) for c in event_attr_cols_sorted])
                )
                for oid, qualifier in cur_event["rels"]:
                    eo_rows.append((ev_id, oid, qualifier))

                if len(event_rows) >= BATCH_SIZE:
                    flusher(conn, "events", event_ph, event_rows)
                    event_rows = []
                if len(eo_rows) >= BATCH_SIZE:
                    flusher(conn, "event_object", "?, ?, ?", eo_rows)
                    eo_rows = []

            elif elem.tag == "object":
                _in_object = False
                obj_id   = cur_obj["id"]
                obj_type = cur_obj["type"]

                snapshots = sorted(cur_obj["attrs"], key=lambda a: a.get("time") or "")
                latest: dict[str, str | None] = {}
                snap_map: dict[int, dict[str, str | None]] = {}
                for attr in snapshots:
                    name = attr["name"]
                    if name in obj_attr_cols_sorted:
                        val = str(attr["value"]) if attr["value"] is not None else None
                        latest[name] = val
                        ts_unix = _parse_ts(attr.get("time") or "")
                        snap_map.setdefault(ts_unix, {})[name] = val

                for ts_unix, snap in snap_map.items():
                    hist_rows.append(
                        tuple([obj_id, ts_unix] + [snap.get(c) for c in obj_attr_cols_sorted])
                    )
                obj_rows.append(
                    tuple([obj_id, obj_type] + [latest.get(c) for c in obj_attr_cols_sorted])
                )
                for tgt_id, qualifier in cur_obj["rels"]:
                    o2o_rows.append((obj_id, tgt_id, qualifier))

                if len(obj_rows) >= BATCH_SIZE:
                    flusher(conn, "objects", obj_ph, obj_rows)
                    obj_rows = []
                if hist_rows and len(hist_rows) >= BATCH_SIZE:
                    flusher(conn, "object_attribute_history", hist_ph, hist_rows)
                    hist_rows = []

            elem.clear()

    flusher(conn, "events", event_ph, event_rows)
    flusher(conn, "event_object", "?, ?, ?", eo_rows)
    flusher(conn, "objects", obj_ph, obj_rows)
    if hist_rows:
        flusher(conn, "object_attribute_history", hist_ph, hist_rows)
    _flush_ignore(conn, "object_relations", "?, ?, ?", o2o_rows)

    if graceful:
        _graceful_cleanup(conn)

    return OcelDuckDB._from_prepared_connection(
        conn, event_attr_cols_sorted, obj_attr_cols_sorted
    )


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------

def _import_csv(file_path: str, db_path: str, graceful: bool = True) -> OcelDuckDB:
    # CSV headers tell us the attribute columns upfront — no separate pass needed.
    # utf-8-sig strips the UTF-8 BOM (U+FEFF) that some tools add to CSV files
    with open(file_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []

    ot_cols = [c for c in fieldnames if c.startswith("ot:")]
    ea_cols = [c for c in fieldnames if c.startswith("ea:")]
    event_attr_cols = sorted(c[3:] for c in ea_cols)   # strip "ea:" prefix
    obj_attr_cols: list[str] = []                        # CSV objects have no typed attrs in schema

    conn = duckdb.connect(db_path)
    create_ocel_schema(conn, event_attr_cols, obj_attr_cols)
    flusher = _flush_ignore if graceful else _flush

    event_ph  = ", ".join(["?"] * (3 + len(event_attr_cols)))
    obj_ph    = "?, ?"

    event_rows: list[tuple] = []
    eo_rows:    list[tuple] = []
    obj_rows:   list[tuple] = []
    o2o_rows:   list[tuple] = []
    seen_objs:  dict[str, str] = {}  # obj_id → obj_type

    def _parse_obj_cell(cell: str) -> list[tuple[str, str | None]]:
        """Parse 'id[#qualifier][{json}]' cells, '/' separated."""
        results = []
        for part in cell.split("/"):
            part = part.strip()
            if not part:
                continue
            # strip JSON attributes
            brace = part.find("{")
            if brace != -1:
                part = part[:brace].strip()
            if "#" in part:
                obj_id, qualifier = part.split("#", 1)
                results.append((obj_id.strip(), qualifier.strip() or None))
            else:
                results.append((part, None))
        return results

    with open(file_path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            row_id   = (row.get("id") or "").strip()
            activity = (row.get("activity") or "").strip()
            ts_str   = (row.get("timestamp") or "").strip()
            ts_unix  = _parse_ts(ts_str)

            is_o2o  = activity == "o2o"
            is_event = activity and not is_o2o

            if is_event:
                attr_map = {c[3:]: (row.get(c) or "").strip() or None for c in ea_cols}
                event_rows.append(
                    tuple([row_id, activity, ts_unix] + [attr_map.get(c) for c in event_attr_cols])
                )
                for ot_col in ot_cols:
                    obj_type = ot_col[3:]
                    cell = (row.get(ot_col) or "").strip()
                    if not cell:
                        continue
                    for obj_id, qualifier in _parse_obj_cell(cell):
                        if obj_id not in seen_objs:
                            seen_objs[obj_id] = obj_type
                        eo_rows.append((row_id, obj_id, qualifier))

            elif is_o2o:
                src_id = row_id
                for ot_col in ot_cols:
                    obj_type = ot_col[3:]
                    cell = (row.get(ot_col) or "").strip()
                    if not cell:
                        continue
                    for tgt_id, qualifier in _parse_obj_cell(cell):
                        if tgt_id not in seen_objs:
                            seen_objs[tgt_id] = obj_type
                        o2o_rows.append((src_id, tgt_id, qualifier))

            else:
                # object attribute update row — register objects
                for ot_col in ot_cols:
                    obj_type = ot_col[3:]
                    cell = (row.get(ot_col) or "").strip()
                    if not cell:
                        continue
                    for obj_id, _ in _parse_obj_cell(cell):
                        if obj_id not in seen_objs:
                            seen_objs[obj_id] = obj_type

            if len(event_rows) >= BATCH_SIZE:
                flusher(conn, "events", event_ph, event_rows)
                event_rows = []
            if len(eo_rows) >= BATCH_SIZE:
                flusher(conn, "event_object", "?, ?, ?", eo_rows)
                eo_rows = []

    # flush remaining events
    flusher(conn, "events", event_ph, event_rows)
    flusher(conn, "event_object", "?, ?, ?", eo_rows)

    # insert objects (collected while processing events)
    obj_rows = [(obj_id, obj_type) for obj_id, obj_type in seen_objs.items()]
    flusher(conn, "objects", obj_ph, obj_rows)
    _flush_ignore(conn, "object_relations", "?, ?, ?", o2o_rows)

    if graceful:
        _graceful_cleanup(conn)

    return OcelDuckDB._from_prepared_connection(conn, event_attr_cols, obj_attr_cols)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_ts(ts_str: str) -> int:
    """Parse an ISO 8601 timestamp string to Unix epoch seconds. Returns 0 on failure."""
    if not ts_str:
        return 0
    for fmt in (
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            dt = datetime.strptime(ts_str, fmt)
            return int(dt.replace(tzinfo=timezone.utc).timestamp())
        except ValueError:
            continue
    return 0


def _flush(
    conn: duckdb.DuckDBPyConnection,
    table: str,
    placeholders: str,
    rows: list[tuple],
) -> None:
    if rows:
        conn.executemany(f"INSERT INTO {table} VALUES ({placeholders})", rows)


def _flush_ignore(
    conn: duckdb.DuckDBPyConnection,
    table: str,
    placeholders: str,
    rows: list[tuple],
) -> None:
    if rows:
        conn.executemany(
            f"INSERT INTO {table} VALUES ({placeholders}) ON CONFLICT DO NOTHING",
            rows,
        )


# Expose for use in Iterator type hints
__all__ = ["import_ocel_db"]
