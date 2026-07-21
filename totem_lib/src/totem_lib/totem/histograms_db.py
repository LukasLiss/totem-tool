"""DuckDB histogram computation shared by TOTeM discovery and conformance."""

from __future__ import annotations

from typing import Dict, Iterable, Tuple

from ..ocel.ocel_duckdb import OcelDuckDB
from .conformance import TotemConformanceHistograms
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


Histogram = Dict[Tuple[str, str], Dict[str, int]]
DetailHistogram = Dict[Tuple[str, str, str], Dict[str, int]]


_AGGREGATE_CONNECTIONS_CTE = """
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
)
"""


_DETAILED_CONNECTIONS_CTE = """
e2o_conn AS (
    SELECT DISTINCT eo1.obj_id AS src_obj, eo2.obj_id AS tgt_obj
    FROM event_object eo1
    JOIN event_object eo2 ON eo1.event_id = eo2.event_id
),
qualified_o2o_raw AS (
    SELECT source_obj_id AS src_obj,
           target_obj_id AS tgt_obj,
           qualifier
    FROM object_relations
    WHERE qualifier IS NOT NULL
      AND target_obj_id IN (SELECT obj_id FROM event_object)
    UNION
    SELECT target_obj_id AS src_obj,
           source_obj_id AS tgt_obj,
           qualifier
    FROM object_relations
    WHERE qualifier IS NOT NULL
      AND source_obj_id IN (SELECT obj_id FROM event_object)
),
qualified_o2o AS (
    SELECT src_obj, tgt_obj, MIN(qualifier) AS relation_type
    FROM qualified_o2o_raw
    GROUP BY src_obj, tgt_obj
),
relation_conn AS (
    SELECT src_obj, tgt_obj, relation_type
    FROM qualified_o2o
    UNION ALL
    SELECT e.src_obj, e.tgt_obj, 'e2o' AS relation_type
    FROM e2o_conn e
    WHERE NOT EXISTS (
        SELECT 1
        FROM qualified_o2o q
        WHERE q.src_obj = e.src_obj AND q.tgt_obj = e.tgt_obj
    )
)
"""


def compute_totem_histograms_db(
    ocel_db: OcelDuckDB,
    include_details: bool = False,
) -> TotemConformanceHistograms:
    """Compute aggregate and optional detailed TOTeM histograms in DuckDB.

    Aggregate queries preserve the existing ``totemDiscovery_db`` behavior.
    Detailed queries reproduce the reference conformance branch: event
    cardinalities are grouped by activity, while temporal and log-cardinality
    histograms are grouped by ``e2o`` or an o2o qualifier. A qualified o2o
    relation overrides ``e2o`` for the same object pair and is considered in
    both directions. If conflicting qualifiers exist for one pair, the
    lexicographically first qualifier is used to keep output deterministic.
    """
    conn = ocel_db.conn
    event_cardinality = _event_cardinality_histogram(conn)
    log_cardinality = _log_cardinality_histogram(conn)
    temporal = _temporal_histogram(conn)

    if include_details:
        event_by_activity = _event_cardinality_by_activity(conn)
        temporal_by_relation = _temporal_by_relation_type(conn)
        log_by_relation = _log_cardinality_by_relation_type(conn)
    else:
        event_by_activity = {}
        temporal_by_relation = {}
        log_by_relation = {}

    return TotemConformanceHistograms(
        temporal=temporal,
        log_cardinality=log_cardinality,
        event_cardinality=event_cardinality,
        event_cardinality_by_activity=event_by_activity,
        temporal_by_relation_type=temporal_by_relation,
        log_cardinality_by_relation_type=log_by_relation,
    )


def _event_cardinality_histogram(conn) -> Histogram:
    rows = conn.execute("""
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
            src.obj_type,
            all_t.obj_type,
            COUNT(*) AS total,
            SUM(CASE WHEN COALESCE(tgt.n, 0) = 0 THEN 1 ELSE 0 END) AS n_zero,
            SUM(CASE WHEN COALESCE(tgt.n, 0) = 1 THEN 1 ELSE 0 END) AS n_one,
            SUM(CASE WHEN COALESCE(tgt.n, 0) > 1 THEN 1 ELSE 0 END) AS n_many
        FROM event_type_counts src
        CROSS JOIN all_types all_t
        LEFT JOIN event_type_counts tgt
               ON tgt.event_id = src.event_id AND tgt.obj_type = all_t.obj_type
        GROUP BY src.obj_type, all_t.obj_type
    """).fetchall()
    return _cardinality_histogram(
        rows,
        EC_TOTAL,
        EC_ZERO,
        EC_ONE,
        EC_ZERO_ONE,
        EC_MANY,
        EC_ZERO_MANY,
        include_zero_counts=True,
    )


