from __future__ import annotations

import math
from typing import Any

import networkx as nx

from .occn import OCCausalNet

OCCN_SCHEMA = "occn"
OCCN_SCHEMA_VERSION = 1


def occn_to_dict(occn: OCCausalNet) -> dict[str, Any]:
    """Convert an OCCausalNet object to the canonical JSON-compatible v1 shape."""
    activities = sorted(getattr(occn, "activities", []) or [])
    object_types = sorted(getattr(occn, "object_types", []) or [])

    data = {
        "schema": OCCN_SCHEMA,
        "version": OCCN_SCHEMA_VERSION,
        "activities": activities,
        "object_types": object_types,
        "dependency_graph": {
            "edges": _serialize_dependency_graph(occn.dependency_graph),
        },
        "input_marker_groups": _serialize_marker_groups(
            occn.input_marker_groups, activities
        ),
        "output_marker_groups": _serialize_marker_groups(
            occn.output_marker_groups, activities
        ),
        "activity_count": {
            activity: occn.activity_count.get(activity, 1)
            for activity in activities
        },
        "relative_occurrence_threshold": occn.relative_occurrence_threshold,
    }
    validate_occn_dict(data)
    return data


def occn_from_dict(data: dict[str, Any]) -> OCCausalNet:
    """Rebuild an OCCausalNet object from the canonical JSON-compatible v1 shape."""
    validate_occn_dict(data)

    dependency_graph = nx.MultiDiGraph()
    dependency_graph.add_nodes_from(data["activities"])
    for edge in data["dependency_graph"]["edges"]:
        object_type = edge["object_type"]
        dependency_graph.add_edge(
            edge["source"],
            edge["target"],
            key=object_type,
            object_type=object_type,
        )

    input_marker_groups = _deserialize_marker_groups(data["input_marker_groups"])
    output_marker_groups = _deserialize_marker_groups(data["output_marker_groups"])

    return OCCausalNet(
        dependency_graph=dependency_graph,
        output_marker_groups=output_marker_groups,
        input_marker_groups=input_marker_groups,
        activity_count=data["activity_count"],
        relative_occurrence_threshold=data["relative_occurrence_threshold"],
    )


def validate_occn_dict(data: dict[str, Any]) -> None:
    """Validate the canonical OCCN JSON-compatible v1 shape."""
    if not isinstance(data, dict):
        raise ValueError("OCCN data must be an object")
    if data.get("schema") != OCCN_SCHEMA:
        raise ValueError('OCCN data must declare schema "occn"')
    if data.get("version") != OCCN_SCHEMA_VERSION:
        raise ValueError("Unsupported OCCN schema version")

    activities = _require_string_list(data, "activities", "activities")
    object_types = _require_string_list(data, "object_types", "object_types")
    _require_unique_values(activities, "activities")
    _require_unique_values(object_types, "object_types")
    activity_set = set(activities)
    object_type_set = set(object_types)
    for object_type in object_types:
        start_activity = f"START_{object_type}"
        end_activity = f"END_{object_type}"
        _require_known_value(start_activity, activity_set, "activities", "activity")
        _require_known_value(end_activity, activity_set, "activities", "activity")

    dependency_graph = _require_dict(data, "dependency_graph")
    edges = _require_list(dependency_graph, "edges", "dependency_graph.edges")
    edge_set = set()
    for index, edge in enumerate(edges):
        path = f"dependency_graph.edges[{index}]"
        if not isinstance(edge, dict):
            raise ValueError(f"{path} must be an object")
        source = _require_string(edge, "source", f"{path}.source")
        target = _require_string(edge, "target", f"{path}.target")
        object_type = _require_string(edge, "object_type", f"{path}.object_type")
        _require_known_value(source, activity_set, f"{path}.source", "activity")
        _require_known_value(target, activity_set, f"{path}.target", "activity")
        _require_known_value(
            object_type, object_type_set, f"{path}.object_type", "object type"
        )
        edge_key = (source, target, object_type)
        if edge_key in edge_set:
            raise ValueError(f"Duplicate dependency graph edge {edge_key!r}")
        edge_set.add(edge_key)

    _validate_marker_group_mapping(
        data,
        "input_marker_groups",
        activities,
        activity_set,
        object_type_set,
        edge_set,
        "input",
    )
    _validate_marker_group_mapping(
        data,
        "output_marker_groups",
        activities,
        activity_set,
        object_type_set,
        edge_set,
        "output",
    )

    activity_count = _require_dict(data, "activity_count")
    _require_exact_keys(activity_count, activities, "activity_count")
    for activity in activities:
        value = activity_count.get(activity)
        if not _is_non_bool_int(value) or value < 0:
            raise ValueError(f"activity_count.{activity} must be a non-negative int")

    threshold = data.get("relative_occurrence_threshold")
    if (
        isinstance(threshold, bool)
        or not isinstance(threshold, (int, float))
        or threshold < 0
        or threshold > 1
    ):
        raise ValueError("relative_occurrence_threshold must be in [0, 1]")


