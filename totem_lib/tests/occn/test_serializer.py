import json
from pathlib import Path

from totem_lib import discover_occn, serialize_occn
from totem_lib.ocel.importer_db import import_ocel_db

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"


def _occn():
    ocel_db = import_ocel_db(str(TEST_DATA / "container_logistics.duckdb"))
    return discover_occn(ocel_db, relativeOccuranceThreshold=0)


def test_serialize_returns_dict():
    result = serialize_occn(_occn())
    assert isinstance(result, dict)


def test_top_level_keys():
    result = serialize_occn(_occn())
    assert set(result.keys()) == {
        "object_types",
        "relative_occurrence_threshold",
        "activities",
        "edges",
        "input_marker_groups",
        "output_marker_groups",
    }


def test_is_json_serializable():
    result = serialize_occn(_occn())
    dumped = json.dumps(result)
    assert isinstance(dumped, str)


def test_object_types_sorted_list():
    result = serialize_occn(_occn())
    ots = result["object_types"]
    assert isinstance(ots, list)
    assert ots == sorted(ots)
    assert len(ots) > 0


def test_activities_structure():
    result = serialize_occn(_occn())
    assert len(result["activities"]) > 0
    for act in result["activities"]:
        assert "id" in act
        assert "count" in act
        assert isinstance(act["id"], str)
        assert isinstance(act["count"], int)


def test_edges_structure():
    result = serialize_occn(_occn())
    assert len(result["edges"]) > 0
    for edge in result["edges"]:
        assert set(edge.keys()) == {"source", "target", "object_type", "dependence_measure"}


def test_marker_groups_cover_all_activities():
    occn = _occn()
    result = serialize_occn(occn)
    activity_ids = {a["id"] for a in result["activities"]}
    assert set(result["input_marker_groups"].keys()) == activity_ids
    assert set(result["output_marker_groups"].keys()) == activity_ids


def test_marker_structure():
    result = serialize_occn(_occn())
    for act, groups in result["input_marker_groups"].items():
        for group in groups:
            assert "support_count" in group
            assert "markers" in group
            for marker in group["markers"]:
                assert set(marker.keys()) == {
                    "related_activity", "object_type",
                    "min_count", "max_count", "marker_key",
                }
                assert marker["max_count"] is None or isinstance(marker["max_count"], int)


def test_infinity_max_count_serialized_as_null():
    """max_count of float('inf') must become null in the JSON output."""
    from totem_lib.occn.occn import OCCausalNet
    import networkx as nx

    dg = nx.MultiDiGraph()
    dg.add_node("START_order")
    dg.add_node("A")
    dg.add_node("END_order")
    dg.add_edge("START_order", "A", key="order", objectType="order")
    dg.add_edge("A", "END_order", key="order", objectType="order")

    img = {
        "START_order": [],
        "A": [
            OCCausalNet.MarkerGroup([
                OCCausalNet.Marker("START_order", "order", (1, float("inf")), 0)
            ])
        ],
        "END_order": [
            OCCausalNet.MarkerGroup([
                OCCausalNet.Marker("A", "order", (1, 1), 0)
            ])
        ],
    }
    omg = {
        "START_order": [
            OCCausalNet.MarkerGroup([
                OCCausalNet.Marker("A", "order", (1, 1), 0)
            ])
        ],
        "A": [
            OCCausalNet.MarkerGroup([
                OCCausalNet.Marker("END_order", "order", (1, 1), 0)
            ])
        ],
        "END_order": [],
    }

    occn = OCCausalNet(dg, omg, img)
    result = serialize_occn(occn)

    # The marker with float("inf") max_count must serialize as null
    inf_markers = [
        m
        for groups in result["input_marker_groups"].values()
        for group in groups
        for m in group["markers"]
        if m["max_count"] is None
    ]
    assert len(inf_markers) > 0
    assert json.dumps(result)  # must remain JSON-serializable
