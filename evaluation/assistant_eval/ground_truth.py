"""
Ground truth, computed from the very files the assistant's tools read.

Values are computed once per run with plain DuckDB SQL, independently of the
assistant's tool code, so a bug in a tool cannot agree with its own "truth".
Nothing here is hardcoded: if a sample log changes, the expected answers move
with it. Connections are closed before any task runs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Tuple

import duckdb

DAY = 86400.0


def _df(conn, obj_type: str) -> Dict[Tuple[str, str], Dict[str, float]]:
    """Directly-follows pairs for one object type: frequency, median and total wait (seconds)."""
    rows = conn.execute(
        """
        WITH oe AS (
            SELECT eo.obj_id, e.event_id, e.activity, e.timestamp_unix AS ts
            FROM event_object eo
            JOIN events e ON e.event_id = eo.event_id
            JOIN objects o ON o.obj_id = eo.obj_id
            WHERE o.obj_type = ?
        ), s AS (
            SELECT obj_id, activity AS a,
                   LEAD(activity) OVER w AS b,
                   LEAD(ts) OVER w - ts AS d
            FROM oe WINDOW w AS (PARTITION BY obj_id ORDER BY ts, event_id)
        )
        SELECT a, b, COUNT(*), COUNT(DISTINCT obj_id), MEDIAN(d), SUM(d)
        FROM s WHERE b IS NOT NULL GROUP BY 1, 2
        """,
        [obj_type],
    ).fetchall()
    return {(a, b): {"freq": n, "objects": k, "median": float(med), "total": float(tot)} for a, b, n, k, med, tot in rows}


def _lifecycles(conn) -> Dict[str, float]:
    """Median lifecycle (first to last event) per object type, in seconds."""
    rows = conn.execute(
        """
        WITH life AS (
            SELECT o.obj_type, o.obj_id, MAX(e.timestamp_unix) - MIN(e.timestamp_unix) AS span
            FROM objects o
            JOIN event_object eo ON eo.obj_id = o.obj_id
            JOIN events e ON e.event_id = eo.event_id
            GROUP BY 1, 2
        )
        SELECT obj_type, MEDIAN(span) FROM life GROUP BY 1
        """
    ).fetchall()
    return {t: float(m) for t, m in rows}


def _basic(conn) -> Dict[str, Any]:
    events, activities, t0, t1 = conn.execute(
        "SELECT COUNT(*), COUNT(DISTINCT activity), MIN(timestamp_unix), MAX(timestamp_unix) FROM events"
    ).fetchone()
    objects = conn.execute("SELECT COUNT(*) FROM objects").fetchone()[0]
    types = dict(conn.execute("SELECT obj_type, COUNT(*) FROM objects GROUP BY 1").fetchall())
    acts = dict(conn.execute("SELECT activity, COUNT(*) FROM events GROUP BY 1").fetchall())
    return {"events": events, "activities": activities, "objects": objects, "start": t0, "end": t1, "types": types, "activity_counts": acts}


@dataclass
class Truth:
    """Expected answers keyed by log, plus derived facts used by specific tasks."""

    logs: Dict[str, Dict[str, Any]] = field(default_factory=dict)

    def __getitem__(self, key: str) -> Dict[str, Any]:
        return self.logs[key]


def compute(paths: Dict[str, Path]) -> Truth:
    truth = Truth()
    for key, path in paths.items():
        conn = duckdb.connect(str(path), read_only=True)
        try:
            info = _basic(conn)
            info["lifecycle_median"] = _lifecycles(conn)
            if key == "container":
                info.update(_container_facts(conn))
            elif key == "bpic":
                info.update(_bpic_facts(conn))
            elif key == "orders":
                info.update(_order_facts(conn))
            truth.logs[key] = info
        finally:
            conn.close()
    truth.logs["container"]["customer_order_top_variant"] = _top_variant_share(paths["container"], "CustomerOrder")
    return truth


def _top_wait(df: Dict[Tuple[str, str], Dict[str, float]]) -> Tuple[Tuple[str, str], Dict[str, float]]:
    """The transition that adds up to the most waiting time across objects."""
    return max(df.items(), key=lambda kv: kv[1]["total"])


def _container_facts(conn) -> Dict[str, Any]:
    df = {t: _df(conn, t) for t in ("Container", "CustomerOrder", "Vehicle")}
    resched = conn.execute(
        """
        SELECT COUNT(*), COUNT(DISTINCT eo.obj_id) FROM events e
        JOIN event_object eo ON eo.event_id = e.event_id
        JOIN objects o ON o.obj_id = eo.obj_id
        WHERE e.activity = 'RescheduleContainer' AND o.obj_type = 'Container'
        """
    ).fetchone()
    multi = conn.execute(
        """
        SELECT COUNT(*) FROM (
            SELECT eo.obj_id FROM events e JOIN event_object eo ON eo.event_id = e.event_id
            JOIN objects o ON o.obj_id = eo.obj_id
            WHERE e.activity = 'RescheduleContainer' AND o.obj_type = 'Container'
            GROUP BY 1 HAVING COUNT(*) > 1)
        """
    ).fetchone()[0]
    departed = conn.execute(
        """
        SELECT COUNT(DISTINCT eo.obj_id) FROM events e JOIN event_object eo ON eo.event_id = e.event_id
        JOIN objects o ON o.obj_id = eo.obj_id WHERE e.activity = 'Depart' AND o.obj_type = 'Container'
        """
    ).fetchone()[0]
    weigh_next = {b: v["objects"] for (a, b), v in df["Container"].items() if a == "Weigh"}
    top_c = _top_wait(df["Container"])
    top_o = _top_wait(df["CustomerOrder"])
    return {
        "df": df,
        "container_top_wait": {"pair": top_c[0], **top_c[1]},
        "order_top_wait": {"pair": top_o[0], **top_o[1]},
        "vehicle_book_to_load": df["Vehicle"].get(("BookVehicles", "LoadtoVehicle")),
        "reschedule_events": resched[0],
        "rescheduled_containers": resched[1],
        "containers_rescheduled_more_than_once": multi,
        "containers_departed": departed,
        "weigh_next": weigh_next,  # activity -> number of containers
    }


def _bpic_facts(conn) -> Dict[str, Any]:
    actor, n = conn.execute(
        """
        SELECT "Responsible_actor", COUNT(*) FROM objects
        WHERE obj_type = 'case' AND "Responsible_actor" IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 1
        """
    ).fetchone()
    return {"top_responsible_actor": str(actor), "top_responsible_actor_cases": n}


def _order_facts(conn) -> Dict[str, Any]:
    rows = conn.execute(
        """
        SELECT DISTINCT o.customer FROM events e
        JOIN event_object eo ON eo.event_id = e.event_id
        JOIN objects o ON o.obj_id = eo.obj_id
        WHERE e.activity = 'Reject order' AND o.obj_type = 'case'
        """
    ).fetchall()
    return {"rejected_customers": [str(r[0]) for r in rows if r[0] is not None]}


def _top_variant_share(path: Path, leading: str) -> Dict[str, Any]:
    """Library oracle for variants (the tool wraps the same algorithm, summarised)."""
    from totem_lib.ocel.ocel_duckdb import OcelDuckDB
    from totem_lib.variants import find_variants

    db = OcelDuckDB.load(str(path), read_only=True)
    try:
        variants: List[Any] = list(find_variants(db, extraction="leading_1hop", leading_type=leading, iso="wl+vf2", timeout_s=60, verbose=False))
    finally:
        db.close()
    total = sum(v.support for v in variants) or 1
    top = max(variants, key=lambda v: v.support)
    return {"cases": top.support, "share_pct": 100.0 * top.support / total, "total": total, "distinct": len(variants)}
