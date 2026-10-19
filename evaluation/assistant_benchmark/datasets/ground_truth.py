"""
Deterministic ground-truth computation engine for Object-Centric Process Mining logs.
Queries DuckDB directly to calculate verifiable mathematical answers for benchmark tasks.
"""

import os
from typing import Any, Dict, List, Tuple
from totem_lib.ocel.importer_db import import_ocel_db

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))

CONTAINER_LOGISTICS_PATH = os.path.join(ROOT_DIR, "totem_lib", "example_data", "ContainerLogistics.sqlite")
ORDER_MANAGEMENT_PATH = os.path.join(ROOT_DIR, "backend", "user_files", "Guest", "files", "order-management.sqlite")


class GroundTruthEngine:
    """Calculates deterministic process mining ground truth from OCEL databases."""

    @staticmethod
    def get_log_statistics(file_path: str) -> Dict[str, Any]:
        db = import_ocel_db(file_path)
        try:
            num_events = db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
            num_objects = db.conn.execute("SELECT COUNT(*) FROM objects").fetchone()[0]
            num_activities = db.conn.execute("SELECT COUNT(DISTINCT activity) FROM events").fetchone()[0]
            num_types = db.conn.execute("SELECT COUNT(DISTINCT obj_type) FROM objects").fetchone()[0]
            ts = db.conn.execute("SELECT MIN(timestamp_unix), MAX(timestamp_unix) FROM events").fetchone()
            earliest, latest = ts if ts else (0, 0)
            return {
                "num_events": num_events,
                "num_objects": num_objects,
                "num_unique_activities": num_activities,
                "num_object_types": num_types,
                "duration_seconds": latest - earliest,
                "earliest_timestamp": earliest,
                "latest_timestamp": latest,
            }
        finally:
            db.close()

    @staticmethod
    def get_object_types(file_path: str) -> List[str]:
        db = import_ocel_db(file_path)
        try:
            rows = db.conn.execute("SELECT DISTINCT obj_type FROM objects ORDER BY obj_type").fetchall()
            return [r[0] for r in rows]
        finally:
            db.close()

    @staticmethod
    def get_top_bottlenecks(file_path: str, limit: int = 5) -> List[Dict[str, Any]]:
        """Compute the biggest bottleneck transitions (longest avg delay) between consecutive activities."""
        db = import_ocel_db(file_path)
        try:
            query = """
            WITH ordered_events AS (
                SELECT
                    eo.obj_id,
                    e.activity,
                    e.timestamp_unix,
                    LEAD(e.activity) OVER (PARTITION BY eo.obj_id ORDER BY e.timestamp_unix, e.event_id) AS next_activity,
                    LEAD(e.timestamp_unix) OVER (PARTITION BY eo.obj_id ORDER BY e.timestamp_unix, e.event_id) - e.timestamp_unix AS delay
                FROM event_object eo
                JOIN events e ON eo.event_id = e.event_id
            )
            SELECT
                activity,
                next_activity,
                COUNT(*) as transitions_count,
                AVG(delay) as avg_delay_seconds
            FROM ordered_events
            WHERE next_activity IS NOT NULL AND next_activity != activity
            GROUP BY activity, next_activity
            ORDER BY avg_delay_seconds DESC
            LIMIT ?;
            """
            rows = db.conn.execute(query, [limit]).fetchall()
            return [
                {
                    "source": r[0],
                    "target": r[1],
                    "count": r[2],
                    "avg_delay_seconds": float(r[3]),
                }
                for r in rows
            ]
        finally:
            db.close()

    @staticmethod
    def get_object_lifespans(file_path: str) -> List[Dict[str, Any]]:
        """Compute average lifespan (time between first and last event) grouped by object type."""
        db = import_ocel_db(file_path)
        try:
            query = """
            WITH object_spans AS (
                SELECT
                    o.obj_type,
                    o.obj_id,
                    MIN(e.timestamp_unix) as first_ts,
                    MAX(e.timestamp_unix) as last_ts,
                    MAX(e.timestamp_unix) - MIN(e.timestamp_unix) as lifespan
                FROM objects o
                JOIN event_object eo ON o.obj_id = eo.obj_id
                JOIN events e ON eo.event_id = e.event_id
                GROUP BY o.obj_type, o.obj_id
            )
            SELECT
                obj_type,
                COUNT(DISTINCT obj_id) as count,
                AVG(lifespan) as avg_lifespan_seconds
            FROM object_spans
            GROUP BY obj_type
            ORDER BY avg_lifespan_seconds DESC;
            """
            rows = db.conn.execute(query).fetchall()
            return [
                {
                    "obj_type": r[0],
                    "count": r[1],
                    "avg_lifespan_seconds": float(r[2]),
                }
                for r in rows
            ]
        finally:
            db.close()

    @staticmethod
    def get_activity_frequencies(file_path: str) -> List[Tuple[str, int]]:
        db = import_ocel_db(file_path)
        try:
            query = "SELECT activity, COUNT(*) FROM events GROUP BY activity ORDER BY COUNT(*) DESC"
            return [(r[0], int(r[1])) for r in db.conn.execute(query).fetchall()]
        finally:
            db.close()
