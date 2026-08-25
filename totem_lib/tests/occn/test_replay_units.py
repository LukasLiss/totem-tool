from dataclasses import FrozenInstanceError

import polars as pl
import pytest

from totem_lib import (
    CONNECTED_COMPONENTS_REPLAY_STRATEGY,
    LEADING_OBJECT_REPLAY_STRATEGY,
    OCCNReplayEvent,
    OCCNReplayUnit,
    OCCausalNetSemantics,
    OCCausalNetState,
    build_connected_component_replay_units,
    build_leading_object_replay_units,
    extract_occn_replay_events,
    extract_occn_replay_units,
    replay_events_from_duckdb,
    replay_events_from_ocel,
)
from totem_lib.ocel.ocel import EVENTS_SCHEMA, OBJECTS_SCHEMA, ObjectCentricEventLog
from totem_lib.ocel.ocel_duckdb import OcelDuckDB
from tests.assets.example_occns import occn_basic


def make_event(
    event_id="e1",
    activity="Create Order",
    timestamp=1,
    objects_by_type=(("Order", ("o1",)),),
):
    return OCCNReplayEvent(
        event_id=event_id,
        activity=activity,
        timestamp_unix=timestamp,
        objects_by_type=objects_by_type,
    )


def make_ocel(
    *,
    events=None,
    objects=None,
):
    if events is None:
        events = [
            {
                "_eventId": "e3",
                "_activity": "Ship Order",
                "_timestampUnix": 3,
                "_objects": ["o1"],
                "_qualifiers": [None],
                "_attributes": "",
            },
            {
                "_eventId": "e1",
                "_activity": "Create Order",
                "_timestampUnix": 1,
                "_objects": ["o1"],
                "_qualifiers": [None],
                "_attributes": "",
            },
            {
                "_eventId": "e4",
                "_activity": "Audit",
                "_timestampUnix": 2,
                "_objects": [],
                "_qualifiers": [],
                "_attributes": "",
            },
            {
                "_eventId": "e2",
                "_activity": "Add Item",
                "_timestampUnix": 2,
                "_objects": ["o1", "i1"],
                "_qualifiers": [None, None],
                "_attributes": "",
            },
        ]
    if objects is None:
        objects = [
            {
                "_objId": "o1",
                "_objType": "Order",
                "_targetObjects": [],
                "_qualifiers": [],
            },
            {
                "_objId": "i1",
                "_objType": "Item",
                "_targetObjects": [],
                "_qualifiers": [],
            },
            {
                "_objId": "unused",
                "_objType": "Order",
                "_targetObjects": [],
                "_qualifiers": [],
            },
        ]
    return ObjectCentricEventLog(
        events=pl.DataFrame(events, schema=EVENTS_SCHEMA),
        objects=pl.DataFrame(objects, schema=OBJECTS_SCHEMA),
    )


def test_replay_event_canonicalizes_typed_objects():
    event = make_event(
        objects_by_type=(
            ("Order", ("o2", "o1")),
            ("Item", ("i2", "i1")),
        )
    )

    assert event.objects_by_type == (
        ("Item", ("i1", "i2")),
        ("Order", ("o1", "o2")),
    )
    assert event.object_ids == frozenset({"i1", "i2", "o1", "o2"})
    assert event.object_types == ("Item", "Order")


def test_replay_event_allows_no_objects_for_explicit_failure_reporting():
    event = make_event(objects_by_type=())

    assert event.object_ids == frozenset()
    assert event.object_types == ()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("event_id", ""),
        ("activity", ""),
        ("timestamp_unix", True),
        ("timestamp_unix", float("inf")),
        ("timestamp_unix", float("nan")),
    ],
)
def test_replay_event_rejects_invalid_scalar_fields(field, value):
    values = {
        "event_id": "e1",
        "activity": "Create Order",
        "timestamp_unix": 1,
        "objects_by_type": (("Order", ("o1",)),),
    }
    values[field] = value

    with pytest.raises(ValueError):
        OCCNReplayEvent(**values)


@pytest.mark.parametrize(
    "objects_by_type",
    [
        (("Order", ("o1",)), ("Order", ("o2",))),
        (("Order", ("o1", "o1")),),
        (("Order", ("shared",)), ("Item", ("shared",))),
        (("Order", ()),),
        (("", ("o1",)),),
        (("Order", ("",)),),
        (("Order", "o1"),),
        (("Order",),),
    ],
)
def test_replay_event_rejects_invalid_object_groups(objects_by_type):
    with pytest.raises(ValueError):
        make_event(objects_by_type=objects_by_type)


