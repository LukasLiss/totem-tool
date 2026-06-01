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
        "objects",
    } <= set(result["events"][0])


def test_oc_dotted_chart_supports_case_viewport_filter():
    db = import_ocel_db("totem_lib/test_data/small/container_logistics.xml")

    result = get_oc_dotted_chart_data(
        db,
        case_min=1,
        case_max=25,
        max_points=500,
    )

    assert result["total_count"] >= len(result["events"])
    assert all(event["case_index"] <= 25 for event in result["events"])
