"""
DuckDB-backed object-centric variant discovery with selectable extraction
and isomorphism strategies.

The single entry point is `find_variants(ocel_db, *, extraction, leading_type, iso)`.
Process executions are extracted via the chosen technique (leading-1hop,
leading-BFS, or connected components — see `extraction.py`); equivalence
classes are computed via the chosen iso strategy (`iso_strategies.py`).

`find_variants_naive_db(ocel_db, leading_type)` is preserved as a thin
backwards-compat wrapper for code that pre-dates the new API.
"""

from __future__ import annotations

import time
from collections import defaultdict
from typing import Dict, List, Literal, Optional

import networkx as nx
import polars as pl
from tqdm.auto import tqdm as _tqdm

from ..ocel.ocel_duckdb import OcelDuckDB
from . import extraction as _ext
from . import iso_strategies as _iso
from .ocvariants import Variant, Variants


Extraction = Literal["leading_1hop", "leading_bfs", "connected"]
IsoStrategy = Literal[
    "db_signature", "trace", "signature", "wl", "wl+vf2", "exact"
]


# ---------------------------------------------------------------------------
# SQL templates — operate on the case_objs / case_events temp tables
# ---------------------------------------------------------------------------

_CREATE_CASE_EVENTS_SQL = """
CREATE OR REPLACE TEMP TABLE case_events AS
SELECT DISTINCT co.case_id, eo.event_id
FROM case_objs co
JOIN event_object eo ON co.obj_id = eo.obj_id
"""

# case_edges: global EOG (consecutive events for one object) restricted to
# pairs whose both endpoints fall inside the same case
# (= eog.subgraph(case_event_ids)). One row per inducing object.
_CREATE_CASE_EDGES_SQL = """
CREATE OR REPLACE TEMP TABLE case_edges AS
WITH obj_rn AS (
    SELECT
        eo.obj_id,
        eo.event_id,
        ROW_NUMBER() OVER (
            PARTITION BY eo.obj_id
            ORDER BY e.timestamp_unix, eo.event_id
        ) AS rn
    FROM event_object eo
    JOIN events e ON eo.event_id = e.event_id
),
global_eog AS (
    SELECT a.obj_id, a.event_id AS src, b.event_id AS tgt
    FROM obj_rn a
    JOIN obj_rn b ON a.obj_id = b.obj_id AND b.rn = a.rn + 1
)
SELECT DISTINCT ce1.case_id, g.obj_id, g.src, g.tgt
FROM global_eog g
JOIN case_events ce1 ON g.src = ce1.event_id
JOIN case_events ce2 ON g.tgt = ce2.event_id
                    AND ce1.case_id = ce2.case_id
"""

_NODES_SQL = """
SELECT ce.case_id, ce.event_id, e.activity, e.timestamp_unix
FROM case_events ce
JOIN events e ON ce.event_id = e.event_id
WHERE ce.case_id IN (SELECT DISTINCT case_id FROM case_edges)
"""

