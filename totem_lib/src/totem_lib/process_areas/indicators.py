"""
Resource indicators of thesis section 4.1.

Every indicator answers the same two questions about an ordered pair of object
types ``(a, b)``:

===========================  ==========  ==================================
API name                     Thesis      Meaning
===========================  ==========  ==================================
``resource_force(a, b)``     phi(a,b)    directed, in [-1, 1], antisymmetric.
                                         Positive means *a behaves like a
                                         resource for b* and should end up on a
                                         higher layer.
``attractive_force(a, b)``   psi(a,b)    symmetric, in [0, 1]. High means the
                                         two types are peers and belong on the
                                         same layer.
===========================  ==========  ==================================

The reference implementation accompanying the thesis calls these ``push`` and
``pull``. We use the thesis vocabulary throughout; the mapping is
``push == resource_force`` and ``pull == attractive_force``.

Deviations from the thesis text are inherited from the reference
implementation, which is what produced the thesis's evaluation numbers. They are
documented per class below and collected in ``examples/PROCESS_AREAS.md``.
"""

from abc import ABC, abstractmethod
from typing import Dict, Sequence

from .aggregates import LogAggregates


def _ratio(numerator: float, denominator: float) -> float:
    """Divide, treating an empty denominator as "no evidence" rather than an error."""
    if denominator == 0:
        return 0.0
    return numerator / denominator


class ResourceIndicator(ABC):
    """
    One signal contributing to the layer assignment.

    :param weight: the indicator's weight in the joined indicator
        (thesis Def. 4.1.11). Called ``eps`` in the reference implementation.
    """

    #: Stable key used for weights in the public API and in the HTTP layer.
    name: str = "indicator"

    def __init__(self, weight: float = 1.0):
        self.weight = weight
        self._data: LogAggregates | None = None

    def prepare(self, aggregates: LogAggregates) -> None:
        """
        Bind the indicator to one log's aggregates.

        Kept as an explicit call rather than a constructor argument so that the
        same indicator instance can be re-scored against a re-used, cached
        :class:`LogAggregates` without recomputing anything.
        """
        self._data = aggregates

    @property
    def data(self) -> LogAggregates:
        if self._data is None:
            raise RuntimeError(
                f"{type(self).__name__}.prepare() must be called before scoring"
            )
        return self._data

    @abstractmethod
    def resource_force(self, type_a: str, type_b: str) -> float:
        """Directed force phi(a, b) in [-1, 1]."""

    @abstractmethod
    def attractive_force(self, type_a: str, type_b: str) -> float:
        """Symmetric force psi(a, b) in [0, 1]."""


class TemporalIndicator(ResourceIndicator):
    """
    Thesis section 4.1.1 — resources outlive the objects they serve.

    ``phi`` is the imbalance in lifespan containment: if objects of type ``b``
    tend to live entirely inside the lifespan of the type-``a`` objects they
    relate to, then ``a`` is the longer-lived resource and ``phi(a, b) > 0``.

    ``psi`` is the share of relations where the two lifespans merely hand over
    to each other (disjoint, or overlapping with one starting first). A handover
    is what peers on the same layer do.

    **Deviation D3.** The thesis defines lifespan containment and partial
    overlap as set relations directly. The reference implementation instead
    reuses TOTeM's ``D`` (dependent) and ``I`` (initiating) relation counts,
    which are semantically the same notions counted per object pair. We keep the
    reference behaviour.
    """

    name = "temporal"

    def resource_force(self, type_a: str, type_b: str) -> float:
        forward = self.data.temporal.get((type_a, type_b))
        reverse = self.data.temporal.get((type_b, type_a))
        if forward is None or reverse is None or forward.total == 0:
            return 0.0
        return (reverse.dependent - forward.dependent) / forward.total

    def attractive_force(self, type_a: str, type_b: str) -> float:
        forward = self.data.temporal.get((type_a, type_b))
        reverse = self.data.temporal.get((type_b, type_a))
        if forward is None or reverse is None or forward.total == 0:
            return 0.0
        return (forward.initiating + reverse.initiating) / forward.total


class CardinalityIndicator(ResourceIndicator):
    """
    Thesis section 4.1.2 — resources serve a varying number of objects, peers
    relate in stable numbers.

    ``phi`` is the difference in how *irregular* the two directions are; ``psi``
    is the overall share of objects on both sides that follow the dominant
    cardinality signature.

    **Deviation D1 — this is not the thesis formula.** Thesis Def. 4.1.6/4.1.7
    define a normalised Shannon entropy over the cardinality distribution. The
    reference implementation instead builds a *bilateral signature* per source
    object — its forward cardinality together with the sorted reverse
    cardinalities of the objects it points at — takes the most frequent
    signature as "constant", and derives both forces from that mode share. Same
    intent, different mathematics. The reference behaviour is what the thesis
    evaluated, so it is what we port.
    """

    name = "cardinality"

    def resource_force(self, type_a: str, type_b: str) -> float:
        forward = self.data.cardinality.get((type_a, type_b))
        reverse = self.data.cardinality.get((type_b, type_a))
        if forward is None or reverse is None or forward.total == 0:
            return 0.0
        return _ratio(forward.many, forward.total) - _ratio(reverse.many, reverse.total)

    def attractive_force(self, type_a: str, type_b: str) -> float:
        forward = self.data.cardinality.get((type_a, type_b))
        reverse = self.data.cardinality.get((type_b, type_a))
        if forward is None or reverse is None or forward.total == 0:
            return 0.0
        return _ratio(
            forward.constant + reverse.constant, forward.total + reverse.total
        )


