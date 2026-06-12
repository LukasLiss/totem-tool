"""
Incremental maintenance of the OC-DFG under event-batch appends.

Instead of recomputing the directly-follows graph from scratch after every
append, IncrementalOCDFG maintains four summary tables inside the OCEL
database:

    inc_dfg_edge   (obj_type, src, tgt, weight)   directly-follows counts
    inc_node_freq  (obj_type, activity, cnt)      node frequencies
    inc_starts     (obj_type, activity, weight)   first-activity counts
    inc_ends       (obj_type, activity, weight)   last-activity counts
    inc_obj_state  (obj_id, ...)                  per-object head/tail state

An append of a batch B touches only the objects referenced by B: new
directly-follows edges arise within B and on the "bridge" between each
touched object's previous last event and its first new event. Maintenance
cost is O(|B| log |B| + touched objects), independent of the log size;
materializing the graph afterwards reads only the aggregate tables.

Requirements (checked when validate=True):
- Appends are ordered: for every object, all new events come after its
  previously seen events in the (timestamp, event_id) order.
- An event arrives together with all of its event-to-object links.
"""

from typing import Optional

import polars as pl

from ..dfg.ocdfg_db import OCDFGDb
from ..ocel.ocel_duckdb import OcelDuckDB


class IncrementalOCDFG:
    def __init__(self, ocel_db: OcelDuckDB, validate: bool = False):
        """
        :param ocel_db: Target database. May be empty or already populated;
                        existing events are summarized once at construction.
        :param validate: Verify the ordered-append requirement on every batch.
        """
        self.db = ocel_db
        self.conn = ocel_db.conn
        self.validate = validate
        self._create_state_tables()
        if not self._state_initialized():
            self._bootstrap()

    # ------------------------------------------------------------------
    # State setup
    # ------------------------------------------------------------------

    def _create_state_tables(self) -> None:
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS inc_dfg_edge (
                obj_type VARCHAR, src VARCHAR, tgt VARCHAR, weight BIGINT,
                PRIMARY KEY (obj_type, src, tgt)
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS inc_node_freq (
                obj_type VARCHAR, activity VARCHAR, cnt BIGINT,
                PRIMARY KEY (obj_type, activity)
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS inc_starts (
                obj_type VARCHAR, activity VARCHAR, weight BIGINT,
                PRIMARY KEY (obj_type, activity)
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS inc_ends (
                obj_type VARCHAR, activity VARCHAR, weight BIGINT,
                PRIMARY KEY (obj_type, activity)
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS inc_obj_state (
                obj_id VARCHAR PRIMARY KEY,
                obj_type VARCHAR,
                first_activity VARCHAR,
                last_activity VARCHAR,
                last_ts BIGINT,
                last_event_id VARCHAR
            )
        """)

    def _state_initialized(self) -> bool:
        n_state = self.conn.execute("SELECT COUNT(*) FROM inc_obj_state").fetchone()[0]
        if n_state > 0:
            return True
        n_links = self.conn.execute("SELECT COUNT(*) FROM event_object").fetchone()[0]
        return n_links == 0

    def _bootstrap(self) -> None:
        """Summarize all events already in the database (one full pass)."""
        self.conn.execute("""
            CREATE TEMP TABLE boot_seq AS
            SELECT
                eo.obj_id,
                o.obj_type,
                e.event_id,
                e.activity,
                e.timestamp_unix AS ts,
                ROW_NUMBER() OVER w AS rn,
                LAG(e.activity) OVER w AS prev_act,
                COUNT(*) OVER (PARTITION BY eo.obj_id) AS n_total
            FROM events e
            JOIN event_object eo ON e.event_id = eo.event_id
            JOIN objects o       ON eo.obj_id  = o.obj_id
            WINDOW w AS (PARTITION BY eo.obj_id ORDER BY e.timestamp_unix, e.event_id)
        """)
        self.conn.execute("""
            INSERT INTO inc_dfg_edge
            SELECT obj_type, prev_act, activity, COUNT(*)
            FROM boot_seq WHERE prev_act IS NOT NULL
            GROUP BY obj_type, prev_act, activity
        """)
        self.conn.execute("""
            INSERT INTO inc_node_freq
            SELECT obj_type, activity, COUNT(*)
            FROM boot_seq GROUP BY obj_type, activity
        """)
        self.conn.execute("""
            INSERT INTO inc_starts
            SELECT obj_type, activity, COUNT(*)
            FROM boot_seq WHERE rn = 1
            GROUP BY obj_type, activity
        """)
        self.conn.execute("""
            INSERT INTO inc_ends
            SELECT obj_type, activity, COUNT(*)
            FROM boot_seq WHERE rn = n_total
            GROUP BY obj_type, activity
        """)
        self.conn.execute("""
            INSERT INTO inc_obj_state
            SELECT f.obj_id, f.obj_type, f.activity, l.activity, l.ts, l.event_id
            FROM (SELECT * FROM boot_seq WHERE rn = 1) f
            JOIN (SELECT * FROM boot_seq WHERE rn = n_total) l USING (obj_id)
        """)
        self.conn.execute("DROP TABLE boot_seq")

    # ------------------------------------------------------------------
    # Append
    # ------------------------------------------------------------------

    def append_batch(
        self,
        events: pl.DataFrame,
        event_object: pl.DataFrame,
        objects: Optional[pl.DataFrame] = None,
        object_relations: Optional[pl.DataFrame] = None,
    ) -> None:
        """
        Append a batch and maintain all summaries.

        :param events: columns event_id, activity, timestamp_unix
        :param event_object: columns event_id, obj_id, qualifier
        :param objects: new objects; columns obj_id, obj_type
        :param object_relations: columns source_obj_id, target_obj_id, qualifier
        """
        conn = self.conn
        conn.register("batch_events", events)
        conn.register("batch_eo", event_object)

        if objects is not None and len(objects) > 0:
            conn.register("batch_objects", objects)
            conn.execute("""
                INSERT INTO objects (obj_id, obj_type)
                SELECT obj_id, obj_type FROM batch_objects
            """)
            conn.unregister("batch_objects")
        conn.execute("""
            INSERT INTO events (event_id, activity, timestamp_unix)
            SELECT event_id, activity, timestamp_unix FROM batch_events
        """)
        conn.execute("""
            INSERT INTO event_object (event_id, obj_id, qualifier)
            SELECT event_id, obj_id, qualifier FROM batch_eo
        """)
        if object_relations is not None and len(object_relations) > 0:
            conn.register("batch_o2o", object_relations)
            conn.execute("""
                INSERT INTO object_relations (source_obj_id, target_obj_id, qualifier)
                SELECT source_obj_id, target_obj_id, qualifier FROM batch_o2o
                ON CONFLICT DO NOTHING
            """)
            conn.unregister("batch_o2o")

        conn.execute("""
            CREATE TEMP TABLE delta_seq AS
            SELECT
                eo.obj_id,
                o.obj_type,
                e.event_id,
                e.activity,
                e.timestamp_unix AS ts,
                ROW_NUMBER() OVER w AS rn,
                LAG(e.activity) OVER w AS prev_act,
                COUNT(*) OVER (PARTITION BY eo.obj_id) AS n_new
            FROM batch_events e
            JOIN batch_eo eo ON e.event_id = eo.event_id
            JOIN objects o   ON eo.obj_id  = o.obj_id
            WINDOW w AS (PARTITION BY eo.obj_id ORDER BY e.timestamp_unix, e.event_id)
        """)

        if self.validate:
            violations = conn.execute("""
                SELECT COUNT(*)
                FROM delta_seq d
                JOIN inc_obj_state s ON d.obj_id = s.obj_id
                WHERE d.rn = 1
                  AND (d.ts < s.last_ts
                       OR (d.ts = s.last_ts AND d.event_id <= s.last_event_id))
            """).fetchone()[0]
            if violations:
                conn.execute("DROP TABLE delta_seq")
                raise ValueError(
                    f"Out-of-order append: {violations} objects received events "
                    "before their previously seen last event"
                )

        # Directly-follows edges inside the batch.
        conn.execute("""
            INSERT INTO inc_dfg_edge
            SELECT obj_type, prev_act, activity, COUNT(*)
            FROM delta_seq WHERE prev_act IS NOT NULL
            GROUP BY obj_type, prev_act, activity
            ON CONFLICT (obj_type, src, tgt)
            DO UPDATE SET weight = weight + EXCLUDED.weight
        """)
        # Bridge edges from each known object's previous last event.
        conn.execute("""
            INSERT INTO inc_dfg_edge
            SELECT s.obj_type, s.last_activity, d.activity, COUNT(*)
            FROM delta_seq d
            JOIN inc_obj_state s ON d.obj_id = s.obj_id
            WHERE d.rn = 1
            GROUP BY s.obj_type, s.last_activity, d.activity
            ON CONFLICT (obj_type, src, tgt)
            DO UPDATE SET weight = weight + EXCLUDED.weight
        """)
        conn.execute("""
            INSERT INTO inc_node_freq
            SELECT obj_type, activity, COUNT(*)
            FROM delta_seq GROUP BY obj_type, activity
            ON CONFLICT (obj_type, activity)
            DO UPDATE SET cnt = cnt + EXCLUDED.cnt
        """)
        # Start counts: only objects never seen before contribute.
        conn.execute("""
            INSERT INTO inc_starts
            SELECT d.obj_type, d.activity, COUNT(*)
            FROM delta_seq d
            LEFT JOIN inc_obj_state s ON d.obj_id = s.obj_id
            WHERE d.rn = 1 AND s.obj_id IS NULL
            GROUP BY d.obj_type, d.activity
            ON CONFLICT (obj_type, activity)
            DO UPDATE SET weight = weight + EXCLUDED.weight
        """)
        # End counts: known touched objects lose their old last activity ...
        conn.execute("""
            INSERT INTO inc_ends
            SELECT s.obj_type, s.last_activity, -COUNT(*)
            FROM inc_obj_state s
            JOIN (SELECT DISTINCT obj_id FROM delta_seq) t ON s.obj_id = t.obj_id
            GROUP BY s.obj_type, s.last_activity
            ON CONFLICT (obj_type, activity)
            DO UPDATE SET weight = weight + EXCLUDED.weight
        """)
        # ... and every touched object gains its new last activity.
        conn.execute("""
            INSERT INTO inc_ends
            SELECT obj_type, activity, COUNT(*)
            FROM delta_seq WHERE rn = n_new
            GROUP BY obj_type, activity
            ON CONFLICT (obj_type, activity)
            DO UPDATE SET weight = weight + EXCLUDED.weight
        """)
        # Per-object head/tail state.
        conn.execute("""
            INSERT INTO inc_obj_state
            SELECT f.obj_id, f.obj_type, f.activity, l.activity, l.ts, l.event_id
            FROM (SELECT * FROM delta_seq WHERE rn = 1) f
            JOIN (SELECT * FROM delta_seq WHERE rn = n_new) l USING (obj_id)
            ON CONFLICT (obj_id) DO UPDATE SET
                last_activity = EXCLUDED.last_activity,
                last_ts       = EXCLUDED.last_ts,
                last_event_id = EXCLUDED.last_event_id
        """)

        conn.execute("DROP TABLE delta_seq")
        conn.unregister("batch_events")
        conn.unregister("batch_eo")

    # ------------------------------------------------------------------
    # Materialization
    # ------------------------------------------------------------------

    def get_ocdfg(self) -> OCDFGDb:
        """Materialize the OC-DFG from the summary tables (no event scan)."""
        edges_df = self.conn.execute(
            "SELECT obj_type, src, tgt, weight FROM inc_dfg_edge WHERE weight > 0"
        ).pl()
        node_freq_df = self.conn.execute(
            "SELECT obj_type, activity, cnt AS count FROM inc_node_freq WHERE cnt > 0"
        ).pl()
        starts_df = self.conn.execute(
            "SELECT obj_type, activity, weight FROM inc_starts WHERE weight > 0"
        ).pl()
        ends_df = self.conn.execute(
            "SELECT obj_type, activity, weight FROM inc_ends WHERE weight > 0"
        ).pl()
        return OCDFGDb._build_graph(edges_df, node_freq_df, starts_df, ends_df)
