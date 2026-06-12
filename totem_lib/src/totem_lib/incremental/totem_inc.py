"""
Incremental maintenance of TOTeM summaries under event-batch appends.

totemDiscovery_db derives the TOTeM model from a handful of aggregates over
the raw log: object lifetimes, connected object pairs with their temporal
classification, per-event type-cardinality counters (EC), and per-object
connection counters (LC). All of these can be maintained incrementally:

    inc_lifetimes  (obj_id, obj_type, min_t, max_t)
    inc_pair       (src_obj, tgt_obj, src_type, tgt_type, mask)
    inc_lc         (src_obj, src_type, tgt_type, n)
    inc_ec_pair    (type_source, type_target, n_one, n_many)
    inc_src_totals (obj_type, total)
    inc_act_type   (obj_type, activity)
    inc_type_rel   (t1, t2)

A batch B changes the lifetimes of only the objects it references; the
temporal classification (mask: bit 1 = dependent, 2 = dependent-inverse,
4 = initiating, 8 = initiating-reverse) must be recomputed only for pairs
incident to an object whose lifetime changed, plus newly connected pairs.
EC counters are strictly additive because an event's object links arrive
with the event. refresh() turns the summaries into a Totem object by
aggregating the (much smaller) summary tables — no scan of the event log.

Unlike IncrementalOCDFG, no temporal ordering of appends is required: every
maintained aggregate is order-independent.
"""

from itertools import product
from typing import Optional

import polars as pl

from ..ocel.ocel_duckdb import OcelDuckDB
from ..totem.totem import (
    Totem,
    TR_TOTAL,
    TR_DEPENDENT,
    TR_DEPENDENT_INVERSE,
    TR_INITIATING,
    TR_INITIATING_REVERSE,
    TR_PARALLEL,
    EC_TOTAL,
    EC_ZERO,
    EC_ONE,
    EC_ZERO_ONE,
    EC_MANY,
    EC_ZERO_MANY,
    LC_TOTAL,
    LC_ZERO,
    LC_ONE,
    LC_ZERO_ONE,
    LC_MANY,
    LC_ZERO_MANY,
)
from ..totem.totem_db import build_totem_from_counters

# Classification of a pair of lifetime intervals (ls = source, lt = target)
# into a bitmask. The CASE conditions are identical to the ones in
# totem_db._phase_temporal_relations.
_MASK_EXPR = """
    CAST(
        (CASE WHEN lt.min_t <= ls.min_t AND ls.max_t <= lt.max_t
              THEN 1 ELSE 0 END)
      + (CASE WHEN ls.min_t <= lt.min_t AND lt.max_t <= ls.max_t
              THEN 2 ELSE 0 END)
      + (CASE WHEN (ls.min_t <= ls.max_t AND ls.max_t <= lt.min_t AND lt.min_t <= lt.max_t)
                OR (ls.min_t <  lt.min_t AND lt.min_t <= ls.max_t AND ls.max_t < lt.max_t)
              THEN 4 ELSE 0 END)
      + (CASE WHEN (lt.min_t <= lt.max_t AND lt.max_t <= ls.min_t AND ls.min_t <= ls.max_t)
                OR (lt.min_t <  ls.min_t AND ls.min_t <= lt.max_t AND lt.max_t < ls.max_t)
              THEN 8 ELSE 0 END)
    AS TINYINT)
"""