class DivergenceIndicator(ResourceIndicator):
    """
    Thesis section 4.1.3 — an object *diverges* under another if it can be
    swapped out across executions of the same activity while the other stays
    fixed. Divergent objects are being used as resources.

    ``phi`` is the imbalance of the two divergence ratios. ``psi`` combines low
    divergence in both directions with object-type closeness (thesis' delta):
    types that hardly ever swap and that almost always occur together are peers.

    **Deviation D4.** The thesis defines divergence existentially — some other
    event of the same activity contains one object but not the other. The
    reference implementation buckets by ``(type pair, activity, source object)``,
    collects the target-object sets seen across those events and treats
    ``union - intersection`` as divergent whenever at least two distinct sets
    occur. Directionally equivalent, not identical. The ``psi`` side matches the
    thesis exactly.
    """

    name = "divergence"

    def _divergence_ratio(self, type_a: str, type_b: str) -> float:
        counts = self.data.divergence.get((type_a, type_b))
        if counts is None:
            return 0.0
        return _ratio(counts.diverging_targets, self.data.object_counts.get(type_b, 0))

    def _closeness(self, type_a: str, type_b: str) -> float:
        counts = self.data.divergence.get((type_a, type_b))
        if counts is None:
            return 0.0
        return _ratio(counts.related_sources, self.data.object_counts.get(type_a, 0))

    def resource_force(self, type_a: str, type_b: str) -> float:
        return self._divergence_ratio(type_a, type_b) - self._divergence_ratio(
            type_b, type_a
        )

    def attractive_force(self, type_a: str, type_b: str) -> float:
        closeness = max(
            self._closeness(type_a, type_b), self._closeness(type_b, type_a)
        )
        return (
            (1 - self._divergence_ratio(type_a, type_b))
            * (1 - self._divergence_ratio(type_b, type_a))
            * closeness
        )


#: Indicator classes in the order the joined indicator applies them.
INDICATOR_CLASSES = (TemporalIndicator, CardinalityIndicator, DivergenceIndicator)

#: Weight keys accepted by the public API, in the same order.
INDICATOR_NAMES = tuple(cls.name for cls in INDICATOR_CLASSES)


class JoinedIndicator:
    """
    The joined resource indicator of thesis Def. 4.1.11: a weighted mean of the
    individual indicators' forces.

    ``phi(a,b) = sum_i w_i * phi_i(a,b) / sum_i w_i`` and likewise for ``psi``.

    :param indicators: the indicators to combine. Each carries its own weight.
    """

    def __init__(self, indicators: Sequence[ResourceIndicator]):
        if not indicators:
            raise ValueError("at least one indicator is required")
        total_weight = sum(indicator.weight for indicator in indicators)
        if total_weight <= 0:
            raise ValueError("the sum of indicator weights must be positive")
        self.indicators = tuple(indicators)
        self.total_weight = total_weight

    @classmethod
    def from_weights(cls, weights: Dict[str, float] | None = None) -> "JoinedIndicator":
        """
        Build the standard three-indicator ensemble.

        :param weights: per-indicator weights keyed by :data:`INDICATOR_NAMES`.
            Missing keys default to ``1.0``. Indicators weighted ``0`` are
            dropped rather than multiplied out, so they cost nothing to score.
        """
        weights = weights or {}
        unknown = set(weights) - set(INDICATOR_NAMES)
        if unknown:
            raise ValueError(
                f"unknown indicator weights: {sorted(unknown)}; "
                f"expected any of {list(INDICATOR_NAMES)}"
            )
        chosen = []
        for indicator_cls in INDICATOR_CLASSES:
            weight = float(weights.get(indicator_cls.name, 1.0))
            if weight < 0:
                raise ValueError(f"weight for '{indicator_cls.name}' must be >= 0")
            if weight > 0:
                chosen.append(indicator_cls(weight))
        if not chosen:
            raise ValueError("at least one indicator weight must be greater than zero")
        return cls(chosen)

    def prepare(self, aggregates: LogAggregates) -> None:
        for indicator in self.indicators:
            indicator.prepare(aggregates)

    def resource_force(self, type_a: str, type_b: str) -> float:
        return (
            sum(
                indicator.resource_force(type_a, type_b) * indicator.weight
                for indicator in self.indicators
            )
            / self.total_weight
        )

    def attractive_force(self, type_a: str, type_b: str) -> float:
        return (
            sum(
                indicator.attractive_force(type_a, type_b) * indicator.weight
                for indicator in self.indicators
            )
            / self.total_weight
        )

    def score(
        self, object_types: Sequence[str]
    ) -> tuple[Dict[tuple[str, str], float], Dict[tuple[str, str], float]]:
        """
        Score every ordered pair of distinct object types.

        :return: ``(resource_forces, attractive_forces)``, both keyed by ordered
            type pair. Identical pairs are scored ``0`` on both sides, matching
            the reference implementation.
        """
        resource_forces: Dict[tuple[str, str], float] = {}
        attractive_forces: Dict[tuple[str, str], float] = {}
        for type_a in object_types:
            for type_b in object_types:
                if type_a == type_b:
                    resource_forces[(type_a, type_b)] = 0.0
                    attractive_forces[(type_a, type_b)] = 0.0
                    continue
                resource_forces[(type_a, type_b)] = self.resource_force(type_a, type_b)
                attractive_forces[(type_a, type_b)] = self.attractive_force(
                    type_a, type_b
                )
        return resource_forces, attractive_forces
