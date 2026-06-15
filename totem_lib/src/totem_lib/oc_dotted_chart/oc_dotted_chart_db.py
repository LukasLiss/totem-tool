from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from totem_lib.ocel.ocel_duckdb import OcelDuckDB


DEFAULT_MAX_POINTS = 3_000
HARD_MAX_POINTS = 20_000
MAX_SAMPLE_BUCKETS = 20_000
OUTLIER_BUDGET_RATIO = 0.2
OUTLIER_SCORE_THRESHOLD = 2.0


def get_oc_dotted_chart_data(
    db: OcelDuckDB,
    *,
    t_min: str | int | float | None = None,
    t_max: str | int | float | None = None,
    row_min: int | None = None,
    row_max: int | None = None,
    x_axis: str = "time",
    y_axis: str | None = None,
    color_by: str = "activity",
    shape_by: str = "none",
    sort_by: str = "time",
    max_points: int = DEFAULT_MAX_POINTS,
    sample_seed: int = 0,
) -> dict[str, Any]:
    """
    Return sampled event data for the object-centric dotted chart.

    Defaults follow the generic dotted chart view: timestamp on the x-axis,
    activity on the y-axis, and activity for coloring. Event attributes can be
    selected as dimensions once they are present as event columns in DuckDB.
    The default point budget is intentionally conservative and should be raised
    only after benchmarking representative logs for query time, response size,
    and frontend rendering cost.
    """
    point_limit = _clamp_max_points(max_points)
    effective_y_axis = y_axis or "activity"
    event_attr_columns = _event_attr_columns(db)
    object_attr_columns = _object_attr_columns(db)
    include_objects = any(
        _axis_uses_object_columns(axis, object_attr_columns)
        for axis in (x_axis, effective_y_axis, color_by, shape_by, sort_by)
    )

    time_filters, time_params = _time_filters(t_min=t_min, t_max=t_max)
    row_filters, row_params = _row_filters(row_min=row_min, row_max=row_max)
    base_where_sql = f"WHERE {' AND '.join(time_filters)}" if time_filters else ""
    dimensioned_where = ["x IS NOT NULL", "y IS NOT NULL", *row_filters]
    dimensioned_where_sql = f"WHERE {' AND '.join(dimensioned_where)}"

    base_sql = _base_events_sql(
        event_attr_columns=event_attr_columns,
        object_attr_columns=object_attr_columns,
        include_objects=include_objects,
    )
    x_expr = _axis_expr(x_axis, event_attr_columns, object_attr_columns)
    y_expr = _axis_expr(effective_y_axis, event_attr_columns, object_attr_columns)
    color_expr = _axis_expr(color_by, event_attr_columns, object_attr_columns)
    shape_expr = _axis_expr(shape_by, event_attr_columns, object_attr_columns)
    sort_expr = _axis_expr(sort_by, event_attr_columns, object_attr_columns)
    dimensioned_sql = _dimensioned_events_sql(
        base_sql=base_sql,
        base_where_sql=base_where_sql,
        x_expr=x_expr,
        y_expr=y_expr,
        color_expr=color_expr,
        shape_expr=shape_expr,
    )

    total_count = db.conn.execute(
        f"SELECT COUNT(*) FROM ({dimensioned_sql}) dimensioned {dimensioned_where_sql}",
        [*time_params, *row_params],
    ).fetchone()[0]
    dataset_dimensioned_sql = _dimensioned_events_sql(
        base_sql=base_sql,
        base_where_sql="",
        x_expr=x_expr,
        y_expr=y_expr,
        color_expr=color_expr,
        shape_expr=shape_expr,
    )
    dataset_total_count = db.conn.execute(
        f"SELECT COUNT(*) FROM ({dataset_dimensioned_sql}) dimensioned WHERE x IS NOT NULL AND y IS NOT NULL"
    ).fetchone()[0]

    if total_count == 0:
        return {
            "events": [],
            "total_count": 0,
            "dataset_total_count": int(dataset_total_count),
            "sampled": False,
            "outlier_count": 0,
        }

    bucket_count = _bucket_count_for_point_limit(point_limit)
    outlier_budget = _outlier_budget_for_point_limit(point_limit)
    query = f"""
        WITH dimensioned AS ({dimensioned_sql}),
        filtered AS (
            SELECT * FROM dimensioned
            {dimensioned_where_sql}
        ),
        scored AS (
            SELECT
                *,
                0.6 * CASE
                    WHEN std_row_ts IS NULL OR std_row_ts = 0 THEN 0
                    ELSE ABS((timestamp_unix - avg_row_ts) / std_row_ts)
                END
                + 0.4 * (1 - (COUNT(*) OVER (PARTITION BY activity))::DOUBLE / COUNT(*) OVER ())
                AS outlier_score,
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
                    ORDER BY outlier_score DESC, hash(event_id, row_id, ?) ASC
                ) AS bucket_rank
            FROM scored
        ),
        marked AS (
            SELECT
                *,
                outlier_score >= ? AND outlier_rank <= ? AS force_include
            FROM ranked
        ),
        budgeted AS (
            SELECT
                *,
                ? - SUM(CASE WHEN force_include THEN 1 ELSE 0 END) OVER () AS remaining_budget
            FROM marked
        ),
        fill_ranked AS (
            SELECT
                *,
                ROW_NUMBER() OVER (
                    PARTITION BY force_include
                    ORDER BY
                        bucket_rank ASC,
                        outlier_score DESC,
                        hash(event_id, row_id, ?) ASC
                ) AS fill_rank
            FROM budgeted
        ),
        sampled AS (
            SELECT *
            FROM fill_ranked
            WHERE force_include
               OR fill_rank <= GREATEST(0, remaining_budget)
            ORDER BY {sort_expr} NULLS LAST, timestamp_unix ASC, event_id ASC, row_id ASC
            LIMIT ?
        )
        SELECT
            event_id,
            x,
            y,
            color_value,
            shape_value,
            activity,
            timestamp_unix,
            row_id,
            row_index,
            event_index_in_row,
            outlier_score
        FROM sampled
    """
    rows = db.conn.execute(
        query,
        [
            *time_params,
            *row_params,
            bucket_count,
            bucket_count,
            bucket_count,
            int(sample_seed),
            OUTLIER_SCORE_THRESHOLD,
            outlier_budget,
            point_limit,
            int(sample_seed),
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
            "row_id": row[7],
            "row_index": int(row[8]) if row[8] is not None else None,
            "event_index_in_row": int(row[9]) if row[9] is not None else None,
            "objects": objects_by_event.get(row[0], {}),
        }
        for row in rows
    ]

    return {
        "events": events,
        "total_count": int(total_count),
        "dataset_total_count": int(dataset_total_count),
        "sampled": int(total_count) > len(events),
        "outlier_count": sum(1 for row in rows if float(row[10] or 0) >= 2.0),
    }


