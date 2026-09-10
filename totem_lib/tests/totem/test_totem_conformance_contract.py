import json

import polars as pl
import pytest
from totem_lib import (
    TotemConformanceResult as PublicTotemConformanceResult,
)
from totem_lib import conformance_of_totem as public_conformance_of_totem

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
    conformance_of_totem,
    get_more_precise_ec,
    get_more_precise_lc,
    get_more_precise_tr,
)
from totem_lib.totem.histograms_db import compute_totem_histograms_db
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


def make_disconnected_ocel():
    """Two active object types that never participate in the same event."""
    events = pl.DataFrame(
        {
            "_eventId": ["e-a", "e-b"],
            "_activity": ["Use A", "Use B"],
            "_timestampUnix": [1, 2],
            "_objects": [["a1"], ["b1"]],
            "_qualifiers": [["a"], ["b"]],
            "_attributes": ["{}", "{}"],
        },
        schema=EVENTS_SCHEMA,
    )
    objects = pl.DataFrame(
        {
            "_objId": ["a1", "b1"],
            "_objType": ["A", "B"],
            "_targetObjects": [[], []],
            "_qualifiers": [[], []],
        },
        schema=OBJECTS_SCHEMA,
    )
    return ObjectCentricEventLog(events=events, objects=objects)


def make_o2o_only_ocel():
    """Two active objects connected only by a qualified o2o relation."""
    events = pl.DataFrame(
        {
            "_eventId": ["e-a", "e-b"],
            "_activity": ["Use A", "Use B"],
            "_timestampUnix": [1, 2],
            "_objects": [["a1"], ["b1"]],
            "_qualifiers": [["a"], ["b"]],
            "_attributes": ["{}", "{}"],
        },
        schema=EVENTS_SCHEMA,
    )
    objects = pl.DataFrame(
        {
            "_objId": ["a1", "b1"],
            "_objType": ["A", "B"],
            "_targetObjects": [["b1"], []],
            "_qualifiers": [["links"], []],
        },
        schema=OBJECTS_SCHEMA,
    )
    return ObjectCentricEventLog(events=events, objects=objects)


def reference_connection_histograms(ocel):
    """Small independent oracle matching the reference branch's o2o logic."""
    object_types = {
        row["_objId"]: row["_objType"]
        for row in ocel.objects.iter_rows(named=True)
    }
    active_objects = {
        object_id
        for row in ocel.events.iter_rows(named=True)
        for object_id in row["_objects"]
    }
    connections = {object_id: set() for object_id in active_objects}
    relation_types = {}
    lifetimes = {}

    for row in ocel.events.iter_rows(named=True):
        event_objects = row["_objects"]
        timestamp = row["_timestampUnix"]
        for source in event_objects:
            connections[source].update(event_objects)
            previous = lifetimes.get(source)
            lifetimes[source] = (
                min(previous[0], timestamp),
                max(previous[1], timestamp),
            ) if previous else (timestamp, timestamp)
            for target in event_objects:
                if source != target:
                    relation_types.setdefault((source, target), "e2o")

    for row in ocel.objects.iter_rows(named=True):
        source = row["_objId"]
        for target, qualifier in zip(
            row["_targetObjects"] or [],
            row["_qualifiers"] or [],
        ):
            if not qualifier or source not in active_objects or target not in active_objects:
                continue
            connections[source].add(target)
            connections[target].add(source)
            relation_types[(source, target)] = qualifier
            relation_types[(target, source)] = qualifier

    log_cardinality = {}
    temporal = {}
    log_by_relation = {}
    temporal_by_relation = {}
    active_types = sorted({object_types[item] for item in active_objects})

    for source_type in active_types:
        sources = [
            item for item in active_objects if object_types[item] == source_type
        ]
        for target_type in active_types:
            cardinalities = [
                len(
                    {
                        target
                        for target in connections[source]
                        if object_types[target] == target_type
                    }
                )
                for source in sources
            ]
            log_cardinality[(source_type, target_type)] = (
                _reference_cardinality_counts(cardinalities)
            )

            for source in sources:
                grouped_targets = {}
                for target in connections[source]:
                    if object_types[target] != target_type:
                        continue
                    relation_type = relation_types.get(
                        (source, target),
                        "e2o",
                    )
                    grouped_targets.setdefault(relation_type, set()).add(target)

                for relation_type, targets in grouped_targets.items():
                    log_key = (source_type, target_type, relation_type)
                    counts = log_by_relation.setdefault(log_key, [])
                    counts.append(len(targets))

                    for target in targets:
                        temporal_key = (source_type, target_type)
                        detail_key = (
                            source_type,
                            target_type,
                            relation_type,
                        )
                        relation = _reference_temporal_relations(
                            lifetimes[source],
                            lifetimes[target],
                        )
                        for target_histogram, key in (
                            (temporal, temporal_key),
                            (temporal_by_relation, detail_key),
                        ):
                            histogram = target_histogram.setdefault(
                                key,
                                {"total": 0},
                            )
                            histogram["total"] += 1
                            for value in relation:
                                histogram[value] = histogram.get(value, 0) + 1

    return {
        "log_cardinality": log_cardinality,
        "temporal": temporal,
        "log_cardinality_by_relation_type": {
            key: _reference_cardinality_counts(values)
            for key, values in log_by_relation.items()
        },
        "temporal_by_relation_type": temporal_by_relation,
    }


