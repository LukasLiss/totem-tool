from totem_lib import ObjectCentricEventLog
from totem_lib.ocel import schema_base_filtering, propagate_filtering
from totem_lib.ocel.ocel import EVENTS_SCHEMA, OBJECTS_SCHEMA, OBJECT_ATTRIBUTE_SCHEMA
import pytest
import polars as pl
from typing import cast


@pytest.fixture
def valid_events_df() -> pl.DataFrame:
    return pl.DataFrame(
        [
            {
                "_eventId": "e1",
                "_activity": "Order Created",
                "_timestampUnix": 1600000000,
                "_objects": ["o1", "o2"],
                "_qualifiers": ["q1", "q2"],
                "_attributes": '{"cost": 100}',
            }
        ],
        schema=EVENTS_SCHEMA,
    )


@pytest.fixture
def valid_objects_df() -> pl.DataFrame:
    return pl.DataFrame(
        [
            {
                "_objId": "o1",
                "_objType": "Order",
                "_targetObjects": ["o2"],
                "_qualifiers": ["relates_to"],
            },
            {
                "_objId": "o2",
                "_objType": "Item",
                "_targetObjects": [],
                "_qualifiers": [],
            },
        ],
        schema=OBJECTS_SCHEMA,
    )


@pytest.fixture
def valid_object_attributes_df() -> pl.DataFrame:
    return pl.DataFrame(
        [
            {
                "_objId": "o1",
                "_timestampUnix": 1600000000,
                "_jsonObjAttributes": '{"status": "new"}',
            }
        ],
        schema=OBJECT_ATTRIBUTE_SCHEMA,
    )


@pytest.fixture
def valid_ocel(
    valid_events_df: pl.DataFrame,
    valid_objects_df: pl.DataFrame,
    valid_object_attributes_df: pl.DataFrame,
) -> ObjectCentricEventLog:
    return ObjectCentricEventLog(
        events=valid_events_df,
        objects=valid_objects_df,
        object_attributes=valid_object_attributes_df,
    )


def test_schema_base_filtering_valid_data(valid_ocel: ObjectCentricEventLog):
    filtered_ocel = schema_base_filtering(valid_ocel)

    assert filtered_ocel.events.height == 1
    assert filtered_ocel.objects.height == 2
    assert filtered_ocel.object_attributes.height == 1


def test_schema_base_filtering_invalid_events():
    invalid_events = pl.DataFrame(
        [
            {
                "_eventId": "valid_e1",
                "_activity": "A",
                "_timestampUnix": 1,
                "_objects": ["o1"],
                "_qualifiers": ["q1"],
                "_attributes": "{}",
            },
            {
                "_eventId": None,
                "_activity": "A",
                "_timestampUnix": 1,
                "_objects": ["o1"],
                "_qualifiers": ["q1"],
                "_attributes": "{}",
            },
            {
                "_eventId": "",
                "_activity": "A",
                "_timestampUnix": 1,
                "_objects": ["o1"],
                "_qualifiers": ["q1"],
                "_attributes": "{}",
            },
            {
                "_eventId": "e_no_act",
                "_activity": None,
                "_timestampUnix": 1,
                "_objects": ["o1"],
                "_qualifiers": ["q1"],
                "_attributes": "{}",
            },
            {
                "_eventId": "e_empty_act",
                "_activity": "",
                "_timestampUnix": 1,
                "_objects": ["o1"],
                "_qualifiers": ["q1"],
                "_attributes": "{}",
            },
            {
                "_eventId": "e_no_ts",
                "_activity": "A",
                "_timestampUnix": None,
                "_objects": ["o1"],
                "_qualifiers": ["q1"],
                "_attributes": "{}",
            },
            {
                "_eventId": "e_no_obj",
                "_activity": "A",
                "_timestampUnix": 1,
                "_objects": None,
                "_qualifiers": ["q1"],
                "_attributes": "{}",
            },
            {
                "_eventId": "e_empty_obj",
                "_activity": "A",
                "_timestampUnix": 1,
                "_objects": [],
                "_qualifiers": [],
                "_attributes": "{}",
            },
            {
                "_eventId": "e_no_qual",
                "_activity": "A",
                "_timestampUnix": 1,
                "_objects": ["o1"],
                "_qualifiers": None,
                "_attributes": "{}",
            },
            {
                "_eventId": "e_mismatch",
                "_activity": "A",
                "_timestampUnix": 1,
                "_objects": ["o1"],
                "_qualifiers": ["q1", "q2"],
                "_attributes": "{}",
            },
        ],
        schema=EVENTS_SCHEMA,
    )

    empty_objects = pl.DataFrame(schema=OBJECTS_SCHEMA)
    ocel = ObjectCentricEventLog(events=invalid_events, objects=empty_objects)

    filtered_ocel = schema_base_filtering(ocel)

    assert filtered_ocel.events.height == 1
    assert filtered_ocel.events.item(0, "_eventId") == "valid_e1"