def test_replay_event_is_frozen_and_serializes_deterministically():
    event = make_event(
        objects_by_type=(
            ("Order", ("o2", "o1")),
            ("Item", ("i1",)),
        )
    )

    with pytest.raises(FrozenInstanceError):
        event.activity = "Changed"

    assert event.to_dict() == {
        "event_id": "e1",
        "activity": "Create Order",
        "timestamp_unix": 1,
        "objects_by_type": {
            "Item": ["i1"],
            "Order": ["o1", "o2"],
        },
    }


def test_polars_ocel_adapter_normalizes_all_events_deterministically():
    events = replay_events_from_ocel(make_ocel())

    assert tuple(event.event_id for event in events) == (
        "e1",
        "e2",
        "e4",
        "e3",
    )
    assert events[1].objects_by_type == (
        ("Item", ("i1",)),
        ("Order", ("o1",)),
    )
    assert events[2].objects_by_type == ()


def test_duckdb_adapter_matches_polars_adapter_and_keeps_objectless_events():
    source = make_ocel()
    database = OcelDuckDB(source)
    try:
        polars_events = replay_events_from_ocel(source)
        duckdb_events = replay_events_from_duckdb(database)
    finally:
        database.conn.close()

    assert duckdb_events == polars_events
    assert "e4" in {event.event_id for event in duckdb_events}


def test_replay_event_dispatcher_supports_both_ocel_representations():
    source = make_ocel()
    database = OcelDuckDB(source)
    try:
        assert extract_occn_replay_events(source) == replay_events_from_ocel(
            source
        )
        assert extract_occn_replay_events(
            database
        ) == replay_events_from_duckdb(database)
    finally:
        database.conn.close()


def test_polars_ocel_adapter_rejects_missing_columns():
    source = make_ocel()
    source.events = source.events.drop("_objects")

    with pytest.raises(ValueError, match="_objects"):
        replay_events_from_ocel(source)


def test_polars_ocel_adapter_rejects_duplicate_event_ids():
    events = make_ocel().events.to_dicts()
    events.append(dict(events[0]))

    with pytest.raises(ValueError, match="duplicate event id"):
        replay_events_from_ocel(make_ocel(events=events))


def test_polars_ocel_adapter_rejects_duplicate_object_ids():
    objects = make_ocel().objects.to_dicts()
    objects.append(dict(objects[0]))

    with pytest.raises(ValueError, match="duplicate object id"):
        replay_events_from_ocel(make_ocel(objects=objects))


def test_polars_ocel_adapter_rejects_unknown_objects():
    events = make_ocel().events.to_dicts()
    events[0]["_objects"] = ["missing"]

    with pytest.raises(ValueError, match="unknown object"):
        replay_events_from_ocel(make_ocel(events=events))


def test_duckdb_adapter_rejects_relations_to_unknown_objects():
    database = OcelDuckDB(make_ocel())
    try:
        database.conn.execute(
            "INSERT INTO event_object VALUES ('e4', 'missing', NULL)"
        )
        with pytest.raises(ValueError, match="has no object type"):
            replay_events_from_duckdb(database)
    finally:
        database.conn.close()


def test_replay_event_dispatcher_rejects_unsupported_sources():
    with pytest.raises(TypeError, match="ObjectCentricEventLog or OcelDuckDB"):
        extract_occn_replay_events(object())


def test_replay_unit_orders_events_and_exposes_summary_fields():
    later = make_event(
        event_id="e3",
        activity="Close Order",
        timestamp=2,
        objects_by_type=(("Order", ("o1",)),),
    )
    tie_second = make_event(
        event_id="e2",
        activity="Add Item",
        timestamp=1,
        objects_by_type=(
            ("Order", ("o1",)),
            ("Item", ("i1",)),
        ),
    )
    tie_first = make_event(
        event_id="e1",
        activity="Create Order",
        timestamp=1,
        objects_by_type=(("Order", ("o1",)),),
    )

    unit = OCCNReplayUnit(
        unit_id="connected_components:000001",
        strategy=CONNECTED_COMPONENTS_REPLAY_STRATEGY,
        events=(later, tie_second, tie_first),
    )

    assert unit.event_ids == ("e1", "e2", "e3")
    assert unit.activities == (
        "Create Order",
        "Add Item",
        "Close Order",
    )
    assert unit.timestamps == (1, 1, 2)
    assert unit.object_ids == frozenset({"o1", "i1"})
    assert unit.object_types == ("Item", "Order")


