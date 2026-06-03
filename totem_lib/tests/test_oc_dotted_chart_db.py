from totem_lib.oc_dotted_chart import get_oc_dotted_chart_data
from totem_lib.oc_dotted_chart.oc_dotted_chart_db import _bucket_count_for_point_limit
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


def test_oc_dotted_chart_bucket_count_is_bounded_by_points_and_frontend_cap():
    assert _bucket_count_for_point_limit(1) == 1
    assert _bucket_count_for_point_limit(100) == 100
    assert _bucket_count_for_point_limit(3_000) == 1_000
