"""
Public entry point: object types in, process areas out.

The return value is deliberately shape-identical to
:func:`totem_lib.totem.totem.mlpaDiscovery`::

    {level: [(object_types, event_types), ...], ...}

so that the backend serializer and the whole frontend rendering path work with
either algorithm without changes. Choosing the discovery engine stays a
one-line decision at the call site.

Pipeline, mirroring thesis section 4.1 end to end:

1. prepare the log into per-type-pair counters,
2. score every type pair with the joined indicator,
3. solve the layer-assignment ILP,
4. group object types by layer,
5. split each layer into connected components,
6. assign each activity to the lowest layer that touches it.

Steps 5 and 6 reuse ``mlpaDiscovery``'s own helpers rather than reimplementing
them, so both algorithms draw the same boxes for the same layer assignment.
"""

from typing import Dict, List, Set, Tuple

from ..totem.totem import connected_components_undirected
from .aggregates import LogAggregates
from .indicators import JoinedIndicator
from .layer_assignment import assign_layers
from .preparation import prepare

#: Lowest layer number in the returned process view. ``mlpaDiscovery`` starts at
#: zero, and the visualizer prints the number as-is, so we match it.
FIRST_LEVEL = 0

ProcessView = Dict[int, List[Tuple[List[str], Set[str]]]]


def process_areas_from_aggregates(
    aggregates: LogAggregates,
    weights: Dict[str, float] | None = None,
    alpha: float = 1.0,
    beta: float = 1.0,
    margin_scale: float = 0.0,
) -> ProcessView:
    """
    Run scoring, the ILP and the grouping over already-prepared aggregates.

    Split out from :func:`discover_process_areas` because preparation depends
    only on the log while everything here depends on the parameters. A caller
    that keeps the aggregates around -- the HTTP layer does -- can answer a
    slider change without touching the log again.

    :param aggregates: output of :func:`~.preparation.prepare` or
        :func:`~.preparation_db.prepare_db`.
    :param weights: per-indicator weights; see
        :meth:`~.indicators.JoinedIndicator.from_weights`.
    :param alpha: weight on the resource-force hinge (thesis convention).
    :param beta: weight on the attractive-force distance (thesis convention).
    :param margin_scale: reference-implementation extension; ``0`` is the thesis.
    :return: ``{level: [(object_types, event_types), ...]}``, lowest level first.
    """
    joined = JoinedIndicator.from_weights(weights)
    joined.prepare(aggregates)
    resource_forces, attractive_forces = joined.score(aggregates.object_types)

    layer_of = assign_layers(
        aggregates.object_types,
        resource_forces,
        attractive_forces,
        alpha=alpha,
        beta=beta,
        margin_scale=margin_scale,
    )

    return build_process_view(
        layer_of,
        aggregates.type_relations,
        aggregates.event_types_by_object_type,
        aggregates.all_event_types,
    )


def build_process_view(
    layer_of: Dict[str, int],
    type_relations,
    event_types_by_object_type: Dict[str, frozenset],
    all_event_types: frozenset,
) -> ProcessView:
    """
    Turn a raw layer assignment into the MLPA process-view structure.

    :param layer_of: object type to layer, resources on the higher numbers.
    :param type_relations: unordered pairs of co-occurring object types.
    :param event_types_by_object_type: activities per object type.
    :param all_event_types: every activity in the log.

    Layer numbers are compacted to consecutive integers starting at
    :data:`FIRST_LEVEL`. The ILP is free to leave gaps -- nothing forces it to
    use every value in ``1..K`` -- and a gap would render as a missing row.

    Each layer is then split into connected components over ``type_relations``.
    This is a **deliberate deviation from the thesis**, which defines exactly one
    process area per layer (Def. 4.3.2); TOTeM-Tool has always split a layer into
    the groups that actually relate to each other, and that behaviour is kept.

    Activities are assigned bottom-up: an activity belongs to the lowest layer
    any of its objects sit on, which is the thesis's native activity layer
    (Def. 4.1.14). Draining a remaining-activities set as we climb guarantees
    every activity lands in exactly one area.
    """
    types_by_layer: Dict[int, List[str]] = {}
    for object_type, layer in layer_of.items():
        types_by_layer.setdefault(layer, []).append(object_type)

    used_layers = sorted(types_by_layer)
    level_of_layer = {
        layer: FIRST_LEVEL + index for index, layer in enumerate(used_layers)
    }

    process_view: ProcessView = {}
    remaining_event_types = set(all_event_types)

    for layer in used_layers:
        components = connected_components_undirected(
            sorted(types_by_layer[layer]), type_relations
        )
        areas = []
        for component in components:
            requested: Set[str] = set()
            for object_type in component:
                requested |= set(event_types_by_object_type.get(object_type, ()))
            assigned = requested & remaining_event_types
            remaining_event_types -= assigned
            areas.append((component, assigned))
        process_view[level_of_layer[layer]] = areas

    return process_view


def discover_process_areas(
    ocel,
    weights: Dict[str, float] | None = None,
    alpha: float = 1.0,
    beta: float = 1.0,
    margin_scale: float = 0.0,
) -> ProcessView:
    """
    Discover process areas from an in-memory event log.

    The DuckDB-backed equivalent is
    :func:`~.discovery_db.discover_process_areas_db`, which is what the backend
    uses; this one is for library users holding an
    :class:`~totem_lib.ocel.ocel.ObjectCentricEventLog`.

    :param ocel: the event log.
    :param weights: per-indicator weights, e.g.
        ``{"temporal": 1.0, "cardinality": 1.0, "divergence": 1.0}``.
    :param alpha: weight on the resource-force hinge (thesis convention).
    :param beta: weight on the attractive-force distance (thesis convention).
    :param margin_scale: reference-implementation extension; ``0`` is the thesis.
    :return: ``{level: [(object_types, event_types), ...]}``.
    """
    return process_areas_from_aggregates(
        prepare(ocel),
        weights=weights,
        alpha=alpha,
        beta=beta,
        margin_scale=margin_scale,
    )
