from totem_lib.oc_dotted_chart import get_oc_dotted_chart_data
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
        "row_object_type",
        "row_id",
        "row_index",
        "objects",
    } <= set(result["events"][0])
    assert result["object_type"] is None
    assert all(event["row_object_type"] is None for event in result["events"])
    assert all(event["y"] == event["activity"] for event in result["events"])


def test_oc_dotted_chart_supports_object_row_viewport_filter():
    db = import_ocel_db("totem_lib/test_data/small/container_logistics.xml")

    result = get_oc_dotted_chart_data(
        db,
        object_type="Container",
        row_min=1,
        row_max=25,
        max_points=500,
    )

    assert result["total_count"] >= len(result["events"])
    assert result["object_type"] == "Container"
    assert all(event["row_object_type"] == "Container" for event in result["events"])
    assert all(event["row_index"] <= 25 for event in result["events"])


def test_oc_dotted_chart_uses_object_rows_when_object_type_is_selected():
    db = import_ocel_db("totem_lib/test_data/small/container_logistics.xml")

    default_result = get_oc_dotted_chart_data(
        db,
        object_type="Container",
        max_points=250,
    )
    row_result = get_oc_dotted_chart_data(
        db,
        object_type="Container",
        y_axis="row_index",
        max_points=250,
    )

    assert default_result["object_type"] == "Container"
    assert all(event["row_object_type"] == "Container" for event in default_result["events"])
    assert all(event["y"] == event["activity"] for event in default_result["events"])
    assert all(event["y"] == event["row_index"] for event in row_result["events"])
