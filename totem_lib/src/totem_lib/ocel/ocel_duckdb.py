import json
import os
import duckdb
import polars as pl
from typing import List, Tuple

from .ocel import ObjectCentricEventLog


def create_ocel_schema(
    conn: duckdb.DuckDBPyConnection,
    event_attr_cols: List[str],
    obj_attr_cols: List[str],
) -> None:
    """
    Create all OCEL tables and indexes in an existing DuckDB connection.

    Extracted as a module-level function so both OcelDuckDB (constructed from
    an ObjectCentricEventLog) and import_ocel_db (streaming importer) can share
    the same DDL without duplicating it.

    All attribute columns are typed VARCHAR; cast to numeric types in queries
    when needed (e.g. cost::DOUBLE).
    """
    event_attr_defs = "".join(f',\n    "{c}" VARCHAR' for c in event_attr_cols)
    obj_attr_defs = "".join(f',\n    "{c}" VARCHAR' for c in obj_attr_cols)

    conn.execute(f"""
        CREATE TABLE events (
            event_id       VARCHAR PRIMARY KEY,
            activity       VARCHAR NOT NULL,
            timestamp_unix BIGINT  NOT NULL
            {event_attr_defs}
        )
    """)

    conn.execute(f"""
        CREATE TABLE objects (
            obj_id   VARCHAR PRIMARY KEY,
            obj_type VARCHAR NOT NULL
            {obj_attr_defs}
        )
    """)

    conn.execute("""
        CREATE TABLE event_object (
            event_id  VARCHAR NOT NULL,
            obj_id    VARCHAR NOT NULL,
            qualifier VARCHAR,
            PRIMARY KEY (event_id, obj_id)
        )
    """)

    conn.execute(f"""
        CREATE TABLE object_attribute_history (
            obj_id         VARCHAR NOT NULL,
            timestamp_unix BIGINT  NOT NULL{obj_attr_defs},
            PRIMARY KEY (obj_id, timestamp_unix)
        )
    """)

    conn.execute("""
        CREATE TABLE object_relations (
            source_obj_id VARCHAR NOT NULL,
            target_obj_id VARCHAR NOT NULL,
            qualifier     VARCHAR,
            PRIMARY KEY (source_obj_id, target_obj_id)
        )
    """)

    conn.execute("CREATE INDEX idx_event_object_obj ON event_object(obj_id)")
    conn.execute("CREATE INDEX idx_event_object_ev  ON event_object(event_id)")
    conn.execute("CREATE INDEX idx_objects_type     ON objects(obj_type)")
    conn.execute("CREATE INDEX idx_events_ts        ON events(timestamp_unix)")
    if obj_attr_cols:
        conn.execute(
            "CREATE INDEX idx_obj_hist_obj ON object_attribute_history(obj_id)"
        )


