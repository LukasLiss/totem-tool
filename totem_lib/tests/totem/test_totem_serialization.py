import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.totem import Totem, totem_from_dict, totem_to_dict, validate_totem_dict


def _totem():
    return Totem(
        tempgraph={
            "nodes": {"Order", "Item"},
            "D": {("Order", "Item")},
            "Di": set(),
            "I": set(),
            "Ii": set(),
            "P": {("Item", "Order")},
        },
        cardinalities={
            ("Order", "Item"): {"LC": "1..*", "EC": "0...*"},
            ("Item", "Order"): {"LC": "0...1", "EC": "1"},
        },
        type_relations={frozenset(("Order", "Item"))},
        all_event_types={"Pick Item", "Create Order"},
        object_type_to_event_types={
            "Order": {"Create Order"},
            "Item": {"Pick Item"},
        },
    )


def test_totem_to_dict_returns_canonical_v1_shape():
    assert totem_to_dict(_totem()) == {
        "schema": "totem",
        "version": 1,
        "tempgraph": {
            "nodes": ["Item", "Order"],
            "D": [["Order", "Item"]],
            "Di": [],
            "I": [],
            "Ii": [],
            "P": [["Item", "Order"]],
        },
        "cardinalities": [
            {
                "from": "Item",
                "to": "Order",
                "log_cardinality": "0...1",
                "event_cardinality": "1",
            },
            {
                "from": "Order",
                "to": "Item",
                "log_cardinality": "1..*",
                "event_cardinality": "0...*",
            },
        ],
        "type_relations": [["Item", "Order"]],
        "all_event_types": ["Create Order", "Pick Item"],
        "object_type_to_event_types": {
            "Item": ["Pick Item"],
            "Order": ["Create Order"],
        },
    }


def test_totem_roundtrips_through_canonical_dict():
    original = _totem()
    restored = totem_from_dict(totem_to_dict(original))

    assert restored.tempgraph == original.tempgraph
    assert restored.cardinalities == original.cardinalities
    assert restored.type_relations == original.type_relations
    assert restored.all_event_types == original.all_event_types
    assert restored.object_type_to_event_types == original.object_type_to_event_types


@pytest.mark.parametrize(
    ("path", "value", "message"),
    [
        (("schema",), "occn", 'schema "totem"'),
        (("version",), 2, "Unsupported TOTeM schema version"),
        (("tempgraph", "D"), [["Order", "Missing"]], "Unknown object type"),
        (("cardinalities", 0, "log_cardinality"), "2..*", "Unsupported cardinality"),
        (
            ("object_type_to_event_types", "Order"),
            ["Create Order", "Unknown Event"],
            "Unknown event type",
        ),
    ],
)
def test_validate_totem_dict_rejects_malformed_input(path, value, message):
    data = totem_to_dict(_totem())
    cursor = data
    for key in path[:-1]:
        cursor = cursor[key]
    cursor[path[-1]] = value

    with pytest.raises(ValueError, match=message):
        validate_totem_dict(data)


def test_totem_from_dict_does_not_mutate_input():
    data = totem_to_dict(_totem())
    before = copy.deepcopy(data)

    totem_from_dict(data)

    assert data == before


def test_validate_totem_dict_accepts_optional_layout():
    data = totem_to_dict(_totem())
    data["layout"] = {
        "objectTypes": {
            "Order": {"position": {"x": 40, "y": 300}, "color": "#8B5CF6"},
            "Item": {"position": {"x": 640, "y": 470}},
        }
    }

    validate_totem_dict(data)


def test_totem_from_dict_ignores_layout():
    data = totem_to_dict(_totem())
    data["layout"] = {"objectTypes": {"Order": {"position": {"x": 1, "y": 2}}}}

    restored = totem_from_dict(data)

    assert not hasattr(restored, "layout")
    assert restored.tempgraph == _totem().tempgraph


def test_validate_totem_dict_without_layout_still_valid():
    data = totem_to_dict(_totem())
    assert "layout" not in data
    validate_totem_dict(data)


@pytest.mark.parametrize(
    ("layout", "message"),
    [
        ({"objectTypes": {"Missing": {}}}, "Unknown object type"),
        ({"objectTypes": {"Order": {"position": {"x": "a", "y": 2}}}}, "must be a number"),
        ({"objectTypes": {"Order": {"color": 123}}}, "color must be a string"),
        ({"objectTypes": []}, "layout.objectTypes must be an object"),
        ("not-an-object", "layout must be an object"),
    ],
)
def test_validate_totem_dict_rejects_malformed_layout(layout, message):
    data = totem_to_dict(_totem())
    data["layout"] = layout

    with pytest.raises(ValueError, match=message):
        validate_totem_dict(data)
