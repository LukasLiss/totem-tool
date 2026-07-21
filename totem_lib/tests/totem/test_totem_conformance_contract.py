import json

import polars as pl

from totem_lib.ocel.ocel import (
    EVENTS_SCHEMA,
    OBJECTS_SCHEMA,
    ObjectCentricEventLog,
)
from totem_lib.ocel.ocel_duckdb import OcelDuckDB
from totem_lib.totem.conformance import (
    FitnessPrecision,
    ObjectTypeConformance,
    OverallConformance,
    RelationConformance,
    TotemConformanceHistograms,
    TotemConformanceResult,
    TypePairConformance,
)
from totem_lib.totem.serialization import totem_from_dict, totem_to_dict
from totem_lib.totem.totem_db import totemDiscovery_db


def make_conformance_ocel():
    """Small two-type log shared by the upcoming conformance tests."""
    events = pl.DataFrame(
        {
            "_eventId": ["e1", "e2", "e3", "e4"],
            "_activity": [
                "Create Order",
                "Add Item",
                "Add Item",
                "Close Order",
            ],
            "_timestampUnix": [1, 2, 3, 4],
            "_objects": [
                ["o1"],
                ["o1", "i1"],
                ["o1", "i2"],
                ["o1"],
            ],
            "_qualifiers": [
                ["order"],
                ["order", "item"],
                ["order", "item"],
                ["order"],
            ],
            "_attributes": ["{}", "{}", "{}", "{}"],
        },
        schema=EVENTS_SCHEMA,
    )
    objects = pl.DataFrame(
        {
            "_objId": ["o1", "i1", "i2"],
            "_objType": ["Order", "Item", "Item"],
            "_targetObjects": [["i1", "i2"], [], []],
            "_qualifiers": [["contains", "contains"], [], []],
        },
        schema=OBJECTS_SCHEMA,
    )
    return ObjectCentricEventLog(events=events, objects=objects)


def fitting_totem_data():
    """Canonical model matching the relation and cardinalities in the log."""
    return {
        "schema": "totem",
        "version": 1,
        "tempgraph": {
            "nodes": ["Item", "Order"],
            "D": [["Item", "Order"]],
            "Di": [],
            "I": [],
            "Ii": [],
            "P": [],
        },
        "cardinalities": [
            {
                "from": "Item",
                "to": "Order",
                "log_cardinality": "1",
                "event_cardinality": "1",
            },
            {
                "from": "Order",
                "to": "Item",
                "log_cardinality": "1..*",
                "event_cardinality": "0...1",
            },
        ],
        "type_relations": [["Item", "Order"]],
        "all_event_types": ["Add Item", "Close Order", "Create Order"],
        "object_type_to_event_types": {
            "Item": ["Add Item"],
            "Order": ["Add Item", "Close Order", "Create Order"],
        },
    }


def non_fitting_totem_data():
    """Canonical model deliberately contradicting the same event log."""
    data = fitting_totem_data()
    data["tempgraph"]["D"] = [["Order", "Item"]]
    data["cardinalities"] = [
        {
            "from": "Item",
            "to": "Order",
            "log_cardinality": "0",
            "event_cardinality": "0",
        },
        {
            "from": "Order",
            "to": "Item",
            "log_cardinality": "0",
            "event_cardinality": "1..*",
        },
    ]
    return data


def test_conformance_scenarios_use_independently_loaded_canonical_models():
    fitting = totem_from_dict(fitting_totem_data())
    non_fitting = totem_from_dict(non_fitting_totem_data())

    assert totem_to_dict(fitting) == fitting_totem_data()
    assert totem_to_dict(non_fitting) == non_fitting_totem_data()
    assert fitting.tempgraph["D"] == {("Item", "Order")}
    assert non_fitting.tempgraph["D"] == {("Order", "Item")}


def test_conformance_log_scenario_is_available_through_duckdb():
    database = OcelDuckDB(make_conformance_ocel())
    try:
        assert database.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 4
        assert database.conn.execute("SELECT COUNT(*) FROM objects").fetchone()[0] == 3
        assert database.conn.execute(
            "SELECT DISTINCT qualifier FROM object_relations"
        ).fetchall() == [("contains",)]
    finally:
        database.close()


def test_fitting_scenario_matches_current_duckdb_discovery():
    database = OcelDuckDB(make_conformance_ocel())
    try:
        assert totem_to_dict(totemDiscovery_db(database)) == fitting_totem_data()
    finally:
        database.close()


def test_conformance_result_contract_is_deterministic_and_json_compatible():
    medium = FitnessPrecision(fitness=0.75, precision=0.5)
    high = FitnessPrecision(fitness=1.0, precision=1.0)
    pair = TypePairConformance(
        source_type="Order",
        target_type="Item",
        temporal=RelationConformance("D", 0.75, 0.5),
        log_cardinality=RelationConformance("1..*", 1.0, 1.0),
        event_cardinality=RelationConformance("0...1", 1.0, 1.0),
    )
    result = TotemConformanceResult(
        overall_metrics=OverallConformance(
            temporal=medium,
            log_cardinality=high,
            event_cardinality=high,
        ),
        object_type_metrics=(
            ObjectTypeConformance("Order", medium, high, high),
            ObjectTypeConformance("Item", medium, high, high),
        ),
        type_pair_metrics=(pair,),
        histograms=TotemConformanceHistograms(
            temporal={("Order", "Item"): {"total": 4, "D": 3}},
            log_cardinality={("Order", "Item"): {"total": 1, "1..*": 1}},
            event_cardinality={("Order", "Item"): {"total": 4, "0...1": 4}},
            event_cardinality_by_activity={
                ("Order", "Item", "Add Item"): {"total": 2, "1": 2}
            },
            temporal_by_relation_type={
                ("Order", "Item", "contains"): {"total": 2, "D": 2}
            },
            log_cardinality_by_relation_type={
                ("Order", "Item", "contains"): {"total": 1, "1..*": 1}
            },
        ),
    )

    payload = result.to_dict()

    assert [item["object_type"] for item in payload["object_type_metrics"]] == [
        "Item",
        "Order",
    ]
    assert payload["type_pair_metrics"][0]["source_type"] == "Order"
    assert payload["histograms"]["temporal"] == [
        {
            "source_type": "Order",
            "target_type": "Item",
            "counts": {"D": 3, "total": 4},
        }
    ]
    assert json.loads(json.dumps(payload, sort_keys=True)) == payload
