"""
Preparation over the in-memory Polars :class:`ObjectCentricEventLog`.

This is the reference-faithful path: it walks the log in Python exactly the way
the thesis's implementation does, and is the yardstick the DuckDB path in
:mod:`.preparation_db` is checked against. Production traffic goes through the
DuckDB path, which handles logs larger than memory.

The O2O relation used throughout is thesis Def. 3.3.2: two objects are related
if they share an event, or if the log declares an explicit object-to-object
edge between them. Both are symmetric here. An object is also related to itself
whenever it shares an event with itself, which is always -- this matches the
reference implementation and only affects the diagonal type pairs, which no
indicator ever reads.
"""

from collections import defaultdict
from typing import Dict, Set, Tuple

from .aggregates import (
    CardinalityCounts,
    DivergenceCounts,
    LogAggregates,
    TemporalCounts,
)

#: ``object id -> object type -> related object ids of that type``
O2ORelation = Dict[str, Dict[str, Set[str]]]


def _build_o2o(ocel) -> Tuple[Dict[str, int], Dict[str, int], O2ORelation, Dict[str, Set[str]]]:
    """
    Single pass over the log building object lifespans and the O2O closure.

    :return: ``(min_times, max_times, o2o, type_to_objects)``.
    """
    min_times: Dict[str, int] = {}
    max_times: Dict[str, int] = {}
    o2o: O2ORelation = {}
    type_to_objects: Dict[str, Set[str]] = {}

    object_types = list(ocel.object_types)

    for event_id in ocel.events["_eventId"]:
        timestamp = ocel.get_event_timestamp(event_id)
        event_objects = ocel.get_event_objectIDs(event_id)

        objects_by_type = {
            object_type: set(ocel.get_event_objects_by_type(event_id, object_type))
            for object_type in object_types
        }

        for object_type, objects in objects_by_type.items():
            if objects:
                type_to_objects.setdefault(object_type, set()).update(objects)

        for obj in event_objects:
            related = o2o.setdefault(obj, {})
            for object_type in object_types:
                related.setdefault(object_type, set()).update(
                    objects_by_type[object_type]
                )

            if timestamp is not None:
                if obj not in min_times or timestamp < min_times[obj]:
                    min_times[obj] = timestamp
                if obj not in max_times or timestamp > max_times[obj]:
                    max_times[obj] = timestamp

    object_to_type: Dict[str, str] = {
        obj: object_type
        for object_type, objects in type_to_objects.items()
        for obj in objects
    }

    # Explicit O2O edges, added in both directions. Endpoints that never appear
    # in an event have no type and are skipped -- they carry no lifespan and no
    # activity either, so no indicator could say anything about them.
    for source_obj, target_obj in ocel.o2o_graph_edges:
        source_type = object_to_type.get(source_obj)
        target_type = object_to_type.get(target_obj)
        if source_type is None or target_type is None:
            continue
        o2o.setdefault(source_obj, {}).setdefault(target_type, set()).add(target_obj)
        o2o.setdefault(target_obj, {}).setdefault(source_type, set()).add(source_obj)

    return min_times, max_times, o2o, type_to_objects


def _temporal_counts(
    object_types, min_times, max_times, o2o, type_to_objects
) -> Dict[Tuple[str, str], TemporalCounts]:
    counts: Dict[Tuple[str, str], Dict[str, int]] = {}

    for source_type in object_types:
        for target_type in object_types:
            total = dependent = initiating = 0

            for source_obj in type_to_objects.get(source_type, ()):
                if source_obj not in min_times or source_obj not in max_times:
                    continue
                source_min, source_max = min_times[source_obj], max_times[source_obj]

                for target_obj in o2o.get(source_obj, {}).get(target_type, ()):
                    if target_obj not in min_times or target_obj not in max_times:
                        continue
                    target_min, target_max = (
                        min_times[target_obj],
                        max_times[target_obj],
                    )

                    total += 1

                    # Source lives entirely inside the target's lifespan: the
                    # target outlives it and behaves like the resource.
                    if target_min <= source_min <= source_max <= target_max:
                        dependent += 1

                    # Disjoint, or overlapping with the source starting first:
                    # a handover between peers.
                    if (source_max <= target_min) or (
                        source_min < target_min <= source_max < target_max
                    ):
                        initiating += 1

            counts[(source_type, target_type)] = {
                "total": total,
                "dependent": dependent,
                "initiating": initiating,
            }

    return {
        pair: TemporalCounts(
            total=value["total"],
            dependent=value["dependent"],
            initiating=value["initiating"],
        )
        for pair, value in counts.items()
    }


