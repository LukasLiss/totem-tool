"""
Naive (lazy-aggregation) formulation of the TOTeM temporal-relation phase.

totemDiscovery_db first reduces every object to its lifetime interval
[min_t, max_t] (one row per object) and only then joins co-occurring object
pairs — eager aggregation. This module instead transcribes the in-memory
algorithm literally: every connected object pair is joined with *all* events
of both objects and the interval bounds are aggregated per pair, producing
an intermediate of size sum over pairs of |events(src)| x |events(tgt)|.

Used as the ablation baseline that quantifies the benefit of eager
aggregation (group-by pushdown). Results are identical
(see tests/totem/test_totem_naive.py).
"""

from .totem import (
    Totem,
    TR_TOTAL,
    TR_DEPENDENT,
    TR_DEPENDENT_INVERSE,
    TR_INITIATING,
    TR_INITIATING_REVERSE,
    TR_PARALLEL,
)
from .totem_db import (
    _phase_act_types,
    _phase_type_relations,
    _phase_event_cardinalities,
    _phase_log_cardinalities,
    build_totem_from_counters,
)
from ..ocel.ocel_duckdb import OcelDuckDB


def totemDiscovery_db_naive(ocel_db: OcelDuckDB, tau: float = 0.9) -> Totem:
    """Same result as totemDiscovery_db, but with the naive TR phase."""
    conn = ocel_db.conn

    obj_typ_to_ev_type, all_event_types = _phase_act_types(conn)
    type_relations = _phase_type_relations(conn)
    h_event_cardinalities = _phase_event_cardinalities(conn)
    h_log_cardinalities = _phase_log_cardinalities(conn)
    h_temporal_relations = _phase_temporal_relations_naive(conn)

    return build_totem_from_counters(
        type_relations,
        all_event_types,
        obj_typ_to_ev_type,
        h_event_cardinalities,
        h_log_cardinalities,
        h_temporal_relations,
        tau,
    )


def _phase_temporal_relations_naive(conn):
    tr_rows = conn.execute("""
        WITH
        e2o_conn AS (
            SELECT eo1.obj_id AS src_obj, eo2.obj_id AS tgt_obj
            FROM event_object eo1
            JOIN event_object eo2 ON eo1.event_id = eo2.event_id
        ),
        o2o_direct AS (
            SELECT source_obj_id AS src_obj, target_obj_id AS tgt_obj
            FROM object_relations
            WHERE target_obj_id IN (SELECT obj_id FROM event_object)
        ),
        all_conn AS (
            SELECT DISTINCT src_obj, tgt_obj FROM e2o_conn
            UNION
            SELECT src_obj, tgt_obj FROM o2o_direct
        ),
        -- Lazy aggregation: expand every pair to the cross product of the
        -- two objects' event sets, then aggregate interval bounds per pair.
        pair_times AS (
            SELECT
                ac.src_obj,
                ac.tgt_obj,
                MIN(es.timestamp_unix) AS s_min,
                MAX(es.timestamp_unix) AS s_max,
                MIN(et.timestamp_unix) AS t_min,
                MAX(et.timestamp_unix) AS t_max
            FROM all_conn ac
            JOIN event_object eos ON eos.obj_id  = ac.src_obj
            JOIN events es        ON es.event_id = eos.event_id
            JOIN event_object eot ON eot.obj_id  = ac.tgt_obj
            JOIN events et        ON et.event_id = eot.event_id
            GROUP BY ac.src_obj, ac.tgt_obj
        )
        SELECT
            os.obj_type AS type_source,
            ot.obj_type AS type_target,
            COUNT(*)    AS tr_total,
            SUM(CASE WHEN pt.t_min <= pt.s_min AND pt.s_max <= pt.t_max
                     THEN 1 ELSE 0 END) AS tr_dependent,
            SUM(CASE WHEN pt.s_min <= pt.t_min AND pt.t_max <= pt.s_max
                     THEN 1 ELSE 0 END) AS tr_dependent_inv,
            SUM(CASE WHEN (pt.s_min <= pt.s_max AND pt.s_max <= pt.t_min AND pt.t_min <= pt.t_max)
                       OR (pt.s_min <  pt.t_min AND pt.t_min <= pt.s_max AND pt.s_max < pt.t_max)
                     THEN 1 ELSE 0 END) AS tr_initiating,
            SUM(CASE WHEN (pt.t_min <= pt.t_max AND pt.t_max <= pt.s_min AND pt.s_min <= pt.s_max)
                       OR (pt.t_min <  pt.s_min AND pt.s_min <= pt.t_max AND pt.t_max < pt.s_max)
                     THEN 1 ELSE 0 END) AS tr_initiating_rev,
            COUNT(*)    AS tr_parallel
        FROM pair_times pt
        JOIN objects os ON pt.src_obj = os.obj_id
        JOIN objects ot ON pt.tgt_obj = ot.obj_id
        GROUP BY os.obj_type, ot.obj_type
    """).fetchall()

    h_temporal_relations: dict[tuple[str, str], dict[str, int]] = {}
    for row in tr_rows:
        type_source, type_target, total, n_dep, n_dep_inv, n_init, n_init_rev, n_par = row
        key = (type_source, type_target)
        d: dict[str, int] = {TR_TOTAL: total, TR_PARALLEL: n_par}
        if n_dep > 0:
            d[TR_DEPENDENT] = n_dep
        if n_dep_inv > 0:
            d[TR_DEPENDENT_INVERSE] = n_dep_inv
        if n_init > 0:
            d[TR_INITIATING] = n_init
        if n_init_rev > 0:
            d[TR_INITIATING_REVERSE] = n_init_rev
        h_temporal_relations[key] = d

    return h_temporal_relations
