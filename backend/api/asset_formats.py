"""Structural validators for OCPN and OC-DFG model assets.

TOTeM and OCCN assets are validated by their canonical validators in
``totem_lib`` (``validate_totem_dict`` / ``validate_occn_dict``). The OCPN and
OC-DFG formats are defined by the frontend editors (see
docs/MODEL_EDITORS.md):

- OCPN uses the ``"format": "ocpn"`` exchange JSON (objectTypes, places,
  transitions, arcs) — the same document the OCPN discovery endpoint returns
  and the playout engine consumes.
- OC-DFG uses the canonical ``"schema": "ocdfg"`` JSON (object_types,
  activities, edges with ``__start__:<type>`` / ``__end__:<type>`` pseudo
  nodes, optional layout).

These validators check the structural invariants the tool relies on; layout
blocks are treated as presentation hints and only loosely checked.
"""

OCDFG_START_PREFIX = "__start__:"
OCDFG_END_PREFIX = "__end__:"


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _name(value):
    return value.strip() if isinstance(value, str) and value.strip() else None


def validate_ocpn_asset_dict(data):
    """Validate an OCPN model asset (``format: "ocpn"``, version 1)."""
    _require(isinstance(data, dict), "OCPN asset must be a JSON object.")
    _require(data.get("format") == "ocpn", 'OCPN asset must declare "format": "ocpn".')
    _require(data.get("version") == 1, "Unsupported OCPN format version.")

    object_types = data.get("objectTypes", [])
    _require(isinstance(object_types, list), '"objectTypes" must be a list.')
    type_names = set()
    for entry in object_types:
        name = _name(entry.get("name")) if isinstance(entry, dict) else _name(entry)
        _require(name is not None, "Every object type needs a non-empty name.")
        _require(name not in type_names, f'Duplicate object type "{name}".')
        type_names.add(name)

    places = data.get("places")
    transitions = data.get("transitions")
    _require(isinstance(places, list), '"places" must be a list.')
    _require(isinstance(transitions, list), '"transitions" must be a list.')

    node_ids = set()
    place_ids = set()
    for index, place in enumerate(places):
        _require(isinstance(place, dict), f"Place #{index + 1} must be an object.")
        place_id = _name(place.get("id"))
        _require(place_id is not None, f'Place #{index + 1} needs an "id".')
        _require(place_id not in node_ids, f'Duplicate node id "{place_id}".')
        node_ids.add(place_id)
        place_ids.add(place_id)
        object_type = _name(place.get("objectType"))
        _require(
            object_type is not None,
            f'Place "{place_id}" needs an "objectType" (pt is a total function).',
        )
        # Types referenced only by places are fine — the editors auto-register
        # them on import — so no membership check against objectTypes here.

    transition_ids = set()
    for index, transition in enumerate(transitions):
        _require(isinstance(transition, dict), f"Transition #{index + 1} must be an object.")
        transition_id = _name(transition.get("id"))
        _require(transition_id is not None, f'Transition #{index + 1} needs an "id".')
        _require(transition_id not in node_ids, f'Duplicate node id "{transition_id}".')
        node_ids.add(transition_id)
        transition_ids.add(transition_id)
        label = transition.get("label")
        _require(
            label is None or isinstance(label, str),
            f'Transition "{transition_id}": "label" must be a string or null.',
        )

    arcs = data.get("arcs", [])
    _require(isinstance(arcs, list), '"arcs" must be a list.')
    seen_arcs = set()
    for index, arc in enumerate(arcs):
        _require(isinstance(arc, dict), f"Arc #{index + 1} must be an object.")
        source = _name(arc.get("source"))
        target = _name(arc.get("target"))
        _require(
            source is not None and target is not None,
            f'Arc #{index + 1} needs "source" and "target".',
        )
        _require(source in node_ids, f'Arc #{index + 1} references unknown node "{source}".')
        _require(target in node_ids, f'Arc #{index + 1} references unknown node "{target}".')
        _require(
            (source in place_ids) != (target in place_ids),
            f"Arc #{index + 1} ({source} -> {target}) must connect a place and a transition.",
        )
        key = (source, target)
        _require(key not in seen_arcs, f"Duplicate arc {source} -> {target}.")
        seen_arcs.add(key)