def _cardinality_counts(
    object_types, o2o, type_to_objects
) -> Dict[Tuple[str, str], CardinalityCounts]:
    counts: Dict[Tuple[str, str], CardinalityCounts] = {}

    for source_type in object_types:
        source_objects = type_to_objects.get(source_type, set())
        total = len(source_objects)

        for target_type in object_types:
            signature_counts: Dict[tuple, int] = defaultdict(int)

            for source_obj in source_objects:
                target_objects = o2o.get(source_obj, {}).get(target_type, set())
                forward_cardinality = len(target_objects)
                if forward_cardinality == 0:
                    continue
                reverse_cardinalities = tuple(
                    sorted(
                        len(o2o.get(target_obj, {}).get(source_type, ()))
                        for target_obj in target_objects
                    )
                )
                signature_counts[(forward_cardinality, reverse_cardinalities)] += 1

            if total == 0 or not signature_counts:
                counts[(source_type, target_type)] = CardinalityCounts(
                    total=total, constant=0, many=total
                )
                continue

            dominant = max(
                signature_counts,
                key=lambda signature: (
                    signature_counts[signature],
                    -signature[0],
                    tuple(-value for value in signature[1]),
                ),
            )
            constant = signature_counts[dominant]
            counts[(source_type, target_type)] = CardinalityCounts(
                total=total, constant=constant, many=total - constant
            )

    return counts


def _divergence_counts(
    ocel, object_types, o2o, type_to_objects
) -> Dict[Tuple[str, str], DivergenceCounts]:
    related_sources: Dict[Tuple[str, str], int] = {
        (source_type, target_type): 0
        for source_type in object_types
        for target_type in object_types
    }
    for source_type in object_types:
        for source_obj in type_to_objects.get(source_type, ()):
            for target_type, target_objects in o2o.get(source_obj, {}).items():
                if target_objects:
                    related_sources[(source_type, target_type)] += 1

    object_to_type: Dict[str, str] = {
        obj: object_type
        for object_type, objects in type_to_objects.items()
        for obj in objects
    }

    # Per (type pair, activity, source object): the distinct sets of target
    # objects that were observed. Two different sets mean the source saw
    # different partners doing the same thing.
    observed_target_sets: Dict[tuple, Set[frozenset]] = defaultdict(set)
    for event_id in ocel.events["_eventId"]:
        activity = ocel.get_event_activity(event_id)

        objects_by_type: Dict[str, Set[str]] = defaultdict(set)
        for obj in ocel.get_event_objectIDs(event_id):
            object_type = object_to_type.get(obj)
            if object_type is not None:
                objects_by_type[object_type].add(obj)

        frozen_by_type = {
            object_type: frozenset(objects)
            for object_type, objects in objects_by_type.items()
            if objects
        }

        for source_type, source_objects in frozen_by_type.items():
            for target_type, target_objects in frozen_by_type.items():
                for source_obj in source_objects:
                    observed_target_sets[
                        ((source_type, target_type), activity, source_obj)
                    ].add(target_objects)

    diverging: Dict[Tuple[str, str], Set[str]] = defaultdict(set)
    for (pair, _activity, _source_obj), target_sets in observed_target_sets.items():
        if len(target_sets) < 2:
            continue
        iterator = iter(target_sets)
        first = next(iterator)
        union: Set[str] = set(first)
        intersection: Set[str] = set(first)
        for target_objects in iterator:
            union.update(target_objects)
            intersection.intersection_update(target_objects)
        diverging[pair].update(union - intersection)

    return {
        pair: DivergenceCounts(
            related_sources=related_sources.get(pair, 0),
            diverging_targets=len(diverging.get(pair, ())),
        )
        for pair in related_sources
    }


def prepare(ocel) -> LogAggregates:
    """
    Compute all indicator inputs from an in-memory event log.

    :param ocel: an :class:`~totem_lib.ocel.ocel.ObjectCentricEventLog`.
    :return: aggregates ready to be handed to
        :meth:`~.indicators.JoinedIndicator.prepare`.

    The result depends only on the log, never on the indicator weights or the
    ILP parameters, so it is safe to cache per log and re-use across parameter
    changes.
    """
    object_types = sorted(ocel.object_types)
    min_times, max_times, o2o, type_to_objects = _build_o2o(ocel)

    return LogAggregates(
        object_types=tuple(object_types),
        object_counts={
            object_type: len(type_to_objects.get(object_type, ()))
            for object_type in object_types
        },
        temporal=_temporal_counts(
            object_types, min_times, max_times, o2o, type_to_objects
        ),
        cardinality=_cardinality_counts(object_types, o2o, type_to_objects),
        divergence=_divergence_counts(ocel, object_types, o2o, type_to_objects),
    )