def test_schema_base_filtering_invalid_objects():
    invalid_objects = pl.DataFrame(
        [
            {
                "_objId": "valid_o1",
                "_objType": "T",
                "_targetObjects": ["o2"],
                "_qualifiers": ["q1"],
            },
            {
                "_objId": None,
                "_objType": "T",
                "_targetObjects": ["o2"],
                "_qualifiers": ["q1"],
            },
            {
                "_objId": "",
                "_objType": "T",
                "_targetObjects": ["o2"],
                "_qualifiers": ["q1"],
            },
            {
                "_objId": "o_no_type",
                "_objType": None,
                "_targetObjects": ["o2"],
                "_qualifiers": ["q1"],
            },
            {
                "_objId": "o_empty_type",
                "_objType": "",
                "_targetObjects": ["o2"],
                "_qualifiers": ["q1"],
            },
            {
                "_objId": "o_no_target",
                "_objType": "T",
                "_targetObjects": None,
                "_qualifiers": ["q1"],
            },
            {
                "_objId": "o_no_qual",
                "_objType": "T",
                "_targetObjects": ["o2"],
                "_qualifiers": None,
            },
            {
                "_objId": "o_mismatch",
                "_objType": "T",
                "_targetObjects": ["o2", "o3"],
                "_qualifiers": ["q1"],
            },
        ],
        schema=OBJECTS_SCHEMA,
    )

    empty_events = pl.DataFrame(schema=EVENTS_SCHEMA)
    ocel = ObjectCentricEventLog(events=empty_events, objects=invalid_objects)

    filtered_ocel = schema_base_filtering(ocel)

    assert filtered_ocel.objects.height == 1
    assert filtered_ocel.objects.item(0, "_objId") == "valid_o1"


def test_schema_base_filtering_invalid_objects_with_attributes():
    invalid_attrs = pl.DataFrame(
        [
            {"_objId": "valid_o1", "_timestampUnix": 100, "_jsonObjAttributes": "{}"},
            {"_objId": None, "_timestampUnix": 100, "_jsonObjAttributes": "{}"},
            {"_objId": "", "_timestampUnix": 100, "_jsonObjAttributes": "{}"},
            {"_objId": "o3", "_timestampUnix": None, "_jsonObjAttributes": "{}"},
        ],
        schema=OBJECT_ATTRIBUTE_SCHEMA,
    )

    ocel = ObjectCentricEventLog(
        events=pl.DataFrame(schema=EVENTS_SCHEMA),
        objects=pl.DataFrame(schema=OBJECTS_SCHEMA),
        object_attributes=invalid_attrs,
    )

    filtered_ocel = schema_base_filtering(ocel)

    assert filtered_ocel.object_attributes.height == 1
    assert filtered_ocel.object_attributes.item(0, "_objId") == "valid_o1"


def test_propagate_filtering_valid_data(valid_ocel: ObjectCentricEventLog):
    filtered_ocel = propagate_filtering(valid_ocel)

    assert filtered_ocel.events.height == 1
    assert filtered_ocel.objects.height == 2
    assert filtered_ocel.object_attributes.height == 1


def test_propagate_filtering_removes_unreferenced_objects():
    events = pl.DataFrame(
        [
            {
                "_eventId": "e1",
                "_activity": "A",
                "_timestampUnix": 1,
                "_objects": ["o1"],
                "_qualifiers": ["q1"],
                "_attributes": "{}",
            }
        ],
        schema=EVENTS_SCHEMA,
    )
    objects = pl.DataFrame(
        [
            {"_objId": "o1", "_objType": "T", "_targetObjects": [], "_qualifiers": []},
            {
                "_objId": "o_unreferenced",
                "_objType": "T",
                "_targetObjects": [],
                "_qualifiers": [],
            },
        ],
        schema=OBJECTS_SCHEMA,
    )

    ocel = ObjectCentricEventLog(events=events, objects=objects)
    filtered_ocel = propagate_filtering(ocel)

    assert filtered_ocel.objects.height == 1
    assert filtered_ocel.objects.item(0, "_objId") == "o1"


