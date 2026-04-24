"""
Direct streaming importer: OCEL 2.0 → DuckDB.

Unlike import_ocel() which loads the full log into Polars DataFrames first,
import_ocel_db() uses a two-pass streaming approach so the full dataset never
lives in RAM at the same time:

  Pass 1 (lightweight): stream through the file collecting only attribute
                        column names → build the DuckDB schema
  Pass 2 (streaming):   stream events / objects in batches of BATCH_SIZE
                        rows → insert directly into DuckDB

Format-specific streaming strategies:
  SQLite — sqlite3 cursor + PRAGMA (no full-load, built-in)
  JSON   — ijson streaming iterator (one JSON object at a time)
  XML    — xml.etree.ElementTree.iterparse + elem.clear() (built-in)
  CSV    — csv.DictReader row by row (built-in)
"""

import csv
import json
import os
import sqlite3
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Iterator

import duckdb
import ijson

from .ocel_duckdb import OcelDuckDB, create_ocel_schema

BATCH_SIZE = 1_000


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def import_ocel_db(file_path: str, db_path: str = ":memory:") -> OcelDuckDB:
    """
    Import an OCEL 2.0 file directly into a DuckDB database.

    Uses two-pass streaming so the full log never lives in RAM simultaneously.
    Supports .sqlite, .json, .xml, and .csv formats (detected from extension).

    Args:
        file_path: Path to the OCEL 2.0 file.
        db_path:   DuckDB target path. Defaults to ':memory:'.
                   Pass a file path like 'ocel.duckdb' for persistence.

    Returns:
        OcelDuckDB instance backed by the populated database.
    """
    _, ext = os.path.splitext(file_path)
    fmt = ext.lower().lstrip(".")

    dispatchers = {
        "sqlite": _import_sqlite,
        "json":   _import_json,
        "xml":    _import_xml,
        "csv":    _import_csv,
    }
    if fmt not in dispatchers:
        raise ValueError(
            f"Unsupported format '{ext}'. "
            f"Supported: {list(dispatchers.keys())}"
        )
    return dispatchers[fmt](file_path, db_path)


# ---------------------------------------------------------------------------
# SQLite
# ---------------------------------------------------------------------------

def _import_sqlite(file_path: str, db_path: str) -> OcelDuckDB:
    con = sqlite3.connect(file_path)
    cur = con.cursor()

    # --- Pass 1: discover attribute columns ---
    event_attr_cols = _sqlite_discover_event_attrs(cur)
    obj_attr_cols   = _sqlite_discover_obj_attrs(cur)

    conn = duckdb.connect(db_path)
    create_ocel_schema(conn, event_attr_cols, obj_attr_cols)

    # --- Pass 2: stream events ---
    _sqlite_insert_events(con, cur, conn, event_attr_cols)

    # --- Pass 2: stream objects ---
    _sqlite_insert_objects(con, cur, conn, obj_attr_cols)

    # --- Pass 2: stream object-to-object relations ---
    _sqlite_insert_o2o(cur, conn)

    con.close()
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
            _flush(conn, "events", event_ph, event_rows)
            event_rows = []
        if len(eo_rows) >= BATCH_SIZE:
            _flush(conn, "event_object", eo_ph, eo_rows)
            eo_rows = []

    _flush(conn, "events", event_ph, event_rows)
    _flush(conn, "event_object", eo_ph, eo_rows)


def _sqlite_insert_objects(
    con: sqlite3.Connection,
    cur: sqlite3.Cursor,
    conn: duckdb.DuckDBPyConnection,
    obj_attr_cols: list[str],
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
            _flush(conn, "objects", obj_ph, obj_rows)
            obj_rows = []

    _flush(conn, "objects", obj_ph, obj_rows)

    if obj_attr_cols and history_rows:
        hist_ph = ", ".join(["?"] * (2 + len(obj_attr_cols)))
        _flush(conn, "object_attribute_history", hist_ph, history_rows)


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

def _import_json(file_path: str, db_path: str) -> OcelDuckDB:
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
                _flush(conn, "events", event_ph, event_rows)
                event_rows = []
            if len(eo_rows) >= BATCH_SIZE:
                _flush(conn, "event_object", "?, ?, ?", eo_rows)
                eo_rows = []

    _flush(conn, "events", event_ph, event_rows)
    _flush(conn, "event_object", "?, ?, ?", eo_rows)

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
                _flush(conn, "objects", obj_ph, obj_rows)
                obj_rows = []
            if hist_rows and len(hist_rows) >= BATCH_SIZE:
                _flush(conn, "object_attribute_history", hist_ph, hist_rows)
                hist_rows = []

    _flush(conn, "objects", obj_ph, obj_rows)
    if hist_rows:
        _flush(conn, "object_attribute_history", hist_ph, hist_rows)
    _flush_ignore(conn, "object_relations", "?, ?, ?", o2o_rows)

    return OcelDuckDB._from_prepared_connection(
        conn, event_attr_cols_sorted, obj_attr_cols_sorted
    )


# ---------------------------------------------------------------------------
# XML (ET.iterparse streaming)
# ---------------------------------------------------------------------------

def _import_xml(file_path: str, db_path: str) -> OcelDuckDB:
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

            elif elem.tag == "relationship":
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
                    _flush(conn, "events", event_ph, event_rows)
                    event_rows = []
                if len(eo_rows) >= BATCH_SIZE:
                    _flush(conn, "event_object", "?, ?, ?", eo_rows)
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
                    _flush(conn, "objects", obj_ph, obj_rows)
                    obj_rows = []
                if hist_rows and len(hist_rows) >= BATCH_SIZE:
                    _flush(conn, "object_attribute_history", hist_ph, hist_rows)
                    hist_rows = []

            elem.clear()

    _flush(conn, "events", event_ph, event_rows)
    _flush(conn, "event_object", "?, ?, ?", eo_rows)
    _flush(conn, "objects", obj_ph, obj_rows)
    if hist_rows:
        _flush(conn, "object_attribute_history", hist_ph, hist_rows)
    _flush_ignore(conn, "object_relations", "?, ?, ?", o2o_rows)

    return OcelDuckDB._from_prepared_connection(
        conn, event_attr_cols_sorted, obj_attr_cols_sorted
    )


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------

def _import_csv(file_path: str, db_path: str) -> OcelDuckDB:
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
                _flush(conn, "events", event_ph, event_rows)
                event_rows = []
            if len(eo_rows) >= BATCH_SIZE:
                _flush(conn, "event_object", "?, ?, ?", eo_rows)
                eo_rows = []

    # flush remaining events
    _flush(conn, "events", event_ph, event_rows)
    _flush(conn, "event_object", "?, ?, ?", eo_rows)

    # insert objects (collected while processing events)
    obj_rows = [(obj_id, obj_type) for obj_id, obj_type in seen_objs.items()]
    _flush(conn, "objects", obj_ph, obj_rows)
    _flush_ignore(conn, "object_relations", "?, ?, ?", o2o_rows)

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