class OcelDuckDB:
    """
    DuckDB-backed representation of an ObjectCentricEventLog.

    Attribute columns are discovered dynamically at import time so that
    users can write plain SQL (SELECT cost FROM events) without JSON
    extraction syntax. All attribute values are stored as VARCHAR; cast
    to numeric types in queries when needed (e.g. cost::DOUBLE).

    Supports both in-memory (':memory:') and on-disk databases.

    Construct via:
    - OcelDuckDB(ocel)              — from an ObjectCentricEventLog in memory
    - import_ocel_db(path)          — streaming direct importer (no Polars intermediate)
    """

    def __init__(self, ocel: ObjectCentricEventLog, path: str = ":memory:"):
        self.conn = duckdb.connect(path)
        self._event_attr_cols, self._obj_attr_cols = self._discover_attributes(ocel)
        create_ocel_schema(self.conn, self._event_attr_cols, self._obj_attr_cols)
        self._populate(ocel)

    @classmethod
    def _from_prepared_connection(
        cls,
        conn: duckdb.DuckDBPyConnection,
        event_attr_cols: List[str],
        obj_attr_cols: List[str],
    ) -> "OcelDuckDB":
        """
        Wrap an already-populated DuckDB connection as an OcelDuckDB instance.
        Used by the streaming importer after it has created the schema and
        loaded all data without going through an ObjectCentricEventLog.
        """
        instance = cls.__new__(cls)
        instance.conn = conn
        instance._event_attr_cols = event_attr_cols
        instance._obj_attr_cols = obj_attr_cols
        return instance

    # ------------------------------------------------------------------
    # Schema setup (OCEL path)
    # ------------------------------------------------------------------

    def _discover_attributes(
        self, ocel: ObjectCentricEventLog
    ) -> Tuple[List[str], List[str]]:
        """First pass over the OCEL to collect all attribute key names."""
        event_attr_cols: set[str] = set()
        if "_attributes" in ocel.events.columns:
            for (attrs_json,) in ocel.events.select("_attributes").iter_rows():
                if attrs_json:
                    try:
                        event_attr_cols.update(json.loads(attrs_json).keys())
                    except json.JSONDecodeError:
                        pass

        obj_attr_cols: set[str] = set()
        for (attrs_json,) in ocel.object_attributes.select(
            "_jsonObjAttributes"
        ).iter_rows():
            if attrs_json:
                try:
                    obj_attr_cols.update(json.loads(attrs_json).keys())
                except json.JSONDecodeError:
                    pass

        return sorted(event_attr_cols), sorted(obj_attr_cols)

    # ------------------------------------------------------------------
    # Data population (OCEL path)
    # ------------------------------------------------------------------

    def _populate(self, ocel: ObjectCentricEventLog) -> None:
        """Populate all tables from the OCEL DataFrames."""
        self._insert_events(ocel)
        self._insert_objects(ocel)
        self._insert_object_relations(ocel)

    def _insert_events(self, ocel: ObjectCentricEventLog) -> None:
        event_rows: list[tuple] = []
        event_object_rows: list[tuple] = []

        n_event_cols = 3 + len(self._event_attr_cols)
        event_ph = ", ".join(["?"] * n_event_cols)

        has_event_attrs = "_attributes" in ocel.events.columns
        for row in ocel.events.iter_rows(named=True):
            attrs: dict = {}
            if has_event_attrs and row.get("_attributes"):
                try:
                    attrs = json.loads(row["_attributes"])
                except json.JSONDecodeError:
                    pass

            event_row: list = [row["_eventId"], row["_activity"], row["_timestampUnix"]]
            for col in self._event_attr_cols:
                val = attrs.get(col)
                event_row.append(str(val) if val is not None else None)
            event_rows.append(tuple(event_row))

            objects: list[str] = row["_objects"] or []
            qualifiers: list[str | None] = list(row["_qualifiers"] or [])
            while len(qualifiers) < len(objects):
                qualifiers.append(None)
            for obj_id, qualifier in zip(objects, qualifiers):
                event_object_rows.append((row["_eventId"], obj_id, qualifier or None))

        self.conn.executemany(f"INSERT INTO events VALUES ({event_ph})", event_rows)
        self.conn.executemany(
            "INSERT INTO event_object VALUES (?, ?, ?)", event_object_rows
        )

    def _insert_objects(self, ocel: ObjectCentricEventLog) -> None:
        obj_snapshots: dict[str, list[tuple[int, dict]]] = {}
        for row in ocel.object_attributes.sort("_timestampUnix").iter_rows(named=True):
            obj_id = row["_objId"]
            attrs: dict = {}
            if row["_jsonObjAttributes"]:
                try:
                    attrs = json.loads(row["_jsonObjAttributes"])
                except json.JSONDecodeError:
                    pass
            obj_snapshots.setdefault(obj_id, []).append((row["_timestampUnix"], attrs))

        def latest_attrs(obj_id: str) -> dict:
            merged: dict = {}
            for _, attrs in obj_snapshots.get(obj_id, []):
                merged.update(attrs)
            return merged

        n_obj_cols = 2 + len(self._obj_attr_cols)
        obj_ph = ", ".join(["?"] * n_obj_cols)

        obj_rows: list[tuple] = []
        for row in ocel.objects.iter_rows(named=True):
            obj_id = row["_objId"]
            latest = latest_attrs(obj_id)
            obj_row: list = [obj_id, row["_objType"]]
            for col in self._obj_attr_cols:
                val = latest.get(col)
                obj_row.append(str(val) if val is not None else None)
            obj_rows.append(tuple(obj_row))

        self.conn.executemany(f"INSERT INTO objects VALUES ({obj_ph})", obj_rows)

        if self._obj_attr_cols:
            n_hist_cols = 2 + len(self._obj_attr_cols)
            hist_ph = ", ".join(["?"] * n_hist_cols)
            history_rows: list[tuple] = []
            for obj_id, snapshots in obj_snapshots.items():
                for ts, attrs in snapshots:
                    hist_row: list = [obj_id, ts]
                    for col in self._obj_attr_cols:
                        val = attrs.get(col)
                        hist_row.append(str(val) if val is not None else None)
                    history_rows.append(tuple(hist_row))
            if history_rows:
                self.conn.executemany(
                    f"INSERT INTO object_attribute_history VALUES ({hist_ph})",
                    history_rows,
                )

    def _insert_object_relations(self, ocel: ObjectCentricEventLog) -> None:
        o2o_rows: list[tuple] = []
        for row in ocel.objects.iter_rows(named=True):
            targets: list[str] = row["_targetObjects"] or []
            qualifiers: list[str | None] = list(row["_qualifiers"] or [])
            while len(qualifiers) < len(targets):
                qualifiers.append(None)
            for target, qualifier in zip(targets, qualifiers):
                if target:
                    o2o_rows.append((row["_objId"], target, qualifier or None))
        if o2o_rows:
            self.conn.executemany(
                "INSERT INTO object_relations VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                o2o_rows,
            )

    # ------------------------------------------------------------------
    # Convenience query methods
    # ------------------------------------------------------------------

    def get_object_lifetimes(self) -> pl.DataFrame:
        """
        Returns a DataFrame with the first and last event timestamp per object.

        Replaces the o_min_times / o_max_times hot loop in totem.py.
        """
        return self.conn.execute("""
            SELECT o.obj_id, o.obj_type,
                   MIN(e.timestamp_unix) AS min_time,
                   MAX(e.timestamp_unix) AS max_time
            FROM objects o
            JOIN event_object eo ON o.obj_id    = eo.obj_id
            JOIN events e        ON eo.event_id  = e.event_id
            GROUP BY o.obj_id, o.obj_type
        """).pl()

    def get_co_occurring_pairs(self) -> pl.DataFrame:
        """
        Returns all pairs of object IDs that share at least one event.

        Feed the result into a union-find to compute connected components
        without building the full graph in memory.
        """
        return self.conn.execute("""
            SELECT DISTINCT eo1.obj_id AS obj1, eo2.obj_id AS obj2
            FROM event_object eo1
            JOIN event_object eo2 ON eo1.event_id = eo2.event_id
            WHERE eo1.obj_id < eo2.obj_id
        """).pl()

    def get_temporal_relation_data(self) -> pl.DataFrame:
        """
        Returns object lifetime data for all co-occurring object pairs, grouped by
        type. This is the base data needed to classify temporal relations
        (Dependent, Initiating, Parallel, etc.) in totem.py lines 515-636.
        """
        return self.conn.execute("""
            WITH lifetimes AS (
                SELECT o.obj_id, o.obj_type,
                       MIN(e.timestamp_unix) AS min_time,
                       MAX(e.timestamp_unix) AS max_time
                FROM objects o
                JOIN event_object eo ON o.obj_id    = eo.obj_id
                JOIN events e        ON eo.event_id  = e.event_id
                GROUP BY o.obj_id, o.obj_type
            ),
            co_occurring AS (
                SELECT DISTINCT eo1.obj_id AS src_obj, eo2.obj_id AS tgt_obj
                FROM event_object eo1
                JOIN event_object eo2 ON eo1.event_id = eo2.event_id
                WHERE eo1.obj_id <> eo2.obj_id
            )
            SELECT ls.obj_type AS type_source, lt.obj_type AS type_target,
                   ls.obj_id   AS src_obj,     lt.obj_id   AS tgt_obj,
                   ls.min_time AS src_min,      ls.max_time AS src_max,
                   lt.min_time AS tgt_min,      lt.max_time AS tgt_max
            FROM co_occurring c
            JOIN lifetimes ls ON c.src_obj = ls.obj_id
            JOIN lifetimes lt ON c.tgt_obj = lt.obj_id
        """).pl()

    def get_events_with_objects(self) -> pl.DataFrame:
        """
        Returns a flat table of events joined with their objects and object types.

        Replaces the per-event loop + per-type lookups in totem.py lines 374-414.
        """
        return self.conn.execute("""
            SELECT e.event_id, e.activity, e.timestamp_unix,
                   o.obj_id,  o.obj_type, eo.qualifier
            FROM events e
            JOIN event_object eo ON e.event_id  = eo.event_id
            JOIN objects o       ON eo.obj_id   = o.obj_id
            ORDER BY e.timestamp_unix
        """).pl()

    def query(self, sql: str) -> pl.DataFrame:
        """Execute an arbitrary SQL query and return a Polars DataFrame."""
        return self.conn.execute(sql).pl()

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save(self, db_path: str) -> None:
        """
        Save this database to a native DuckDB file for fast reloading.

        Use this when the database was created in-memory (the default). If you
        already passed db_path= to import_ocel_db(), the file is already on disk
        and no explicit save is needed.

        Reload later with OcelDuckDB.load(db_path) — opening an existing DuckDB
        file is essentially instantaneous compared to re-parsing the original OCEL
        source.

        Args:
            db_path: Destination file path, e.g. 'my_log.duckdb'.

        Raises:
            FileExistsError: If db_path already exists. Delete the file first or
                             choose a different path.
        """
        if os.path.exists(db_path):
            raise FileExistsError(
                f"'{db_path}' already exists. Delete it first or choose a different path."
            )
        self.conn.execute(f"ATTACH '{db_path}' AS _save_dest")
        for table in (
            "events",
            "objects",
            "event_object",
            "object_relations",
            "object_attribute_history",
        ):
            self.conn.execute(
                f"CREATE TABLE _save_dest.{table} AS SELECT * FROM {table}"
            )
        self.conn.execute("DETACH _save_dest")

    @classmethod
    def load(cls, db_path: str) -> "OcelDuckDB":
        """
        Load a previously saved OcelDuckDB from a native DuckDB file.

        This is orders of magnitude faster than re-parsing the original OCEL
        source because the data is already structured and indexed — opening the
        file is essentially just a file handle and memory-map operation.

        Typical workflow::

            # First run — slow (full parse + save)
            db = import_ocel_db("big_log.sqlite")
            db.save("big_log.duckdb")
            db.close()

            # Every subsequent run — fast
            db = OcelDuckDB.load("big_log.duckdb")

        Args:
            db_path: Path to a .duckdb file previously created by save() or by
                     passing db_path= to import_ocel_db().

        Returns:
            OcelDuckDB instance backed by the on-disk database.
        """
        conn = duckdb.connect(db_path)
        fixed_event = {"event_id", "activity", "timestamp_unix"}
        fixed_obj   = {"obj_id", "obj_type"}
        event_cols = [
            r[0] for r in conn.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'events' ORDER BY ordinal_position"
            ).fetchall()
        ]
        obj_cols = [
            r[0] for r in conn.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'objects' ORDER BY ordinal_position"
            ).fetchall()
        ]
        event_attr_cols = sorted(c for c in event_cols if c not in fixed_event)
        obj_attr_cols   = sorted(c for c in obj_cols   if c not in fixed_obj)
        return cls._from_prepared_connection(conn, event_attr_cols, obj_attr_cols)

    # ------------------------------------------------------------------
    # Context manager support
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Close the DuckDB connection."""
        self.conn.close()

    def __enter__(self) -> "OcelDuckDB":
        return self

    def __exit__(self, *_) -> None:
        self.close()