def validate_ocdfg_asset_dict(data):
    """Validate an OC-DFG model asset (``schema: "ocdfg"``, version 1)."""
    _require(isinstance(data, dict), "OC-DFG asset must be a JSON object.")
    _require(data.get("schema") == "ocdfg", 'OC-DFG asset must declare "schema": "ocdfg".')
    _require(data.get("version") == 1, "Unsupported OC-DFG schema version.")

    object_types = data.get("object_types")
    _require(isinstance(object_types, list), '"object_types" must be a list.')
    type_names = set()
    for entry in object_types:
        name = _name(entry)
        _require(name is not None, "Every object type needs a non-empty name.")
        _require(name not in type_names, f'Duplicate object type "{name}".')
        type_names.add(name)

    activities = data.get("activities")
    _require(isinstance(activities, list), '"activities" must be a list.')
    activity_names = set()
    for entry in activities:
        name = _name(entry)
        _require(name is not None, "Every activity needs a non-empty name.")
        _require(name not in activity_names, f'Duplicate activity "{name}".')
        activity_names.add(name)

    def check_endpoint(value, index, role):
        _require(value is not None, f'Edge #{index + 1} needs "{role}".')
        if value.startswith(OCDFG_START_PREFIX) or value.startswith(OCDFG_END_PREFIX):
            prefix = OCDFG_START_PREFIX if value.startswith(OCDFG_START_PREFIX) else OCDFG_END_PREFIX
            object_type = value[len(prefix):]
            _require(
                object_type in type_names,
                f'Edge #{index + 1} references a START/END node of unknown object type "{object_type}".',
            )
        else:
            _require(
                value in activity_names,
                f'Edge #{index + 1} references unknown activity "{value}".',
            )

    edges = data.get("edges", [])
    _require(isinstance(edges, list), '"edges" must be a list.')
    seen_edges = set()
    for index, edge in enumerate(edges):
        _require(isinstance(edge, dict), f"Edge #{index + 1} must be an object.")
        source = _name(edge.get("source"))
        target = _name(edge.get("target"))
        object_type = _name(edge.get("object_type"))
        check_endpoint(source, index, "source")
        check_endpoint(target, index, "target")
        _require(object_type in type_names, f'Edge #{index + 1} references unknown object type "{object_type}".')
        _require(
            not (source or "").startswith(OCDFG_END_PREFIX),
            f"Edge #{index + 1}: edges cannot leave an END node.",
        )
        _require(
            not (target or "").startswith(OCDFG_START_PREFIX),
            f"Edge #{index + 1}: edges cannot enter a START node.",
        )
        key = (source, target, object_type)
        _require(
            key not in seen_edges,
            f'Duplicate edge {source} -> {target} for object type "{object_type}".',
        )
        seen_edges.add(key)

    layout = data.get("layout")
    _require(
        layout is None or isinstance(layout, dict),
        '"layout" must be an object when present.',
    )


# --------------------------------------------------------------------------
# Stored SQL queries
# --------------------------------------------------------------------------

SQL_QUERY_ASSET_SCHEMA = "sql-query"
SQL_QUERY_ASSET_VERSION = 1
SQL_QUERY_MAX_LENGTH = 20_000


def validate_sql_query_asset_dict(data):
    """Validate the ``content_json`` of a QUERY project asset.

    Shape::

        {"schema": "sql-query", "version": 1,
         "query": "SELECT ...", "description": "optional free text"}

    Only the structure is checked here; whether the SQL actually runs is
    decided by the sandboxed ``execute_query`` endpoint at execution time
    (it rejects anything but a single SELECT).
    """
    _require(isinstance(data, dict), "Query asset JSON must be an object.")
    _require(
        data.get("schema") == SQL_QUERY_ASSET_SCHEMA,
        f'Query asset JSON must declare "schema": "{SQL_QUERY_ASSET_SCHEMA}".',
    )
    version = data.get("version", SQL_QUERY_ASSET_VERSION)
    _require(
        version == SQL_QUERY_ASSET_VERSION,
        f"Unsupported query asset version: {version!r}.",
    )
    query = data.get("query")
    _require(isinstance(query, str) and query.strip(), "Query asset needs a non-empty \"query\" string.")
    _require(
        len(query) <= SQL_QUERY_MAX_LENGTH,
        f"Query text must be at most {SQL_QUERY_MAX_LENGTH} characters.",
    )
    description = data.get("description", "")
    _require(
        description is None or isinstance(description, str),
        'Query asset "description" must be a string.',
    )
    return data


# --------------------------------------------------------------------------
# Process-area compositions
# --------------------------------------------------------------------------

PROCESS_AREAS_ASSET_SCHEMA = "process-areas"
PROCESS_AREAS_ASSET_VERSION = 1
PROCESS_AREAS_MAX_LEVELS = 50
PROCESS_AREAS_MAX_AREAS = 200
PROCESS_AREAS_NAME_MAX_LENGTH = 100


def _string_list(value, label):
    _require(isinstance(value, list), f"{label} must be a list.")
    names = []
    for entry in value:
        name = _name(entry)
        _require(name is not None, f"{label} must only contain non-empty strings.")
        names.append(name)
    _require(len(set(names)) == len(names), f"{label} must not contain duplicates.")
    return names