def get_oc_dotted_chart_columns(db: OcelDuckDB) -> dict[str, list[dict[str, str]]]:
    event_attr_columns = _event_attr_columns(db)
    object_attr_columns = _object_attr_columns(db)
    object_types = _object_types(db)
    attr_options = [
        {
            "value": column,
            "label": _humanize_column_name(column),
            "kind": "time" if _is_time_related_column(column) else "categorical",
        }
        for column in event_attr_columns
    ]
    object_type_row_options = [
        {
            "value": f"object_type:{object_type}",
            "label": _humanize_column_name(object_type),
            "kind": "categorical",
        }
        for object_type in object_types
    ]
    object_options = [
        {"value": "object_id", "label": "Object ID", "kind": "categorical"},
        {"value": "object_type", "label": "Object Type", "kind": "categorical"},
        {"value": "qualifier", "label": "Qualifier", "kind": "categorical"},
        *[
            {
                "value": f"object_attr:{column}",
                "label": f"Object {_humanize_column_name(column)}",
                "kind": "time" if _is_time_related_column(column) else "categorical",
            }
            for column in object_attr_columns
        ],
    ]
    time_options = [
        {"value": "time", "label": "Time", "kind": "time"},
        {"value": "timestamp", "label": "Timestamp", "kind": "time"},
        {"value": "timestamp_unix", "label": "Timestamp (Unix)", "kind": "time"},
        {"value": "since_start", "label": "Since Start", "kind": "time"},
        *[option for option in attr_options if option["kind"] == "time"],
        *[option for option in object_options if option["kind"] == "time"],
    ]
    categorical_options = [
        {"value": "activity", "label": "Activity", "kind": "categorical"},
        *[option for option in attr_options if option["kind"] == "categorical"],
        *[option for option in object_options if option["kind"] == "categorical"],
        *object_type_row_options,
    ]
    y_axis_options = [
        {"value": "activity", "label": "Activity", "kind": "categorical"},
        *[option for option in attr_options if option["kind"] == "categorical"],
        *object_type_row_options,
        {"value": "object_id", "label": "All Objects", "kind": "categorical"},
        {"value": "qualifier", "label": "Qualifier", "kind": "categorical"},
        *[option for option in object_options if option["kind"] == "categorical" and option["value"].startswith("object_attr:")],
    ]

    return {
        "x_axis": time_options,
        "y_axis": y_axis_options,
        "color_by": [
            {"value": "none", "label": "None", "kind": "none"},
            *categorical_options,
        ],
        "shape_by": [
            {"value": "none", "label": "None", "kind": "none"},
            *categorical_options,
        ],
        "sort_by": [*time_options, *categorical_options],
    }


