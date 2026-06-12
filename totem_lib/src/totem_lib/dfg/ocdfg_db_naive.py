"""
Naive self-join formulation of the OC-DFG discovery query.

This is the textbook SQL translation of "directly follows": event b directly
follows event a for object o iff both reference o, a comes before b, and no
third event of o lies between them (NOT EXISTS anti-join). It is the
formulation used by classic SQL-based process mining approaches and serves
as the ablation baseline for the window-function rewrite in ocdfg_db.py:
the self-join enumerates O(L^2) candidate pairs per object and checks O(L)
witnesses each, while the window-function version is a single sort-based
pass. Results are identical (see tests/dfg/test_ocdfg_naive.py).
"""

from typing import List, Optional

from totem_lib.ocel.ocel_duckdb import OcelDuckDB

from .ocdfg_db import OCDFGDb


class OCDFGDbNaive(OCDFGDb):
    """Self-join + NOT EXISTS variant of OCDFGDb. For benchmarking only."""

    @classmethod
    def from_ocel_db(
        cls,
        ocel_db: OcelDuckDB,
        object_types: Optional[List[str]] = None,
    ) -> "OCDFGDbNaive":
        type_filter = ""
        params: list = []
        if object_types is not None:
            placeholders = ", ".join(["?"] * len(object_types))
            type_filter = f"WHERE o.obj_type IN ({placeholders})"
            params = list(object_types)

        cte = f"""
            WITH ev_obj AS (
                SELECT
                    e.event_id,
                    e.activity,
                    e.timestamp_unix AS ts,
                    eo.obj_id,
                    o.obj_type
                FROM events e
                JOIN event_object eo ON e.event_id = eo.event_id
                JOIN objects o       ON eo.obj_id  = o.obj_id
                {type_filter}
            )
        """

        def _q(suffix: str):
            sql = cte + suffix
            if params:
                return ocel_db.conn.execute(sql, params).pl()
            return ocel_db.conn.execute(sql).pl()

        # (a, b) is a directly-follows pair for a.obj_id iff no event c of the
        # same object falls strictly between them in the (ts, event_id) order.
        edges_df = _q("""
            SELECT a.obj_type, a.activity AS src, b.activity AS tgt, COUNT(*) AS weight
            FROM ev_obj a
            JOIN ev_obj b
              ON a.obj_id = b.obj_id
             AND (a.ts < b.ts OR (a.ts = b.ts AND a.event_id < b.event_id))
            WHERE NOT EXISTS (
                SELECT 1 FROM ev_obj c
                WHERE c.obj_id = a.obj_id
                  AND (a.ts < c.ts OR (a.ts = c.ts AND a.event_id < c.event_id))
                  AND (c.ts < b.ts OR (c.ts = b.ts AND c.event_id < b.event_id))
            )
            GROUP BY a.obj_type, a.activity, b.activity
        """)

        node_freq_df = _q("""
            SELECT obj_type, activity, COUNT(*) AS count
            FROM ev_obj
            GROUP BY obj_type, activity
        """)

        starts_df = _q("""
            SELECT a.obj_type, a.activity, COUNT(*) AS weight
            FROM ev_obj a
            WHERE NOT EXISTS (
                SELECT 1 FROM ev_obj c
                WHERE c.obj_id = a.obj_id
                  AND (c.ts < a.ts OR (c.ts = a.ts AND c.event_id < a.event_id))
            )
            GROUP BY a.obj_type, a.activity
        """)

        ends_df = _q("""
            SELECT a.obj_type, a.activity, COUNT(*) AS weight
            FROM ev_obj a
            WHERE NOT EXISTS (
                SELECT 1 FROM ev_obj c
                WHERE c.obj_id = a.obj_id
                  AND (a.ts < c.ts OR (a.ts = c.ts AND a.event_id < c.event_id))
            )
            GROUP BY a.obj_type, a.activity
        """)

        return cls._build_graph(edges_df, node_freq_df, starts_df, ends_df)