def validate_process_areas_asset_dict(data):
    """Validate the ``content_json`` of a PROCESS_AREAS project asset.

    A composition is a stack of levels (level 0 at the bottom, the core
    business objects; resources higher up), each holding named process
    areas. Shape::

        {"schema": "process-areas", "version": 1,
         "description": "optional free text",
         "levels": [
             {"level": 0, "areas": [
                 {"id": "pa-1", "name": "Order handling",
                  "objectTypes": ["order", "item"],
                  "activities": ["place order", "pick item"]}]},
             ...],
         "unassignedObjectTypes": ["optional", "types in no area"],
         "source": {optional provenance, free form}}

    The asset's own name is the name of the composition; every area has a
    stable ``id`` and a ``name`` unique within the composition so other parts
    of the tool can refer to it. An object type belongs to at most one area.
    """
    _require(isinstance(data, dict), "Process-area asset JSON must be an object.")
    _require(
        data.get("schema") == PROCESS_AREAS_ASSET_SCHEMA,
        f'Process-area asset JSON must declare "schema": "{PROCESS_AREAS_ASSET_SCHEMA}".',
    )
    version = data.get("version", PROCESS_AREAS_ASSET_VERSION)
    _require(
        version == PROCESS_AREAS_ASSET_VERSION,
        f"Unsupported process-area asset version: {version!r}.",
    )
    description = data.get("description", "")
    _require(
        description is None or isinstance(description, str),
        'Process-area asset "description" must be a string.',
    )

    levels = data.get("levels")
    _require(isinstance(levels, list) and levels, '"levels" must be a non-empty list.')
    _require(
        len(levels) <= PROCESS_AREAS_MAX_LEVELS,
        f"A composition can have at most {PROCESS_AREAS_MAX_LEVELS} levels.",
    )

    seen_levels = set()
    area_ids = set()
    area_names = set()
    owner_of_type = {}
    area_count = 0
    for index, level in enumerate(levels):
        _require(isinstance(level, dict), f"Level #{index + 1} must be an object.")
        number = level.get("level", index)
        _require(
            isinstance(number, int) and not isinstance(number, bool) and number >= 0,
            f"Level #{index + 1}: \"level\" must be a non-negative integer.",
        )
        _require(number not in seen_levels, f"Duplicate level {number}.")
        seen_levels.add(number)

        areas = level.get("areas", [])
        _require(isinstance(areas, list), f"Level {number}: \"areas\" must be a list.")
        for area_index, area in enumerate(areas):
            where = f"Level {number}, area #{area_index + 1}"
            _require(isinstance(area, dict), f"{where} must be an object.")
            area_id = _name(area.get("id"))
            _require(area_id is not None, f'{where} needs an "id".')
            _require(area_id not in area_ids, f'Duplicate process area id "{area_id}".')
            area_ids.add(area_id)

            name = _name(area.get("name"))
            _require(name is not None, f'{where} needs a non-empty "name".')
            _require(
                len(name) <= PROCESS_AREAS_NAME_MAX_LENGTH,
                f'{where}: "name" must be at most {PROCESS_AREAS_NAME_MAX_LENGTH} characters.',
            )
            _require(
                name.casefold() not in area_names,
                f'Two process areas are called "{name}"; area names must be unique.',
            )
            area_names.add(name.casefold())

            object_types = _string_list(area.get("objectTypes"), f'Process area "{name}": "objectTypes"')
            _require(object_types, f'Process area "{name}" needs at least one object type.')
            for object_type in object_types:
                _require(
                    object_type not in owner_of_type,
                    f'Object type "{object_type}" is in both "{owner_of_type.get(object_type)}" '
                    f'and "{name}"; an object type belongs to at most one process area.',
                )
                owner_of_type[object_type] = name
            _string_list(area.get("activities", []), f'Process area "{name}": "activities"')
            area_count += 1

    _require(area_count > 0, "A composition needs at least one process area.")
    _require(
        area_count <= PROCESS_AREAS_MAX_AREAS,
        f"A composition can have at most {PROCESS_AREAS_MAX_AREAS} process areas.",
    )

    unassigned = _string_list(
        data.get("unassignedObjectTypes", []), '"unassignedObjectTypes"'
    )
    for object_type in unassigned:
        _require(
            object_type not in owner_of_type,
            f'Object type "{object_type}" is both unassigned and in "{owner_of_type.get(object_type)}".',
        )

    source = data.get("source")
    _require(source is None or isinstance(source, dict), '"source" must be an object when present.')
    return data
