"""
Advanced resource-based process area discovery.

Implements Chapter 4.1 of Moritz Schlegelmilch's bachelor thesis *Discovering
Advanced Resource-Based Process Areas* (PADS, RWTH Aachen, 2026): three
complementary resource indicators are combined into a single directed force and
a single attractive force per object-type pair, and an ILP turns those into a
layer assignment.

It is an alternative to :func:`totem_lib.totem.totem.mlpaDiscovery`, which
decides the same question from TOTeM temporal relations alone.

Vocabulary follows the thesis:

* ``resource_force`` (phi) -- directed, in ``[-1, 1]``, antisymmetric.
* ``attractive_force`` (psi) -- symmetric, in ``[0, 1]``.

The reference implementation accompanying the thesis calls these ``push`` and
``pull``, and swaps the meanings of ``alpha`` and ``beta`` relative to the
thesis text. See ``examples/PROCESS_AREAS.md`` for the full list of deviations.
"""

from .aggregates import (
    CardinalityCounts,
    DivergenceCounts,
    LogAggregates,
    TemporalCounts,
)
from .discovery import (
    build_process_view,
    discover_process_areas,
    process_areas_from_aggregates,
)
from .indicators import (
    INDICATOR_NAMES,
    CardinalityIndicator,
    DivergenceIndicator,
    JoinedIndicator,
    ResourceIndicator,
    TemporalIndicator,
)
from .layer_assignment import assign_layers
from .preparation import prepare

__all__ = [
    "CardinalityCounts",
    "DivergenceCounts",
    "LogAggregates",
    "TemporalCounts",
    "INDICATOR_NAMES",
    "CardinalityIndicator",
    "DivergenceIndicator",
    "JoinedIndicator",
    "ResourceIndicator",
    "TemporalIndicator",
    "assign_layers",
    "build_process_view",
    "discover_process_areas",
    "process_areas_from_aggregates",
    "prepare",
]