def _reference_cardinality_counts(values):
    zero = sum(value == 0 for value in values)
    one = sum(value == 1 for value in values)
    many = sum(value > 1 for value in values)
    counts = {
        "total": len(values),
        "0": zero,
        "1": one,
        "0...1": zero + one,
        "1..*": one + many,
        "0...*": len(values),
    }
    return {key: value for key, value in counts.items() if value > 0}


def _reference_temporal_relations(source_lifetime, target_lifetime):
    source_min, source_max = source_lifetime
    target_min, target_max = target_lifetime
    relations = ["P"]
    if target_min <= source_min and source_max <= target_max:
        relations.append("D")
    if source_min <= target_min and target_max <= source_max:
        relations.append("Di")
    if (
        source_min <= source_max <= target_min <= target_max
        or source_min < target_min <= source_max < target_max
    ):
        relations.append("I")
    if (
        target_min <= target_max <= source_min <= source_max
        or target_min < source_min <= target_max < source_max
    ):
        relations.append("Ii")
    return relations


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


def test_shared_histograms_preserve_discovery_aggregate_semantics():
    database = OcelDuckDB(make_conformance_ocel())
    try:
        histograms = compute_totem_histograms_db(database)
    finally:
        database.close()

    assert histograms.event_cardinality[("Order", "Item")] == {
        "total": 4,
        "0": 2,
        "1": 2,
        "0...1": 4,
        "1..*": 2,
        "0...*": 4,
    }
    assert histograms.log_cardinality[("Order", "Item")] == {
        "total": 1,
        "0": 0,
        "1": 0,
        "0...1": 0,
        "1..*": 1,
        "0...*": 1,
    }
    assert histograms.temporal[("Item", "Order")] == {
        "total": 2,
        "D": 2,
        "P": 2,
    }
    assert histograms.temporal[("Order", "Item")] == {
        "total": 2,
        "Di": 2,
        "P": 2,
    }
    assert histograms.event_cardinality_by_activity == {}
    assert histograms.temporal_by_relation_type == {}
    assert histograms.log_cardinality_by_relation_type == {}


def test_detailed_histograms_preserve_activity_and_qualifier_dimensions():
    database = OcelDuckDB(make_conformance_ocel())
    try:
        histograms = compute_totem_histograms_db(
            database,
            include_details=True,
        )
    finally:
        database.close()

    assert histograms.event_cardinality_by_activity[
        ("Order", "Item", "Add Item")
    ] == {
        "total": 2,
        "1": 2,
        "0...1": 2,
        "1..*": 2,
        "0...*": 2,
    }
    assert histograms.event_cardinality_by_activity[
        ("Order", "Item", "Create Order")
    ] == {
        "total": 1,
        "0": 1,
        "0...1": 1,
        "0...*": 1,
    }
    assert histograms.temporal_by_relation_type[
        ("Item", "Order", "contains")
    ] == {
        "total": 2,
        "D": 2,
        "P": 2,
    }
    assert histograms.temporal_by_relation_type[
        ("Order", "Item", "contains")
    ] == {
        "total": 2,
        "Di": 2,
        "P": 2,
    }
    assert histograms.log_cardinality_by_relation_type[
        ("Order", "Item", "contains")
    ] == {
        "total": 1,
        "1..*": 1,
        "0...*": 1,
    }
    assert ("Order", "Item", "e2o") not in (
        histograms.temporal_by_relation_type
    )
    assert ("Item", "Order", "e2o") not in (
        histograms.temporal_by_relation_type
    )


def test_disconnected_types_have_cardinality_but_no_temporal_histogram():
    database = OcelDuckDB(make_disconnected_ocel())
    try:
        histograms = compute_totem_histograms_db(
            database,
            include_details=True,
        )
    finally:
        database.close()

    assert histograms.event_cardinality[("A", "B")] == {
        "total": 1,
        "0": 1,
        "1": 0,
        "0...1": 1,
        "1..*": 0,
        "0...*": 1,
    }
    assert histograms.log_cardinality[("A", "B")] == {
        "total": 1,
        "0": 1,
        "1": 0,
        "0...1": 1,
        "1..*": 0,
        "0...*": 1,
    }
    assert ("A", "B") not in histograms.temporal
    assert ("A", "B", "e2o") not in histograms.temporal_by_relation_type


