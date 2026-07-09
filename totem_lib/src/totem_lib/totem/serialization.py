from __future__ import annotations

from typing import Any

from .totem import (
    EC_MANY,
    EC_ONE,
    EC_TOTAL,
    EC_ZERO,
    EC_ZERO_MANY,
    EC_ZERO_ONE,
    LC_MANY,
    LC_ONE,
    LC_TOTAL,
    LC_ZERO,
    LC_ZERO_MANY,
    LC_ZERO_ONE,
    TR_DEPENDENT,
    TR_DEPENDENT_INVERSE,
    TR_INITIATING,
    TR_INITIATING_REVERSE,
    TR_PARALLEL,
    Totem,
)

TOTEM_SCHEMA = "totem"
TOTEM_SCHEMA_VERSION = 1

TEMPORAL_RELATIONS = (
    TR_DEPENDENT,
    TR_DEPENDENT_INVERSE,
    TR_INITIATING,
    TR_INITIATING_REVERSE,
    TR_PARALLEL,
)

_CARDINALITY_VALUES = {
    EC_TOTAL,
    EC_ZERO,
    EC_ONE,
    EC_ZERO_ONE,
    EC_MANY,
    EC_ZERO_MANY,
    LC_TOTAL,
    LC_ZERO,
    LC_ONE,
    LC_ZERO_ONE,
    LC_MANY,
    LC_ZERO_MANY,
    "None",
    "ERROR 0",
}


def totem_to_dict(totem: Totem) -> dict[str, Any]:
    """Convert a Totem object to the canonical JSON-compatible v1 shape."""
    raw_tempgraph = getattr(totem, "tempgraph", {}) or {}
    nodes = _sorted_strings(raw_tempgraph.get("nodes", []), "tempgraph.nodes")

    tempgraph: dict[str, Any] = {"nodes": nodes}
    for relation in TEMPORAL_RELATIONS:
        tempgraph[relation] = _sorted_edges(raw_tempgraph.get(relation, []), relation)

    cardinalities = []
    for key, value in (getattr(totem, "cardinalities", {}) or {}).items():
        source, target = _pair_from_key(key, "cardinality key")
        if not isinstance(value, dict):
            raise ValueError(f"Cardinality for {source!r}, {target!r} must be an object")
        cardinalities.append(
            {
                "from": source,
                "to": target,
                "log_cardinality": value.get("LC"),
                "event_cardinality": value.get("EC"),
            }
        )
    cardinalities.sort(key=lambda item: (item["from"], item["to"]))

    type_relations = [
        sorted(_pair_from_key(relation, "type relation"))
        for relation in (getattr(totem, "type_relations", set()) or set())
    ]
    type_relations.sort(key=lambda item: (item[0], item[1]))

    object_type_to_event_types = {
        str(object_type): _sorted_strings(
            event_types, f"object_type_to_event_types.{object_type}"
        )
        for object_type, event_types in sorted(
            (getattr(totem, "object_type_to_event_types", {}) or {}).items()
        )
    }

    data = {
        "schema": TOTEM_SCHEMA,
        "version": TOTEM_SCHEMA_VERSION,
        "tempgraph": tempgraph,
        "cardinalities": cardinalities,
        "type_relations": type_relations,
        "all_event_types": _sorted_strings(
            getattr(totem, "all_event_types", []), "all_event_types"
        ),
        "object_type_to_event_types": object_type_to_event_types,
    }
    validate_totem_dict(data)
    return data


def totem_from_dict(data: dict[str, Any]) -> Totem:
    """Rebuild a Totem object from the canonical JSON-compatible v1 shape."""
    validate_totem_dict(data)

    tempgraph = {"nodes": set(data["tempgraph"]["nodes"])}
    for relation in TEMPORAL_RELATIONS:
        tempgraph[relation] = {
            (source, target) for source, target in data["tempgraph"][relation]
        }

    cardinalities = {
        (item["from"], item["to"]): {
            "LC": item["log_cardinality"],
            "EC": item["event_cardinality"],
        }
        for item in data["cardinalities"]
    }

    type_relations = {frozenset(relation) for relation in data["type_relations"]}
    all_event_types = set(data["all_event_types"])
    object_type_to_event_types = {
        object_type: set(event_types)
        for object_type, event_types in data["object_type_to_event_types"].items()
    }

    return Totem(
        tempgraph,
        cardinalities,
        type_relations,
        all_event_types,
        object_type_to_event_types,
    )


