"""Stored-column replay units and object-type projection."""

import os
import tempfile
from pathlib import Path

import pytest

from totem_lib import (
    CONNECTED_COMPONENTS_REPLAY_STRATEGY,
    LEADING_OBJECT_REPLAY_STRATEGY,
    REPLAY_UNIT_STRATEGIES,
    STORED_COLUMN_REPLAY_STRATEGY,
    OCCNReplayEvent,
    OCCNReplayStatus,
    build_stored_column_replay_units,
    discover_occn,
    extract_occn_replay_units,
    occn_replay_fitness,
    project_replay_events,
)
from totem_lib.ocel import OcelDuckDB, import_ocel_db, write_event_columns_to_file
from totem_lib.ocel.importer import import_ocel
from totem_lib.variants import extract_process_executions, partition_events

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"
CLEAN_LOG = TEST_DATA / "resource_aware_orders.json"
DEVIATING_LOG = TEST_DATA / "resource_aware_orders_deviating.json"
BUSINESS_TYPES = ["order", "item", "package"]
BUSINESS_ACTIVITIES = ["place order", "pick item", "pack items", "ship package", "close order"]


def _event(event_id, activity, timestamp, objects_by_type):
    return OCCNReplayEvent(
        event_id=event_id,
        activity=activity,
        timestamp_unix=timestamp,
        objects_by_type=objects_by_type,
    )


EVENTS = (
    _event("e1", "a", 1, (("order", ("o1",)), ("worker", ("w1",)))),
    _event("e2", "a", 2, (("order", ("o2",)), ("worker", ("w1",)))),
    _event("e3", "b", 3, (("order", ("o1",)),)),
    _event("e4", "shift", 4, (("worker", ("w1",)),)),
)


def test_strategy_registry_lists_the_stored_column_strategy():
    assert STORED_COLUMN_REPLAY_STRATEGY in REPLAY_UNIT_STRATEGIES
    assert CONNECTED_COMPONENTS_REPLAY_STRATEGY in REPLAY_UNIT_STRATEGIES
    assert LEADING_OBJECT_REPLAY_STRATEGY in REPLAY_UNIT_STRATEGIES


def test_stored_column_units_group_by_execution_id_and_skip_unassigned_events():
    units = build_stored_column_replay_units(
        EVENTS, {"e1": "x", "e3": "x", "e2": "y", "e4": None}
    )

    assert [unit.unit_id for unit in units] == ["stored_column:x", "stored_column:y"]
    assert all(unit.strategy == STORED_COLUMN_REPLAY_STRATEGY for unit in units)
    assert units[0].event_ids == ("e1", "e3")
    assert units[1].event_ids == ("e2",)


def test_stored_column_units_are_ordered_by_their_first_event():
    units = build_stored_column_replay_units(EVENTS, {"e2": "first", "e1": "second"})
    assert [unit.unit_id for unit in units] == [
        "stored_column:second",
        "stored_column:first",
    ]


def test_stored_column_units_reject_invalid_input():
    with pytest.raises(ValueError, match="non-empty string"):
        build_stored_column_replay_units(EVENTS, {"e1": ""})
    with pytest.raises(ValueError, match="OCCNReplayEvent"):
        build_stored_column_replay_units(("nope",), {})
    with pytest.raises(ValueError, match="unique"):
        build_stored_column_replay_units((EVENTS[0], EVENTS[0]), {"e1": "x"})


def test_projection_drops_foreign_objects_and_objectless_events():
    projected = project_replay_events(EVENTS, ["order"])

    assert [event.event_id for event in projected] == ["e1", "e2", "e3"]
    assert projected[0].objects_by_type == (("order", ("o1",)),)
    # Untouched events keep their identity.
    assert projected[2] is EVENTS[2]


def test_projection_validates_object_types():
    with pytest.raises(ValueError, match="at least one"):
        project_replay_events(EVENTS, [])
    with pytest.raises(ValueError, match="iterable of strings"):
        project_replay_events(EVENTS, "order")


def test_extraction_validates_strategy_specific_options():
    ocel = import_ocel(str(CLEAN_LOG))
    with pytest.raises(ValueError, match="execution_column is only supported"):
        extract_occn_replay_units(
            ocel, CONNECTED_COMPONENTS_REPLAY_STRATEGY, execution_column="execution"
        )
    with pytest.raises(ValueError, match="execution_column is required"):
        extract_occn_replay_units(ocel, STORED_COLUMN_REPLAY_STRATEGY)
    with pytest.raises(ValueError, match="leading_object_type is only supported"):
        extract_occn_replay_units(
            ocel,
            STORED_COLUMN_REPLAY_STRATEGY,
            leading_object_type="order",
            execution_column="execution",
        )
    with pytest.raises(ValueError, match="does not exist"):
        extract_occn_replay_units(
            ocel, STORED_COLUMN_REPLAY_STRATEGY, execution_column="missing"
        )