def test_conformance_histograms_match_reference_for_o2o_only_connections():
    ocel = make_o2o_only_ocel()
    expected = reference_connection_histograms(ocel)
    database = OcelDuckDB(ocel)
    try:
        histograms = compute_totem_histograms_db(
            database,
            include_details=True,
            connection_mode="conformance",
        )
    finally:
        database.close()

    assert histograms.log_cardinality == expected["log_cardinality"]
    assert histograms.temporal == expected["temporal"]
    assert (
        histograms.log_cardinality_by_relation_type
        == expected["log_cardinality_by_relation_type"]
    )
    assert (
        histograms.temporal_by_relation_type
        == expected["temporal_by_relation_type"]
    )
    assert histograms.temporal[("A", "B")] == {
        "total": 1,
        "I": 1,
        "P": 1,
    }
    assert histograms.temporal[("B", "A")] == {
        "total": 1,
        "Ii": 1,
        "P": 1,
    }


def test_discovery_histograms_keep_directional_o2o_behavior():
    database = OcelDuckDB(make_o2o_only_ocel())
    try:
        histograms = compute_totem_histograms_db(database)
    finally:
        database.close()

    assert ("A", "B") in histograms.temporal
    assert ("B", "A") not in histograms.temporal


def test_histogram_connection_mode_is_validated():
    database = OcelDuckDB(make_o2o_only_ocel())
    try:
        with pytest.raises(ValueError, match="unknown"):
            compute_totem_histograms_db(database, connection_mode="unknown")
    finally:
        database.close()


def test_precision_hierarchies_match_reference_algorithm():
    assert get_more_precise_tr("P") == ("D", "Di", "I", "Ii")
    assert get_more_precise_tr("I") == ("D", "Di")
    assert get_more_precise_tr("Ii") == ("D", "Di")
    assert get_more_precise_tr("D") == ()
    assert get_more_precise_lc("0...*") == ("0", "1", "0...1", "1..*")
    assert get_more_precise_lc("0...1") == ("0", "1")
    assert get_more_precise_ec("1..*") == ("1",)


def test_conformance_algorithm_returns_stable_fitting_result():
    model = totem_from_dict(fitting_totem_data())
    database = OcelDuckDB(make_conformance_ocel())
    try:
        result = conformance_of_totem(model, database)
    finally:
        database.close()

    assert result.overall_metrics.temporal == FitnessPrecision(1.0, 1.0)
    assert result.overall_metrics.log_cardinality == FitnessPrecision(1.0, 1.0)
    assert result.overall_metrics.event_cardinality == FitnessPrecision(
        1.0,
        pytest.approx(2 / 3),
    )
    assert result.object_type_metrics == (
        ObjectTypeConformance(
            "Item",
            FitnessPrecision(1.0, 1.0),
            FitnessPrecision(1.0, 1.0),
            FitnessPrecision(1.0, 0.75),
        ),
        ObjectTypeConformance(
            "Order",
            FitnessPrecision(1.0, 1.0),
            FitnessPrecision(1.0, 1.0),
            FitnessPrecision(1.0, 0.75),
        ),
    )
    payload = result.to_dict()
    assert json.loads(json.dumps(payload, allow_nan=False)) == payload
    assert [
        (metric["source_type"], metric["target_type"])
        for metric in payload["type_pair_metrics"]
    ] == [("Item", "Order"), ("Order", "Item")]


def test_explicit_inverse_temporal_relation_is_used_directly():
    model_data = fitting_totem_data()
    model_data["tempgraph"]["D"] = []
    model_data["tempgraph"]["Di"] = [["Order", "Item"]]
    model = totem_from_dict(model_data)
    database = OcelDuckDB(make_conformance_ocel())
    try:
        result = conformance_of_totem(model, database)
    finally:
        database.close()

    pair_metrics = {
        (metric.source_type, metric.target_type): metric
        for metric in result.type_pair_metrics
    }
    assert pair_metrics[("Order", "Item")].temporal.model_relation == "Di"
    assert pair_metrics[("Order", "Item")].temporal.fitness == 1.0
    assert pair_metrics[("Item", "Order")].temporal.model_relation == "D"
    assert pair_metrics[("Item", "Order")].temporal.fitness == 1.0


