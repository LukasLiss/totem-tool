from __future__ import annotations

from ..ocel.ocel_duckdb import OcelDuckDB
from .histograms_db import compute_totem_histograms_db
from .totem import (
    TR_DEPENDENT,
    TR_DEPENDENT_INVERSE,
    TR_INITIATING,
    TR_INITIATING_REVERSE,
    TR_PARALLEL,
    Totem,
    get_most_precise_ec,
    get_most_precise_lc,
    get_most_precise_tr,
    has_valid_event_cardinality_pair,
)


def totemDiscovery_db(ocel_db: OcelDuckDB, tau: float = 0.9) -> Totem:
    """Discover a TOTeM through DuckDB aggregations over an OCEL database."""
    conn = ocel_db.conn

    activity_rows = conn.execute("""
        SELECT DISTINCT o.obj_type, e.activity
        FROM events e
        JOIN event_object eo ON e.event_id = eo.event_id
        JOIN objects o       ON eo.obj_id   = o.obj_id
    """).fetchall()

    object_type_to_event_types: dict[str, set[str]] = {}
    all_event_types: set[str] = set()
    for object_type, activity in activity_rows:
        object_type_to_event_types.setdefault(object_type, set()).add(activity)
        all_event_types.add(activity)

    type_pair_rows = conn.execute("""
        SELECT DISTINCT o1.obj_type AS t1, o2.obj_type AS t2
        FROM event_object eo1
        JOIN event_object eo2 ON eo1.event_id = eo2.event_id
        JOIN objects o1       ON eo1.obj_id    = o1.obj_id
        JOIN objects o2       ON eo2.obj_id    = o2.obj_id
        WHERE o1.obj_type < o2.obj_type
    """).fetchall()
    type_relations: set[frozenset[str]] = {
        frozenset({source, target}) for source, target in type_pair_rows
    }

    histograms = compute_totem_histograms_db(ocel_db)
    event_cardinalities = histograms.event_cardinality
    log_cardinalities = histograms.log_cardinality
    temporal_relations = histograms.temporal

    tempgraph = {
        "nodes": set(object_type_to_event_types.keys()),
        TR_PARALLEL: set(),
        TR_INITIATING: set(),
        TR_DEPENDENT: set(),
    }
    cardinalities = {}

    for connected_types in type_relations:
        source, target = connected_types
        tempgraph["nodes"].add(source)
        tempgraph["nodes"].add(target)

        log_cardinality = get_most_precise_lc(
            (source, target), tau, log_cardinalities
        )
        inverse_log_cardinality = get_most_precise_lc(
            (target, source), tau, log_cardinalities
        )
        event_cardinality = get_most_precise_ec(
            (source, target), tau, event_cardinalities
        )
        inverse_event_cardinality = get_most_precise_ec(
            (target, source), tau, event_cardinalities
        )
        if not has_valid_event_cardinality_pair(
            event_cardinality, inverse_event_cardinality, tau
        ):
            continue
        temporal_relation = get_most_precise_tr(
            (source, target), tau, temporal_relations
        )
        inverse_temporal_relation = get_most_precise_tr(
            (target, source), tau, temporal_relations
        )

        if temporal_relation in (
            TR_DEPENDENT_INVERSE,
            TR_INITIATING_REVERSE,
        ):
            tempgraph[inverse_temporal_relation].add((target, source))
        else:
            tempgraph[temporal_relation].add((source, target))

        cardinalities[(source, target)] = {
            "LC": log_cardinality,
            "EC": event_cardinality,
        }
        cardinalities[(target, source)] = {
            "LC": inverse_log_cardinality,
            "EC": inverse_event_cardinality,
        }

    totem = Totem(
        tempgraph,
        cardinalities,
        type_relations,
        all_event_types,
        object_type_to_event_types,
    )
    totem.h_event_cardinalities = event_cardinalities
    totem.h_log_cardinalities = log_cardinalities
    totem.h_temporal_relations = temporal_relations
    return totem
