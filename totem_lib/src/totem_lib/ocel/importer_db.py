"""
Direct importer: OCEL 2.0 → DuckDB.

Every format goes through the same three-step pipeline, so the per-format
code only has to get the raw source rows into DuckDB — nothing is parsed,
deduplicated or pivoted in Python:

  1. **Stage.** The source is read into temporary staging tables (``_src_*``)
     that mirror the source layout one-to-one (raw timestamp strings,
     attributes in long ``(owner, name, value)`` form). The heavy lifting
     happens in DuckDB:

       SQLite — the ``sqlite_scanner`` extension reads the file directly
                (pure SQL, no Python row iteration). When the extension is
                not available (offline machine, packaged build) a chunked
                ``sqlite3`` → Arrow fallback is used instead.
       JSON   — DuckDB's native JSON reader for files below
                ``streaming_threshold_mb``; larger files are streamed with
                ``ijson`` in Arrow batches so peak RAM stays bounded.
       XML    — ``ElementTree.iterparse`` streamed in Arrow batches.
       CSV    — ``csv.DictReader`` streamed in Arrow batches.

  2. **Finalize.** Pure SQL turns the staging tables into the OCEL schema:
     timestamps are parsed (``TRY_CAST`` with a Python fallback for exotic
     formats), duplicates are dropped deterministically (first occurrence
     wins), object attribute snapshots are pivoted into ``objects`` (latest
     value) and ``object_attribute_history``.

  3. **Index + validate.** Indexes are built once the data is in place
     (much cheaper than maintaining them during the load); strict mode then
     runs the OCEL validation.

Memory stays bounded for every format: DuckDB streams from SQLite, the
Python readers hand over fixed-size Arrow batches, and only the native JSON
path (which is opt-out via ``streaming_threshold_mb``) holds a whole
document at once.
"""

from __future__ import annotations

import csv
import glob
import importlib.util
import os
import re
import sqlite3
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Callable, Optional

import duckdb
import ijson
import pyarrow as pa

from .ocel_duckdb import OcelDuckDB, create_ocel_indexes, create_ocel_schema
from .validation import OCELValidationException, validate_ocel

# Rows per Arrow batch handed from a Python reader to DuckDB.
BATCH_SIZE = 200_000
# JSON files at or above this size are streamed with ijson instead of being
# read whole by DuckDB's JSON reader (which holds the document in memory).
STREAMING_THRESHOLD_MB = 200

ProgressCallback = Callable[[float, str], None]

# Attribute names that would collide with the fixed schema columns.
_FIXED_EVENT_COLS = frozenset({"event_id", "activity", "timestamp_unix"})
_FIXED_OBJ_COLS = frozenset({"obj_id", "obj_type", "timestamp_unix"})

# Separates the per-source-table / per-chunk part of a sequence number from
# the row number inside it, so `seq` orders rows by source order globally.
_SEQ_STRIDE = 1 << 40

_PY_TS_UDF = "_totem_parse_ts"

_JS_DATE_RE = re.compile(r"^([A-Za-z]{3} [A-Za-z]{3} \d{1,2} \d{4} \d{2}:\d{2}:\d{2} GMT[+-]\d{4})")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def import_ocel_db(
    file_path: str | os.PathLike,
    db_path: str = ":memory:",
    streaming_threshold_mb: float = STREAMING_THRESHOLD_MB,
    graceful_import: bool = True,
    strict_mode: bool = False,
    progress: Optional[ProgressCallback] = None,
) -> OcelDuckDB:
    """
    Import an OCEL 2.0 file directly into a DuckDB database.

    Usage example::

        db = import_ocel_db("log.sqlite")
        db.conn.execute("SELECT COUNT(*) FROM events").fetchone()
        db.close()

        # Persist to disk:
        db = import_ocel_db("large_log.json", db_path="out.duckdb")

    Args:
        file_path:              Path to the OCEL 2.0 file (.sqlite, .json, .xml, .csv).
        db_path:                DuckDB target path. Defaults to ':memory:'. Pass a file
                                path (e.g. 'my_log.duckdb') to persist the database.
                                If the import fails, a database file this call
                                created is removed again; a file that already
                                existed at db_path is never deleted.
        streaming_threshold_mb: JSON files strictly below this size (MB) are read
                                in one go by DuckDB's JSON reader (fastest); files
                                at or above it are streamed with bounded memory.
                                Pass 0 to always stream. Other formats always
                                stream and ignore this value.
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
        strict_mode:            Validate the imported log (duplicate ids, dangling
                                references, ...) and raise ``OCELValidationException``
                                instead of returning a database with problems.
        progress:               Optional ``callback(fraction, message)`` invoked as
                                the import advances (``fraction`` in ``[0, 1]``).
                                Raising inside the callback aborts the import.

    Returns:
        OcelDuckDB instance backed by the populated database.
    """
    # The readers build SQL from the path, so they need a str, not a Path.
    file_path = os.fspath(file_path)
    _, ext = os.path.splitext(file_path)
    fmt = ext.lower().lstrip(".")

    if fmt == "duckdb":
        return OcelDuckDB.load(file_path)

    readers = {
        "sqlite": _stage_sqlite,
        "json": _stage_json,
        "xml": _stage_xml,
        "csv": _stage_csv,
    }
    if fmt not in readers:
        raise ValueError(
            f"Unsupported format '{ext}'. "
            f"Supported: {list(readers.keys())}"
        )

    # Only a database this call creates is ours to clean up. A file already
    # at db_path belongs to someone else, and the failure may well be that it
    # is in use — deleting it would destroy their data.
    creates_db = db_path != ":memory:" and not os.path.exists(db_path)
    conn = duckdb.connect(db_path)
    try:
        _ensure_empty_target(conn)
        with _import_session(conn):
            report = _Reporter(progress)
            stage = _Staging(conn)
            readers[fmt](file_path, stage, report, streaming_threshold_mb)
            return _finalize(conn, stage, graceful_import, strict_mode, report)
    except BaseException:
        try:
            conn.close()
        except Exception:
            pass
        if creates_db:
            for path in (db_path, db_path + ".wal"):
                try:
                    os.remove(path)
                except OSError:
                    pass
        raise


