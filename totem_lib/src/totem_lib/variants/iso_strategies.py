"""
Isomorphism-grouping strategies for object-centric variant discovery.

Each strategy takes a dict of per-case process-execution graphs and returns
a list of variants — one variant per equivalence class — preserving every
member case_id (used downstream to build executions lists).

Strategies in increasing order of strictness / cost:

  - db_signature   : SQL-side multiset signature on case_events. The only
                     strategy that does NOT take per-case graphs as input —
                     it works directly off the case_events temp table and
                     never builds graphs except for a single representative
                     per bucket. False merges possible.
  - signature      : in-Python sorted multiset of (node_labels, edges_typed).
                     Order-blind, blind to topology beyond direct edges.
  - wl             : Weisfeiler-Lehman graph hash. Sound on real OCEL data;
                     CFI-style false merges are theoretically possible but
                     vanishingly rare.
  - wl+vf2         : WL hash bucketing followed by pairwise VF2 refinement.
                     Recommended default. Sound and exact.
  - exact          : full pairwise VF2 across all cases. Reference oracle.

All strategies (except db_signature) return:
    list[tuple[case_id_representative, list[case_id_members], nx.DiGraph]]

Each grouping function accepts an optional `_progress_bar` keyword argument.
When provided it must be a tqdm-compatible bar (supporting `.update(n)`);
it is advanced once per case processed.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Tuple

import duckdb
import networkx as nx


VariantGroup = Tuple[str, List[str], nx.DiGraph]


# ---------------------------------------------------------------------------
# In-memory strategies (operate on pre-built per-case nx.DiGraph instances)
# ---------------------------------------------------------------------------

def group_signature(
    case_graphs: Dict[str, nx.DiGraph],
    *,
    _progress_bar=None,
) -> List[VariantGroup]:
    """Sorted multiset of (node labels, edges with types). Topology-blind."""
    buckets: dict[str, list[str]] = defaultdict(list)
    for cid, g in case_graphs.items():
        buckets[_struct_signature(g)].append(cid)
        if _progress_bar is not None:
            _progress_bar.update(1)
    return [(members[0], members, case_graphs[members[0]]) for members in buckets.values()]


def group_wl(
    case_graphs: Dict[str, nx.DiGraph],
    *,
    _progress_bar=None,
) -> List[VariantGroup]:
    """Bucket by Weisfeiler-Lehman graph hash with node label + edge type."""
    buckets: dict[str, list[str]] = defaultdict(list)
    for cid, g in case_graphs.items():
        h = nx.weisfeiler_lehman_graph_hash(
            g, node_attr="label", edge_attr="type", iterations=3
        )
        buckets[h].append(cid)
        if _progress_bar is not None:
            _progress_bar.update(1)
    return [(members[0], members, case_graphs[members[0]]) for members in buckets.values()]


def group_wl_vf2(
    case_graphs: Dict[str, nx.DiGraph],
    *,
    _progress_bar=None,
) -> List[VariantGroup]:
    """WL bucketing + VF2 refinement within each bucket. Sound and exact."""
    wl_buckets: dict[str, list[str]] = defaultdict(list)
    for cid, g in case_graphs.items():
        h = nx.weisfeiler_lehman_graph_hash(
            g, node_attr="label", edge_attr="type", iterations=3
        )
        wl_buckets[h].append(cid)
        if _progress_bar is not None:
            _progress_bar.update(1)

    groups: list[VariantGroup] = []
    for members in wl_buckets.values():
        if len(members) == 1:
            cid = members[0]
            groups.append((cid, [cid], case_graphs[cid]))
            continue
        # Refine: each member is matched against existing reps in this bucket.
        bucket_groups: list[VariantGroup] = []
        for cid in members:
            g = case_graphs[cid]
            matched = False
            for i, (rep_id, rep_members, rep_g) in enumerate(bucket_groups):
                if _vf2_match(g, rep_g):
                    rep_members.append(cid)
                    matched = True
                    break
            if not matched:
                bucket_groups.append((cid, [cid], g))
        groups.extend(bucket_groups)
    return groups


def group_exact(
    case_graphs: Dict[str, nx.DiGraph],
    *,
    _progress_bar=None,
) -> List[VariantGroup]:
    """Full pairwise VF2. No bucketing. O(n²) iso checks."""
    groups: list[VariantGroup] = []
    for cid, g in case_graphs.items():
        matched = False
        for i, (rep_id, rep_members, rep_g) in enumerate(groups):
            if _vf2_match(g, rep_g):
                rep_members.append(cid)
                matched = True
                break
        if not matched:
            groups.append((cid, [cid], g))
        if _progress_bar is not None:
            _progress_bar.update(1)
    return groups


# ---------------------------------------------------------------------------
# DB-side strategy
# ---------------------------------------------------------------------------

_DB_SIG_SQL = """
WITH ev_features AS (
    SELECT ce.case_id,
           COUNT(DISTINCT ce.event_id)                          AS n_events,
           STRING_AGG(e.activity, '|' ORDER BY e.activity)      AS activities
    FROM case_events ce
    JOIN events e USING(event_id)
    GROUP BY ce.case_id
),
edge_features AS (
    SELECT case_id,
           STRING_AGG(
               sa || '>' || ta || ':' || edge_type, '|'
               ORDER BY sa, ta, edge_type
           ) AS edges
    FROM (
        SELECT ied.case_id,
               es.activity AS sa,
               et.activity AS ta,
               STRING_AGG(DISTINCT o.obj_type, '|' ORDER BY o.obj_type) AS edge_type
        FROM case_edges ied
        JOIN events    es ON ied.src   = es.event_id
        JOIN events    et ON ied.tgt   = et.event_id
        JOIN objects   o  ON ied.obj_id = o.obj_id
        GROUP BY ied.case_id, ied.src, ied.tgt, es.activity, et.activity
    )
    GROUP BY case_id
)
SELECT ev.case_id,
       ev.n_events || '#' || ev.activities || '#' || COALESCE(ef.edges, '') AS sig