class IncrementalTotem:
    def __init__(self, ocel_db: OcelDuckDB):
        """
        :param ocel_db: Target database. May be empty or already populated;
                        existing events are summarized once at construction.
        """
        self.db = ocel_db
        self.conn = ocel_db.conn
        self._create_state_tables()
        if not self._state_initialized():
            self._bootstrap()

    # ------------------------------------------------------------------
    # State setup
    # ------------------------------------------------------------------

    def _create_state_tables(self) -> None:
        c = self.conn
        c.execute("""
            CREATE TABLE IF NOT EXISTS inc_lifetimes (
                obj_id VARCHAR PRIMARY KEY, obj_type VARCHAR,
                min_t BIGINT, max_t BIGINT
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS inc_pair (
                src_obj VARCHAR, tgt_obj VARCHAR,
                src_type VARCHAR, tgt_type VARCHAR, mask TINYINT,
                PRIMARY KEY (src_obj, tgt_obj)
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS inc_lc (
                src_obj VARCHAR, src_type VARCHAR, tgt_type VARCHAR, n BIGINT,
                PRIMARY KEY (src_obj, tgt_type)
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS inc_ec_pair (
                type_source VARCHAR, type_target VARCHAR,
                n_one BIGINT, n_many BIGINT,
                PRIMARY KEY (type_source, type_target)
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS inc_src_totals (
                obj_type VARCHAR PRIMARY KEY, total BIGINT
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS inc_act_type (
                obj_type VARCHAR, activity VARCHAR,
                PRIMARY KEY (obj_type, activity)
            )
        """)
        c.execute("""
            CREATE TABLE IF NOT EXISTS inc_type_rel (
                t1 VARCHAR, t2 VARCHAR, PRIMARY KEY (t1, t2)
            )
        """)

    def _state_initialized(self) -> bool:
        n_state = self.conn.execute("SELECT COUNT(*) FROM inc_lifetimes").fetchone()[0]
        if n_state > 0:
            return True
        n_links = self.conn.execute("SELECT COUNT(*) FROM event_object").fetchone()[0]
        return n_links == 0

    def _bootstrap(self) -> None:
        """Summarize all events already in the database (one full pass)."""
        c = self.conn
        c.execute("""
            INSERT INTO inc_lifetimes
            SELECT o.obj_id, o.obj_type,
                   MIN(e.timestamp_unix), MAX(e.timestamp_unix)
            FROM objects o
            JOIN event_object eo ON o.obj_id   = eo.obj_id
            JOIN events e        ON eo.event_id = e.event_id
            GROUP BY o.obj_id, o.obj_type
        """)
        c.execute(f"""
            INSERT INTO inc_pair
            WITH
            e2o_conn AS (
                SELECT eo1.obj_id AS src_obj, eo2.obj_id AS tgt_obj
                FROM event_object eo1
                JOIN event_object eo2 ON eo1.event_id = eo2.event_id
            ),
            o2o_direct AS (
                SELECT source_obj_id AS src_obj, target_obj_id AS tgt_obj
                FROM object_relations
            ),
            all_conn AS (
                SELECT DISTINCT src_obj, tgt_obj FROM e2o_conn
                UNION
                SELECT src_obj, tgt_obj FROM o2o_direct
            )
            SELECT ac.src_obj, ac.tgt_obj, ls.obj_type, lt.obj_type, {_MASK_EXPR}
            FROM all_conn ac
            JOIN inc_lifetimes ls ON ac.src_obj = ls.obj_id
            JOIN inc_lifetimes lt ON ac.tgt_obj = lt.obj_id
        """)
        c.execute("""
            INSERT INTO inc_lc
            SELECT src_obj, src_type, tgt_type, COUNT(*)
            FROM inc_pair
            GROUP BY src_obj, src_type, tgt_type
        """)
        c.execute("""
            INSERT INTO inc_ec_pair
            WITH event_type_counts AS (
                SELECT e.event_id, o.obj_type, COUNT(*) AS n
                FROM events e
                JOIN event_object eo ON e.event_id = eo.event_id
                JOIN objects o       ON eo.obj_id   = o.obj_id
                GROUP BY e.event_id, o.obj_type
            )
            SELECT s.obj_type, t.obj_type,
                   SUM(CASE WHEN t.n = 1 THEN 1 ELSE 0 END),
                   SUM(CASE WHEN t.n > 1 THEN 1 ELSE 0 END)
            FROM event_type_counts s
            JOIN event_type_counts t ON s.event_id = t.event_id
            GROUP BY s.obj_type, t.obj_type
        """)
        c.execute("""
            INSERT INTO inc_src_totals
            SELECT obj_type, COUNT(*)
            FROM (
                SELECT e.event_id, o.obj_type
                FROM events e
                JOIN event_object eo ON e.event_id = eo.event_id
                JOIN objects o       ON eo.obj_id   = o.obj_id
                GROUP BY e.event_id, o.obj_type
            )
            GROUP BY obj_type
        """)
        c.execute("""
            INSERT INTO inc_act_type
            SELECT DISTINCT o.obj_type, e.activity
            FROM events e
            JOIN event_object eo ON e.event_id = eo.event_id
            JOIN objects o       ON eo.obj_id   = o.obj_id
        """)
        c.execute("""
            INSERT INTO inc_type_rel
            SELECT DISTINCT o1.obj_type, o2.obj_type
            FROM event_object eo1
            JOIN event_object eo2 ON eo1.event_id = eo2.event_id
            JOIN objects o1       ON eo1.obj_id    = o1.obj_id
            JOIN objects o2       ON eo2.obj_id    = o2.obj_id
            WHERE o1.obj_type < o2.obj_type
        """)

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

        Assumes an event arrives together with all of its event-to-object
        links and that referenced objects either exist or are part of the
        batch. Appends may arrive in any temporal order.
        """
        conn = self.conn
        conn.register("batch_events", events)
        conn.register("batch_eo", event_object)
        has_o2o = object_relations is not None and len(object_relations) > 0
        if has_o2o:
            conn.register("batch_o2o", object_relations)

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
        if has_o2o:
            conn.execute("""
                INSERT INTO object_relations (source_obj_id, target_obj_id, qualifier)
                SELECT source_obj_id, target_obj_id, qualifier FROM batch_o2o
                ON CONFLICT DO NOTHING
            """)

        # ---- lifetime deltas ------------------------------------------------
        conn.execute("""
            CREATE TEMP TABLE d_touched AS
            WITH d_objstats AS (
                SELECT eo.obj_id, o.obj_type,
                       MIN(e.timestamp_unix) AS min_t,
                       MAX(e.timestamp_unix) AS max_t
                FROM batch_events e
                JOIN batch_eo eo ON e.event_id = eo.event_id
                JOIN objects o   ON eo.obj_id  = o.obj_id
                GROUP BY eo.obj_id, o.obj_type
            )
            SELECT d.obj_id, d.obj_type,
                   (s.obj_id IS NULL) AS is_new,
                   LEAST(d.min_t, COALESCE(s.min_t, d.min_t))    AS new_min,
                   GREATEST(d.max_t, COALESCE(s.max_t, d.max_t)) AS new_max,
                   (s.obj_id IS NULL
                    OR LEAST(d.min_t, s.min_t)    <> s.min_t
                    OR GREATEST(d.max_t, s.max_t) <> s.max_t)    AS changed
            FROM d_objstats d
            LEFT JOIN inc_lifetimes s ON d.obj_id = s.obj_id
        """)
        conn.execute("""
            INSERT INTO inc_lifetimes
            SELECT obj_id, obj_type, new_min, new_max FROM d_touched
            ON CONFLICT (obj_id) DO UPDATE SET
                min_t = EXCLUDED.min_t, max_t = EXCLUDED.max_t
        """)

        # ---- monotone metadata ----------------------------------------------
        conn.execute("""
            INSERT OR IGNORE INTO inc_act_type
            SELECT DISTINCT o.obj_type, e.activity
            FROM batch_events e
            JOIN batch_eo eo ON e.event_id = eo.event_id
            JOIN objects o   ON eo.obj_id  = o.obj_id
        """)
        conn.execute("""
            INSERT OR IGNORE INTO inc_type_rel
            SELECT DISTINCT o1.obj_type, o2.obj_type
            FROM batch_eo a
            JOIN batch_eo b ON a.event_id = b.event_id
            JOIN objects o1 ON a.obj_id = o1.obj_id
            JOIN objects o2 ON b.obj_id = o2.obj_id
            WHERE o1.obj_type < o2.obj_type
        """)

        # ---- event cardinality counters (additive) --------------------------
        conn.execute("""
            CREATE TEMP TABLE d_etc AS
            SELECT e.event_id, o.obj_type, COUNT(*) AS n
            FROM batch_events e
            JOIN batch_eo eo ON e.event_id = eo.event_id
            JOIN objects o   ON eo.obj_id  = o.obj_id
            GROUP BY e.event_id, o.obj_type
        """)
        conn.execute("""
            INSERT INTO inc_src_totals
            SELECT obj_type, COUNT(*) FROM d_etc GROUP BY obj_type
            ON CONFLICT (obj_type) DO UPDATE SET total = total + EXCLUDED.total
        """)
        conn.execute("""
            INSERT INTO inc_ec_pair
            SELECT s.obj_type, t.obj_type,
                   SUM(CASE WHEN t.n = 1 THEN 1 ELSE 0 END),
                   SUM(CASE WHEN t.n > 1 THEN 1 ELSE 0 END)
            FROM d_etc s JOIN d_etc t ON s.event_id = t.event_id
            GROUP BY s.obj_type, t.obj_type
            ON CONFLICT (type_source, type_target) DO UPDATE SET
                n_one = n_one + EXCLUDED.n_one,
                n_many = n_many + EXCLUDED.n_many
        """)

        # ---- pair deltas -----------------------------------------------------
        # Candidates: pairs co-occurring in a batch event, plus object-to-object
        # relations that become effective now (new o2o rows between active
        # objects, or existing o2o rows whose endpoint just became active).
        o2o_cand = ""
        if has_o2o:
            o2o_cand = """
                UNION
                SELECT b.source_obj_id, b.target_obj_id
                FROM batch_o2o b
                JOIN inc_lifetimes ls ON b.source_obj_id = ls.obj_id
                JOIN inc_lifetimes lt ON b.target_obj_id = lt.obj_id
            """
        conn.execute(f"""
            CREATE TEMP TABLE d_cand AS
            SELECT DISTINCT a.obj_id AS src_obj, b.obj_id AS tgt_obj
            FROM batch_eo a JOIN batch_eo b ON a.event_id = b.event_id
            {o2o_cand}
            UNION
            SELECT r.source_obj_id, r.target_obj_id
            FROM object_relations r
            JOIN inc_lifetimes ls ON r.source_obj_id = ls.obj_id
            JOIN inc_lifetimes lt ON r.target_obj_id = lt.obj_id
            WHERE r.source_obj_id IN (SELECT obj_id FROM d_touched WHERE is_new)
               OR r.target_obj_id IN (SELECT obj_id FROM d_touched WHERE is_new)
        """)
        conn.execute("""
            CREATE TEMP TABLE d_new_pairs AS
            SELECT c.src_obj, c.tgt_obj
            FROM d_cand c
            LEFT JOIN inc_pair p
                   ON c.src_obj = p.src_obj AND c.tgt_obj = p.tgt_obj
            WHERE p.src_obj IS NULL
        """)
        conn.execute("""
            INSERT INTO inc_lc
            SELECT np.src_obj, ls.obj_type, lt.obj_type, COUNT(*)
            FROM d_new_pairs np
            JOIN inc_lifetimes ls ON np.src_obj = ls.obj_id
            JOIN inc_lifetimes lt ON np.tgt_obj = lt.obj_id
            GROUP BY np.src_obj, ls.obj_type, lt.obj_type
            ON CONFLICT (src_obj, tgt_type) DO UPDATE SET n = n + EXCLUDED.n
        """)
        # Re-classify new pairs and pairs incident to a changed lifetime.
        conn.execute(f"""
            INSERT INTO inc_pair
            WITH d_affected AS (
                SELECT src_obj, tgt_obj FROM d_new_pairs
                UNION
                SELECT p.src_obj, p.tgt_obj FROM inc_pair p
                WHERE p.src_obj IN (SELECT obj_id FROM d_touched WHERE changed)
                   OR p.tgt_obj IN (SELECT obj_id FROM d_touched WHERE changed)
            )
            SELECT a.src_obj, a.tgt_obj, ls.obj_type, lt.obj_type, {_MASK_EXPR}
            FROM d_affected a
            JOIN inc_lifetimes ls ON a.src_obj = ls.obj_id
            JOIN inc_lifetimes lt ON a.tgt_obj = lt.obj_id
            ON CONFLICT (src_obj, tgt_obj) DO UPDATE SET mask = EXCLUDED.mask
        """)

        for tmp in ("d_touched", "d_etc", "d_cand", "d_new_pairs"):
            conn.execute(f"DROP TABLE {tmp}")
        conn.unregister("batch_events")
        conn.unregister("batch_eo")
        if has_o2o:
            conn.unregister("batch_o2o")

    # ------------------------------------------------------------------
    # Materialization
    # ------------------------------------------------------------------

    def refresh(self, tau: float = 0.9) -> Totem:
        """Build the Totem model from the summary tables (no event scan)."""
        conn = self.conn

        act_rows = conn.execute(
            "SELECT obj_type, activity FROM inc_act_type"
        ).fetchall()
        obj_typ_to_ev_type: dict[str, set[str]] = {}
        all_event_types: set[str] = set()
        for obj_type, activity in act_rows:
            obj_typ_to_ev_type.setdefault(obj_type, set()).add(activity)
            all_event_types.add(activity)

        type_relations = {
            frozenset({t1, t2})
            for t1, t2 in conn.execute("SELECT t1, t2 FROM inc_type_rel").fetchall()
        }

        active_types = [
            r[0]
            for r in conn.execute(
                "SELECT DISTINCT obj_type FROM inc_lifetimes"
            ).fetchall()
        ]
        src_totals = dict(
            conn.execute("SELECT obj_type, total FROM inc_src_totals").fetchall()
        )
        ec_pairs = {
            (s, t): (one, many)
            for s, t, one, many in conn.execute(
                "SELECT type_source, type_target, n_one, n_many FROM inc_ec_pair"
            ).fetchall()
        }
        h_event_cardinalities: dict[tuple[str, str], dict[str, int]] = {}
        for s, t in product(active_types, active_types):
            total = src_totals.get(s, 0)
            one, many = ec_pairs.get((s, t), (0, 0))
            zero = total - one - many
            h_event_cardinalities[(s, t)] = {
                EC_TOTAL:    total,
                EC_ZERO:     zero,
                EC_ONE:      one,
                EC_ZERO_ONE: zero + one,
                EC_MANY:     one + many,
                EC_ZERO_MANY: total,
            }

        obj_counts = dict(
            conn.execute(
                "SELECT obj_type, COUNT(*) FROM inc_lifetimes GROUP BY obj_type"
            ).fetchall()
        )
        lc_pairs = {
            (s, t): (one, many)
            for s, t, one, many in conn.execute("""
                SELECT src_type, tgt_type,
                       SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END),
                       SUM(CASE WHEN n > 1 THEN 1 ELSE 0 END)
                FROM inc_lc GROUP BY src_type, tgt_type
            """).fetchall()
        }
        h_log_cardinalities: dict[tuple[str, str], dict[str, int]] = {}
        for s, t in product(active_types, active_types):
            total = obj_counts.get(s, 0)
            one, many = lc_pairs.get((s, t), (0, 0))
            zero = total - one - many
            h_log_cardinalities[(s, t)] = {
                LC_TOTAL:    total,
                LC_ZERO:     zero,
                LC_ONE:      one,
                LC_ZERO_ONE: zero + one,
                LC_MANY:     one + many,
                LC_ZERO_MANY: total,
            }

        tr_rows = conn.execute("""
            SELECT src_type, tgt_type, COUNT(*),
                   SUM(CASE WHEN mask & 1 > 0 THEN 1 ELSE 0 END),
                   SUM(CASE WHEN mask & 2 > 0 THEN 1 ELSE 0 END),
                   SUM(CASE WHEN mask & 4 > 0 THEN 1 ELSE 0 END),
                   SUM(CASE WHEN mask & 8 > 0 THEN 1 ELSE 0 END)
            FROM inc_pair
            GROUP BY src_type, tgt_type
        """).fetchall()
        h_temporal_relations: dict[tuple[str, str], dict[str, int]] = {}
        for type_source, type_target, total, n_dep, n_dep_inv, n_init, n_init_rev in tr_rows:
            d: dict[str, int] = {TR_TOTAL: total, TR_PARALLEL: total}
            if n_dep > 0:
                d[TR_DEPENDENT] = n_dep
            if n_dep_inv > 0:
                d[TR_DEPENDENT_INVERSE] = n_dep_inv
            if n_init > 0:
                d[TR_INITIATING] = n_init
            if n_init_rev > 0:
                d[TR_INITIATING_REVERSE] = n_init_rev
            h_temporal_relations[(type_source, type_target)] = d

        return build_totem_from_counters(
            type_relations,
            all_event_types,
            obj_typ_to_ev_type,
            h_event_cardinalities,
            h_log_cardinalities,
            h_temporal_relations,
            tau,
        )