# ---------------------------------------------------------------------------
# Session setup
# ---------------------------------------------------------------------------

def _ensure_empty_target(conn: duckdb.DuckDBPyConnection) -> None:
    """Fail before reading the source when the target already holds an OCEL."""
    present = {
        r[0]
        for r in conn.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'"
        ).fetchall()
    }
    for table in ("events", "objects", "event_object", "object_relations",
                  "object_attribute_history"):
        if table in present:
            raise duckdb.CatalogException(f"Table with name {table} already exists!")


@contextmanager
def _import_session(conn: duckdb.DuckDBPyConnection):
    """Connection settings for the load, restored afterwards.

    Naive timestamps are read as UTC (matching ``_parse_ts``), and insertion
    order is not preserved — deduplication orders rows explicitly by ``seq``,
    so DuckDB is free to parallelise the big inserts. Both settings would
    otherwise leak into the connection handed back to the caller.
    """
    old_tz = conn.execute("SELECT current_setting('TimeZone')").fetchone()[0]
    old_order = conn.execute(
        "SELECT current_setting('preserve_insertion_order')"
    ).fetchone()[0]
    conn.execute("SET TimeZone = 'UTC'")
    conn.execute("SET preserve_insertion_order = false")
    has_udf = False
    try:
        conn.create_function(_PY_TS_UDF, _parse_ts, ["VARCHAR"], "BIGINT")
        has_udf = True
    except Exception:
        # Very old DuckDB without Python UDF support: SQL parsing only.
        pass
    try:
        yield
    finally:
        for stmt in (
            f"SET TimeZone = '{old_tz}'",
            f"SET preserve_insertion_order = {'true' if old_order else 'false'}",
        ):
            try:
                conn.execute(stmt)
            except Exception:
                pass
        if has_udf:
            try:
                conn.remove_function(_PY_TS_UDF)
            except Exception:
                pass


def _ts_sql(expr: str) -> str:
    """SQL turning a raw timestamp string into Unix seconds (0 when unparseable).

    ``TRY_CAST`` handles every ISO 8601 flavour (``Z``, offsets, fractions,
    date only, ``T`` or space separator); the Python UDF only ever sees the
    rows the cast rejected, so it costs nothing on well-formed data.
    """
    return (
        f"COALESCE(floor(epoch(TRY_CAST({expr} AS TIMESTAMPTZ)))::BIGINT, "
        f"{_PY_TS_UDF}({expr}), 0)"
    )


class _Reporter:
    """Progress callback wrapper that tolerates ``None`` and clamps values."""

    def __init__(self, callback: Optional[ProgressCallback]):
        self._callback = callback

    def __call__(self, fraction: float, message: str) -> None:
        if self._callback is None:
            return
        self._callback(max(0.0, min(1.0, float(fraction))), message)

    @property
    def enabled(self) -> bool:
        return self._callback is not None


# ---------------------------------------------------------------------------
# Staging tables
# ---------------------------------------------------------------------------

_STAGING_TABLES = {
    "_src_events": ("seq", "event_id", "activity", "ts_raw"),
    "_src_event_attr": ("event_id", "name", "value"),
    "_src_event_object": ("seq", "event_id", "obj_id", "qualifier"),
    "_src_objects": ("seq", "obj_id", "obj_type"),
    "_src_obj_attr": ("seq", "obj_id", "ts_raw", "name", "value"),
    "_src_o2o": ("seq", "source_obj_id", "target_obj_id", "qualifier"),
}

_STAGING_DDL = {
    "_src_events": "seq BIGINT, event_id VARCHAR, activity VARCHAR, ts_raw VARCHAR",
    "_src_event_attr": "event_id VARCHAR, name VARCHAR, value VARCHAR",
    "_src_event_object": "seq BIGINT, event_id VARCHAR, obj_id VARCHAR, qualifier VARCHAR",
    "_src_objects": "seq BIGINT, obj_id VARCHAR, obj_type VARCHAR",
    "_src_obj_attr": "seq BIGINT, obj_id VARCHAR, ts_raw VARCHAR, name VARCHAR, value VARCHAR",
    "_src_o2o": "seq BIGINT, source_obj_id VARCHAR, target_obj_id VARCHAR, qualifier VARCHAR",
}


class _Staging:
    """Raw source rows as DuckDB temp tables, before parsing or deduplication.

    ``seq`` columns record the source order so that "first occurrence wins"
    deduplication and "latest attribute value" are deterministic whatever
    order DuckDB processes the rows in.
    """

    def __init__(self, conn: duckdb.DuckDBPyConnection):
        self.conn = conn
        self._chunk = 0
        for table, ddl in _STAGING_DDL.items():
            conn.execute(f"CREATE TEMP TABLE {table} ({ddl})")

    def next_seq_base(self) -> int:
        """A fresh sequence-number base for the next chunk or source table."""
        self._chunk += 1
        return self._chunk * _SEQ_STRIDE

    def insert_arrow(self, table: str, batch: pa.Table) -> None:
        """Append an Arrow table whose columns match the staging table."""
        if batch.num_rows == 0:
            return
        cols = ", ".join(f'"{c}"' for c in _STAGING_TABLES[table])
        name = f"_arrow_{table}"
        self.conn.register(name, batch)
        try:
            self.conn.execute(f"INSERT INTO {table} ({cols}) SELECT {cols} FROM {name}")
        finally:
            self.conn.unregister(name)

    def drop(self) -> None:
        for table in _STAGING_TABLES:
            try:
                self.conn.execute(f"DROP TABLE IF EXISTS {table}")
            except Exception:
                pass


def _str_array(values: list) -> pa.Array:
    return pa.array(values, type=pa.string())


def _seq_array(base: int, n: int) -> pa.Array:
    return pa.array(range(base, base + n), type=pa.int64())


def _str_or_none(value) -> Optional[str]:
    return None if value is None else str(value)