def test_replay_unit_rejects_empty_or_duplicate_events():
    with pytest.raises(ValueError, match="at least one event"):
        OCCNReplayUnit(
            unit_id="connected_components:000001",
            strategy=CONNECTED_COMPONENTS_REPLAY_STRATEGY,
            events=(),
        )

    event = make_event()
    with pytest.raises(ValueError, match="unique"):
        OCCNReplayUnit(
            unit_id="connected_components:000001",
            strategy=CONNECTED_COMPONENTS_REPLAY_STRATEGY,
            events=(event, event),
        )


@pytest.mark.parametrize(
    ("unit_id", "strategy"),
    [
        ("", CONNECTED_COMPONENTS_REPLAY_STRATEGY),
        ("connected_components:000001", ""),
    ],
)
def test_replay_unit_rejects_invalid_identity(unit_id, strategy):
    with pytest.raises(ValueError):
        OCCNReplayUnit(
            unit_id=unit_id,
            strategy=strategy,
            events=(make_event(),),
        )


def test_replay_unit_rejects_non_event_values():
    with pytest.raises(ValueError, match="OCCNReplayEvent"):
        OCCNReplayUnit(
            unit_id="connected_components:000001",
            strategy=CONNECTED_COMPONENTS_REPLAY_STRATEGY,
            events=("e1",),
        )


def test_replay_unit_serializes_complete_contract():
    unit = OCCNReplayUnit(
        unit_id="connected_components:000001",
        strategy=CONNECTED_COMPONENTS_REPLAY_STRATEGY,
        events=(make_event(),),
    )

    assert unit.to_dict() == {
        "unit_id": "connected_components:000001",
        "strategy": "connected_components",
        "event_ids": ["e1"],
        "activities": ["Create Order"],
        "timestamps": [1],
        "object_ids": ["o1"],
        "object_types": ["Order"],
        "events": [
            {
                "event_id": "e1",
                "activity": "Create Order",
                "timestamp_unix": 1,
                "objects_by_type": {"Order": ["o1"]},
            }
        ],
    }


def test_connected_components_group_events_that_share_objects():
    events = (
        make_event(
            event_id="e4",
            activity="Audit",
            timestamp=4,
            objects_by_type=(),
        ),
        make_event(
            event_id="e3",
            activity="Create Invoice",
            timestamp=3,
            objects_by_type=(("Invoice", ("invoice-1",)),),
        ),
        make_event(
            event_id="e2",
            activity="Add Item",
            timestamp=2,
            objects_by_type=(
                ("Order", ("order-1",)),
                ("Item", ("item-1",)),
            ),
        ),
        make_event(
            event_id="e1",
            activity="Create Order",
            timestamp=1,
            objects_by_type=(("Order", ("order-1",)),),
        ),
    )

    units = build_connected_component_replay_units(events)

    assert tuple(unit.unit_id for unit in units) == (
        "connected_components:000001",
        "connected_components:000002",
        "connected_components:000003",
    )
    assert tuple(unit.event_ids for unit in units) == (
        ("e1", "e2"),
        ("e3",),
        ("e4",),
    )
    assert units[0].object_ids == frozenset({"order-1", "item-1"})
    assert units[1].object_ids == frozenset({"invoice-1"})
    assert units[2].object_ids == frozenset()


def test_connected_component_units_are_stable_for_shuffled_input():
    events = (
        make_event(
            event_id="e1",
            timestamp=2,
            objects_by_type=(("Order", ("order-1",)),),
        ),
        make_event(
            event_id="e2",
            timestamp=1,
            objects_by_type=(("Invoice", ("invoice-1",)),),
        ),
        make_event(
            event_id="e3",
            timestamp=1,
            objects_by_type=(("Order", ("order-1",)),),
        ),
    )

    forward = build_connected_component_replay_units(events)
    reverse = build_connected_component_replay_units(reversed(events))

    assert reverse == forward
    assert tuple(unit.event_ids for unit in forward) == (
        ("e2",),
        ("e3", "e1"),
    )


def test_event_and_object_ids_use_separate_graph_namespaces():
    events = (
        make_event(
            event_id="e1",
            timestamp=1,
            objects_by_type=(("Order", ("e2",)),),
        ),
        make_event(
            event_id="e2",
            timestamp=2,
            objects_by_type=(("Order", ("other",)),),
        ),
    )

    units = build_connected_component_replay_units(events)

    assert tuple(unit.event_ids for unit in units) == (("e1",), ("e2",))


def test_connected_component_extraction_handles_empty_events():
    assert build_connected_component_replay_units(()) == ()