def _log_cardinality_histogram(conn) -> Histogram:
    rows = conn.execute(f"""
        WITH
        {_AGGREGATE_CONNECTIONS_CTE},
        active_objs AS (
            SELECT DISTINCT o.obj_id, o.obj_type
            FROM objects o
            WHERE o.obj_id IN (SELECT obj_id FROM event_object)
        ),
        all_types AS (
            SELECT DISTINCT obj_type FROM active_objs
        ),
        relation_counts AS (
            SELECT
                source.obj_id AS src_obj,
                source.obj_type AS type_source,
                all_t.obj_type AS type_target,
                COUNT(DISTINCT CASE
                    WHEN target.obj_type = all_t.obj_type THEN connection.tgt_obj
                END) AS n
            FROM active_objs source
            CROSS JOIN all_types all_t
            LEFT JOIN all_conn connection ON connection.src_obj = source.obj_id
            LEFT JOIN active_objs target ON connection.tgt_obj = target.obj_id
            GROUP BY source.obj_id, source.obj_type, all_t.obj_type
        )
        SELECT
            type_source,
            type_target,
            COUNT(*) AS total,
            SUM(CASE WHEN n = 0 THEN 1 ELSE 0 END) AS n_zero,
            SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END) AS n_one,
            SUM(CASE WHEN n > 1 THEN 1 ELSE 0 END) AS n_many
        FROM relation_counts
        GROUP BY type_source, type_target
    """).fetchall()
    return _cardinality_histogram(
        rows,
        LC_TOTAL,
        LC_ZERO,
        LC_ONE,
        LC_ZERO_ONE,
        LC_MANY,
        LC_ZERO_MANY,
        include_zero_counts=True,
    )


def _temporal_histogram(conn) -> Histogram:
    rows = conn.execute(f"""
        WITH
        {_AGGREGATE_CONNECTIONS_CTE},
        lifetimes AS (
            SELECT o.obj_id, o.obj_type,
                   MIN(e.timestamp_unix) AS min_t,
                   MAX(e.timestamp_unix) AS max_t
            FROM objects o
            JOIN event_object eo ON o.obj_id = eo.obj_id
            JOIN events e ON eo.event_id = e.event_id
            GROUP BY o.obj_id, o.obj_type
        )
        SELECT
            source.obj_type,
            target.obj_type,
            COUNT(*) AS total,
            SUM(CASE WHEN target.min_t <= source.min_t
                           AND source.max_t <= target.max_t
                     THEN 1 ELSE 0 END) AS n_dependent,
            SUM(CASE WHEN source.min_t <= target.min_t
                           AND target.max_t <= source.max_t
                     THEN 1 ELSE 0 END) AS n_dependent_inverse,
            SUM(CASE WHEN (source.min_t <= source.max_t
                                AND source.max_t <= target.min_t
                                AND target.min_t <= target.max_t)
                           OR (source.min_t < target.min_t
                                AND target.min_t <= source.max_t
                                AND source.max_t < target.max_t)
                     THEN 1 ELSE 0 END) AS n_initiating,
            SUM(CASE WHEN (target.min_t <= target.max_t
                                AND target.max_t <= source.min_t
                                AND source.min_t <= source.max_t)
                           OR (target.min_t < source.min_t
                                AND source.min_t <= target.max_t
                                AND target.max_t < source.max_t)
                     THEN 1 ELSE 0 END) AS n_initiating_reverse,
            COUNT(*) AS n_parallel
        FROM all_conn connection
        JOIN lifetimes source ON connection.src_obj = source.obj_id
        JOIN lifetimes target ON connection.tgt_obj = target.obj_id
        GROUP BY source.obj_type, target.obj_type
    """).fetchall()
    return _temporal_histogram_from_rows(rows)


