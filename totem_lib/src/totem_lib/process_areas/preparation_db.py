"""
DuckDB-native preparation — the production path.

Same output as :func:`~.preparation.prepare`, computed by SQL aggregation
instead of Python loops. This is what the backend runs, for two reasons:

* the backend already holds every log as an :class:`OcelDuckDB`, so the Polars
  path would mean importing each log a second time through a different reader,
  and
* everything below aggregates to per-type-pair counters *inside* DuckDB. Only
  ``O(|OT|^2)`` rows ever cross into Python, and DuckDB spills its intermediates
  to disk, so a log larger than memory still goes through.

The O2O closure (thesis Def. 3.3.2) is materialised once as a temp table and
reused by four of the five queries; rebuilding it per query is the single most
expensive mistake available here. Explicit object-to-object edges are unioned in
**both directions**: the relation is symmetric by definition, and the indicators
rely on that symmetry to keep the attractive force symmetric.
"""

from typing import Dict, Set, Tuple

from ..ocel.ocel_duckdb import OcelDuckDB
from .aggregates import (
    CardinalityCounts,
    DivergenceCounts,
    LogAggregates,
    TemporalCounts,
)

# Objects that occur in at least one event, and the symmetric O2O closure over
# them. Objects never referenced by an event carry no lifespan and no activity,
# so no indicator can say anything about them; they are excluded here exactly as
# the Polars path excludes them.
_SETUP_SQL = """
CREATE OR REPLACE TEMP TABLE _pa_active AS
    SELECT DISTINCT o.obj_id, o.obj_type
    FROM objects o
    JOIN event_object eo ON o.obj_id = eo.obj_id;

CREATE OR REPLACE TEMP TABLE _pa_conn AS
    SELECT src_obj, tgt_obj FROM (
        SELECT eo1.obj_id AS src_obj, eo2.obj_id AS tgt_obj
        FROM event_object eo1
        JOIN event_object eo2 ON eo1.event_id = eo2.event_id
        UNION
        SELECT source_obj_id, target_obj_id FROM object_relations
        UNION
        SELECT target_obj_id, source_obj_id FROM object_relations
    )
    WHERE src_obj IN (SELECT obj_id FROM _pa_active)
      AND tgt_obj IN (SELECT obj_id FROM _pa_active);
"""

_TEARDOWN_SQL = """
DROP TABLE IF EXISTS _pa_conn;
DROP TABLE IF EXISTS _pa_active;
"""

_OBJECT_COUNTS_SQL = """
SELECT obj_type, COUNT(*) FROM _pa_active GROUP BY obj_type
"""

# "dependent": the source lives entirely inside the target's lifespan, so the
# target outlives it. "initiating": the two lifespans hand over -- disjoint, or
# overlapping with the source starting and ending first.
_TEMPORAL_SQL = """
WITH lifetimes AS (
    SELECT eo.obj_id,
           MIN(e.timestamp_unix) AS min_t,
           MAX(e.timestamp_unix) AS max_t
    FROM event_object eo
    JOIN events e ON eo.event_id = e.event_id
    GROUP BY eo.obj_id
)
SELECT s.obj_type AS type_source,
       t.obj_type AS type_target,
       COUNT(*)   AS total,
       SUM(CASE WHEN lt.min_t <= ls.min_t AND ls.max_t <= lt.max_t
                THEN 1 ELSE 0 END) AS dependent,
       SUM(CASE WHEN ls.max_t <= lt.min_t
                  OR (ls.min_t < lt.min_t AND lt.min_t <= ls.max_t AND ls.max_t < lt.max_t)
                THEN 1 ELSE 0 END) AS initiating
FROM _pa_conn c
JOIN _pa_active s  ON c.src_obj = s.obj_id
JOIN _pa_active t  ON c.tgt_obj = t.obj_id
JOIN lifetimes ls  ON c.src_obj = ls.obj_id
JOIN lifetimes lt  ON c.tgt_obj = lt.obj_id
GROUP BY 1, 2
"""