def test_leading_object_units_project_events_per_selected_object():
    events = (
        make_event(
            event_id="e3",
            activity="Pack orders",
            timestamp=3,
            objects_by_type=(
                ("Order", ("order-1", "order-2")),
                ("Package", ("package-1",)),
            ),
        ),
        make_event(
            event_id="e1",
            activity="Create first order",
            timestamp=1,
            objects_by_type=(("Order", ("order-1",)),),
        ),
        make_event(
            event_id="e2",
            activity="Create second order",
            timestamp=2,
            objects_by_type=(("Order", ("order-2",)),),
        ),
    )

    units = build_leading_object_replay_units(events, "Order")

    assert tuple(unit.unit_id for unit in units) == (
        "leading_object:order-1",
        "leading_object:order-2",
    )
    assert tuple(unit.event_ids for unit in units) == (
        ("e1", "e3"),
        ("e2", "e3"),
    )
    assert all(
        unit.strategy == LEADING_OBJECT_REPLAY_STRATEGY for unit in units
    )
    assert units[0].object_types == ("Order", "Package")


def test_leading_object_units_ignore_events_without_selected_type():
    units = build_leading_object_replay_units(
        (
            make_event(objects_by_type=(("Item", ("item-1",)),)),
            make_event(event_id="e2", objects_by_type=()),
        ),
        "Order",
    )

    assert units == ()


def test_leading_object_unit_validation_rejects_invalid_inputs():
    with pytest.raises(ValueError, match="leading_object_type"):
        build_leading_object_replay_units((), "")

    with pytest.raises(ValueError, match="OCCNReplayEvent"):
        build_leading_object_replay_units(("e1",), "Order")

    event = make_event()
    with pytest.raises(ValueError, match="unique"):
        build_leading_object_replay_units((event, event), "Order")


def test_replay_unit_extraction_handles_empty_ocel_sources():
    source = make_ocel(events=[], objects=[])
    database = OcelDuckDB(source)
    try:
        assert extract_occn_replay_units(source) == ()
        assert extract_occn_replay_units(database) == ()
    finally:
        database.conn.close()


def test_replay_unit_extraction_dispatches_leading_object_strategy():
    source = make_ocel()

    units = extract_occn_replay_units(
        source,
        strategy=LEADING_OBJECT_REPLAY_STRATEGY,
        leading_object_type="Order",
    )

    assert tuple(unit.unit_id for unit in units) == ("leading_object:o1",)
    assert units[0].event_ids == ("e1", "e2", "e3")


def test_replay_unit_extraction_validates_strategy_options():
    source = make_ocel()

    with pytest.raises(ValueError, match="required"):
        extract_occn_replay_units(
            source,
            strategy=LEADING_OBJECT_REPLAY_STRATEGY,
        )

    with pytest.raises(ValueError, match="only supported"):
        extract_occn_replay_units(
            source,
            leading_object_type="Order",
        )


def test_connected_component_extraction_rejects_invalid_events():
    with pytest.raises(ValueError, match="OCCNReplayEvent"):
        build_connected_component_replay_units(("e1",))

    event = make_event()
    with pytest.raises(ValueError, match="unique"):
        build_connected_component_replay_units((event, event))


def test_replay_unit_extraction_matches_both_sources_and_ignores_unused_objects():
    source = make_ocel()
    database = OcelDuckDB(source)
    try:
        polars_units = extract_occn_replay_units(source)
        duckdb_units = extract_occn_replay_units(database)
    finally:
        database.conn.close()

    assert duckdb_units == polars_units
    assert tuple(unit.event_ids for unit in polars_units) == (
        ("e1", "e2", "e3"),
        ("e4",),
    )
    assert all(
        "unused" not in unit.object_ids
        for unit in polars_units
    )


def test_replay_unit_extraction_rejects_unknown_strategies():
    with pytest.raises(ValueError, match="unsupported"):
        extract_occn_replay_units(make_ocel(), strategy="variants")


def test_replay_event_contract_supplies_exact_objects_to_occn_semantics():
    event = make_event(
        activity="a",
        objects_by_type=(
            ("order", ("o1",)),
            ("item", ("i1",)),
        ),
    )
    state = OCCausalNetState()
    occn = occn_basic()

    for object_type, object_ids in event.objects_by_type:
        for object_id in object_ids:
            start_bindings = OCCausalNetSemantics.enabled_bindings_start_activity(
                occn,
                f"START_{object_type}",
                object_type,
                {object_id},
            )
            assert start_bindings
            state = OCCausalNetSemantics.bind_activity(
                start_bindings[0],
                state,
            )

    visible_bindings = OCCausalNetSemantics.enabled_bindings_for_objects(
        occn,
        event.activity,
        state,
        event.object_ids,
    )

    assert visible_bindings
    assert event.object_ids == frozenset({"o1", "i1"})
    assert not event.activity.startswith(("START_", "END_"))