FROM ev_features ev
LEFT JOIN edge_features ef USING(case_id)
"""


def db_signature_buckets(conn: duckdb.DuckDBPyConnection) -> Dict[str, List[str]]:
    """
    Compute one bucket per cheap multiset signature in pure SQL.
    Requires a TEMP TABLE `case_events(case_id, event_id)` to be present.

    Returns: dict[signature -> list of case_ids in that bucket].
    """
    rows = conn.execute(_DB_SIG_SQL).fetchall()
    buckets: dict[str, list[str]] = defaultdict(list)
    for case_id, sig in rows:
        buckets[sig].append(case_id)
    return buckets


# ---------------------------------------------------------------------------
# Trace strategy — total order of events with per-event object-type counts
# ---------------------------------------------------------------------------
#
# A "trace" is the timestamp-ordered concatenation of (activity, obj_type:count
# multiset) tuples. Two cases collide iff they share the exact same sequence
# of activities AND the same per-event object-type counts. Over-separates
# isomorphic cases that linearise differently (concurrent events) but is
# the cheapest strategy after `db_signature` and gives a useful baseline
# for "how much does temporal order match structural equivalence?".

# Two variants: full (consider all object types) and business-only (consider only
# object types in the TEMP TABLE `business_objects`).
_TRACE_SQL_FULL = """
WITH event_obj_counts AS (
    SELECT ce.case_id, ce.event_id, o.obj_type, COUNT(*) AS n
    FROM case_events ce
    JOIN event_object eo ON ce.event_id = eo.event_id
    JOIN objects     o   ON eo.obj_id   = o.obj_id
    GROUP BY ce.case_id, ce.event_id, o.obj_type
),
event_obj_sig AS (
    SELECT case_id, event_id,
           STRING_AGG(obj_type || ':' || n, ',' ORDER BY obj_type) AS obj_part
    FROM event_obj_counts
    GROUP BY case_id, event_id
),
event_step AS (
    SELECT ce.case_id, ce.event_id, e.activity, e.timestamp_unix,
           COALESCE(eos.obj_part, '') AS obj_part
    FROM case_events ce
    JOIN events e ON ce.event_id = e.event_id
    LEFT JOIN event_obj_sig eos
           ON eos.case_id = ce.case_id AND eos.event_id = ce.event_id
)
SELECT case_id,
       STRING_AGG(activity || '{' || obj_part || '}', '|'
                  ORDER BY timestamp_unix, event_id) AS trace
