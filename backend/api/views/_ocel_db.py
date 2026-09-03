"""Process-local DuckDB registry and OCEL-loading helpers.

Every API endpoint operates on an in-memory ``OcelDuckDB`` held here for the
lifetime of the worker process. See the concurrency notes on ``_with_ocel_db``.
"""

import os
import threading
import time
from contextlib import contextmanager

from totem_lib.ocel import OcelDuckDB, import_ocel_db
from totem_lib.ocel.validation import OCELValidationException, validate_ocel


def _build_ocel_db_from_path(path: str, strict_mode: bool = False) -> OcelDuckDB:
    """Open an uploaded OCEL file as an `OcelDuckDB`, dispatching on extension."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".duckdb":
        # Read-only: the registry connection only ever reads (algorithms use
        # TEMP tables, which work on read-only connections). A read-write
        # open would be exclusive and conflict with any other opener of the
        # same file — DuckDB then raises "Could not set lock on file" /
        # "Can't open a connection to same database file with a different
        # configuration", which used to surface when several things loaded
        # at once.
        db = OcelDuckDB.load(path, read_only=True)
        if strict_mode:
            errors = validate_ocel(db.conn)
            if errors:
                db.close()
                raise OCELValidationException(errors)
        return db
    if ext in (".sqlite", ".db", ".json", ".xml", ".csv"):
        # `import_ocel_db` infers the format from the extension.
        return import_ocel_db(path, strict_mode=strict_mode)
    raise ValueError(
        f"Unsupported file type: {ext}. "
        "Supported formats: .sqlite, .db, .json, .xml, .csv, .duckdb"
    )


# Module-level process-local registry for OcelDuckDB instances.
#
# We can't use Django's cache here even though LocMemCache is "in-process":
# LocMemCache pickles every value on set() to preserve copy-on-read
# semantics, and `duckdb.DuckDBPyConnection` is a native C handle that
# cannot be pickled. Serializable derived results go through the "results"
# cache instead — see `cache_utils` (get_cached_result/set_cached_result).
#
# Concurrency model — a DuckDB connection is documented as "thread-safe but
# only one thread can execute a query at a time". Worse, our algorithms
# create connection-scoped TEMP TABLEs (e.g. `case_events` in
# `find_variants`), so two concurrent algorithm runs on the same connection
# would corrupt each other's temp state and can SIGSEGV the worker. The
# React dashboard fires four endpoints in parallel on first load, so this
# is not hypothetical.
#
# Solution: every `OcelDuckDB` carries a reentrant `lock`; every view
# acquires it for the duration of its algorithm work via
# `_with_ocel_db(user_file)`. Because the lock lives on the instance (not in
# a side table here), totem_lib code that receives the db object can take
# the same lock without importing backend internals, and a consumer that
# already holds it can call helpers that lock again (RLock). Requests for
# different files still run in parallel.
#
# The registry lives for the lifetime of the gunicorn/runserver worker.
# There is no TTL — the connection stays open until the process exits.
_OCEL_DB_REGISTRY: dict[int, OcelDuckDB] = {}
_OCEL_OBJECT_TYPES_REGISTRY: dict[int, tuple[tuple[str, int], ...]] = {}
_OCEL_DB_REGISTRY_LOCK = threading.Lock()  # guards the dicts themselves


def _open_ocel_db_with_retry(path: str) -> OcelDuckDB:
    """Open an OCEL database, retrying briefly on file-lock conflicts.

    A concurrent writer (e.g. an upload conversion finishing, or another
    process holding the file) makes `duckdb.connect` fail immediately.
    Those windows are short, so a few retries turn a user-visible 500 into
    a slightly slower first load. Anything still failing after the retries
    is re-raised with the original message.
    """
    last_error: Exception | None = None
    for _ in range(5):
        try:
            return _build_ocel_db_from_path(path)
        except Exception as exc:  # duckdb.IOException / ConnectionException
            message = str(exc).lower()
            if "lock" in message or "different configuration" in message:
                last_error = exc
                time.sleep(0.2)
                continue
            raise
    raise last_error


def _get_or_load_ocel_db(user_file) -> OcelDuckDB:
    """
    Return the process-local `OcelDuckDB` for this file, loading it on first
    call. **Does NOT acquire the per-file lock** — callers that intend to
    run a query against the connection must use `_with_ocel_db(...)` so
    concurrent requests are serialised. Read-only helpers that only need
    cheap, non-temp-table scalar queries can still call this directly.
    """
    pk = int(user_file.pk)
    db = _OCEL_DB_REGISTRY.get(pk)
    if db is not None:
        return db
    # Double-checked locking so concurrent first-loads only import once.
    with _OCEL_DB_REGISTRY_LOCK:
        db = _OCEL_DB_REGISTRY.get(pk)
        if db is None:
            db = _open_ocel_db_with_retry(user_file.file.path)
            object_types = tuple(
                (row["name"], row["count"]) for row in _object_types_with_counts(db)
            )
            _OCEL_DB_REGISTRY[pk] = db
            _OCEL_OBJECT_TYPES_REGISTRY[pk] = object_types
    return db


def _get_ocel_object_types(user_file) -> list[dict]:
    """Return immutable log metadata without waiting for algorithm work.

    Entries are ``{"name": <object type>, "count": <object count>}`` dicts;
    the counts are computed once when the log is first loaded, so serving
    them never has to wait for the per-file algorithm lock.
    """
    pk = int(user_file.pk)
    object_types = _OCEL_OBJECT_TYPES_REGISTRY.get(pk)
    if object_types is None:
        _get_or_load_ocel_db(user_file)
        object_types = _OCEL_OBJECT_TYPES_REGISTRY[pk]
    return [{"name": name, "count": count} for name, count in object_types]


@contextmanager
def _with_ocel_db(user_file):
    """
    Context manager that yields a loaded `OcelDuckDB` with the per-file lock
    held. Every view that runs an algorithm on the connection must use this
    so DuckDB never executes two queries on the same connection in parallel.

    Usage::

        with _with_ocel_db(user_file) as db:
            totem = totemDiscovery_db(db)
    """
    db = _get_or_load_ocel_db(user_file)
    with db.lock:
        yield db


@contextmanager
def _filter_shadow(db, fp):
    """Context manager: temporarily shadow events/event_object/objects with
    filtered subsets so library functions work on filtered data without
    modification.  DuckDB searches the temp schema before main, so any
    unqualified SELECT against those tables uses the temp versions.

    The shadow is always torn down on exit — even if an exception occurs —
    because the DuckDB connection is persistent and shared across requests.

    Accepts the ``OcelDuckDB`` (not its connection) and only touches
    ``db.conn`` once a filter is actually active, so an unfiltered request
    never needs a live connection.
    """
    has_filter = any(k in fp for k in ("after", "before", "activities", "object_types"))
    if not has_filter:
        yield
        return

    conn = db.conn

    # Event-level predicates (time window / activity set). These decide which
    # *events* survive and are independent of the object-type predicate.
    event_conditions, event_params = [], []
    if "after" in fp:
        event_conditions.append("e.timestamp_unix >= ?")
        event_params.append(fp["after"])
    if "before" in fp:
        event_conditions.append("e.timestamp_unix <= ?")
        event_params.append(fp["before"])
    if "activities" in fp:
        placeholders = ",".join("?" for _ in fp["activities"])
        event_conditions.append(f"e.activity IN ({placeholders})")
        event_params.extend(fp["activities"])

    # Order matters. Objects are filtered *by type directly*, then the relation
    # is narrowed to the surviving objects, then events to the relation.
    # Deriving objects from events (the reverse) silently re-admits a removed
    # type whenever one of its objects shares an event with a kept type — in an
    # OCEL that is almost always the case, so the removed type never disappears.
    if "object_types" in fp:
        placeholders = ",".join("?" for _ in fp["object_types"])
        conn.execute(
            f"""
            CREATE OR REPLACE TEMP TABLE objects AS
            SELECT * FROM main.objects WHERE obj_type IN ({placeholders})
            """,
            list(fp["object_types"]),
        )
    else:
        conn.execute(
            "CREATE OR REPLACE TEMP TABLE objects AS SELECT * FROM main.objects"
        )

    conn.execute("""
        CREATE OR REPLACE TEMP TABLE event_object AS
        SELECT eo.* FROM main.event_object eo
        WHERE eo.obj_id IN (SELECT obj_id FROM objects)
    """)

    # An event survives if it passes the event-level predicates *and* still has
    # at least one surviving object relation: an event stripped of all its
    # objects carries no object-centric information.
    event_where = (
        f"WHERE {' AND '.join(event_conditions)} AND" if event_conditions else "WHERE"
    )
    conn.execute(
        f"""
        CREATE OR REPLACE TEMP TABLE events AS
        SELECT e.* FROM main.events e
        {event_where} e.event_id IN (SELECT event_id FROM event_object)
        """,
        event_params,
    )

    # Re-narrow the relation and the objects: the event-level predicates may
    # have dropped events that `event_object` still references, and objects may
    # be left with no relation at all.
    if event_conditions:
        conn.execute("""
            CREATE OR REPLACE TEMP TABLE event_object AS
            SELECT eo.* FROM event_object eo
            WHERE eo.event_id IN (SELECT event_id FROM events)
        """)
        conn.execute("""
            CREATE OR REPLACE TEMP TABLE objects AS
            SELECT o.* FROM objects o
            WHERE o.obj_id IN (SELECT obj_id FROM event_object)
        """)

    # `CREATE TABLE AS` copies no indexes, so every unqualified query in the
    # algorithms would scan the shadows linearly — the opposite of the speed-up
    # a filter is meant to buy. Mirror the indexes `ocel_duckdb` puts on main.
    for stmt in (
        "CREATE INDEX idx_shadow_eo_obj ON event_object(obj_id)",
        "CREATE INDEX idx_shadow_eo_ev ON event_object(event_id)",
        "CREATE INDEX idx_shadow_obj_type ON objects(obj_type)",
        "CREATE INDEX idx_shadow_obj_id ON objects(obj_id)",
        "CREATE INDEX idx_shadow_ev_ts ON events(timestamp_unix)",
        "CREATE INDEX idx_shadow_ev_id ON events(event_id)",
    ):
        try:
            conn.execute(stmt)
        except Exception:
            pass

    try:
        yield
    finally:
        for tbl in ("objects", "event_object", "events"):
            try:
                conn.execute(f"DROP TABLE IF EXISTS {tbl}")
            except Exception:
                pass


def _object_types(db: OcelDuckDB) -> list[str]:
    """Distinct object types in the log (sorted, frontend-friendly)."""
    return sorted(
        r[0]
        for r in db.conn.execute("SELECT DISTINCT obj_type FROM objects").fetchall()
    )


def _object_types_with_counts(db: OcelDuckDB) -> list[dict]:
    """Object types with per-type object counts, sorted by name."""
    return [
        {"name": r[0], "count": r[1]}
        for r in db.conn.execute(
            "SELECT obj_type, COUNT(*) FROM objects GROUP BY obj_type ORDER BY obj_type"
        ).fetchall()
    ]


def _activities_with_counts(db: OcelDuckDB) -> list[dict]:
    """Activity names with per-activity event counts, sorted by name."""
    return [
        {"name": r[0], "count": r[1]}
        for r in db.conn.execute(
            "SELECT activity, COUNT(*) FROM events GROUP BY activity ORDER BY activity"
        ).fetchall()
    ]
