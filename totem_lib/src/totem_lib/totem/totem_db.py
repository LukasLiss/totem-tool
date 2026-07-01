from .totem import (
    Totem,
    get_most_precise_lc,
    get_most_precise_ec,
    get_most_precise_tr,
    TR_TOTAL,
    TR_DEPENDENT,
    TR_DEPENDENT_INVERSE,
    TR_INITIATING,
    TR_INITIATING_REVERSE,
    TR_PARALLEL,
    EC_TOTAL,
    EC_ZERO,
    EC_ONE,
    EC_ZERO_ONE,
    EC_MANY,
    EC_ZERO_MANY,
    LC_TOTAL,
    LC_ZERO,
    LC_ONE,
    LC_ZERO_ONE,
    LC_MANY,
    LC_ZERO_MANY,
)
from ..ocel.ocel_duckdb import OcelDuckDB


def totemDiscovery_db(ocel_db: OcelDuckDB, tau: float = 0.9) -> Totem:
    """
    DB-native implementation of totemDiscovery.

    Produces identical results to totemDiscovery(ocel, tau) but replaces all
    Python event/object loops with DuckDB SQL aggregations over the five-table
    OcelDuckDB schema.

    :param ocel_db: A populated OcelDuckDB instance.
    :param tau: Threshold for determining strong relations (default 0.9).
    :return: A Totem object identical to what totemDiscovery would return.
    """
    conn = ocel_db.conn

    # ------------------------------------------------------------------
    # Phase 1: Activity/type mappings
    # ------------------------------------------------------------------
    act_rows = conn.execute("""
        SELECT DISTINCT o.obj_type, e.activity
        FROM events e
        JOIN event_object eo ON e.event_id = eo.event_id
        JOIN objects o       ON eo.obj_id   = o.obj_id
    """).fetchall()

    obj_typ_to_ev_type: dict[str, set[str]] = {}
    all_event_types: set[str] = set()
    for obj_type, activity in act_rows:
        obj_typ_to_ev_type.setdefault(obj_type, set()).add(activity)
        all_event_types.add(activity)

    # ------------------------------------------------------------------
    # Phase 2: Connected type pairs (type_relations)
    # ------------------------------------------------------------------
    type_pair_rows = conn.execute("""
        SELECT DISTINCT o1.obj_type AS t1, o2.obj_type AS t2
        FROM event_object eo1
        JOIN event_object eo2 ON eo1.event_id = eo2.event_id
        JOIN objects o1       ON eo1.obj_id    = o1.obj_id
        JOIN objects o2       ON eo2.obj_id    = o2.obj_id
        WHERE o1.obj_type < o2.obj_type
    """).fetchall()

    type_relations: set[frozenset[str]] = {frozenset({t1, t2}) for t1, t2 in type_pair_rows}

    # ------------------------------------------------------------------
    # Phase 3: Event cardinalities
    #
    # For every event where source_type has ≥1 object, count how many
    # target_type objects appear (0 if absent). Matches the original loop:
    #   for type_source in involved_types:
    #     for type_target in ocel.object_types:
    #       cardinality = obj_count_per_type.get(type_target, 0)
    # ------------------------------------------------------------------
    ec_rows = conn.execute("""
        WITH
        all_types AS (
            SELECT DISTINCT o.obj_type
            FROM objects o
            WHERE o.obj_id IN (SELECT obj_id FROM event_object)
        ),
        event_type_counts AS (
            SELECT e.event_id, o.obj_type, COUNT(*) AS n
            FROM events e
            JOIN event_object eo ON e.event_id = eo.event_id
            JOIN objects o       ON eo.obj_id   = o.obj_id
            GROUP BY e.event_id, o.obj_type
        )
        SELECT
            src.obj_type                              AS type_source,
            all_t.obj_type                            AS type_target,
            COUNT(*)                                  AS ec_total,
            SUM(CASE WHEN COALESCE(tgt.n, 0) = 0 THEN 1 ELSE 0 END) AS ec_zero,
            SUM(CASE WHEN COALESCE(tgt.n, 0) = 1 THEN 1 ELSE 0 END) AS ec_one,
            SUM(CASE WHEN COALESCE(tgt.n, 0) > 1 THEN 1 ELSE 0 END) AS ec_many
        FROM event_type_counts src
        CROSS JOIN all_types all_t
        LEFT JOIN event_type_counts tgt
               ON tgt.event_id = src.event_id AND tgt.obj_type = all_t.obj_type
        GROUP BY src.obj_type, all_t.obj_type
    """).fetchall()

    h_event_cardinalities: dict[tuple[str, str], dict[str, int]] = {}
    for type_source, type_target, total, n_zero, n_one, n_many in ec_rows:
        h_event_cardinalities[(type_source, type_target)] = {
            EC_TOTAL:    total,
            EC_ZERO:     n_zero,
            EC_ONE:      n_one,
            EC_ZERO_ONE: n_zero + n_one,
            EC_MANY:     n_one + n_many,
            EC_ZERO_MANY: total,
        }

    # ------------------------------------------------------------------
    # Phase 4: Log cardinalities
    #
    # Builds the same o2o connectivity as the original:
    #   - e2o bidirectional (includes self-pairs, matching original's
    #     get_event_objects_by_type which returns obj itself)
    #   - direct o2o from object_relations (source→target only, matching
    #     ocel.o2o_graph_edges)
    # Then for each (src_obj, target_type): count distinct connected targets.
    # ------------------------------------------------------------------
    lc_rows = conn.execute("""
        WITH
        -- e2o bidirectional connections (self-pairs included, matching original)
        e2o_conn AS (
            SELECT eo1.obj_id AS src_obj, eo2.obj_id AS tgt_obj
            FROM event_object eo1
            JOIN event_object eo2 ON eo1.event_id = eo2.event_id
        ),
        -- direct o2o (directional: source→target only, matching o2o_graph_edges)
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
        active_objs AS (
            SELECT DISTINCT o.obj_id, o.obj_type
            FROM objects o
            WHERE o.obj_id IN (SELECT obj_id FROM event_object)
        ),
        lc_all_types AS (
            SELECT DISTINCT obj_type FROM active_objs
        ),
        -- For each (src_obj, target_type): count distinct connected target objects
        lc_counts AS (
            SELECT
                ao.obj_id   AS src_obj,
                ao.obj_type AS type_source,
                all_t.obj_type AS type_target,
                COUNT(DISTINCT CASE WHEN tgt_o.obj_type = all_t.obj_type THEN ac.tgt_obj END) AS n
            FROM active_objs ao
            CROSS JOIN lc_all_types all_t
            LEFT JOIN all_conn ac   ON ac.src_obj = ao.obj_id
            LEFT JOIN active_objs tgt_o ON ac.tgt_obj = tgt_o.obj_id
            GROUP BY ao.obj_id, ao.obj_type, all_t.obj_type
        )
        SELECT
            type_source,
            type_target,
            COUNT(*)                                        AS lc_total,
            SUM(CASE WHEN n = 0 THEN 1 ELSE 0 END)        AS lc_zero,
            SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END)        AS lc_one,
            SUM(CASE WHEN n > 1 THEN 1 ELSE 0 END)        AS lc_many
        FROM lc_counts
        GROUP BY type_source, type_target
    """).fetchall()

    h_log_cardinalities: dict[tuple[str, str], dict[str, int]] = {}
    for type_source, type_target, total, n_zero, n_one, n_many in lc_rows:
        h_log_cardinalities[(type_source, type_target)] = {
            LC_TOTAL:    total,
            LC_ZERO:     n_zero,
            LC_ONE:      n_one,
            LC_ZERO_ONE: n_zero + n_one,
            LC_MANY:     n_one + n_many,
            LC_ZERO_MANY: total,
        }

    # ------------------------------------------------------------------
    # Phase 5: Temporal relations
    #
    # For each (src_obj, tgt_obj) pair in all_conn, compare lifetimes.
    # CASE conditions mirror the original's if-chains exactly.
    # TR_PARALLEL is always counted (= total pairs), matching:
    #   h_temporal_relations[...][TR_PARALLEL] += 1  (unconditional)
    # ------------------------------------------------------------------
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
        lifetimes AS (
            SELECT o.obj_id, o.obj_type,
                   MIN(e.timestamp_unix) AS min_t,
                   MAX(e.timestamp_unix) AS max_t
            FROM objects o
            JOIN event_object eo ON o.obj_id   = eo.obj_id
            JOIN events e        ON eo.event_id = e.event_id
            GROUP BY o.obj_id, o.obj_type
        )
        SELECT
            ls.obj_type AS type_source,
            lt.obj_type AS type_target,
            COUNT(*)    AS tr_total,
            SUM(CASE WHEN lt.min_t <= ls.min_t AND ls.max_t <= lt.max_t
                     THEN 1 ELSE 0 END) AS tr_dependent,
            SUM(CASE WHEN ls.min_t <= lt.min_t AND lt.max_t <= ls.max_t
                     THEN 1 ELSE 0 END) AS tr_dependent_inv,
            SUM(CASE WHEN (ls.min_t <= ls.max_t AND ls.max_t <= lt.min_t AND lt.min_t <= lt.max_t)
                       OR (ls.min_t <  lt.min_t AND lt.min_t <= ls.max_t AND ls.max_t < lt.max_t)
                     THEN 1 ELSE 0 END) AS tr_initiating,
            SUM(CASE WHEN (lt.min_t <= lt.max_t AND lt.max_t <= ls.min_t AND ls.min_t <= ls.max_t)
                       OR (lt.min_t <  ls.min_t AND ls.min_t <= lt.max_t AND lt.max_t < ls.max_t)
                     THEN 1 ELSE 0 END) AS tr_initiating_rev,
            COUNT(*)    AS tr_parallel
        FROM all_conn ac
        JOIN lifetimes ls ON ac.src_obj = ls.obj_id
        JOIN lifetimes lt ON ac.tgt_obj = lt.obj_id
        GROUP BY ls.obj_type, lt.obj_type
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

    # ------------------------------------------------------------------
    # Phase 6: Build temporal graph (identical logic to totemDiscovery)
    # ------------------------------------------------------------------
    tempgraph: dict = {
        "nodes": set(),
        TR_PARALLEL: set(),
        TR_INITIATING: set(),
        TR_DEPENDENT: set(),
    }
    cardinalities: dict = {}

    for connected_types in type_relations:
        t1, t2 = connected_types
        tempgraph["nodes"].add(t1)
        tempgraph["nodes"].add(t2)

        lc   = get_most_precise_lc((t1, t2), tau, h_log_cardinalities)
        lc_i = get_most_precise_lc((t2, t1), tau, h_log_cardinalities)
        ec   = get_most_precise_ec((t1, t2), tau, h_event_cardinalities)
        ec_i = get_most_precise_ec((t2, t1), tau, h_event_cardinalities)
        tr   = get_most_precise_tr((t1, t2), tau, h_temporal_relations)
        tr_i = get_most_precise_tr((t2, t1), tau, h_temporal_relations)

        if tr == TR_DEPENDENT_INVERSE or tr == TR_INITIATING_REVERSE:
            tempgraph[tr_i].add((t2, t1))
        else:
            tempgraph[tr].add((t1, t2))

        cardinalities[(t1, t2)] = {"LC": lc,   "EC": ec}
        cardinalities[(t2, t1)] = {"LC": lc_i, "EC": ec_i}

    return Totem(tempgraph, cardinalities, type_relations, all_event_types, obj_typ_to_ev_type)
