"""
Event-log statistics computed in pure totem_lib (no Django imports).

All functions accept an OcelDuckDB instance and return plain dicts
suitable for JSON serialization.
"""

from .ocel_duckdb import OcelDuckDB


def get_event_log_statistics(db: OcelDuckDB) -> dict:
    """
    Return summary statistics for the event log stored in *db*.

    Keys:
        num_events, num_unique_activities, num_objects, num_object_types,
        earliest_timestamp, newest_timestamp.
    """
    num_events = db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    num_unique_activities = db.conn.execute(
        "SELECT COUNT(DISTINCT activity) FROM events"
    ).fetchone()[0]
    num_objects = db.conn.execute("SELECT COUNT(*) FROM objects").fetchone()[0]
    num_object_types = db.conn.execute(
        "SELECT COUNT(DISTINCT obj_type) FROM objects"
    ).fetchone()[0]
    ts_row = db.conn.execute(
        "SELECT MIN(timestamp_unix), MAX(timestamp_unix) FROM events"
    ).fetchone()

    return {
        "num_events": num_events,
        "num_unique_activities": num_unique_activities,
        "num_objects": num_objects,
        "num_object_types": num_object_types,
        "earliest_timestamp": ts_row[0] if ts_row else None,
        "newest_timestamp": ts_row[1] if ts_row else None,
    }