def _event_cardinality_by_activity(conn) -> DetailHistogram:
    rows = conn.execute("""
        WITH
        all_types AS (
            SELECT DISTINCT o.obj_type
            FROM objects o
            WHERE o.obj_id IN (SELECT obj_id FROM event_object)
        ),
        event_type_counts AS (
            SELECT e.event_id, e.activity, o.obj_type, COUNT(*) AS n
            FROM events e
            JOIN event_object eo ON e.event_id = eo.event_id
            JOIN objects o       ON eo.obj_id   = o.obj_id
            GROUP BY e.event_id, e.activity, o.obj_type
        )
        SELECT
            src.obj_type,
            all_t.obj_type,
            src.activity,
            COUNT(*) AS total,
            SUM(CASE WHEN COALESCE(tgt.n, 0) = 0 THEN 1 ELSE 0 END) AS n_zero,
            SUM(CASE WHEN COALESCE(tgt.n, 0) = 1 THEN 1 ELSE 0 END) AS n_one,
            SUM(CASE WHEN COALESCE(tgt.n, 0) > 1 THEN 1 ELSE 0 END) AS n_many
        FROM event_type_counts src
        CROSS JOIN all_types all_t
        LEFT JOIN event_type_counts tgt
               ON tgt.event_id = src.event_id AND tgt.obj_type = all_t.obj_type
        GROUP BY src.obj_type, all_t.obj_type, src.activity
    """).fetchall()
    return _detail_cardinality_histogram(
        rows,
        EC_TOTAL,
        EC_ZERO,
        EC_ONE,
        EC_ZERO_ONE,
        EC_MANY,
        EC_ZERO_MANY,
    )


def _temporal_by_relation_type(conn) -> DetailHistogram:
    rows = conn.execute(f"""
        WITH
        {_DETAILED_CONNECTIONS_CTE},
        lifetimes AS (
            SELECT o.obj_id, o.obj_type,
                   MIN(e.timestamp_unix) AS min_t,
                   MAX(e.timestamp_unix) AS max_t
            FROM objects o
            JOIN event_object eo ON o.obj_id = eo.obj_id
            JOIN events e ON eo.event_id = e.event_id
            GROUP BY o.obj_id, o.obj_type
        )
        SELECT
            source.obj_type,
            target.obj_type,
            connection.relation_type,
            COUNT(*) AS total,
            SUM(CASE WHEN target.min_t <= source.min_t
                           AND source.max_t <= target.max_t
                     THEN 1 ELSE 0 END) AS n_dependent,
            SUM(CASE WHEN source.min_t <= target.min_t
                           AND target.max_t <= source.max_t
                     THEN 1 ELSE 0 END) AS n_dependent_inverse,
            SUM(CASE WHEN (source.min_t <= source.max_t
                                AND source.max_t <= target.min_t
                                AND target.min_t <= target.max_t)
                           OR (source.min_t < target.min_t
                                AND target.min_t <= source.max_t
                                AND source.max_t < target.max_t)
                     THEN 1 ELSE 0 END) AS n_initiating,
            SUM(CASE WHEN (target.min_t <= target.max_t
                                AND target.max_t <= source.min_t
                                AND source.min_t <= source.max_t)
                           OR (target.min_t < source.min_t
                                AND source.min_t <= target.max_t
                                AND target.max_t < source.max_t)
                     THEN 1 ELSE 0 END) AS n_initiating_reverse,
            COUNT(*) AS n_parallel
        FROM relation_conn connection
        JOIN lifetimes source ON connection.src_obj = source.obj_id
        JOIN lifetimes target ON connection.tgt_obj = target.obj_id
        GROUP BY source.obj_type, target.obj_type, connection.relation_type
    """).fetchall()
    return _detail_temporal_histogram(rows)