# Bilateral cardinality signatures: per source object, how many targets of the
# other type it relates to, together with the sorted list of how many objects of
# its own type those targets relate back to. Grouping by the signature collapses
# millions of objects into a handful of rows before anything reaches Python.
_CARDINALITY_SQL = """
WITH card AS (
    SELECT c.src_obj, t.obj_type AS type_target, COUNT(*) AS n
    FROM _pa_conn c
    JOIN _pa_active t ON c.tgt_obj = t.obj_id
    GROUP BY 1, 2
),
signatures AS (
    SELECT s.obj_type AS type_source,
           t.obj_type AS type_target,
           c.src_obj,
           COUNT(*) AS forward,
           list_sort(list(COALESCE(rev.n, 0))) AS reverse
    FROM _pa_conn c
    JOIN _pa_active s ON c.src_obj = s.obj_id
    JOIN _pa_active t ON c.tgt_obj = t.obj_id
    LEFT JOIN card rev ON rev.src_obj = c.tgt_obj AND rev.type_target = s.obj_type
    GROUP BY 1, 2, 3
)
SELECT type_source, type_target, forward, reverse, COUNT(*) AS occurrences
FROM signatures
GROUP BY 1, 2, 3, 4
"""

_RELATED_SOURCES_SQL = """
SELECT s.obj_type AS type_source,
       t.obj_type AS type_target,
       COUNT(DISTINCT c.src_obj) AS related_sources
FROM _pa_conn c
JOIN _pa_active s ON c.src_obj = s.obj_id
JOIN _pa_active t ON c.tgt_obj = t.obj_id
GROUP BY 1, 2
"""

# Divergence: bucket by (type pair, activity, source object) and look at the
# distinct sets of partner objects seen across those events. A partner that is
# missing from at least one of those sets was swapped out, so it diverges.
# Expressed as: it occurs in fewer than all of the bucket's distinct sets.
_DIVERGENCE_SQL = """
WITH event_targets AS (
    SELECT eo.event_id,
           o.obj_type AS type_target,
           list_sort(list(eo.obj_id)) AS target_set
    FROM event_object eo
    JOIN objects o ON eo.obj_id = o.obj_id
    GROUP BY 1, 2
),
event_sources AS (
    SELECT eo.event_id, eo.obj_id AS source_obj, o.obj_type AS type_source
    FROM event_object eo
    JOIN objects o ON eo.obj_id = o.obj_id
),
bucket_sets AS (
    SELECT DISTINCT s.type_source, t.type_target, e.activity, s.source_obj, t.target_set
    FROM event_sources s
    JOIN events e        ON e.event_id = s.event_id
    JOIN event_targets t ON t.event_id = s.event_id
),
bucket_size AS (
    SELECT type_source, type_target, activity, source_obj, COUNT(*) AS distinct_sets
    FROM bucket_sets
    GROUP BY 1, 2, 3, 4
),
memberships AS (
    SELECT type_source, type_target, activity, source_obj,
           unnest(target_set) AS target_obj
    FROM bucket_sets
),
occurrences AS (
    SELECT type_source, type_target, activity, source_obj, target_obj,
           COUNT(*) AS sets_containing
    FROM memberships
    GROUP BY 1, 2, 3, 4, 5
)
SELECT o.type_source, o.type_target, COUNT(DISTINCT o.target_obj) AS diverging
FROM occurrences o
JOIN bucket_size b USING (type_source, type_target, activity, source_obj)
WHERE b.distinct_sets >= 2
  AND o.sets_containing < b.distinct_sets
GROUP BY 1, 2
"""

_ACTIVITIES_SQL = """
SELECT DISTINCT o.obj_type, e.activity
FROM events e
JOIN event_object eo ON e.event_id = eo.event_id
JOIN objects o       ON eo.obj_id  = o.obj_id
"""

_ALL_ACTIVITIES_SQL = "SELECT DISTINCT activity FROM events"

_TYPE_RELATIONS_SQL = """
SELECT DISTINCT o1.obj_type AS type_a, o2.obj_type AS type_b
FROM event_object eo1
JOIN event_object eo2 ON eo1.event_id = eo2.event_id
JOIN objects o1       ON eo1.obj_id = o1.obj_id
JOIN objects o2       ON eo2.obj_id = o2.obj_id
WHERE o1.obj_type < o2.obj_type
"""