_EDGES_SQL = """
SELECT ce.case_id, ce.src, ce.tgt, ce.obj_id, o.obj_type
FROM case_edges ce
JOIN objects o ON ce.obj_id = o.obj_id
"""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def find_variants(
    ocel_db: OcelDuckDB,
    *,
    extraction: Extraction = "leading_1hop",
    leading_type: Optional[str] = None,
    iso: IsoStrategy = "wl+vf2",
    verbose: bool = True,
) -> Variants:
    """
    Discover object-centric variants from an OcelDuckDB.

    :param ocel_db: A populated OcelDuckDB instance.
    :param extraction: Process-execution extraction technique.
        - "leading_1hop": case = leading object ∪ direct neighbours (fast).
        - "leading_bfs":  paper Definition 6 — BFS with per-type distance pruning.
        - "connected":    paper Definition 5 — one case per connected component.
    :param leading_type: Required for "leading_*" extraction; ignored for "connected".
    :param iso: Equivalence-class (graph isomorphism) strategy.
        - "db_signature": SQL multiset signature. Cheapest, may over-merge.
        - "trace":        SQL timestamp-ordered sequence of
                          (activity, obj_type:count) tuples. Over-separates
                          isomorphic cases whose linearisations differ.
        - "signature":    in-Python multiset of (labels, edges).
        - "wl":           Weisfeiler-Lehman hash only.
        - "wl+vf2":       WL bucketing + VF2 refinement (recommended default).
        - "exact":        full pairwise VF2.
    :param verbose: Show per-step progress bars in the terminal.
    :return: Variants sorted by support descending.
    """
    if extraction in ("leading_1hop", "leading_bfs") and leading_type is None:
        raise ValueError(f"extraction='{extraction}' requires leading_type")

    _bar_kw = dict(dynamic_ncols=True, leave=True, disable=not verbose)

    def _msg(s: str) -> None:
        if verbose:
            _tqdm.write(s)

    total_t0 = time.time()
    conn = ocel_db.conn

    # ---- Step 1: object graph ----
    with _tqdm(
        total=1,
        desc="[1/4] building object graph",
        unit="graph",
        bar_format="{desc} {bar} {elapsed}",
        **_bar_kw,
    ) as pb:
        object_graph, obj_type = _ext.build_object_graph(conn)
        n_obj = object_graph.number_of_nodes()
        n_comp = nx.number_connected_components(object_graph)
        pb.set_postfix_str(f"{n_obj:,} objects · {n_comp:,} component(s)")
        pb.update(1)

    # ---- Step 1b: extract cases ----
    _extract_label = (
        f"[1/4] extracting ({extraction}"
        + (f" · {leading_type}" if leading_type else "")
        + ")"
    )
    with _tqdm(
        total=0,
        desc=_extract_label,
        unit="obj",
        bar_format="{desc}: {n_fmt}/{total_fmt} {bar} [{elapsed}, {rate_fmt}]",
        **_bar_kw,
    ) as pb:
        if extraction == "leading_1hop":
            cases = _ext.extract_leading_1hop(
                conn, object_graph, leading_type, _progress_bar=pb
            )
        elif extraction == "leading_bfs":
            cases = _ext.extract_leading_bfs(
                conn, object_graph, obj_type, leading_type, _progress_bar=pb
            )
        elif extraction == "connected":
            cases = _ext.extract_connected_components(object_graph)
            pb.reset(total=len(cases))
            pb.update(len(cases))
        else:
            raise ValueError(f"unknown extraction: {extraction!r}")
        pb.set_postfix_str(f"→ {len(cases):,} cases")

    if not cases:
        return Variants([])

    # ---- Step 2: materialise case tables ----
    _table_names = ["case_objs", "case_events", "case_edges"]
    with _tqdm(
        total=3,
        desc="[2/4] building case tables",
        unit="table",
        bar_format="{desc}: {n_fmt}/{total_fmt} {bar} [{elapsed}]",
        **_bar_kw,
    ) as pb:
        _materialise_case_objs(conn, cases)
        pb.set_postfix_str("case_objs ✓")
        pb.update(1)

        conn.execute(_CREATE_CASE_EVENTS_SQL)
        pb.set_postfix_str("case_events ✓")
        pb.update(1)

        conn.execute(_CREATE_CASE_EDGES_SQL)
        pb.set_postfix_str("case_edges ✓")
        pb.update(1)

    # Cases with at least one edge — matches the legacy naive 0-edge filter.
    cases_with_edges = {
        r[0] for r in conn.execute("SELECT DISTINCT case_id FROM case_edges").fetchall()
    }
    n_filtered = len(cases) - len(cases_with_edges)
    if n_filtered and verbose:
        _msg(f"         {n_filtered} case(s) skipped (no edges)")

    # ---- Step 3: group into variants ----
    n_cases = len(cases_with_edges)
    case_event_lists = _fetch_case_event_lists(conn, cases_with_edges)

    if iso in ("db_signature", "trace"):
        with _tqdm(
            total=1,
            desc=f"[3/4] grouping ({iso})",
            unit="query",
            bar_format="{desc} {bar} [{elapsed}]",
            **_bar_kw,
        ) as pb:
            if iso == "db_signature":
                groups = _group_db_signature(conn, cases_with_edges)
            else:
                groups = _group_trace(conn, cases_with_edges)
            pb.set_postfix_str(f"→ {len(groups):,} variants")
            pb.update(1)
    else:
        with _tqdm(
            total=n_cases,
            desc="[3/4] building case graphs",
            unit="case",
            bar_format="{desc}: {n_fmt}/{total_fmt} {bar} [{elapsed}, {rate_fmt}]",
            **_bar_kw,
        ) as pb:
            case_graphs = _build_case_graphs(conn, _progress_bar=pb)

        _iso_label = f"[3/4] grouping ({iso})"
        with _tqdm(
            total=n_cases,
            desc=_iso_label,
            unit="case",
            bar_format="{desc}: {n_fmt}/{total_fmt} {bar} [{elapsed}, {rate_fmt}]",
            **_bar_kw,
        ) as pb:
            if iso == "signature":
                groups = _iso.group_signature(case_graphs, _progress_bar=pb)
            elif iso == "wl":
                groups = _iso.group_wl(case_graphs, _progress_bar=pb)
            elif iso == "wl+vf2":
                groups = _iso.group_wl_vf2(case_graphs, _progress_bar=pb)
            elif iso == "exact":
                groups = _iso.group_exact(case_graphs, _progress_bar=pb)
            else:
                raise ValueError(f"unknown iso strategy: {iso!r}")
            pb.set_postfix_str(f"→ {len(groups):,} variants")

    # ---- Step 4: format Variant objects ----
    with _tqdm(
        total=len(groups),
        desc="[4/4] formatting variants",
        unit="variant",
        bar_format="{desc}: {n_fmt}/{total_fmt} {bar} [{elapsed}]",
        **_bar_kw,
    ) as pb:
        variant_list = _format_variants(groups, case_event_lists, _progress_bar=pb)

    total_exec = sum(len(x.executions) for x in variant_list)
    elapsed = time.time() - total_t0
    _msg(
        f"\n  ✓ {len(variant_list)} variant(s) · {total_exec:,} execution(s)"
        f"  [{elapsed:.2f}s total]"
    )

    return Variants(variant_list)


