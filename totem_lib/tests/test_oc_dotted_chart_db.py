from totem_lib.oc_dotted_chart import get_oc_dotted_chart_columns, get_oc_dotted_chart_data
from totem_lib.oc_dotted_chart.oc_dotted_chart_db import (
    _bucket_count_for_point_limit,
    _clamp_max_points,
    _outlier_budget_for_point_limit,
)
from totem_lib.ocel import import_ocel_db


def test_oc_dotted_chart_caps_rows_and_returns_contract():
    db = import_ocel_db("totem_lib/test_data/small/container_logistics.xml")

    result = get_oc_dotted_chart_data(db, max_points=250)

    assert result["total_count"] > 0
    assert len(result["events"]) <= 250
    assert result["sampled"] is True
    assert result["outlier_count"] >= 0
    assert {
        "id",
        "x",
        "y",
        "color_value",
        "shape_value",
        "activity",
        "timestamp",
        "row_id",
        "row_index",
        "event_index_in_row",
        "objects",
    } <= set(result["events"][0])
    assert all(event["y"] == event["activity"] for event in result["events"])
    assert all(event["color_value"] == event["activity"] for event in result["events"])


def test_oc_dotted_chart_supports_row_viewport_filter():
    db = import_ocel_db("totem_lib/test_data/small/container_logistics.xml")

    result = get_oc_dotted_chart_data(
        db,
        row_min=1,
        row_max=5,
        max_points=500,
    )

    assert result["total_count"] >= len(result["events"])
    assert all(1 <= event["row_index"] <= 5 for event in result["events"])


def test_oc_dotted_chart_ignores_unknown_y_axis_values():
    db = import_ocel_db("totem_lib/test_data/small/container_logistics.xml")

    result = get_oc_dotted_chart_data(
        db,
        y_axis="not_a_dimension",
        max_points=250,
    )

    assert result["events"] == []
    assert result["total_count"] == 0
    assert result["sampled"] is False


def test_oc_dotted_chart_supports_since_start_x_axis():
    db = import_ocel_db("totem_lib/test_data/small/container_logistics.xml")

    result = get_oc_dotted_chart_data(
        db,
        x_axis="since_start",
        max_points=500,
    )

    log_start_timestamp = db.conn.execute("SELECT MIN(timestamp_unix) FROM events").fetchone()[0]
    assert min(event["x"] for event in result["events"]) == 0
    assert all(event["x"] == event["timestamp_unix"] - log_start_timestamp for event in result["events"])


def test_oc_dotted_chart_exposes_object_dimensions_for_configuration():
    db = import_ocel_db("totem_lib/test_data/small/container_logistics.xml")

    columns = get_oc_dotted_chart_columns(db)
    y_values = {option["value"] for option in columns["y_axis"]}
    x_values = {option["value"] for option in columns["x_axis"]}

    assert {"object_id", "object_type:Container", "object_type:Customer Order", "qualifier", "object_attr:Status"} <= y_values
    assert "object_attr:DepartureDate" not in y_values
    assert "object_attr:DepartureDate" in x_values

    result = get_oc_dotted_chart_data(db, y_axis="object_type:Container", color_by="object_attr:Status", max_points=250)
    container_ids = {
        row[0]
        for row in db.conn.execute("SELECT obj_id FROM objects WHERE obj_type = 'Container'").fetchall()
    }

    assert result["total_count"] > 0
    assert {event["y"] for event in result["events"]} <= container_ids
    assert any(event["color_value"] for event in result["events"])


def test_oc_dotted_chart_bucket_count_is_bounded_by_points_and_frontend_cap():
    assert _bucket_count_for_point_limit(1) == 1
    assert _bucket_count_for_point_limit(100) == 100
    assert _bucket_count_for_point_limit(3_000) == 3_000
    assert _bucket_count_for_point_limit(25_000) == 20_000


def test_oc_dotted_chart_point_limit_is_bounded_by_minimum_and_hard_cap():
    assert _clamp_max_points(20) == 100
    assert _clamp_max_points(3_000) == 3_000
    assert _clamp_max_points(25_000) == 20_000


def test_oc_dotted_chart_outlier_budget_is_twenty_percent_of_point_limit():
    assert _outlier_budget_for_point_limit(100) == 20
    assert _outlier_budget_for_point_limit(3_000) == 600
