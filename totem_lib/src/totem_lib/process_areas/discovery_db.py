"""
DuckDB-backed discovery entry point.

Thin counterpart to :func:`~.discovery.discover_process_areas`: it swaps the
preparation stage for the SQL one and then runs exactly the same scoring, ILP
and grouping. Keeping only preparation backend-specific is what makes the parity
test in ``tests/process_areas/test_parity_db.py`` meaningful -- any difference
between the two paths has to come from how the log was read.
"""

from typing import Dict

from ..ocel.ocel_duckdb import OcelDuckDB
from .discovery import ProcessView, process_areas_from_aggregates
from .preparation_db import prepare_db


def discover_process_areas_db(
    ocel_db: OcelDuckDB,
    weights: Dict[str, float] | None = None,
    alpha: float = 1.0,
    beta: float = 1.0,
    margin_scale: float = 0.0,
) -> ProcessView:
    """
    Discover process areas from a DuckDB-backed event log.

    :param ocel_db: a populated :class:`OcelDuckDB`.
    :param weights: per-indicator weights, e.g.
        ``{"temporal": 1.0, "cardinality": 1.0, "divergence": 1.0}``.
    :param alpha: weight on the resource-force hinge (thesis convention).
    :param beta: weight on the attractive-force distance (thesis convention).
    :param margin_scale: reference-implementation extension; ``0`` is the thesis.
    :return: ``{level: [(object_types, event_types), ...]}``, the same structure
        ``mlpaDiscovery`` returns.

    Callers that re-run discovery with different parameters on the same log
    should call :func:`~.preparation_db.prepare_db` once and drive
    :func:`~.discovery.process_areas_from_aggregates` directly — preparation is
    the expensive half and none of these parameters affect it.
    """
    return process_areas_from_aggregates(
        prepare_db(ocel_db),
        weights=weights,
        alpha=alpha,
        beta=beta,
        margin_scale=margin_scale,
    )
