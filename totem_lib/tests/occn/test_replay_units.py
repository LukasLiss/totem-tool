from dataclasses import FrozenInstanceError

import pytest

from totem_lib import (
    CONNECTED_COMPONENTS_REPLAY_STRATEGY,
    OCCNReplayEvent,
    OCCNReplayUnit,
)


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