def test_extraction_reads_stored_column_from_duckdb_and_rejects_unknown_columns():
    db = import_ocel_db(str(CLEAN_LOG))
    try:
        with pytest.raises(ValueError, match="does not exist"):
            extract_occn_replay_units(
                db, STORED_COLUMN_REPLAY_STRATEGY, execution_column="missing"
            )
        # Projection applies to every strategy: without the worker the
        # standard strategy no longer collapses the log into one unit.
        assert len(extract_occn_replay_units(db)) == 1
        assert len(extract_occn_replay_units(db, object_types=BUSINESS_TYPES)) == 3
    finally:
        db.close()


def _store_resource_aware_executions(source: Path, path: str) -> None:
    db = import_ocel_db(str(source), db_path=path)
    executions = extract_process_executions(
        db,
        extraction="resource_aware",
        business_object_types=BUSINESS_TYPES,
        business_activities=BUSINESS_ACTIVITIES,
    )
    partition = partition_events(executions.case_events)
    db.close()
    write_event_columns_to_file(path, {"execution": partition.assignment})


def test_end_to_end_stored_executions_detect_the_missing_pick():
    with tempfile.TemporaryDirectory() as tmp:
        clean_path = os.path.join(tmp, "clean.duckdb")
        deviating_path = os.path.join(tmp, "deviating.duckdb")
        _store_resource_aware_executions(CLEAN_LOG, clean_path)
        _store_resource_aware_executions(DEVIATING_LOG, deviating_path)

        clean = OcelDuckDB.load(clean_path, read_only=True)
        deviating = OcelDuckDB.load(deviating_path, read_only=True)
        try:
            # The model deliberately leaves the worker out ...
            occn = discover_occn(
                clean, relativeOccuranceThreshold=0.0, parameters={"object_types": BUSINESS_TYPES}
            )
            assert set(occn.object_types) == set(BUSINESS_TYPES)

            # ... so the log has to be projected onto the model's object types
            # for the stored executions to be replayable at all.
            unprojected = extract_occn_replay_units(
                clean, STORED_COLUMN_REPLAY_STRATEGY, execution_column="execution"
            )
            assert occn_replay_fitness(occn, unprojected).fitness == 0.0
            assert all(
                result.stopping_activity == "START_worker"
                for result in occn_replay_fitness(occn, unprojected).unit_results
            )

            clean_units = extract_occn_replay_units(
                clean,
                STORED_COLUMN_REPLAY_STRATEGY,
                execution_column="execution",
                object_types=occn.object_types,
            )
            assert [unit.unit_id for unit in clean_units] == [
                "stored_column:i1",
                "stored_column:i3",
                "stored_column:i5",
            ]
            assert occn_replay_fitness(occn, clean_units).fitness == 1.0

            deviating_units = extract_occn_replay_units(
                deviating,
                STORED_COLUMN_REPLAY_STRATEGY,
                execution_column="execution",
                object_types=occn.object_types,
            )
            result = occn_replay_fitness(occn, deviating_units)
            assert result.fitness == pytest.approx(2 / 3)
            by_unit = {r.unit_id: r for r in result.unit_results}
            assert by_unit["stored_column:i3"].status is OCCNReplayStatus.NON_FITTING
            assert by_unit["stored_column:i3"].stopping_activity == "pack items"
            assert by_unit["stored_column:i3"].failure_event_id == "e11"
            assert by_unit["stored_column:i1"].status is OCCNReplayStatus.FITTING
            assert by_unit["stored_column:i5"].status is OCCNReplayStatus.FITTING
        finally:
            clean.close()
            deviating.close()


def test_polars_source_reads_stored_column_from_event_attributes():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "clean.duckdb")
        _store_resource_aware_executions(CLEAN_LOG, path)
        ocel = import_ocel(path)
        units = extract_occn_replay_units(
            ocel, STORED_COLUMN_REPLAY_STRATEGY, execution_column="execution"
        )
        assert [unit.unit_id for unit in units] == [
            "stored_column:i1",
            "stored_column:i3",
            "stored_column:i5",
        ]
        with pytest.raises(ValueError, match="does not exist"):
            extract_occn_replay_units(
                ocel, STORED_COLUMN_REPLAY_STRATEGY, execution_column="missing"
            )
