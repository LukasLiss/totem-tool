"""
Log-level aggregates that feed the resource indicators.

Everything the three indicators of thesis section 4.1 need can be expressed as a
handful of counters per *ordered object-type pair*. Keeping that as the boundary
between "read the log" and "score the log" has two consequences that matter:

* the Polars path (:mod:`.preparation`) and the DuckDB path
  (:mod:`.preparation_db`) produce the same structure, so they are comparable by
  construction rather than by hope, and
* the memory held in Python is O(|OT|^2) regardless of log size, which is what
  lets the DuckDB path stream logs larger than RAM.
"""

from dataclasses import dataclass, field
from typing import Dict, FrozenSet, Tuple


TypePair = Tuple[str, str]


@dataclass(frozen=True)
class TemporalCounts:
    """
    Counts over object pairs (source of type A, target of type B) that are
    related in the O2O closure.

    :param total: number of related object pairs.
    :param dependent: pairs whose source lifespan is contained in the target's.
    :param initiating: pairs whose lifespans are disjoint or partially overlap
        with the source starting first.
    """

    total: int = 0
    dependent: int = 0
    initiating: int = 0


@dataclass(frozen=True)
class CardinalityCounts:
    """
    Counts over source objects of type A, describing how stable their
    relationship cardinality towards type B is.

    :param total: number of objects of the source type present in the log.
    :param constant: objects carrying the most frequent bilateral cardinality
        signature towards the target type.
    :param many: ``total - constant``.
    """

    total: int = 0
    constant: int = 0
    many: int = 0


@dataclass(frozen=True)
class DivergenceCounts:
    """
    Counts describing how interchangeable objects of type B are underneath
    objects of type A.

    :param related_sources: objects of the source type having at least one
        related object of the target type.
    :param diverging_targets: distinct objects of the target type that were
        observed being swapped out across executions of the same activity.
    """

    related_sources: int = 0
    diverging_targets: int = 0


@dataclass(frozen=True)
class LogAggregates:
    """
    The complete indicator input for one event log.

    :param object_types: all object types, **sorted**. The order is part of the
        contract: the ILP iterates it, and CBC can return a different optimum
        for a different variable order, so an unordered collection here would
        make discovery non-reproducible.
    :param object_counts: number of objects per type that occur in at least one
        event. Objects never referenced by an event are invisible to every
        indicator and are excluded throughout.
    :param temporal: temporal counters per ordered type pair.
    :param cardinality: cardinality counters per ordered type pair.
    :param divergence: divergence counters per ordered type pair.
    :param event_types_by_object_type: activities each object type participates
        in. Used to lift the layer assignment from object types to activities.
    :param all_event_types: every activity in the log.
    :param type_relations: unordered pairs of object types sharing at least one
        event. Same definition as ``Totem.type_relations``, and used for the
        same purpose: splitting a layer into connected process areas.
    """

    object_types: Tuple[str, ...]
    object_counts: Dict[str, int] = field(default_factory=dict)
    temporal: Dict[TypePair, TemporalCounts] = field(default_factory=dict)
    cardinality: Dict[TypePair, CardinalityCounts] = field(default_factory=dict)
    divergence: Dict[TypePair, DivergenceCounts] = field(default_factory=dict)
    event_types_by_object_type: Dict[str, FrozenSet[str]] = field(default_factory=dict)
    all_event_types: FrozenSet[str] = frozenset()
    type_relations: FrozenSet[FrozenSet[str]] = frozenset()