def _dominant_signature_counts(rows) -> Dict[Tuple[str, str], int]:
    """
    Pick the most frequent bilateral signature per type pair.

    Ties are broken the way the reference implementation breaks them -- lowest
    forward cardinality first, then the reverse cardinalities -- because a
    different winner here shifts the scores and therefore the layers.
    """
    grouped: Dict[Tuple[str, str], list] = {}
    for type_source, type_target, forward, reverse, occurrences in rows:
        grouped.setdefault((type_source, type_target), []).append(
            (int(forward), tuple(int(value) for value in reverse), int(occurrences))
        )

    dominant: Dict[Tuple[str, str], int] = {}
    for pair, signatures in grouped.items():
        best = max(
            signatures,
            key=lambda signature: (
                signature[2],
                -signature[0],
                tuple(-value for value in signature[1]),
            ),
        )
        dominant[pair] = best[2]
    return dominant


def prepare_db(ocel_db: OcelDuckDB) -> LogAggregates:
    """
    Compute all indicator inputs from a DuckDB-backed event log.

    Produces the same :class:`~.aggregates.LogAggregates` as
    :func:`~.preparation.prepare` does for the equivalent in-memory log; the
    parity tests assert that on two logs.

    :param ocel_db: a populated :class:`OcelDuckDB`.
    :return: aggregates, depending only on the log and therefore cacheable per
        file regardless of the discovery parameters.

    Temp tables prefixed ``_pa_`` are created on the passed connection and
    dropped again before returning, including on failure.
    """
    conn = ocel_db.conn
    try:
        conn.execute(_SETUP_SQL)

        object_counts: Dict[str, int] = {
            object_type: int(count)
            for object_type, count in conn.execute(_OBJECT_COUNTS_SQL).fetchall()
        }
        object_types = tuple(sorted(object_counts))
        all_pairs = [(a, b) for a in object_types for b in object_types]

        temporal_rows = conn.execute(_TEMPORAL_SQL).fetchall()
        temporal = {
            (source, target): TemporalCounts(
                total=int(total),
                dependent=int(dependent or 0),
                initiating=int(initiating or 0),
            )
            for source, target, total, dependent, initiating in temporal_rows
        }

        constant_counts = _dominant_signature_counts(
            conn.execute(_CARDINALITY_SQL).fetchall()
        )
        cardinality = {}
        for pair in all_pairs:
            total = object_counts[pair[0]]
            constant = constant_counts.get(pair, 0)
            cardinality[pair] = CardinalityCounts(
                total=total, constant=constant, many=total - constant
            )

        related_sources = {
            (source, target): int(count)
            for source, target, count in conn.execute(_RELATED_SOURCES_SQL).fetchall()
        }
        diverging = {
            (source, target): int(count)
            for source, target, count in conn.execute(_DIVERGENCE_SQL).fetchall()
        }
        divergence = {
            pair: DivergenceCounts(
                related_sources=related_sources.get(pair, 0),
                diverging_targets=diverging.get(pair, 0),
            )
            for pair in all_pairs
        }

        event_types_by_object_type: Dict[str, Set[str]] = {}
        for object_type, activity in conn.execute(_ACTIVITIES_SQL).fetchall():
            event_types_by_object_type.setdefault(object_type, set()).add(activity)

        all_event_types = frozenset(
            activity for (activity,) in conn.execute(_ALL_ACTIVITIES_SQL).fetchall()
        )
        type_relations = frozenset(
            frozenset({type_a, type_b})
            for type_a, type_b in conn.execute(_TYPE_RELATIONS_SQL).fetchall()
        )
    finally:
        conn.execute(_TEARDOWN_SQL)

    # Pairs absent from a GROUP BY result had no rows at all, which means "no
    # relation" rather than "unknown"; fill them in so every indicator sees a
    # complete matrix and never has to distinguish the two.
    for pair in all_pairs:
        temporal.setdefault(pair, TemporalCounts())

    return LogAggregates(
        object_types=object_types,
        object_counts=object_counts,
        temporal=temporal,
        cardinality=cardinality,
        divergence=divergence,
        event_types_by_object_type={
            object_type: frozenset(activities)
            for object_type, activities in event_types_by_object_type.items()
        },
        all_event_types=all_event_types,
        type_relations=type_relations,
    )