def validate_totem_dict(data: dict[str, Any]) -> None:
    """Validate the canonical TOTeM JSON-compatible v1 shape."""
    if not isinstance(data, dict):
        raise ValueError("TOTeM data must be an object")
    if data.get("schema") != TOTEM_SCHEMA:
        raise ValueError('TOTeM data must declare schema "totem"')
    if data.get("version") != TOTEM_SCHEMA_VERSION:
        raise ValueError("Unsupported TOTeM schema version")

    tempgraph = _require_dict(data, "tempgraph")
    nodes = _require_string_list(tempgraph, "nodes", "tempgraph.nodes")
    node_set = set(nodes)

    for relation in TEMPORAL_RELATIONS:
        edges = _require_edge_list(tempgraph, relation, f"tempgraph.{relation}")
        for source, target in edges:
            _require_known_node(source, node_set, f"tempgraph.{relation}")
            _require_known_node(target, node_set, f"tempgraph.{relation}")

    cardinalities = _require_list(data, "cardinalities", "cardinalities")
    for index, item in enumerate(cardinalities):
        path = f"cardinalities[{index}]"
        if not isinstance(item, dict):
            raise ValueError(f"{path} must be an object")
        source = _require_string(item, "from", f"{path}.from")
        target = _require_string(item, "to", f"{path}.to")
        _require_known_node(source, node_set, f"{path}.from")
        _require_known_node(target, node_set, f"{path}.to")
        _require_cardinality_value(item, "log_cardinality", f"{path}.log_cardinality")
        _require_cardinality_value(
            item, "event_cardinality", f"{path}.event_cardinality"
        )

    type_relations = _require_list(data, "type_relations", "type_relations")
    for index, relation in enumerate(type_relations):
        source, target = _validate_pair(relation, f"type_relations[{index}]")
        _require_known_node(source, node_set, f"type_relations[{index}]")
        _require_known_node(target, node_set, f"type_relations[{index}]")

    all_event_types = _require_string_list(data, "all_event_types", "all_event_types")
    all_event_type_set = set(all_event_types)

    object_type_to_event_types = _require_dict(data, "object_type_to_event_types")
    for object_type, event_types in object_type_to_event_types.items():
        if not isinstance(object_type, str):
            raise ValueError("object_type_to_event_types keys must be strings")
        _require_known_node(
            object_type, node_set, f"object_type_to_event_types.{object_type}"
        )
        for event_type in _validate_string_list(
            event_types, f"object_type_to_event_types.{object_type}"
        ):
            if event_type not in all_event_type_set:
                raise ValueError(
                    f"Unknown event type {event_type!r} in "
                    f"object_type_to_event_types.{object_type}"
                )


def _sorted_strings(values: Any, path: str) -> list[str]:
    return sorted(_validate_string_list(values, path))


def _sorted_edges(values: Any, path: str) -> list[list[str]]:
    edges = [_validate_pair(edge, f"tempgraph.{path}") for edge in values or []]
    return [[source, target] for source, target in sorted(edges)]


def _pair_from_key(value: Any, path: str) -> tuple[str, str]:
    return _validate_pair(value, path)


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
    return _validate_string_list(_require_list(data, key, path), path)


def _require_edge_list(
    data: dict[str, Any], key: str, path: str
) -> list[tuple[str, str]]:
    return [_validate_pair(edge, path) for edge in _require_list(data, key, path)]


def _validate_string_list(value: Any, path: str) -> list[str]:
    if not isinstance(value, (list, set, tuple)):
        raise ValueError(f"{path} must be a list of strings")
    result = list(value)
    if not all(isinstance(item, str) for item in result):
        raise ValueError(f"{path} must contain only strings")
    return result


def _validate_pair(value: Any, path: str) -> tuple[str, str]:
    if isinstance(value, (set, frozenset)):
        value = sorted(value)
    if not isinstance(value, (list, tuple, set)):
        raise ValueError(f"{path} must be a two-item string pair")
    pair = list(value)
    if len(pair) != 2 or not all(isinstance(item, str) for item in pair):
        raise ValueError(f"{path} must be a two-item string pair")
    return pair[0], pair[1]


def _require_known_node(value: str, node_set: set[str], path: str) -> None:
    if value not in node_set:
        raise ValueError(f"Unknown object type {value!r} in {path}")


def _require_cardinality_value(data: dict[str, Any], key: str, path: str) -> None:
    value = data.get(key)
    if not isinstance(value, str):
        raise ValueError(f"{path} must be a string")
    if value not in _CARDINALITY_VALUES:
        raise ValueError(f"Unsupported cardinality value {value!r} in {path}")