FROM event_step
GROUP BY case_id
"""

_TRACE_SQL_BUSINESS = """
WITH event_obj_counts AS (
    SELECT ce.case_id, ce.event_id, o.obj_type, COUNT(*) AS n
    FROM case_events ce
    JOIN event_object eo      ON ce.event_id = eo.event_id
    JOIN business_objects bo  ON eo.obj_id   = bo.obj_id
    JOIN objects     o        ON eo.obj_id   = o.obj_id
    GROUP BY ce.case_id, ce.event_id, o.obj_type
),
event_obj_sig AS (
    SELECT case_id, event_id,
           STRING_AGG(obj_type || ':' || n, ',' ORDER BY obj_type) AS obj_part
    FROM event_obj_counts
    GROUP BY case_id, event_id
),
event_step AS (
    SELECT ce.case_id, ce.event_id, e.activity, e.timestamp_unix,
           COALESCE(eos.obj_part, '') AS obj_part
    FROM case_events ce
    JOIN events e ON ce.event_id = e.event_id
    LEFT JOIN event_obj_sig eos
           ON eos.case_id = ce.case_id AND eos.event_id = ce.event_id
)
SELECT case_id,
       STRING_AGG(activity || '{' || obj_part || '}', '|'
                  ORDER BY timestamp_unix, event_id) AS trace
FROM event_step
GROUP BY case_id
"""


def trace_buckets(
    conn: duckdb.DuckDBPyConnection,
    *,
    business_only: bool = False,
) -> Dict[str, List[str]]:
    """
    Compute one bucket per timestamp-ordered trace in pure SQL.

    Each event in the trace is encoded as `activity{obj_type:n,...}` where
    `obj_type:n` lists the count of objects of each type involved in that
    event. Cases sharing the exact same trace string land in the same bucket.

    Requires a TEMP TABLE `case_events(case_id, event_id)` to be present.
    When ``business_only`` is True, also requires the TEMP TABLE
    ``business_objects(obj_id, obj_type)`` and counts only objects whose
    type is in that table.

    Returns: dict[trace -> list of case_ids in that bucket].
    """
    sql = _TRACE_SQL_BUSINESS if business_only else _TRACE_SQL_FULL
    rows = conn.execute(sql).fetchall()
    buckets: dict[str, list[str]] = defaultdict(list)
    for case_id, tr in rows:
        buckets[tr].append(case_id)
    return buckets


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _struct_signature(g: nx.DiGraph) -> str:
    node_labels = sorted(d.get("label", "") for _, d in g.nodes(data=True))
    edges = sorted(
        (
            g.nodes[u].get("label", ""),
            g.nodes[v].get("label", ""),
            d.get("type", ""),
        )
        for u, v, d in g.edges(data=True)
    )
    return f"n:{'|'.join(node_labels)};e:{'|'.join(map(str, edges))}"


def _vf2_match(g1: nx.DiGraph, g2: nx.DiGraph) -> bool:
    return nx.is_isomorphic(
        g1,
        g2,
        node_match=lambda n1, n2: n1.get("label") == n2.get("label"),
        edge_match=lambda e1, e2: e1.get("type") == e2.get("type"),
    )
