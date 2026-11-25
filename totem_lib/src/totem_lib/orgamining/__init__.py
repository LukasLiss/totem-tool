"""Organizational mining: who does the work in an object-centric event log.

Two subtopics:

* **Handover of work** (:mod:`.handover`) — which resources pass business
  objects to each other, how often and how fast:
  :func:`discover_handover` returns a :class:`HandoverGraph`.
* **Resource profiling** (:mod:`.profiling`) — a feature profile per resource
  with distances, clustering and an MDS layout:
  :func:`discover_resource_profiles` returns a :class:`ProfileMatrix`.

All entry points accept either a polars ``ObjectCentricEventLog`` or an
``OcelDuckDB``; see :class:`EventObjectSource` for the shared data slice.
"""

from ._source import EventObjectSource
from .handover import (
    NORMALIZATION_SCOPES,
    NORMALIZATIONS,
    HandoverGraph,
    Normalization,
    NormalizationScope,
    compute_footprint,
    discover_handover,
)
from .profiling import (
    CLUSTER_METHODS,
    DISTANCE_METRICS,
    FEATURE_GROUPS,
    ClusterMethod,
    DistanceMetric,
    FeatureGroup,
    ProfileMatrix,
    ResourceProfile,
    discover_resource_profiles,
)

__all__ = [
    "CLUSTER_METHODS",
    "ClusterMethod",
    "compute_footprint",
    "discover_handover",
    "discover_resource_profiles",
    "DISTANCE_METRICS",
    "DistanceMetric",
    "EventObjectSource",
    "FEATURE_GROUPS",
    "FeatureGroup",
    "HandoverGraph",
    "NORMALIZATION_SCOPES",
    "NORMALIZATIONS",
    "Normalization",
    "NormalizationScope",
    "ProfileMatrix",
    "ResourceProfile",
]