def _base_events_sql(
    *,
    event_attr_columns: list[str],
    object_attr_columns: list[str],
    include_objects: bool,
) -> str:
    event_attr_selects = _column_selects(event_attr_columns, table_alias="e")
    if include_objects:
        object_selects = "".join(
            f",\n            o.{_quote_identifier(column)} AS {_quote_identifier(_object_attr_alias(column))}"
            for column in object_attr_columns
        )
        object_join_sql = """
        LEFT JOIN event_object eo ON eo.event_id = e.event_id
        LEFT JOIN objects o ON o.obj_id = eo.obj_id
        """
        object_columns_sql = f""",
            eo.obj_id AS object_id,
            o.obj_type AS object_type,
            eo.qualifier AS qualifier,
            eo.obj_id AS source_object_id
            {object_selects}
        """
    else:
        object_join_sql = ""
        object_columns_sql = """,
            NULL AS source_object_id
        """

    return """
        SELECT
            e.event_id,
            e.activity,
            e.timestamp_unix,
            e.timestamp_unix - log_start_ts AS since_start
            {event_attr_selects}
            {object_columns_sql}
        FROM events e
        {object_join_sql}
        CROSS JOIN (SELECT MIN(timestamp_unix) AS log_start_ts FROM events) log_bounds
        {base_where_sql}
    """.format(
        event_attr_selects=event_attr_selects,
        object_columns_sql=object_columns_sql,
        object_join_sql=object_join_sql,
        base_where_sql="{base_where_sql}",
    )


def _dimensioned_events_sql(
    *,
    base_sql: str,
    base_where_sql: str,
    x_expr: str,
    y_expr: str,
    color_expr: str,
    shape_expr: str,
) -> str:
    return f"""
        WITH base AS ({base_sql.format(base_where_sql=base_where_sql)}),
        selected AS (
            SELECT
                *,
                {x_expr} AS x,
                {y_expr} AS y,
                {color_expr} AS color_value,
                {shape_expr} AS shape_value
            FROM base
        ),
        rowed AS (
            SELECT
                *,
                CAST(y AS VARCHAR) AS row_id,
                MIN(timestamp_unix) OVER (PARTITION BY y) AS row_first_timestamp
            FROM selected
        )
        SELECT
            event_id,
            source_object_id,
            x,
            y,
            color_value,
            shape_value,
            activity,
            timestamp_unix,
            row_id,
            DENSE_RANK() OVER (
                ORDER BY row_first_timestamp, row_id
            ) AS row_index,
            ROW_NUMBER() OVER (
                PARTITION BY row_id
                ORDER BY timestamp_unix, event_id, source_object_id
            ) AS event_index_in_row,
            AVG(timestamp_unix) OVER (
                PARTITION BY row_id
            ) AS avg_row_ts,
            STDDEV_POP(timestamp_unix) OVER (
                PARTITION BY row_id
            ) AS std_row_ts,
            MIN(timestamp_unix) OVER () AS min_ts,
            MAX(timestamp_unix) OVER () AS max_ts
        FROM rowed
    """