def test_conformance_algorithm_returns_expected_non_fitting_result():
    model = totem_from_dict(non_fitting_totem_data())
    database = OcelDuckDB(make_conformance_ocel())
    try:
        result = conformance_of_totem(model, database)
    finally:
        database.close()

    assert result.overall_metrics == OverallConformance(
        temporal=FitnessPrecision(0.0, 1.0),
        log_cardinality=FitnessPrecision(0.0, 1.0),
        event_cardinality=FitnessPrecision(
            pytest.approx(1 / 3),
            pytest.approx(2 / 3),
        ),
    )
    assert result.object_type_metrics == (
        ObjectTypeConformance(
            "Item",
            FitnessPrecision(0.0, 1.0),
            FitnessPrecision(0.0, 1.0),
            FitnessPrecision(0.25, 0.75),
        ),
        ObjectTypeConformance(
            "Order",
            FitnessPrecision(0.0, 1.0),
            FitnessPrecision(0.0, 1.0),
            FitnessPrecision(0.25, 0.75),
        ),
    )

    pair_metrics = {
        (metric.source_type, metric.target_type): metric
        for metric in result.type_pair_metrics
    }
    assert pair_metrics[("Item", "Order")].temporal.fitness == 0.0
    assert pair_metrics[("Item", "Order")].log_cardinality.fitness == 0.0
    assert pair_metrics[("Order", "Item")].event_cardinality == (
        RelationConformance("1..*", 0.5, 0.5)
    )


def test_model_types_missing_from_log_produce_unavailable_metrics():
    model_data = fitting_totem_data()
    model_data["tempgraph"] = {
        "nodes": ["Ghost", "Order"],
        "D": [["Ghost", "Order"]],
        "Di": [],
        "I": [],
        "Ii": [],
        "P": [],
    }
    model_data["cardinalities"] = [
        {
            "from": "Ghost",
            "to": "Order",
            "log_cardinality": "1",
            "event_cardinality": "1",
        }
    ]
    model_data["type_relations"] = [["Ghost", "Order"]]
    model_data["object_type_to_event_types"] = {
        "Ghost": [],
        "Order": ["Add Item", "Close Order", "Create Order"],
    }
    model = totem_from_dict(model_data)
    database = OcelDuckDB(make_conformance_ocel())
    try:
        result = conformance_of_totem(model, database)
    finally:
        database.close()

    unavailable = FitnessPrecision(None, None)
    assert result.overall_metrics == OverallConformance(
        temporal=unavailable,
        log_cardinality=unavailable,
        event_cardinality=unavailable,
    )
    assert all(
        metric.temporal == RelationConformance("D", None, None)
        and metric.log_cardinality == RelationConformance("1", None, None)
        and metric.event_cardinality == RelationConformance("1", None, None)
        for metric in result.type_pair_metrics
    )
    assert all(
        metric.temporal == unavailable
        and metric.log_cardinality == unavailable
        and metric.event_cardinality == unavailable
        for metric in result.object_type_metrics
    )


def test_empty_model_returns_stable_empty_metrics():
    model = totem_from_dict(
        {
            "schema": "totem",
            "version": 1,
            "tempgraph": {
                "nodes": [],
                "D": [],
                "Di": [],
                "I": [],
                "Ii": [],
                "P": [],
            },
            "cardinalities": [],
            "type_relations": [],
            "all_event_types": [],
            "object_type_to_event_types": {},
        }
    )
    database = OcelDuckDB(make_conformance_ocel())
    try:
        result = conformance_of_totem(model, database)
    finally:
        database.close()

    unavailable = FitnessPrecision(None, None)
    assert result.overall_metrics == OverallConformance(
        temporal=unavailable,
        log_cardinality=unavailable,
        event_cardinality=unavailable,
    )
    assert result.object_type_metrics == ()
    assert result.type_pair_metrics == ()
    assert json.loads(json.dumps(result.to_dict(), allow_nan=False)) == (
        result.to_dict()
    )


def test_conformance_api_is_exposed_from_package_root():
    assert public_conformance_of_totem is conformance_of_totem
    assert PublicTotemConformanceResult is TotemConformanceResult


def test_conformance_result_contract_is_deterministic_and_json_compatible():
    medium = FitnessPrecision(fitness=0.75, precision=0.5)
    high = FitnessPrecision(fitness=1.0, precision=1.0)
    pair = TypePairConformance(
        source_type="Order",
        target_type="Item",
        temporal=RelationConformance("Di", 0.75, 0.5),
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

    assert list(payload["object_type_metrics"]) == ["Item", "Order"]
    assert payload["object_type_metrics"]["Order"]["temporal"] == {
        "avg_fitness": 0.75,
        "avg_precision": 0.5,
    }
    assert payload["type_pair_metrics"][0]["source_type"] == "Order"
    assert payload["histograms"]["temporal"] == [
        {
            "source_type": "Order",
            "target_type": "Item",
            "counts": {"D": 3, "total": 4},
        }
    ]
    assert json.loads(json.dumps(payload, sort_keys=True)) == payload
