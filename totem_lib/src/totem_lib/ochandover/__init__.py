"""Organizational mining: handover of work and resource profiling.

Both algorithms accept either a polars ``ObjectCentricEventLog`` or an
``OcelDuckDB``; see :class:`EventObjectSource` for the shared data slice.
"""

from ._source import EventObjectSource
from .ochandover import OCHANDOVER
from .orgamining import FEATURE_GROUPS, ProfileMatrix, ResourceProfile

__all__ = [
    "EventObjectSource",
    "FEATURE_GROUPS",
    "OCHANDOVER",
    "ProfileMatrix",
    "ResourceProfile",
]