def _serialize_dependency_graph(graph: nx.MultiDiGraph) -> list[dict[str, str]]:
    edges = []
    for source, target, key, attributes in graph.edges(keys=True, data=True):
        object_type = (
            attributes.get("object_type") if isinstance(attributes, dict) else None
        )
        if object_type is None:
            object_type = key
        edges.append(
            {
                "source": source,
                "target": target,
                "object_type": object_type,
            }
        )
    edges.sort(key=lambda edge: (edge["source"], edge["target"], edge["object_type"]))
    return edges


def _serialize_marker_groups(
    marker_groups_by_activity: dict[str, list[OCCausalNet.MarkerGroup]],
    activities: list[str],
) -> dict[str, list[dict[str, Any]]]:
    return {
        activity: _serialize_marker_group_list(
            marker_groups_by_activity.get(activity, [])
        )
        for activity in activities
    }


def _serialize_marker_group_list(
    marker_groups: list[OCCausalNet.MarkerGroup],
) -> list[dict[str, Any]]:
    groups = [_serialize_marker_group(group) for group in marker_groups]
    groups.sort(
        key=lambda group: (
            _sort_number(group["support_count"]),
            [
                (
                    marker["related_activity"],
                    marker["object_type"],
                    marker["min_count"],
                    _sort_number(marker["max_count"]),
                    marker["marker_key"],
                )
                for marker in group["markers"]
            ],
        )
    )
    return groups


def _serialize_marker_group(group: OCCausalNet.MarkerGroup) -> dict[str, Any]:
    markers = [
        {
            "related_activity": marker.related_activity,
            "object_type": marker.object_type,
            "min_count": marker.min_count,
            "max_count": _finite_or_none(marker.max_count),
            "marker_key": marker.marker_key,
        }
        for marker in group.markers
    ]
    markers.sort(
        key=lambda marker: (
            marker["related_activity"],
            marker["object_type"],
            marker["min_count"],
            _sort_number(marker["max_count"]),
            marker["marker_key"],
        )
    )
    return {
        "support_count": _finite_or_none(group.support_count),
        "markers": markers,
    }


def _deserialize_marker_groups(
    marker_groups_by_activity: dict[str, list[dict[str, Any]]],
) -> dict[str, list[OCCausalNet.MarkerGroup]]:
    return {
        activity: [
            OCCausalNet.MarkerGroup(
                markers=[
                    OCCausalNet.Marker(
                        marker["related_activity"],
                        marker["object_type"],
                        (
                            marker["min_count"],
                            _none_or_infinity(marker["max_count"]),
                        ),
                        marker["marker_key"],
                    )
                    for marker in group["markers"]
                ],
                support_count=_none_or_infinity(group["support_count"]),
            )
            for group in groups
        ]
        for activity, groups in marker_groups_by_activity.items()
    }


def _validate_marker_group_mapping(
    data: dict[str, Any],
    key: str,
    activities: list[str],
    activity_set: set[str],
    object_type_set: set[str],
    edge_set: set[tuple[str, str, str]],
    direction: str,
) -> None:
    marker_groups_by_activity = _require_dict(data, key)
    _require_exact_keys(marker_groups_by_activity, activities, key)
    for activity, groups in marker_groups_by_activity.items():
        _require_known_value(activity, activity_set, f"{key}.{activity}", "activity")
        if not isinstance(groups, list):
            raise ValueError(f"{key}.{activity} must be a list")
        for group_index, group in enumerate(groups):
            group_path = f"{key}.{activity}[{group_index}]"
            if not isinstance(group, dict):
                raise ValueError(f"{group_path} must be an object")
            _validate_optional_count(
                group.get("support_count"), f"{group_path}.support_count"
            )
            markers = _require_list(group, "markers", f"{group_path}.markers")
            if not markers:
                raise ValueError(f"{group_path}.markers must not be empty")
            for marker_index, marker in enumerate(markers):
                marker_path = f"{group_path}.markers[{marker_index}]"
                _validate_marker(
                    marker,
                    marker_path,
                    activity,
                    direction,
                    activity_set,
                    object_type_set,
                    edge_set,
                )


