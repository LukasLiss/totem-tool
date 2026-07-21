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

This module initially defines the stable result boundary. The DuckDB histogram
and metric computation is added in the following implementation passes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Tuple


PairKey = Tuple[str, str]
DetailKey = Tuple[str, str, str]
HistogramCounts = Mapping[str, int]


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

    def to_dict(self) -> Dict[str, Any]:
        return {
            "object_type": self.object_type,
            "temporal": self.temporal.to_dict(),
            "log_cardinality": self.log_cardinality.to_dict(),
            "event_cardinality": self.event_cardinality.to_dict(),
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
            "object_type_metrics": [
                metric.to_dict()
                for metric in sorted(
                    self.object_type_metrics,
                    key=lambda item: item.object_type,
                )
            ],
            "type_pair_metrics": [
                metric.to_dict()
                for metric in sorted(
                    self.type_pair_metrics,
                    key=lambda item: (item.source_type, item.target_type),
                )
            ],
            "histograms": self.histograms.to_dict(),
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
