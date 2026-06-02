from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from totem_lib.ocel.ocel_duckdb import OcelDuckDB


DEFAULT_MAX_POINTS = 3_000
HARD_MAX_POINTS = 10_000


def get_oc_dotted_chart_data(
    db: OcelDuckDB,
    *,
    t_min: str | int | float | None = None,
    t_max: str | int | float | None = None,
    row_min: int | None = None,
    row_max: int | None = None,
    object_type: str | None = None,
    x_axis: str = "time",
    y_axis: str | None = None,
    color_by: str = "activity",
    shape_by: str = "none",
    sort_by: str = "time",
    max_points: int = DEFAULT_MAX_POINTS,
) -> dict[str, Any]:
    """
    Return sampled event data for the object-centric dotted chart.

    If an object type is selected, rows are object ids of that type, sorted by
    each object's first event timestamp. Without an object type, rows default
    to activities. The default point budget is intentionally conservative and
    should be raised only after benchmarking representative logs for query
    time, response size, and frontend rendering cost.
    """
    point_limit = _clamp_max_points(max_points)
    selected_object_type = object_type.strip() if object_type else None
    effective_y_axis = y_axis or ("row_index" if selected_object_type else "activity")

    filters, params = _filters(t_min=t_min, t_max=t_max, row_min=row_min, row_max=row_max)
    base_params = [selected_object_type] if selected_object_type else []
    where_sql = f"WHERE {' AND '.join(filters)}" if filters else ""
    base_sql = _base_events_sql(use_object_rows=selected_object_type is not None)

    total_count = db.conn.execute(
        f"SELECT COUNT(*) FROM ({base_sql}) base {where_sql}",
        [*base_params, *params],
    ).fetchone()[0]

    if total_count == 0:
        return {
            "events": [],
            "total_count": 0,
            "sampled": False,
            "outlier_count": 0,
            "object_type": selected_object_type,
        }

    x_expr = _axis_expr(x_axis)
    y_expr = _axis_expr(effective_y_axis)
    color_expr = _axis_expr(color_by)
    shape_expr = _axis_expr(shape_by)
    sort_expr = _axis_expr(sort_by)

    bucket_count = max(1, min(1_000, point_limit // 10))
    query = f"""
        WITH base AS ({base_sql}),
        filtered AS (
            SELECT * FROM base
            {where_sql}
        ),
        scored AS (
            SELECT
                *,
                CASE
                    WHEN std_row_ts IS NULL OR std_row_ts = 0 THEN 0
                    ELSE ABS((timestamp_unix - avg_row_ts) / std_row_ts)
                END AS outlier_score,
                CASE
                    WHEN ? <= 1 OR max_ts = min_ts THEN 0
                    ELSE LEAST(
                        ? - 1,
                        GREATEST(
                            0,
                            CAST(FLOOR(((timestamp_unix - min_ts)::DOUBLE
                                / NULLIF((max_ts - min_ts)::DOUBLE, 0)) * ?) AS INTEGER)
                        )
                    )
                END AS sample_bucket
            FROM filtered
        ),
        ranked AS (
            SELECT
                *,
                ROW_NUMBER() OVER (
                    ORDER BY outlier_score DESC, timestamp_unix ASC, event_id ASC, row_id ASC
                ) AS outlier_rank,
                ROW_NUMBER() OVER (
                    PARTITION BY sample_bucket
                    ORDER BY outlier_score DESC, hash(event_id, row_id) ASC
                ) AS bucket_rank
            FROM scored
        ),
        sampled AS (
            SELECT *
            FROM ranked
            WHERE outlier_rank <= CEIL(?::DOUBLE * 0.15)
               OR bucket_rank <= CEIL(?::DOUBLE / ?)
            ORDER BY {sort_expr} NULLS LAST, timestamp_unix ASC, event_id ASC, row_id ASC
            LIMIT ?
        )
        SELECT
            event_id,
            {x_expr} AS x,
            {y_expr} AS y,
            {color_expr} AS color_value,
            {shape_expr} AS shape_value,
            activity,
            timestamp_unix,
            row_object_type,
            row_id,
            row_index,
            event_index_in_row,
            outlier_score
        FROM sampled
    """
    rows = db.conn.execute(
        query,
        [
            *base_params,
            *params,
            bucket_count,
            bucket_count,
            bucket_count,
            point_limit,
            point_limit,
            bucket_count,
            point_limit,
        ],
    ).fetchall()
    objects_by_event = _objects_for_events(db, [row[0] for row in rows])

    events = [
        {
            "id": row[0],
            "x": row[1],
            "y": row[2],
            "color_value": row[3],
            "shape_value": row[4],
            "activity": row[5],
            "timestamp": _to_iso(row[6]),
            "timestamp_unix": int(row[6]),
            "row_object_type": row[7],
            "row_id": row[8],
            "row_index": int(row[9]) if row[9] is not None else None,
            "event_index_in_row": int(row[10]) if row[10] is not None else None,
            "objects": objects_by_event.get(row[0], {}),
        }
        for row in rows
    ]

    return {
        "events": events,
        "total_count": int(total_count),
        "sampled": int(total_count) > len(events),
        "outlier_count": sum(1 for row in rows if float(row[11] or 0) >= 2.0),
        "object_type": selected_object_type,
    }


def _base_events_sql(*, use_object_rows: bool) -> str:
    if not use_object_rows:
        return """
            WITH selected AS (
                SELECT
                    event_id,
                    activity,
                    timestamp_unix,
                    NULL AS row_object_type,
                    activity AS row_id,
                    MIN(timestamp_unix) OVER (PARTITION BY activity) AS row_first_timestamp
                FROM events
            )
            SELECT
                event_id,
                activity,
                timestamp_unix,
                row_object_type,
                row_id,
                DENSE_RANK() OVER (ORDER BY row_first_timestamp, row_id) AS row_index,
                ROW_NUMBER() OVER (
                    PARTITION BY row_id
                    ORDER BY timestamp_unix, event_id
                ) AS event_index_in_row,
                AVG(timestamp_unix) OVER (
                    PARTITION BY row_id
                ) AS avg_row_ts,
                STDDEV_POP(timestamp_unix) OVER (
                    PARTITION BY row_id
                ) AS std_row_ts,
                MIN(timestamp_unix) OVER () AS min_ts,
                MAX(timestamp_unix) OVER () AS max_ts
            FROM selected
        """

    return """
        WITH selected AS (
            SELECT
                e.event_id,
                e.activity,
                e.timestamp_unix,
                o.obj_type AS row_object_type,
                eo.obj_id AS row_id,
                MIN(e.timestamp_unix) OVER (PARTITION BY eo.obj_id) AS row_first_timestamp
            FROM events e
            JOIN event_object eo ON eo.event_id = e.event_id
            JOIN objects o ON o.obj_id = eo.obj_id
            WHERE o.obj_type = ?
        )
        SELECT
            event_id,
            activity,
            timestamp_unix,
            row_object_type,
            row_id,
            DENSE_RANK() OVER (ORDER BY row_first_timestamp, row_id) AS row_index,
            ROW_NUMBER() OVER (
                PARTITION BY row_id
                ORDER BY timestamp_unix, event_id
            ) AS event_index_in_row,
            AVG(timestamp_unix) OVER (
                PARTITION BY row_id
            ) AS avg_row_ts,
            STDDEV_POP(timestamp_unix) OVER (
                PARTITION BY row_id
            ) AS std_row_ts,
            MIN(timestamp_unix) OVER () AS min_ts,
            MAX(timestamp_unix) OVER () AS max_ts
        FROM selected
    """


def _filters(
    *,
    t_min: str | int | float | None,
    t_max: str | int | float | None,
    row_min: int | None,
    row_max: int | None,
) -> tuple[list[str], list[Any]]:
    filters: list[str] = []
    params: list[Any] = []
    t_min_unix = _parse_time_bound(t_min)
    t_max_unix = _parse_time_bound(t_max)
    if t_min_unix is not None:
        filters.append("timestamp_unix >= ?")
        params.append(t_min_unix)
    if t_max_unix is not None:
        filters.append("timestamp_unix <= ?")
        params.append(t_max_unix)
    if row_min is not None:
        filters.append("row_index >= ?")
        params.append(int(row_min))
    if row_max is not None:
        filters.append("row_index <= ?")
        params.append(int(row_max))
    return filters, params


def _axis_expr(axis: str | None) -> str:
    if axis == "time":
        return "timestamp_unix"
    if axis == "activity":
        return "activity"
    if axis == "object_type":
        return "row_object_type"
    if axis in ("object_id", "row_id"):
        return "row_id"
    if axis == "row_index":
        return "row_index"
    if axis == "event_index_in_row":
        return "event_index_in_row"
    if axis and axis.startswith("object_type:"):
        object_type = axis.split(":", 1)[1].replace("'", "''")
        return (
            "(SELECT MIN(eo_axis.obj_id) "
            "FROM event_object eo_axis "
            "JOIN objects o_axis ON o_axis.obj_id = eo_axis.obj_id "
            f"WHERE eo_axis.event_id = event_id AND o_axis.obj_type = '{object_type}')"
        )
    return "NULL"


def _objects_for_events(db: OcelDuckDB, event_ids: list[str]) -> dict[str, dict[str, list[str]]]:
    if not event_ids:
        return {}
    placeholders = ", ".join(["?"] * len(event_ids))
    rows = db.conn.execute(
        f"""
        SELECT eo.event_id, o.obj_type, eo.obj_id
        FROM event_object eo
        JOIN objects o ON o.obj_id = eo.obj_id
        WHERE eo.event_id IN ({placeholders})
        ORDER BY eo.event_id, o.obj_type, eo.obj_id
        """,
        event_ids,
    ).fetchall()
    result: dict[str, dict[str, list[str]]] = {}
    for event_id, object_type, object_id in rows:
        result.setdefault(event_id, {}).setdefault(object_type, []).append(object_id)
    return result


def _clamp_max_points(value: int) -> int:
    return max(100, min(int(value or DEFAULT_MAX_POINTS), HARD_MAX_POINTS))


def _parse_time_bound(value: str | int | float | None) -> int | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip()
    if not text:
        return None
    if text.isdigit():
        return int(text)
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    return int(datetime.fromisoformat(text).timestamp())


def _to_iso(value: int | float | None) -> str | None:
    if value is None:
        return None
    return datetime.fromtimestamp(int(value), tz=timezone.utc).isoformat().replace("+00:00", "Z")