def find_variants_naive_db(ocel_db: OcelDuckDB, leading_type: str) -> Variants:
    """Backwards-compat wrapper: leading_1hop extraction + exact VF2 isomorphism."""
    return find_variants(
        ocel_db,
        extraction="leading_1hop",
        leading_type=leading_type,
        iso="exact",
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _materialise_case_objs(conn, cases: Dict[str, set]) -> None:
    """Register `cases` as the TEMP TABLE case_objs(case_id, obj_id)."""
    rows = [(cid, oid) for cid, objs in cases.items() for oid in objs]
    df = pl.DataFrame(  # noqa: F841 — picked up by DuckDB replacement scan
        {
            "case_id": [r[0] for r in rows],
            "obj_id": [r[1] for r in rows],
        },
        schema={"case_id": pl.Utf8, "obj_id": pl.Utf8},
    )
    conn.execute("CREATE OR REPLACE TEMP TABLE case_objs AS SELECT * FROM df")


def _fetch_case_event_lists(
    conn, allowed: set[str] | None = None
) -> Dict[str, List[str]]:
    """Return case_id -> list of event_ids, optionally restricted to `allowed`."""
    rows = conn.execute("SELECT case_id, event_id FROM case_events").fetchall()
    out: dict[str, list[str]] = defaultdict(list)
    for cid, eid in rows:
        if allowed is None or cid in allowed:
            out[cid].append(eid)
    return out


def _build_case_graphs(conn, _progress_bar=None) -> Dict[str, nx.DiGraph]:
    """Build one nx.DiGraph per case from the case_events temp table."""
    nodes_rows = conn.execute(_NODES_SQL).fetchall()
    edges_rows = conn.execute(_EDGES_SQL).fetchall()

    instance_nodes: dict[str, dict[str, dict]] = defaultdict(dict)
    for case_id, event_id, activity, ts in nodes_rows:
        instance_nodes[case_id][event_id] = {
            "label": activity,
            "timestamp": int(ts) if ts is not None else 0,
        }

    instance_edges: dict[str, dict[tuple, dict]] = defaultdict(
        lambda: defaultdict(lambda: {"types": set(), "objects": set()})
    )
    for case_id, src, tgt, obj_id, obj_type in edges_rows:
        edata = instance_edges[case_id][(src, tgt)]
        edata["types"].add(obj_type)
        edata["objects"].add(obj_id)

    graphs: dict[str, nx.DiGraph] = {}
    for case_id, nodes in instance_nodes.items():
        g = nx.DiGraph()
        for event_id, attrs in nodes.items():
            g.add_node(event_id, label=attrs["label"], timestamp=attrs["timestamp"])
        for (src, tgt), edata in instance_edges.get(case_id, {}).items():
            g.add_edge(
                src,
                tgt,
                type="|".join(sorted(edata["types"])),
                objects=sorted(edata["objects"]),
            )
        graphs[case_id] = g
        if _progress_bar is not None:
            _progress_bar.update(1)
    return graphs


def _build_one_case_graph(conn, case_id: str) -> Optional[nx.DiGraph]:
    """Build a single representative graph for `case_id`."""
    nodes_rows = conn.execute(
        """
        SELECT ce.event_id, e.activity, e.timestamp_unix
        FROM case_events ce
        JOIN events e ON ce.event_id = e.event_id
        WHERE ce.case_id = $cid
        """,
        {"cid": case_id},
    ).fetchall()
    edges_rows = conn.execute(
        """
        SELECT ce.src, ce.tgt, ce.obj_id, o.obj_type
        FROM case_edges ce
        JOIN objects o ON ce.obj_id = o.obj_id
        WHERE ce.case_id = $cid
        """,
        {"cid": case_id},
    ).fetchall()

    if not edges_rows:
        return None

    g = nx.DiGraph()
    for event_id, activity, ts in nodes_rows:
        g.add_node(event_id, label=activity, timestamp=int(ts) if ts is not None else 0)

    by_pair: dict[tuple, dict] = defaultdict(lambda: {"types": set(), "objects": set()})
    for src, tgt, obj_id, obj_type in edges_rows:
        by_pair[(src, tgt)]["types"].add(obj_type)
        by_pair[(src, tgt)]["objects"].add(obj_id)
    for (src, tgt), edata in by_pair.items():
        g.add_edge(
            src,
            tgt,
            type="|".join(sorted(edata["types"])),
            objects=sorted(edata["objects"]),
        )
    return g


def _group_db_signature(
    conn,
    cases_with_edges: set[str],
) -> List[_iso.VariantGroup]:
    """
    Bucket cases by SQL-side signature, then build a representative graph
    only for the first rep of each bucket.
    """
    return _group_from_sql_buckets(
        conn, cases_with_edges, _iso.db_signature_buckets(conn)
    )


def _group_trace(
    conn,
    cases_with_edges: set[str],
) -> List[_iso.VariantGroup]:
    """
    Bucket cases by their timestamp-ordered trace (with per-event obj-type
    counts), then build a representative graph only for the first rep of
    each bucket.
    """
    return _group_from_sql_buckets(
        conn, cases_with_edges, _iso.trace_buckets(conn)
    )


def _group_from_sql_buckets(
    conn,
    cases_with_edges: set[str],
    buckets: Dict[str, List[str]],
) -> List[_iso.VariantGroup]:
    """Common bucket → VariantGroup conversion for SQL-only iso strategies."""
    groups: list[_iso.VariantGroup] = []
    for _key, members in buckets.items():
        members = [cid for cid in members if cid in cases_with_edges]
        if not members:
            continue
        rep_id = members[0]
        rep_graph = _build_one_case_graph(conn, rep_id)
        if rep_graph is None:
            continue
        groups.append((rep_id, members, rep_graph))
    return groups


def _format_variants(
    groups: List[_iso.VariantGroup],
    case_event_lists: Dict[str, List[str]],
    _progress_bar=None,
) -> List[Variant]:
    out: list[Variant] = []
    for i, (_rep_id, members, rep_graph) in enumerate(groups):
        executions = [case_event_lists.get(cid, []) for cid in members]
        if "sequence" not in rep_graph.graph:
            rep_graph.graph["sequence"] = [
                d["label"]
                for _, d in sorted(
                    rep_graph.nodes(data=True),
                    key=lambda x: x[1].get("timestamp", 0),
                )
            ]
        out.append(
            Variant(
                vid=f"variant_{i}",
                support=len(members),
                executions=executions,
                graph=rep_graph,
            )
        )
        if _progress_bar is not None:
            _progress_bar.update(1)
    out.sort(key=lambda v: v.support, reverse=True)
    return out