class _RowBuffers:
    """Column buffers for every staging table; flushed as Arrow batches.

    Python readers append to these and call :meth:`maybe_flush` regularly;
    the buffers never grow beyond roughly ``BATCH_SIZE`` rows per table.
    """

    def __init__(self, stage: _Staging):
        self.stage = stage
        self.ev_id: list = []
        self.ev_act: list = []
        self.ev_ts: list = []
        self.ea_ev: list = []
        self.ea_name: list = []
        self.ea_value: list = []
        self.eo_ev: list = []
        self.eo_obj: list = []
        self.eo_qual: list = []
        self.ob_id: list = []
        self.ob_type: list = []
        self.oa_seq: list = []
        self.oa_obj: list = []
        self.oa_ts: list = []
        self.oa_name: list = []
        self.oa_value: list = []
        self.o2o_src: list = []
        self.o2o_tgt: list = []
        self.o2o_qual: list = []
        self._oa_seq_next = stage.next_seq_base()

    def next_obj_attr_seq(self) -> int:
        self._oa_seq_next += 1
        return self._oa_seq_next

    def add_event(self, event_id, activity, ts_raw) -> None:
        self.ev_id.append(event_id)
        self.ev_act.append(activity)
        self.ev_ts.append(ts_raw)

    def add_event_attr(self, event_id, name, value) -> None:
        self.ea_ev.append(event_id)
        self.ea_name.append(name)
        self.ea_value.append(value)

    def add_event_object(self, event_id, obj_id, qualifier) -> None:
        self.eo_ev.append(event_id)
        self.eo_obj.append(obj_id)
        self.eo_qual.append(qualifier)

    def add_object(self, obj_id, obj_type) -> None:
        self.ob_id.append(obj_id)
        self.ob_type.append(obj_type)

    def add_object_attr(self, obj_id, ts_raw, name, value) -> None:
        self.oa_seq.append(self.next_obj_attr_seq())
        self.oa_obj.append(obj_id)
        self.oa_ts.append(ts_raw)
        self.oa_name.append(name)
        self.oa_value.append(value)

    def add_o2o(self, source, target, qualifier) -> None:
        self.o2o_src.append(source)
        self.o2o_tgt.append(target)
        self.o2o_qual.append(qualifier)

    def size(self) -> int:
        return max(len(self.ev_id), len(self.ea_ev), len(self.eo_ev),
                   len(self.ob_id), len(self.oa_obj), len(self.o2o_src))

    def maybe_flush(self) -> None:
        if self.size() >= BATCH_SIZE:
            self.flush()

    def flush(self) -> None:
        stage = self.stage
        if self.ev_id:
            n = len(self.ev_id)
            stage.insert_arrow("_src_events", pa.table({
                "seq": _seq_array(stage.next_seq_base(), n),
                "event_id": _str_array(self.ev_id),
                "activity": _str_array(self.ev_act),
                "ts_raw": _str_array(self.ev_ts),
            }))
            self.ev_id, self.ev_act, self.ev_ts = [], [], []
        if self.ea_ev:
            stage.insert_arrow("_src_event_attr", pa.table({
                "event_id": _str_array(self.ea_ev),
                "name": _str_array(self.ea_name),
                "value": _str_array(self.ea_value),
            }))
            self.ea_ev, self.ea_name, self.ea_value = [], [], []
        if self.eo_ev:
            stage.insert_arrow("_src_event_object", pa.table({
                "seq": _seq_array(stage.next_seq_base(), len(self.eo_ev)),
                "event_id": _str_array(self.eo_ev),
                "obj_id": _str_array(self.eo_obj),
                "qualifier": _str_array(self.eo_qual),
            }))
            self.eo_ev, self.eo_obj, self.eo_qual = [], [], []
        if self.ob_id:
            n = len(self.ob_id)
            stage.insert_arrow("_src_objects", pa.table({
                "seq": _seq_array(stage.next_seq_base(), n),
                "obj_id": _str_array(self.ob_id),
                "obj_type": _str_array(self.ob_type),
            }))
            self.ob_id, self.ob_type = [], []
        if self.oa_obj:
            stage.insert_arrow("_src_obj_attr", pa.table({
                "seq": pa.array(self.oa_seq, type=pa.int64()),
                "obj_id": _str_array(self.oa_obj),
                "ts_raw": _str_array(self.oa_ts),
                "name": _str_array(self.oa_name),
                "value": _str_array(self.oa_value),
            }))
            self.oa_seq, self.oa_obj, self.oa_ts = [], [], []
            self.oa_name, self.oa_value = [], []
        if self.o2o_src:
            stage.insert_arrow("_src_o2o", pa.table({
                "seq": _seq_array(stage.next_seq_base(), len(self.o2o_src)),
                "source_obj_id": _str_array(self.o2o_src),
                "target_obj_id": _str_array(self.o2o_tgt),
                "qualifier": _str_array(self.o2o_qual),
            }))
            self.o2o_src, self.o2o_tgt, self.o2o_qual = [], [], []


# ---------------------------------------------------------------------------
# Finalize: staging tables → OCEL schema (pure SQL)
# ---------------------------------------------------------------------------

def _attr_names(conn, table: str, excluded: frozenset) -> list[str]:
    rows = conn.execute(
        f"SELECT DISTINCT name FROM {table} WHERE name IS NOT NULL AND name <> ''"
    ).fetchall()
    return sorted(r[0] for r in rows if r[0] not in excluded)