def _time_filters(
    *,
    t_min: str | int | float | None,
    t_max: str | int | float | None,
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
    return filters, params


def _row_filters(
    *,
    row_min: int | None,
    row_max: int | None,
) -> tuple[list[str], list[Any]]:
    filters: list[str] = []
    params: list[Any] = []
    if row_min is not None:
        filters.append("row_index >= ?")
        params.append(int(row_min))
    if row_max is not None:
        filters.append("row_index <= ?")
        params.append(int(row_max))
    return filters, params


def _axis_expr(axis: str | None, event_attr_columns: list[str], object_attr_columns: list[str]) -> str:
    if axis in ("time", "timestamp", "timestamp_unix"):
        return "timestamp_unix"
    if axis == "since_start":
        return "since_start"
    if axis == "activity":
        return "activity"
    if axis == "object_id":
        return "object_id"
    if axis == "object_type":
        return "object_type"
    if axis and axis.startswith("object_type:"):
        object_type = axis.split(":", 1)[1]
        return f"CASE WHEN object_type = {_quote_literal(object_type)} THEN object_id ELSE NULL END"
    if axis == "qualifier":
        return "qualifier"
    if axis and axis.startswith("object_attr:"):
        column = axis.split(":", 1)[1]
        if column in object_attr_columns:
            return _quote_identifier(_object_attr_alias(column))
    if axis in event_attr_columns:
        return _quote_identifier(axis)
    return "NULL"


def _event_attr_columns(db: OcelDuckDB) -> list[str]:
    fixed_columns = {"event_id", "activity", "timestamp", "timestamp_unix"}
    rows = db.conn.execute("PRAGMA table_info('events')").fetchall()
    return [row[1] for row in rows if row[1] not in fixed_columns]


def _object_attr_columns(db: OcelDuckDB) -> list[str]:
    fixed_columns = {"obj_id", "obj_type"}
    rows = db.conn.execute("PRAGMA table_info('objects')").fetchall()
    return [row[1] for row in rows if row[1] not in fixed_columns]


def _object_types(db: OcelDuckDB) -> list[str]:
    rows = db.conn.execute(
        "SELECT DISTINCT obj_type FROM objects WHERE obj_type IS NOT NULL ORDER BY obj_type"
    ).fetchall()
    return [row[0] for row in rows]


def _column_selects(columns: list[str], table_alias: str | None) -> str:
    prefix = f"{table_alias}." if table_alias else ""
    return "".join(
        f",\n            {prefix}{_quote_identifier(column)} AS {_quote_identifier(column)}"
        for column in columns
    )


def _quote_identifier(identifier: str) -> str:
    return f'"{identifier.replace(chr(34), chr(34) * 2)}"'


def _quote_literal(value: str) -> str:
    return f"'{value.replace(chr(39), chr(39) * 2)}'"


def _is_time_related_column(column: str) -> bool:
    normalized = column.lower()
    return any(token in normalized for token in ("time", "timestamp", "date", "datetime"))


def _humanize_column_name(column: str) -> str:
    return column.replace("_", " ").strip().title() or column


def _object_attr_alias(column: str) -> str:
    return f"object_attr__{column}"


def _axis_uses_object_columns(axis: str | None, object_attr_columns: list[str]) -> bool:
    if axis in {"object_id", "object_type", "qualifier"}:
        return True
    if axis and axis.startswith("object_type:"):
        return True
    if axis and axis.startswith("object_attr:"):
        return axis.split(":", 1)[1] in object_attr_columns
    return False


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


def _bucket_count_for_point_limit(point_limit: int) -> int:
    return max(1, min(int(point_limit), MAX_SAMPLE_BUCKETS))


def _outlier_budget_for_point_limit(point_limit: int) -> int:
    return max(1, int(point_limit * OUTLIER_BUDGET_RATIO))


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