def _log_cardinality_by_relation_type(conn) -> DetailHistogram:
    rows = conn.execute(f"""
        WITH
        {_DETAILED_CONNECTIONS_CTE},
        active_objs AS (
            SELECT DISTINCT o.obj_id, o.obj_type
            FROM objects o
            WHERE o.obj_id IN (SELECT obj_id FROM event_object)
        ),
        relation_counts AS (
            SELECT
                source.obj_id AS src_obj,
                source.obj_type AS type_source,
                target.obj_type AS type_target,
                connection.relation_type,
                COUNT(DISTINCT connection.tgt_obj) AS n
            FROM relation_conn connection
            JOIN active_objs source ON connection.src_obj = source.obj_id
            JOIN active_objs target ON connection.tgt_obj = target.obj_id
            GROUP BY source.obj_id, source.obj_type, target.obj_type,
                     connection.relation_type
        )
        SELECT
            type_source,
            type_target,
            relation_type,
            COUNT(*) AS total,
            SUM(CASE WHEN n = 0 THEN 1 ELSE 0 END) AS n_zero,
            SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END) AS n_one,
            SUM(CASE WHEN n > 1 THEN 1 ELSE 0 END) AS n_many
        FROM relation_counts
        GROUP BY type_source, type_target, relation_type
    """).fetchall()
    return _detail_cardinality_histogram(
        rows,
        LC_TOTAL,
        LC_ZERO,
        LC_ONE,
        LC_ZERO_ONE,
        LC_MANY,
        LC_ZERO_MANY,
    )


def _cardinality_histogram(
    rows: Iterable[tuple],
    total_key: str,
    zero_key: str,
    one_key: str,
    zero_one_key: str,
    many_key: str,
    zero_many_key: str,
    include_zero_counts: bool,
) -> Histogram:
    result: Histogram = {}
    for source, target, total, n_zero, n_one, n_many in rows:
        result[(source, target)] = _cardinality_counts(
            total,
            n_zero,
            n_one,
            n_many,
            total_key,
            zero_key,
            one_key,
            zero_one_key,
            many_key,
            zero_many_key,
            include_zero_counts,
        )
    return result


def _detail_cardinality_histogram(
    rows: Iterable[tuple],
    total_key: str,
    zero_key: str,
    one_key: str,
    zero_one_key: str,
    many_key: str,
    zero_many_key: str,
) -> DetailHistogram:
    result: DetailHistogram = {}
    for source, target, detail, total, n_zero, n_one, n_many in rows:
        result[(source, target, detail)] = _cardinality_counts(
            total,
            n_zero,
            n_one,
            n_many,
            total_key,
            zero_key,
            one_key,
            zero_one_key,
            many_key,
            zero_many_key,
            include_zero_counts=False,
        )
    return result


def _cardinality_counts(
    total,
    n_zero,
    n_one,
    n_many,
    total_key: str,
    zero_key: str,
    one_key: str,
    zero_one_key: str,
    many_key: str,
    zero_many_key: str,
    include_zero_counts: bool,
) -> Dict[str, int]:
    total = int(total)
    n_zero = int(n_zero)
    n_one = int(n_one)
    n_many = int(n_many)
    counts = {
        total_key: total,
        zero_key: n_zero,
        one_key: n_one,
        zero_one_key: n_zero + n_one,
        many_key: n_one + n_many,
        zero_many_key: total,
    }
    if include_zero_counts:
        return counts
    return {key: value for key, value in counts.items() if value > 0}


def _temporal_histogram_from_rows(rows: Iterable[tuple]) -> Histogram:
    result: Histogram = {}
    for row in rows:
        source, target = row[:2]
        result[(source, target)] = _temporal_counts(*row[2:])
    return result


def _detail_temporal_histogram(rows: Iterable[tuple]) -> DetailHistogram:
    result: DetailHistogram = {}
    for row in rows:
        source, target, detail = row[:3]
        result[(source, target, detail)] = _temporal_counts(*row[3:])
    return result


def _temporal_counts(
    total,
    n_dependent,
    n_dependent_inverse,
    n_initiating,
    n_initiating_reverse,
    n_parallel,
) -> Dict[str, int]:
    values = {
        TR_TOTAL: int(total),
        TR_DEPENDENT: int(n_dependent),
        TR_DEPENDENT_INVERSE: int(n_dependent_inverse),
        TR_INITIATING: int(n_initiating),
        TR_INITIATING_REVERSE: int(n_initiating_reverse),
        TR_PARALLEL: int(n_parallel),
    }
    return {key: value for key, value in values.items() if value > 0}