def _validate_marker(
    marker: Any,
    path: str,
    activity: str,
    direction: str,
    activity_set: set[str],
    object_type_set: set[str],
    edge_set: set[tuple[str, str, str]],
) -> None:
    if not isinstance(marker, dict):
        raise ValueError(f"{path} must be an object")
    related_activity = _require_string(
        marker, "related_activity", f"{path}.related_activity"
    )
    object_type = _require_string(marker, "object_type", f"{path}.object_type")
    _require_known_value(
        related_activity, activity_set, f"{path}.related_activity", "activity"
    )
    _require_known_value(
        object_type, object_type_set, f"{path}.object_type", "object type"
    )
    min_count = _require_count(marker, "min_count", f"{path}.min_count")
    max_count = marker.get("max_count")
    _validate_optional_count(max_count, f"{path}.max_count")
    if max_count is not None and min_count > max_count:
        raise ValueError(f"{path}.min_count must be <= max_count")
    marker_key = marker.get("marker_key")
    if not _is_non_bool_int(marker_key) or marker_key <= 0:
        raise ValueError(f"{path}.marker_key must be a positive int")

    expected_edge = (
        (related_activity, activity, object_type)
        if direction == "input"
        else (activity, related_activity, object_type)
    )
    if expected_edge not in edge_set:
        raise ValueError(f"{path} does not match dependency graph edge {expected_edge!r}")


def _require_dict(data: dict[str, Any], key: str) -> dict[str, Any]:
    value = data.get(key)
    if not isinstance(value, dict):
        raise ValueError(f"{key} must be an object")
    return value


def _require_list(data: dict[str, Any], key: str, path: str) -> list[Any]:
    value = data.get(key)
    if not isinstance(value, list):
        raise ValueError(f"{path} must be a list")
    return value


def _require_string(data: dict[str, Any], key: str, path: str) -> str:
    value = data.get(key)
    if not isinstance(value, str):
        raise ValueError(f"{path} must be a string")
    return value


def _require_string_list(data: dict[str, Any], key: str, path: str) -> list[str]:
    values = _require_list(data, key, path)
    if not all(isinstance(value, str) for value in values):
        raise ValueError(f"{path} must contain only strings")
    return values


def _require_count(data: dict[str, Any], key: str, path: str) -> int:
    value = data.get(key)
    if not _is_non_bool_int(value) or value < 0:
        raise ValueError(f"{path} must be a non-negative int")
    return value


def _validate_optional_count(value: Any, path: str) -> None:
    if value is None:
        return
    if not _is_non_bool_int(value) or value < 0:
        raise ValueError(f"{path} must be null or a non-negative int")


def _require_known_value(
    value: str, known_values: set[str], path: str, value_name: str
) -> None:
    if value not in known_values:
        raise ValueError(f"Unknown {value_name} {value!r} in {path}")


def _require_unique_values(values: list[str], path: str) -> None:
    if len(values) != len(set(values)):
        raise ValueError(f"{path} must not contain duplicate values")


def _require_exact_keys(
    data: dict[str, Any], expected_keys: list[str], path: str
) -> None:
    actual = set(data.keys())
    expected = set(expected_keys)
    missing = sorted(expected - actual)
    unexpected = sorted(actual - expected)
    if missing:
        raise ValueError(f"{path} is missing keys: {missing}")
    if unexpected:
        raise ValueError(f"{path} contains unknown keys: {unexpected}")


def _finite_or_none(value: Any) -> int | None:
    if isinstance(value, float) and math.isinf(value):
        return None
    return value


def _none_or_infinity(value: int | None) -> int | float:
    if value is None:
        return float("inf")
    return value


def _sort_number(value: int | None) -> tuple[int, int]:
    if value is None:
        return (1, 0)
    return (0, value)


def _is_non_bool_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)
