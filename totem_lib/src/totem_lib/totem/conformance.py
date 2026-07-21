"""Result contract for TOTeM conformance checking.

The reference implementation on ``origin/totem-conformance`` compares an
existing :class:`Totem` with an event log in three dimensions: temporal
relations, log cardinality, and event cardinality. For each dimension it
reports fitness and precision for type pairs, averages those values per object
type, and provides an overall result. It also exposes aggregate and
fine-grained histograms used by the conformance visualization.

The DuckDB port intentionally preserves those metric categories and formulas:

* fitness is the observed count for the model relation divided by the total;
* precision is one minus the largest count of a more precise relation divided
  by the total;
* temporal and cardinality histogram classes overlap according to their
  precision hierarchy, as they do during TOTeM discovery.

Two integration details differ deliberately from the reference branch. The
model is supplied independently instead of being discovered from the checked
log, and compound histogram keys are represented by named JSON fields instead
of delimiter-encoded strings such as ``"Order|Item"``.

This module defines the stable result boundary and the DuckDB-backed metric
calculation. Histogram extraction remains shared with TOTeM discovery.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Dict, List, Mapping, Optional, Tuple

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
    TR_TOTAL,
)

if TYPE_CHECKING:
    from ..ocel.ocel_duckdb import OcelDuckDB
    from .totem import Totem


PairKey = Tuple[str, str]
DetailKey = Tuple[str, str, str]
HistogramCounts = Mapping[str, int]
MetricContribution = Tuple[int, int, int]

_TEMPORAL_RELATIONS = {
    TR_DEPENDENT,
    TR_DEPENDENT_INVERSE,
    TR_INITIATING,
    TR_INITIATING_REVERSE,
    TR_PARALLEL,
}
_CARDINALITY_RELATIONS = {
    EC_ZERO,
    EC_ONE,
    EC_ZERO_ONE,
    EC_MANY,
    EC_ZERO_MANY,
}
_INVERSE_TEMPORAL_RELATION = {
    TR_DEPENDENT: TR_DEPENDENT_INVERSE,
    TR_DEPENDENT_INVERSE: TR_DEPENDENT,
    TR_INITIATING: TR_INITIATING_REVERSE,
    TR_INITIATING_REVERSE: TR_INITIATING,
    TR_PARALLEL: TR_PARALLEL,
}


@dataclass(frozen=True)
class FitnessPrecision:
    """Fitness and precision for one conformance dimension."""

    fitness: Optional[float]
    precision: Optional[float]

    def to_dict(self) -> Dict[str, Optional[float]]:
        return {
            "fitness": self.fitness,
            "precision": self.precision,
        }


@dataclass(frozen=True)
class RelationConformance:
    """Model relation and its observed fitness and precision."""

    model_relation: Optional[str]
    fitness: Optional[float]
    precision: Optional[float]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "model_relation": self.model_relation,
            "fitness": self.fitness,
            "precision": self.precision,
        }


@dataclass(frozen=True)
class OverallConformance:
    """Aggregate conformance across all evaluated type pairs."""

    temporal: FitnessPrecision
    log_cardinality: FitnessPrecision
    event_cardinality: FitnessPrecision

    def to_dict(self) -> Dict[str, Dict[str, Optional[float]]]:
        return {
            "temporal": self.temporal.to_dict(),
            "log_cardinality": self.log_cardinality.to_dict(),
            "event_cardinality": self.event_cardinality.to_dict(),
        }


@dataclass(frozen=True)
class ObjectTypeConformance:
    """Average conformance for all model pairs involving one object type."""

    object_type: str
    temporal: FitnessPrecision
    log_cardinality: FitnessPrecision
    event_cardinality: FitnessPrecision

    def to_dict(self) -> Dict[str, Dict[str, Optional[float]]]:
        return {
            "temporal": _average_metrics_dict(self.temporal),
            "log_cardinality": _average_metrics_dict(self.log_cardinality),
            "event_cardinality": _average_metrics_dict(
                self.event_cardinality
            ),
        }


@dataclass(frozen=True)
class TypePairConformance:
    """Conformance details for one directed pair of object types."""

    source_type: str
    target_type: str
    temporal: RelationConformance
    log_cardinality: RelationConformance
    event_cardinality: RelationConformance

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_type": self.source_type,
            "target_type": self.target_type,
            "temporal": self.temporal.to_dict(),
            "log_cardinality": self.log_cardinality.to_dict(),
            "event_cardinality": self.event_cardinality.to_dict(),
        }


@dataclass(frozen=True)
class TotemConformanceHistograms:
    """Aggregate and visualization-detail histograms derived from the log."""

    temporal: Mapping[PairKey, HistogramCounts]
    log_cardinality: Mapping[PairKey, HistogramCounts]
    event_cardinality: Mapping[PairKey, HistogramCounts]
    event_cardinality_by_activity: Mapping[DetailKey, HistogramCounts]
    temporal_by_relation_type: Mapping[DetailKey, HistogramCounts]
    log_cardinality_by_relation_type: Mapping[DetailKey, HistogramCounts]

    def to_dict(self) -> Dict[str, List[Dict[str, Any]]]:
        return {
            "temporal": _pair_histogram_records(self.temporal),
            "log_cardinality": _pair_histogram_records(self.log_cardinality),
            "event_cardinality": _pair_histogram_records(
                self.event_cardinality
            ),
            "event_cardinality_by_activity": _detail_histogram_records(
                self.event_cardinality_by_activity,
                "activity",
            ),
            "temporal_by_relation_type": _detail_histogram_records(
                self.temporal_by_relation_type,
                "relation_type",
            ),
            "log_cardinality_by_relation_type": _detail_histogram_records(
                self.log_cardinality_by_relation_type,
                "relation_type",
            ),
        }


@dataclass(frozen=True)
class TotemConformanceResult:
    """Stable library result consumed by the backend and frontend."""

    overall_metrics: OverallConformance
    object_type_metrics: Tuple[ObjectTypeConformance, ...]
    type_pair_metrics: Tuple[TypePairConformance, ...]
    histograms: TotemConformanceHistograms

    def to_dict(self) -> Dict[str, Any]:
        return {
            "overall_metrics": self.overall_metrics.to_dict(),
            "object_type_metrics": {
                metric.object_type: metric.to_dict()
                for metric in sorted(
                    self.object_type_metrics,
                    key=lambda item: item.object_type,
                )
            },
            "type_pair_metrics": [
                metric.to_dict()
                for metric in sorted(
                    self.type_pair_metrics,
                    key=lambda item: (item.source_type, item.target_type),
                )
            ],
            "histograms": self.histograms.to_dict(),
        }


def get_more_precise_tr(relation: Optional[str]) -> Tuple[str, ...]:
    """Return temporal relations that are more precise than ``relation``."""
    if relation == TR_PARALLEL:
        return (
            TR_DEPENDENT,
            TR_DEPENDENT_INVERSE,
            TR_INITIATING,
            TR_INITIATING_REVERSE,
        )
    if relation in (TR_INITIATING, TR_INITIATING_REVERSE):
        return (TR_DEPENDENT, TR_DEPENDENT_INVERSE)
    return ()


def get_more_precise_lc(relation: Optional[str]) -> Tuple[str, ...]:
    """Return log cardinalities that are more precise than ``relation``."""
    return _more_precise_cardinality(relation)


def get_more_precise_ec(relation: Optional[str]) -> Tuple[str, ...]:
    """Return event cardinalities that are more precise than ``relation``."""
    return _more_precise_cardinality(relation)


def conformance_of_totem(
    totem: Totem,
    ocel_db: OcelDuckDB,
) -> TotemConformanceResult:
    """Compare an existing TOTeM model with a DuckDB-backed event log."""
    # Imported here because the shared histogram module uses the result types
    # defined above.
    from .histograms_db import compute_totem_histograms_db

    histograms = compute_totem_histograms_db(
        ocel_db,
        include_details=True,
        connection_mode="conformance",
    )
    model_temporal_relations = _model_temporal_relations(totem)
    pair_metrics = []
    contributions: Dict[str, List[MetricContribution]] = {
        "temporal": [],
        "log_cardinality": [],
        "event_cardinality": [],
    }

    for source_type, target_type in sorted(totem.cardinalities):
        pair = (source_type, target_type)
        cardinalities = totem.cardinalities[pair]
        temporal_relation = _temporal_relation_for_pair(
            pair,
            model_temporal_relations,
        )
        temporal, temporal_contribution = _relation_conformance(
            temporal_relation,
            histograms.temporal.get(pair),
            TR_TOTAL,
            _TEMPORAL_RELATIONS,
            get_more_precise_tr,
        )
        log_cardinality, log_contribution = _relation_conformance(
            cardinalities.get("LC"),
            histograms.log_cardinality.get(pair),
            LC_TOTAL,
            _CARDINALITY_RELATIONS,
            get_more_precise_lc,
        )
        event_cardinality, event_contribution = _relation_conformance(
            cardinalities.get("EC"),
            histograms.event_cardinality.get(pair),
            EC_TOTAL,
            _CARDINALITY_RELATIONS,
            get_more_precise_ec,
        )

        pair_metric = TypePairConformance(
            source_type=source_type,
            target_type=target_type,
            temporal=temporal,
            log_cardinality=log_cardinality,
            event_cardinality=event_cardinality,
        )
        pair_metrics.append(pair_metric)
        _append_contribution(
            contributions["temporal"],
            temporal_contribution,
        )
        _append_contribution(
            contributions["log_cardinality"],
            log_contribution,
        )
        _append_contribution(
            contributions["event_cardinality"],
            event_contribution,
        )

    object_types = sorted(
        {
            object_type
            for pair in totem.cardinalities
            for object_type in pair
        }
    )
    object_type_metrics = tuple(
        _object_type_conformance(object_type, pair_metrics)
        for object_type in object_types
    )
    overall_metrics = OverallConformance(
        temporal=_overall_conformance(contributions["temporal"]),
        log_cardinality=_overall_conformance(
            contributions["log_cardinality"]
        ),
        event_cardinality=_overall_conformance(
            contributions["event_cardinality"]
        ),
    )

    return TotemConformanceResult(
        overall_metrics=overall_metrics,
        object_type_metrics=object_type_metrics,
        type_pair_metrics=tuple(pair_metrics),
        histograms=histograms,
    )


def _more_precise_cardinality(relation: Optional[str]) -> Tuple[str, ...]:
    if relation == LC_ZERO_MANY:
        return (LC_ZERO, LC_ONE, LC_ZERO_ONE, LC_MANY)
    if relation == LC_ZERO_ONE:
        return (LC_ZERO, LC_ONE)
    if relation == LC_MANY:
        return (LC_ONE,)
    return ()


def _model_temporal_relations(totem: Totem) -> Dict[PairKey, str]:
    relations = {}
    for relation in (
        TR_DEPENDENT,
        TR_DEPENDENT_INVERSE,
        TR_INITIATING,
        TR_INITIATING_REVERSE,
        TR_PARALLEL,
    ):
        for source_type, target_type in totem.tempgraph.get(relation, set()):
            relations[(source_type, target_type)] = relation
    return relations


def _temporal_relation_for_pair(
    pair: PairKey,
    relations: Mapping[PairKey, str],
) -> Optional[str]:
    direct_relation = relations.get(pair)
    if direct_relation is not None:
        return direct_relation
    reverse_relation = relations.get((pair[1], pair[0]))
    return _INVERSE_TEMPORAL_RELATION.get(reverse_relation)


def _relation_conformance(
    model_relation: Optional[str],
    histogram: Optional[HistogramCounts],
    total_key: str,
    supported_relations: set[str],
    more_precise_relations,
) -> Tuple[RelationConformance, Optional[MetricContribution]]:
    if model_relation not in supported_relations or histogram is None:
        return RelationConformance(model_relation, None, None), None

    total = int(histogram.get(total_key, 0))
    if total <= 0:
        return RelationConformance(model_relation, None, None), None

    occurrences = int(histogram.get(model_relation, 0))
    max_more_precise = max(
        (
            int(histogram.get(relation, 0))
            for relation in more_precise_relations(model_relation)
        ),
        default=0,
    )
    return (
        RelationConformance(
            model_relation=model_relation,
            fitness=occurrences / total,
            precision=1.0 - (max_more_precise / total),
        ),
        (occurrences, total, max_more_precise),
    )


def _append_contribution(
    contributions: List[MetricContribution],
    contribution: Optional[MetricContribution],
) -> None:
    if contribution is not None:
        contributions.append(contribution)


def _object_type_conformance(
    object_type: str,
    pair_metrics: List[TypePairConformance],
) -> ObjectTypeConformance:
    involving_type = [
        metric
        for metric in pair_metrics
        if object_type in (metric.source_type, metric.target_type)
    ]
    return ObjectTypeConformance(
        object_type=object_type,
        temporal=_average_relation_metrics(
            metric.temporal for metric in involving_type
        ),
        log_cardinality=_average_relation_metrics(
            metric.log_cardinality for metric in involving_type
        ),
        event_cardinality=_average_relation_metrics(
            metric.event_cardinality for metric in involving_type
        ),
    )


def _average_relation_metrics(
    metrics,
) -> FitnessPrecision:
    metrics = list(metrics)
    fitness_values = [
        metric.fitness for metric in metrics if metric.fitness is not None
    ]
    precision_values = [
        metric.precision for metric in metrics if metric.precision is not None
    ]
    return FitnessPrecision(
        fitness=_average(fitness_values),
        precision=_average(precision_values),
    )


def _average(values: List[float]) -> Optional[float]:
    return sum(values) / len(values) if values else None


def _overall_conformance(
    contributions: List[MetricContribution],
) -> FitnessPrecision:
    total = sum(item[1] for item in contributions)
    if total == 0:
        return FitnessPrecision(None, None)
    return FitnessPrecision(
        fitness=sum(item[0] for item in contributions) / total,
        precision=1.0 - (sum(item[2] for item in contributions) / total),
    )


def _average_metrics_dict(
    metrics: FitnessPrecision,
) -> Dict[str, Optional[float]]:
    return {
        "avg_fitness": metrics.fitness,
        "avg_precision": metrics.precision,
    }


def _pair_histogram_records(
    histogram: Mapping[PairKey, HistogramCounts],
) -> List[Dict[str, Any]]:
    return [
        {
            "source_type": source_type,
            "target_type": target_type,
            "counts": _sorted_counts(counts),
        }
        for (source_type, target_type), counts in sorted(histogram.items())
    ]


def _detail_histogram_records(
    histogram: Mapping[DetailKey, HistogramCounts],
    detail_name: str,
) -> List[Dict[str, Any]]:
    return [
        {
            "source_type": source_type,
            "target_type": target_type,
            detail_name: detail,
            "counts": _sorted_counts(counts),
        }
        for (source_type, target_type, detail), counts in sorted(
            histogram.items()
        )
    ]


def _sorted_counts(counts: HistogramCounts) -> Dict[str, int]:
    return {key: counts[key] for key in sorted(counts)}