def _sql_str(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _finalize(
    conn: duckdb.DuckDBPyConnection,
    stage: _Staging,
    graceful: bool,
    strict_mode: bool,
    report: _Reporter,
) -> OcelDuckDB:
    report(0.55, "Building event tables")
    event_attr_cols = _attr_names(conn, "_src_event_attr", _FIXED_EVENT_COLS)
    obj_attr_cols = _attr_names(conn, "_src_obj_attr", _FIXED_OBJ_COLS)
    create_ocel_schema(conn, event_attr_cols, obj_attr_cols, create_indexes=False)

    # ---- events ----
    ev_source = "_src_events"
    if graceful:
        ev_source = (
            "(SELECT * FROM _src_events "
            "QUALIFY row_number() OVER (PARTITION BY event_id ORDER BY seq) = 1)"
        )
    if event_attr_cols:
        pivot = ", ".join(
            f"max(CASE WHEN name = {_sql_str(c)} THEN value END) AS \"{c}\""
            for c in event_attr_cols
        )
        attr_cols_sql = "".join(f', "{c}"' for c in event_attr_cols)
        attr_sel = "".join(f', a."{c}"' for c in event_attr_cols)
        attr_join = (
            f"LEFT JOIN (SELECT event_id, {pivot} FROM _src_event_attr "
            f"WHERE value IS NOT NULL GROUP BY event_id) a USING (event_id)"
        )
    else:
        attr_cols_sql = attr_sel = attr_join = ""
    conn.execute(f"""
        INSERT INTO events (event_id, activity, timestamp_unix{attr_cols_sql})
        SELECT e.event_id, e.activity, {_ts_sql('e.ts_raw')}{attr_sel}
        FROM {ev_source} e
        {attr_join}
    """)

    # ---- objects ----
    report(0.7, "Building object tables")
    obj_source = "_src_objects"
    if graceful:
        obj_source = (
            "(SELECT * FROM _src_objects "
            "QUALIFY row_number() OVER (PARTITION BY obj_id ORDER BY seq) = 1)"
        )
    if obj_attr_cols:
        names_sql = ", ".join(_sql_str(c) for c in obj_attr_cols)
        # One parsed snapshot table feeds both `objects` and the history.
        conn.execute(f"""
            CREATE TEMP TABLE _src_obj_snap AS
            SELECT seq, obj_id, {_ts_sql('ts_raw')} AS ts, name, value
            FROM _src_obj_attr
            WHERE value IS NOT NULL AND obj_id IS NOT NULL AND name IN ({names_sql})
        """)
        latest = ", ".join(
            f"last(value ORDER BY ts, seq) FILTER (WHERE name = {_sql_str(c)}) AS \"{c}\""
            for c in obj_attr_cols
        )
        obj_cols_sql = "".join(f', "{c}"' for c in obj_attr_cols)
        obj_sel = "".join(f', l."{c}"' for c in obj_attr_cols)
        obj_join = (
            f"LEFT JOIN (SELECT obj_id, {latest} FROM _src_obj_snap GROUP BY obj_id) l "
            f"USING (obj_id)"
        )
    else:
        obj_cols_sql = obj_sel = obj_join = ""
    conn.execute(f"""
        INSERT INTO objects (obj_id, obj_type{obj_cols_sql})
        SELECT o.obj_id, o.obj_type{obj_sel}
        FROM {obj_source} o
        {obj_join}
    """)

    # In graceful mode rows referring to unknown events/objects are dropped
    # here, at insert time (an anti-join), instead of being deleted afterwards:
    # deletes have to update the freshly built indexes, this does not.
    known_event = "AND event_id IN (SELECT event_id FROM events)" if graceful else ""
    known_obj = "AND obj_id IN (SELECT obj_id FROM objects)" if graceful else ""

    if obj_attr_cols:
        snapshot = ", ".join(
            f"last(value ORDER BY seq) FILTER (WHERE name = {_sql_str(c)}) AS \"{c}\""
            for c in obj_attr_cols
        )
        conn.execute(f"""
            INSERT INTO object_attribute_history (obj_id, timestamp_unix{obj_cols_sql})
            SELECT obj_id, ts, {snapshot}
            FROM _src_obj_snap
            WHERE TRUE {known_obj}
            GROUP BY obj_id, ts
        """)
        conn.execute("DROP TABLE _src_obj_snap")

    # ---- event ↔ object ----
    report(0.78, "Building relation tables")
    eo_dedupe = (
        "QUALIFY row_number() OVER (PARTITION BY event_id, obj_id ORDER BY seq) = 1"
        if graceful else ""
    )
    conn.execute(f"""
        INSERT INTO event_object (event_id, obj_id, qualifier)
        SELECT event_id, obj_id, qualifier FROM _src_event_object
        WHERE event_id IS NOT NULL AND obj_id IS NOT NULL AND obj_id <> ''
          {known_event} {known_obj}
        {eo_dedupe}
    """)

    # ---- object ↔ object ----
    # Always deduplicated: the OCEL key includes the qualifier, ours does not.
    known_src = "AND source_obj_id IN (SELECT obj_id FROM objects)" if graceful else ""
    known_tgt = "AND target_obj_id IN (SELECT obj_id FROM objects)" if graceful else ""
    conn.execute(f"""
        INSERT INTO object_relations (source_obj_id, target_obj_id, qualifier)
        SELECT source_obj_id, target_obj_id, qualifier FROM _src_o2o
        WHERE source_obj_id IS NOT NULL AND target_obj_id IS NOT NULL
          AND target_obj_id <> '' {known_src} {known_tgt}
        QUALIFY row_number() OVER (PARTITION BY source_obj_id, target_obj_id ORDER BY seq) = 1
    """)

    errors: list[str] = []
    if strict_mode:
        dups = conn.execute("""
            SELECT event_id FROM _src_events
            WHERE event_id IS NOT NULL AND event_id <> ''
            GROUP BY event_id HAVING COUNT(*) > 1
            ORDER BY event_id LIMIT 10
        """).fetchall()
        for (ev_id,) in dups:
            errors.append(
                f"Validation Failed: Found duplicate Event ID '{ev_id}' in source data."
            )

    stage.drop()

    report(0.9, "Building indexes")
    create_ocel_indexes(conn, obj_attr_cols)

    if strict_mode:
        report(0.95, "Validating")
        errors.extend(validate_ocel(conn))
        if errors:
            conn.close()
            raise OCELValidationException(errors)

    report(1.0, "Done")
    return OcelDuckDB._from_prepared_connection(conn, event_attr_cols, obj_attr_cols)


# ---------------------------------------------------------------------------
# SQLite
# ---------------------------------------------------------------------------

def _sqlite_metadata(file_path: str):
    """Activities, object types and the attribute columns of their tables.

    Returns ``(activities, object_types)`` as lists of
    ``(ocel_type, ocel_type_map, [attribute columns])``.
    """
    con = sqlite3.connect(file_path)
    try:
        cur = con.cursor()

        def columns(table: str) -> list[str]:
            cur.execute(f"PRAGMA table_info('{table}')")
            return [r[1] for r in cur.fetchall() if r[1] not in ("ocel_id", "ocel_time")]

        cur.execute("SELECT ocel_type, ocel_type_map FROM event_map_type")
        activities = [(t, m, columns(f"event_{m}")) for t, m in cur.fetchall()]
        cur.execute("SELECT ocel_type, ocel_type_map FROM object_map_type")
        object_types = [(t, m, columns(f"object_{m}")) for t, m in cur.fetchall()]
        return activities, object_types
    finally:
        con.close()


def _bundled_extension_paths(name: str) -> list[str]:
    """Extension binaries shipped as ``duckdb-extension-<name>`` pip packages.

    Those packages make the extension available without network access
    (offline laptops, packaged desktop builds). The build matching the
    running DuckDB version is tried first.
    """
    paths: list[str] = []
    for module in (f"duckdb_extension_{name}", f"duckdb_extension_{name.replace('_scanner', '')}"):
        try:
            spec = importlib.util.find_spec(module)
        except (ImportError, ValueError):
            spec = None
        if spec is None or not spec.submodule_search_locations:
            continue
        for location in spec.submodule_search_locations:
            paths.extend(glob.glob(os.path.join(location, "**", f"{name}.duckdb_extension"), recursive=True))
    version = f"v{duckdb.__version__}"
    paths.sort(key=lambda p: (version not in p, p))
    return paths


def _load_sqlite_scanner(conn: duckdb.DuckDBPyConnection) -> bool:
    """Make ``ATTACH (TYPE sqlite)`` available, or report that it is not.

    Order: an already installed extension (or one DuckDB can download),
    then a binary bundled via pip. Any failure means the Python fallback
    reader is used — slower, but it needs nothing beyond the standard
    library.
    """
    try:
        conn.execute("LOAD sqlite_scanner")
        return True
    except Exception:
        pass
    for path in _bundled_extension_paths("sqlite_scanner"):
        try:
            conn.execute(f"LOAD {_sql_str(path)}")
            return True
        except Exception:
            continue
    return False


def _stage_sqlite(file_path: str, stage: _Staging, report: _Reporter, _threshold) -> None:
    activities, object_types = _sqlite_metadata(file_path)
    conn = stage.conn
    if _load_sqlite_scanner(conn):
        _stage_sqlite_scanner(file_path, stage, report, activities, object_types)
    else:
        _stage_sqlite_python(file_path, stage, report, activities, object_types)


def _unnest_pairs(cols: list[str]) -> tuple[str, str]:
    """``unnest`` expressions zipping column names with column values."""
    names = "[" + ", ".join(_sql_str(c) for c in cols) + "]"
    values = "[" + ", ".join(f'"{c}"::VARCHAR' for c in cols) + "]"
    return f"unnest({names})", f"unnest({values})"


def _stage_sqlite_scanner(file_path, stage, report, activities, object_types) -> None:
    """Pure-SQL staging through DuckDB's SQLite scanner (no row iteration)."""
    conn = stage.conn
    # All columns are read as text so per-type tables with differing attribute
    # types never clash, and values keep SQLite's own text rendering.
    conn.execute("SET sqlite_all_varchar = true")
    # Single-threaded scans keep `row_number() OVER ()` equal to the source
    # row order, which is what decides ties ("first occurrence wins").
    old_threads = conn.execute("SELECT current_setting('threads')").fetchone()[0]
    conn.execute("SET threads = 1")
    conn.execute(f"ATTACH {_sql_str(os.path.abspath(file_path))} AS src (TYPE sqlite)")
    try:
        n_steps = max(1, len(activities) + len(object_types) + 3)
        step = 0

        for _ocel_type, suffix, cols in activities:
            table = f'src."event_{suffix}"'
            base = stage.next_seq_base()
            conn.execute(
                f"INSERT INTO _src_events (seq, event_id, activity, ts_raw) "
                f"SELECT {base} + row_number() OVER (), ocel_id, {_sql_str(suffix)}, ocel_time "
                f"FROM {table}"
            )
            if cols:
                names, values = _unnest_pairs(cols)
                conn.execute(
                    f"INSERT INTO _src_event_attr (event_id, name, value) "
                    f"SELECT event_id, name, value FROM ("
                    f"SELECT ocel_id AS event_id, {names} AS name, {values} AS value "
                    f"FROM {table}) WHERE value IS NOT NULL"
                )
            step += 1
            report(0.5 * step / n_steps, "Reading events")

        base = stage.next_seq_base()
        conn.execute(
            f"INSERT INTO _src_event_object (seq, event_id, obj_id, qualifier) "
            f"SELECT {base} + row_number() OVER (), ocel_event_id, ocel_object_id, "
            f"ocel_qualifier FROM src.event_object"
        )
        step += 1
        report(0.5 * step / n_steps, "Reading event-object relations")

        base = stage.next_seq_base()
        conn.execute(f"""
            INSERT INTO _src_objects (seq, obj_id, obj_type)
            SELECT {base} + row_number() OVER (), o.ocel_id, omt.ocel_type_map
            FROM src.object o
            JOIN src.object_map_type omt ON o.ocel_type = omt.ocel_type
        """)
        for _ocel_type, suffix, cols in object_types:
            if not cols:
                continue
            names, values = _unnest_pairs(cols)
            base = stage.next_seq_base()
            conn.execute(
                f"INSERT INTO _src_obj_attr (seq, obj_id, ts_raw, name, value) "
                f"SELECT seq, obj_id, ts_raw, name, value FROM ("
                f"SELECT {base} + row_number() OVER () AS seq, ocel_id AS obj_id, "
                f"ocel_time AS ts_raw, {names} AS name, {values} AS value "
                f'FROM src."object_{suffix}") WHERE value IS NOT NULL'
            )
            step += 1
            report(0.5 * step / n_steps, "Reading objects")

        base = stage.next_seq_base()
        try:
            conn.execute(
                f"INSERT INTO _src_o2o (seq, source_obj_id, target_obj_id, qualifier) "
                f"SELECT {base} + row_number() OVER (), ocel_source_id, ocel_target_id, "
                f"ocel_qualifier FROM src.object_object"
            )
        except duckdb.Error:
            pass  # table may not exist in all OCEL files
        report(0.5, "Reading object relations")
    finally:
        for stmt in ("DETACH src", f"SET threads = {int(old_threads)}"):
            try:
                conn.execute(stmt)
            except Exception:
                pass


def _stage_sqlite_python(file_path, stage, report, activities, object_types) -> None:
    """Fallback staging with ``sqlite3`` + Arrow batches (no extension needed)."""
    con = sqlite3.connect(file_path)
    try:
        cur = con.cursor()
        buffers = _RowBuffers(stage)
        n_steps = max(1, len(activities) + len(object_types) + 3)
        step = 0

        for _ocel_type, suffix, cols in activities:
            col_sql = "".join(f', "{c}"' for c in cols)
            cur.execute(f'SELECT ocel_id, ocel_time{col_sql} FROM "event_{suffix}"')
            while True:
                rows = cur.fetchmany(BATCH_SIZE)
                if not rows:
                    break
                for row in rows:
                    ev_id = _str_or_none(row[0])
                    buffers.add_event(ev_id, suffix, _str_or_none(row[1]))
                    for name, value in zip(cols, row[2:]):
                        if value is not None:
                            buffers.add_event_attr(ev_id, name, str(value))
                buffers.flush()
            step += 1
            report(0.5 * step / n_steps, "Reading events")

        cur.execute("SELECT ocel_event_id, ocel_object_id, ocel_qualifier FROM event_object")
        while True:
            rows = cur.fetchmany(BATCH_SIZE)
            if not rows:
                break
            for ev_id, obj_id, qualifier in rows:
                buffers.add_event_object(_str_or_none(ev_id), _str_or_none(obj_id), _str_or_none(qualifier))
            buffers.flush()
        step += 1
        report(0.5 * step / n_steps, "Reading event-object relations")

        cur.execute("""
            SELECT o.ocel_id, omt.ocel_type_map
            FROM object o
            JOIN object_map_type omt ON o.ocel_type = omt.ocel_type
        """)
        while True:
            rows = cur.fetchmany(BATCH_SIZE)
            if not rows:
                break
            for obj_id, obj_type in rows:
                buffers.add_object(_str_or_none(obj_id), _str_or_none(obj_type))
            buffers.flush()

        for _ocel_type, suffix, cols in object_types:
            if not cols:
                continue
            col_sql = "".join(f', "{c}"' for c in cols)
            cur.execute(f'SELECT ocel_id, ocel_time{col_sql} FROM "object_{suffix}"')
            while True:
                rows = cur.fetchmany(BATCH_SIZE)
                if not rows:
                    break
                for row in rows:
                    obj_id, ts_raw = _str_or_none(row[0]), _str_or_none(row[1])
                    for name, value in zip(cols, row[2:]):
                        if value is not None:
                            buffers.add_object_attr(obj_id, ts_raw, name, str(value))
                buffers.flush()
            step += 1
            report(0.5 * step / n_steps, "Reading objects")

        try:
            cur.execute("SELECT ocel_source_id, ocel_target_id, ocel_qualifier FROM object_object")
        except sqlite3.OperationalError:
            cur = None  # table may not exist in all OCEL files
        while cur is not None:
            rows = cur.fetchmany(BATCH_SIZE)
            if not rows:
                break
            for src, tgt, qualifier in rows:
                buffers.add_o2o(_str_or_none(src), _str_or_none(tgt), _str_or_none(qualifier))
            buffers.flush()
        buffers.flush()
        report(0.5, "Reading object relations")
    finally:
        con.close()


# ---------------------------------------------------------------------------
# JSON
# ---------------------------------------------------------------------------

_JSON_COLUMNS = (
    "{'events': 'STRUCT(id VARCHAR, type VARCHAR, time VARCHAR, "
    "attributes STRUCT(name VARCHAR, value JSON)[], "
    "relationships STRUCT(objectId VARCHAR, qualifier VARCHAR)[])[]', "
    "'objects': 'STRUCT(id VARCHAR, type VARCHAR, "
    "attributes STRUCT(name VARCHAR, time VARCHAR, value JSON)[], "
    "relationships STRUCT(objectId VARCHAR, qualifier VARCHAR)[])[]'}"
)

# Renders a JSON attribute value the way Python's ``str()`` renders the
# decoded value (``True``/``False`` for booleans, raw text otherwise).
_JSON_VALUE_SQL = (
    "CASE json_type({v}) WHEN 'NULL' THEN NULL "
    "WHEN 'BOOLEAN' THEN (CASE WHEN {v}::VARCHAR = 'true' THEN 'True' ELSE 'False' END) "
    "ELSE {v}->>'$' END"
)

# DuckDB's JSON reader takes the object size limit as a 32-bit value.
_JSON_MAX_OBJECT_SIZE = (1 << 32) - 1


def _stage_json(file_path: str, stage: _Staging, report: _Reporter, threshold_mb: float) -> None:
    size = os.path.getsize(file_path)
    if size < threshold_mb * 1024 * 1024 and size + (1 << 20) <= _JSON_MAX_OBJECT_SIZE:
        _stage_json_native(file_path, stage, report)
    else:
        _stage_json_stream(file_path, stage, report)


def _stage_json_native(file_path: str, stage: _Staging, report: _Reporter) -> None:
    """Read the whole document with DuckDB's JSON reader and unnest it."""
    conn = stage.conn
    report(0.05, "Reading JSON")
    size = os.path.getsize(file_path)
    conn.execute(
        f"CREATE TEMP TABLE _raw_json AS SELECT events, objects "
        f"FROM read_json({_sql_str(file_path)}, format='unstructured', "
        f"maximum_object_size={min(size + (1 << 20), _JSON_MAX_OBJECT_SIZE)}, "
        f"columns={_JSON_COLUMNS})"
    )
    try:
        report(0.25, "Reading events")
        base = stage.next_seq_base()
        conn.execute(f"""
            INSERT INTO _src_events (seq, event_id, activity, ts_raw)
            SELECT {base} + i, e.id, e.type, e.time
            FROM (SELECT unnest(events) AS e, generate_subscripts(events, 1) AS i FROM _raw_json)
        """)
        conn.execute(f"""
            INSERT INTO _src_event_attr (event_id, name, value)
            SELECT id, a.name, {_JSON_VALUE_SQL.format(v='a.value')}
            FROM (SELECT e.id AS id, unnest(e.attributes) AS a
                  FROM (SELECT unnest(events) AS e FROM _raw_json))
        """)
        conn.execute("""
            INSERT INTO _src_event_object (event_id, obj_id, qualifier)
            SELECT id, r.objectId, r.qualifier
            FROM (SELECT e.id AS id, unnest(e.relationships) AS r
                  FROM (SELECT unnest(events) AS e FROM _raw_json))
        """)
        report(0.4, "Reading objects")
        base = stage.next_seq_base()
        conn.execute(f"""
            INSERT INTO _src_objects (seq, obj_id, obj_type)
            SELECT {base} + i, o.id, o.type
            FROM (SELECT unnest(objects) AS o, generate_subscripts(objects, 1) AS i FROM _raw_json)
        """)
        base = stage.next_seq_base()
        conn.execute(f"""
            INSERT INTO _src_obj_attr (seq, obj_id, ts_raw, name, value)
            SELECT {base} + i * {_SEQ_STRIDE >> 8} + j, id, a.time, a.name,
                   {_JSON_VALUE_SQL.format(v='a.value')}
            FROM (SELECT o.id AS id, i, unnest(o.attributes) AS a,
                         generate_subscripts(o.attributes, 1) AS j
                  FROM (SELECT unnest(objects) AS o, generate_subscripts(objects, 1) AS i
                        FROM _raw_json))
        """)
        conn.execute("""
            INSERT INTO _src_o2o (source_obj_id, target_obj_id, qualifier)
            SELECT id, r.objectId, r.qualifier
            FROM (SELECT o.id AS id, unnest(o.relationships) AS r
                  FROM (SELECT unnest(objects) AS o FROM _raw_json))
        """)
        report(0.5, "Reading object relations")
    finally:
        conn.execute("DROP TABLE IF EXISTS _raw_json")


class _FileProgress:
    """Reports a reader's position in the file as a fraction of its size."""

    def __init__(self, handle, size: int, report: _Reporter, lo: float, hi: float, label: str):
        self._handle = handle
        self._size = max(1, size)
        self._report = report
        self._lo, self._hi = lo, hi
        self._label = label

    def __call__(self) -> None:
        if not self._report.enabled:
            return
        try:
            frac = self._handle.tell() / self._size
        except (OSError, ValueError):
            return
        self._report(self._lo + (self._hi - self._lo) * min(1.0, frac), self._label)


def _stage_json_stream(file_path: str, stage: _Staging, report: _Reporter) -> None:
    """Stream the document with ijson in Arrow batches (bounded memory)."""
    buffers = _RowBuffers(stage)
    size = os.path.getsize(file_path)

    with open(file_path, "rb") as f:
        tick = _FileProgress(f, size, report, 0.0, 0.25, "Reading events")
        for ev in ijson.items(f, "events.item", use_float=True):
            ev_id = ev.get("id", "")
            buffers.add_event(ev_id, ev.get("type", ""), ev.get("time", ""))
            for attr in ev.get("attributes") or []:
                name = attr.get("name")
                value = attr.get("value")
                if name and value is not None:
                    buffers.add_event_attr(ev_id, name, str(value))
            for rel in ev.get("relationships") or []:
                obj_id = rel.get("objectId")
                if obj_id:
                    buffers.add_event_object(ev_id, obj_id, rel.get("qualifier"))
            if len(buffers.ev_id) >= BATCH_SIZE:
                buffers.flush()
                tick()
        buffers.flush()

    with open(file_path, "rb") as f:
        tick = _FileProgress(f, size, report, 0.25, 0.5, "Reading objects")
        for obj in ijson.items(f, "objects.item", use_float=True):
            obj_id = obj.get("id", "")
            buffers.add_object(obj_id, obj.get("type", ""))
            for attr in obj.get("attributes") or []:
                name = attr.get("name")
                value = attr.get("value")
                if name and value is not None:
                    buffers.add_object_attr(obj_id, attr.get("time", ""), name, str(value))
            for rel in obj.get("relationships") or []:
                tgt = rel.get("objectId")
                if tgt:
                    buffers.add_o2o(obj_id, tgt, rel.get("qualifier"))
            if len(buffers.ob_id) >= BATCH_SIZE:
                buffers.flush()
                tick()
        buffers.flush()
    report(0.5, "Reading objects")


# ---------------------------------------------------------------------------
# XML (ET.iterparse streaming)
# ---------------------------------------------------------------------------

def _xml_attribute_elements(elem: ET.Element) -> list[ET.Element]:
    return [*elem.findall("attribute"), *elem.findall("attributes/attribute")]


def _xml_attr_value(elem: ET.Element) -> str | None:
    value = elem.get("value")
    if value is not None:
        return value
    text = elem.text.strip() if elem.text else ""
    return text or None


def _stage_xml(file_path: str, stage: _Staging, report: _Reporter, _threshold) -> None:
    buffers = _RowBuffers(stage)
    size = os.path.getsize(file_path)

    in_top_events = in_top_objects = in_event = in_object = False
    cur_event: dict = {}
    cur_obj: dict = {}

    with open(file_path, "rb") as f:
        tick = _FileProgress(f, size, report, 0.0, 0.5, "Reading XML")
        for ev, elem in ET.iterparse(f, events=("start", "end")):
            if ev == "start":
                if elem.tag == "events" and not in_event and not in_object:
                    in_top_events = True
                elif elem.tag == "objects" and not in_event and not in_object:
                    in_top_objects = True
                elif elem.tag == "event" and in_top_events:
                    in_event = True
                    cur_event = {
                        "id": elem.get("id", ""),
                        "type": elem.get("type", ""),
                        "time": elem.get("time", ""),
                        "attrs": [],
                        "rels": [],
                    }
                elif elem.tag == "object" and in_top_objects:
                    in_object = True
                    cur_obj = {
                        "id": elem.get("id", ""),
                        "type": elem.get("type", ""),
                        "attrs": [],
                        "rels": [],
                    }
                continue

            # "end" events
            if elem.tag == "events":
                in_top_events = False
            elif elem.tag == "objects" and not in_event and not in_object:
                in_top_objects = False
            elif elem.tag == "attribute":
                value = _xml_attr_value(elem)
                name = elem.get("name")
                if value is not None and name:
                    if in_event:
                        cur_event["attrs"].append((name, value))
                    elif in_object:
                        cur_obj["attrs"].append((name, value, elem.get("time") or ""))
            elif elem.tag in ("relationship", "relobj"):
                oid = elem.get("object-id")
                if oid:
                    if in_event:
                        cur_event["rels"].append(
                            (oid, elem.get("qualifier") or elem.get("relationship"))
                        )
                    elif in_object:
                        cur_obj["rels"].append((oid, elem.get("qualifier")))
            elif elem.tag == "event":
                in_event = False
                ev_id = cur_event["id"]
                buffers.add_event(ev_id, cur_event["type"], cur_event["time"])
                for name, value in cur_event["attrs"]:
                    buffers.add_event_attr(ev_id, name, value)
                for oid, qualifier in cur_event["rels"]:
                    buffers.add_event_object(ev_id, oid, qualifier)
                if len(buffers.ev_id) >= BATCH_SIZE:
                    buffers.flush()
                    tick()
            elif elem.tag == "object":
                in_object = False
                obj_id = cur_obj["id"]
                buffers.add_object(obj_id, cur_obj["type"])
                for name, value, ts_raw in cur_obj["attrs"]:
                    buffers.add_object_attr(obj_id, ts_raw, name, value)
                for tgt, qualifier in cur_obj["rels"]:
                    buffers.add_o2o(obj_id, tgt, qualifier)
                if len(buffers.ob_id) >= BATCH_SIZE:
                    buffers.flush()
                    tick()
            elem.clear()

    buffers.flush()
    report(0.5, "Reading XML")


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------

def _parse_obj_cell(cell: str) -> list[tuple[str, str | None]]:
    """Parse 'id[#qualifier][{json}]' cells, '/' separated."""
    results = []
    for part in cell.split("/"):
        part = part.strip()
        if not part:
            continue
        brace = part.find("{")
        if brace != -1:
            part = part[:brace].strip()
        if "#" in part:
            obj_id, qualifier = part.split("#", 1)
            results.append((obj_id.strip(), qualifier.strip() or None))
        else:
            results.append((part, None))
    return results


def _stage_csv(file_path: str, stage: _Staging, report: _Reporter, _threshold) -> None:
    buffers = _RowBuffers(stage)
    size = os.path.getsize(file_path)
    seen_objs: dict[str, str] = {}  # obj_id → obj_type, in first-seen order

    # utf-8-sig strips the UTF-8 BOM (U+FEFF) that some tools add to CSV files
    with open(file_path, newline="", encoding="utf-8-sig") as f:
        tick = _FileProgress(f, size, report, 0.0, 0.5, "Reading CSV")
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        ot_cols = [c for c in fieldnames if c.startswith("ot:")]
        ea_cols = [c for c in fieldnames if c.startswith("ea:")]

        for row in reader:
            row_id = (row.get("id") or "").strip()
            activity = (row.get("activity") or "").strip()
            is_o2o = activity == "o2o"
            is_event = bool(activity) and not is_o2o

            if is_event:
                buffers.add_event(row_id, activity, (row.get("timestamp") or "").strip())
                for col in ea_cols:
                    value = (row.get(col) or "").strip()
                    if value:
                        buffers.add_event_attr(row_id, col[3:], value)
                for ot_col in ot_cols:
                    obj_type = ot_col[3:]
                    for obj_id, qualifier in _parse_obj_cell((row.get(ot_col) or "").strip()):
                        seen_objs.setdefault(obj_id, obj_type)
                        buffers.add_event_object(row_id, obj_id, qualifier)
            elif is_o2o:
                for ot_col in ot_cols:
                    obj_type = ot_col[3:]
                    for tgt_id, qualifier in _parse_obj_cell((row.get(ot_col) or "").strip()):
                        seen_objs.setdefault(tgt_id, obj_type)
                        buffers.add_o2o(row_id, tgt_id, qualifier)
            else:
                # object attribute update row — register objects
                for ot_col in ot_cols:
                    obj_type = ot_col[3:]
                    for obj_id, _ in _parse_obj_cell((row.get(ot_col) or "").strip()):
                        seen_objs.setdefault(obj_id, obj_type)

            if len(buffers.ev_id) >= BATCH_SIZE:
                buffers.flush()
                tick()

    for obj_id, obj_type in seen_objs.items():
        buffers.add_object(obj_id, obj_type)
        buffers.maybe_flush()
    buffers.flush()
    report(0.5, "Reading CSV")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_ts(ts_str: str | None) -> int:
    """Parse an ISO 8601 timestamp string to Unix epoch seconds. Returns 0 on failure.

    Used as the fallback for the rows DuckDB's own ``TRY_CAST`` rejects.
    """
    if not ts_str:
        return 0
    clean = ts_str.strip()
    try:
        # Normalize Z/z suffix to standard +00:00 offset
        norm = clean
        if norm.endswith("Z") or norm.endswith("z"):
            norm = norm[:-1] + "+00:00"
        dt = datetime.fromisoformat(norm)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except (ValueError, TypeError):
        pass

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
            dt = datetime.strptime(clean, fmt)
            return int(dt.replace(tzinfo=timezone.utc).timestamp())
        except ValueError:
            continue

    # JavaScript `Date.toString()` output, as found in some published OCEL 2.0
    # XML logs: "Thu Jun 15 2023 22:26:12 GMT+0200 (Central European Summer Time)"
    match = _JS_DATE_RE.match(clean)
    if match:
        try:
            dt = datetime.strptime(match.group(1), "%a %b %d %Y %H:%M:%S GMT%z")
            return int(dt.timestamp())
        except ValueError:
            pass
    return 0


__all__ = ["import_ocel_db"]