def test_propagate_filtering_removes_ghost_objects_from_events():
    events = pl.DataFrame(
        [
            {
                "_eventId": "e1",
                "_activity": "A",
                "_timestampUnix": 1,
                "_objects": ["o1", "ghost_obj"],
                "_qualifiers": ["q1", "q_ghost"],
                "_attributes": "{}",
            }
        ],
        schema=EVENTS_SCHEMA,
    )
    objects = pl.DataFrame(
        [{"_objId": "o1", "_objType": "T", "_targetObjects": [], "_qualifiers": []}],
        schema=OBJECTS_SCHEMA,
    )

    ocel = ObjectCentricEventLog(events=events, objects=objects)
    filtered_ocel = propagate_filtering(ocel)

    assert filtered_ocel.events.height == 1

    remaining_objects = filtered_ocel.events.item(0, "_objects")
    remaining_qualifiers = filtered_ocel.events.item(0, "_qualifiers")

    assert "ghost_obj" not in remaining_objects
    assert "q_ghost" not in remaining_qualifiers
    assert remaining_objects.filter(remaining_objects == "o1").len() == 1
    assert remaining_qualifiers.filter(remaining_qualifiers == "q1").len() == 1


def test_propagate_filtering_removes_events_without_objects():
    events = pl.DataFrame(
        [
            {
                "_eventId": "e1",
                "_activity": "A",
                "_timestampUnix": 1,
                "_objects": ["ghost_obj"],
                "_qualifiers": ["q_ghost"],
                "_attributes": "{}",
            }
        ],
        schema=EVENTS_SCHEMA,
    )
    objects = pl.DataFrame(
        [{"_objId": "o1", "_objType": "T", "_targetObjects": [], "_qualifiers": []}],
        schema=OBJECTS_SCHEMA,
    )

    ocel = ObjectCentricEventLog(events=events, objects=objects)
    filtered_ocel = propagate_filtering(ocel)

    assert filtered_ocel.events.height == 0


def test_propagate_filtering_removes_orphaned_attributes():
    events = pl.DataFrame(
        [
            {
                "_eventId": "e1",
                "_activity": "A",
                "_timestampUnix": 1,
                "_objects": ["o1"],
                "_qualifiers": ["q1"],
                "_attributes": "{}",
            }
        ],
        schema=EVENTS_SCHEMA,
    )
    objects = pl.DataFrame(
        [{"_objId": "o1", "_objType": "T", "_targetObjects": [], "_qualifiers": []}],
        schema=OBJECTS_SCHEMA,
    )
    attributes = pl.DataFrame(
        [
            {"_objId": "o1", "_timestampUnix": 1, "_jsonObjAttributes": "{}"},
            {"_objId": "orphaned_obj", "_timestampUnix": 1, "_jsonObjAttributes": "{}"},
        ],
        schema=OBJECT_ATTRIBUTE_SCHEMA,
    )

    ocel = ObjectCentricEventLog(
        events=events, objects=objects, object_attributes=attributes
    )
    filtered_ocel = propagate_filtering(ocel)

    assert filtered_ocel.object_attributes.height == 1
    assert filtered_ocel.object_attributes.item(0, "_objId") == "o1"


def test_propagate_filtering_cascading_deletions():
    events = pl.DataFrame(
        [
            {
                "_eventId": "e1",
                "_activity": "A",
                "_timestampUnix": 1,
                "_objects": ["ghost1"],
                "_qualifiers": ["q1"],
                "_attributes": "{}",
            },
            {
                "_eventId": "e2",
                "_activity": "B",
                "_timestampUnix": 2,
                "_objects": ["o1"],
                "_qualifiers": ["q2"],
                "_attributes": "{}",
            },
        ],
        schema=EVENTS_SCHEMA,
    )
    objects = pl.DataFrame(
        [
            {"_objId": "o1", "_objType": "T", "_targetObjects": [], "_qualifiers": []},
            {
                "_objId": "o2_unreferenced_by_valid_events",
                "_objType": "T",
                "_targetObjects": [],
                "_qualifiers": [],
            },
        ],
        schema=OBJECTS_SCHEMA,
    )
    attributes = pl.DataFrame(
        [
            {"_objId": "o1", "_timestampUnix": 1, "_jsonObjAttributes": "{}"},
            {
                "_objId": "o2_unreferenced_by_valid_events",
                "_timestampUnix": 1,
                "_jsonObjAttributes": "{}",
            },
        ],
        schema=OBJECT_ATTRIBUTE_SCHEMA,
    )

    ocel = ObjectCentricEventLog(
        events=events, objects=objects, object_attributes=attributes
    )
    filtered_ocel = propagate_filtering(ocel)

    assert filtered_ocel.events.height == 1
    assert filtered_ocel.events.item(0, "_eventId") == "e2"

    assert filtered_ocel.objects.height == 1
    assert filtered_ocel.objects.item(0, "_objId") == "o1"

    assert filtered_ocel.object_attributes.height == 1
    assert filtered_ocel.object_attributes.item(0, "_objId") == "o1"
