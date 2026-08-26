import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from tests.assets.example_occns import TEST_OCCN_FACTORIES, occn_basic
from totem_lib.occn import occn_from_dict, occn_to_dict, validate_occn_dict


def test_occn_to_dict_returns_canonical_v1_shape():
    data = occn_to_dict(occn_basic())

    assert data["schema"] == "occn"
    assert data["version"] == 1
    assert data["activities"] == [
        "END_item",
        "END_order",
        "START_item",
        "START_order",
        "a",
    ]
    assert data["object_types"] == ["item", "order"]
    assert data["dependency_graph"]["edges"] == [
        {"source": "START_item", "target": "a", "object_type": "item"},
        {"source": "START_order", "target": "a", "object_type": "order"},
        {"source": "a", "target": "END_item", "object_type": "item"},
        {"source": "a", "target": "END_order", "object_type": "order"},
    ]
    assert data["activity_count"] == {
        "END_item": 1,
        "END_order": 1,
        "START_item": 1,
        "START_order": 1,
        "a": 1,
    }
    assert data["relative_occurrence_threshold"] == 0

    item_marker = data["input_marker_groups"]["END_item"][0]["markers"][0]
    assert item_marker == {
        "related_activity": "a",
        "object_type": "item",
        "min_count": 1,
        "max_count": None,
        "marker_key": 1,
    }
    assert data["input_marker_groups"]["END_item"][0]["support_count"] is None


@pytest.mark.parametrize("factory_func", TEST_OCCN_FACTORIES)
def test_occn_roundtrips_through_canonical_dict(factory_func):
    original = factory_func()
    data = occn_to_dict(original)
    restored = occn_from_dict(json.loads(json.dumps(data)))

    assert restored == original
    assert occn_to_dict(restored) == data


def test_validate_occn_dict_does_not_mutate_input():
    data = occn_to_dict(occn_basic())
    before = copy.deepcopy(data)

    validate_occn_dict(data)
    occn_from_dict(data)

    assert data == before


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda data: data.update({"schema": "totem"}), 'schema "occn"'),
        (lambda data: data.update({"version": 2}), "Unsupported OCCN schema version"),
        (
            lambda data: data["activities"].append("a"),
            "activities must not contain duplicate values",
        ),
        (
            lambda data: data["object_types"].remove("item"),
            "Unknown object type 'item'",
        ),
        (
            lambda data: data["dependency_graph"]["edges"].append(
                {"source": "START_item", "target": "a", "object_type": "item"}
            ),
            "Duplicate dependency graph edge",
        ),
        (
            lambda data: data["input_marker_groups"]["a"][0]["markers"][0].update(
                {"related_activity": "Missing"}
            ),
            "Unknown activity 'Missing'",
        ),
        (
            lambda data: data["input_marker_groups"]["a"][0]["markers"][0].update(
                {"min_count": 2, "max_count": 1}
            ),
            "min_count must be <= max_count",
        ),
        (
            lambda data: data["input_marker_groups"]["a"][0]["markers"][0].update(
                {"marker_key": 0}
            ),
            "marker_key must be a positive int",
        ),
        (
            lambda data: data["input_marker_groups"]["a"][0]["markers"][0].update(
                {"related_activity": "a"}
            ),
            "does not match dependency graph edge",
        ),
        (
            lambda data: data["output_marker_groups"].pop("a"),
            "output_marker_groups is missing keys",
        ),
        (
            lambda data: data["activity_count"].update({"a": -1}),
            "activity_count.a must be a non-negative int",
        ),
        (
            lambda data: data.update({"relative_occurrence_threshold": 1.1}),
            "relative_occurrence_threshold must be in",
        ),
    ],
)
def test_validate_occn_dict_rejects_malformed_input(mutate, message):
    data = occn_to_dict(occn_basic())
    mutate(data)

    with pytest.raises(ValueError, match=message):
        validate_occn_dict(data)


def _occn_layout():
    return {
        "activities": {
            "a": {"position": {"x": 240, "y": 48}},
            "START_item": {"position": {"x": 40, "y": 40}},
        },
        "objectTypes": {"item": {"color": "#10B981"}},
        "arcs": [
            {"source": "START_item", "target": "START_order", "object_type": "item"},
        ],
    }


def test_validate_occn_dict_accepts_optional_layout():
    data = occn_to_dict(occn_basic())
    data["layout"] = _occn_layout()

    validate_occn_dict(data)


def test_occn_from_dict_ignores_layout():
    data = occn_to_dict(occn_basic())
    data["layout"] = _occn_layout()

    restored = occn_from_dict(data)

    assert restored == occn_basic()
    # The layout must not leak into the canonical serialization.
    assert "layout" not in occn_to_dict(restored)


def test_validate_occn_dict_without_layout_still_valid():
    data = occn_to_dict(occn_basic())
    assert "layout" not in data
    validate_occn_dict(data)


@pytest.mark.parametrize(
    ("layout", "message"),
    [
        ({"activities": {"Missing": {}}}, "Unknown activity"),
        ({"objectTypes": {"missing": {}}}, "Unknown object type"),
        (
            {"activities": {"a": {"position": {"x": "z", "y": 2}}}},
            "must be a number",
        ),
        (
            {"arcs": [{"source": "a", "target": "a", "object_type": "missing"}]},
            "Unknown object type",
        ),
        ({"arcs": {}}, "layout.arcs must be a list"),
        ("nope", "layout must be an object"),
    ],
)
def test_validate_occn_dict_rejects_malformed_layout(layout, message):
    data = occn_to_dict(occn_basic())
    data["layout"] = layout

    with pytest.raises(ValueError, match=message):
        validate_occn_dict(data)
