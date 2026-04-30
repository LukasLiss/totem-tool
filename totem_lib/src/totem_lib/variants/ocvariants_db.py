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
#
# Two variants:
#   _CREATE_CASE_EDGES_SQL          — every object induces edges (legacy)
#   _CREATE_CASE_EDGES_SQL_BUSINESS — only objects in TEMP TABLE
#                                     `business_objects` induce edges. Required
#                                     when the user split obj_types into
#                                     business / resource — otherwise resources
#                                     (e.g. a forklift used across thousands of
#                                     events) would synthesise huge spurious
#                                     EOG chains.

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

_CREATE_CASE_EDGES_SQL_BUSINESS = """
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
    JOIN business_objects bo ON eo.obj_id = bo.obj_id
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

# Resource-induced edges between events that already belong to a
# representative case. We use **case-local** EOG ranking here (rank a
# resource's events within each rep case by timestamp) instead of the
# global EOG rank used for business objects. Rationale: a high-traffic
# resource (e.g. a forklift used by hundreds of orders) almost never has
# two *globally* consecutive events in the same case, so global ranking
# would silently hide every such resource. Case-local ranking faithfully
# shows "the order in which this resource was touched within this rep
# case", which is what the user-visible variant graph needs.
#
# Reads from TEMP TABLE `rep_events(rep_case_id, event_id)` materialised
# by `_enrich_with_resources` and returns one row per
# (rep_case_id, src, tgt, obj_id, obj_type) consecutive pair.
_RESOURCE_EDGES_SQL = """
WITH res_events_in_rep AS (
    SELECT re.rep_case_id,
           re.event_id,
           eo.obj_id,
           e.timestamp_unix
    FROM rep_events     re
    JOIN event_object   eo ON re.event_id = eo.event_id
    JOIN events         e  ON re.event_id = e.event_id
    JOIN resource_objects ro ON eo.obj_id = ro.obj_id
),
ranked AS (
    SELECT *,
           ROW_NUMBER() OVER (
               PARTITION BY rep_case_id, obj_id
               ORDER BY timestamp_unix, event_id
           ) AS rn
    FROM res_events_in_rep
)
SELECT a.rep_case_id,
       a.obj_id,
       o.obj_type,
       a.event_id AS src,
       b.event_id AS tgt
FROM ranked a
JOIN ranked b
  ON a.rep_case_id = b.rep_case_id
 AND a.obj_id      = b.obj_id
 AND b.rn          = a.rn + 1
JOIN objects o ON a.obj_id = o.obj_id
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
    business_obj_types: Optional[List[str]] = None,
    resource_types: Optional[List[str]] = None,
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
    :param business_obj_types: Optional list of obj_types treated as
        "business" objects. Only these participate in the object graph,
        case extraction, case-edge construction, and the iso comparison.
    :param resource_types: Optional list of obj_types treated as
        "resources" (e.g. forklifts, drivers). They are excluded from the
        case extraction and the iso projection but are *re-added* to the
        representative graph as additional edges between events that are
        already part of that case (using the same edge schema as business
        objects, so downstream consumers keep working).
        Resolution rules (see also docs):
          - both None         → all types are business, no resources.
          - only resources    → all other types become business.
          - only business     → all other types become resources.
          - both given        → types not in either set are ignored entirely.
        Validation: business ∩ resources must be empty; for leading
        extractions, leading_type must be in the business set.
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

    # ---- Step 0: resolve business / resource type split ----
    business_set, resource_set = _resolve_object_types(
        conn, business_obj_types, resource_types, leading_type
    )
    use_split = bool(resource_set) or business_obj_types is not None
    if use_split:
        _materialise_type_partition(conn, business_set, resource_set)
        if verbose:
            _msg(
                f"  business types: {sorted(business_set)}"
                f"\n  resource types: {sorted(resource_set) or '∅'}"
            )

    # ---- Step 1: object graph ----
    with _tqdm(
        total=1,
        desc="[1/4] building object graph",
        unit="graph",
        bar_format="{desc} {bar} {elapsed}",
        **_bar_kw,
    ) as pb:
        object_graph, obj_type = _ext.build_object_graph(
            conn, business_only=use_split
        )
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

        conn.execute(
            _CREATE_CASE_EDGES_SQL_BUSINESS if use_split else _CREATE_CASE_EDGES_SQL
        )
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
                groups = _group_trace(
                    conn, cases_with_edges, business_only=use_split
                )
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

    # ---- Step 3b: re-introduce resource objects on the rep graphs ----
    if resource_set:
        with _tqdm(
            total=1,
            desc="[3/4] enriching with resources",
            unit="query",
            bar_format="{desc} {bar} [{elapsed}]",
            **_bar_kw,
        ) as pb:
            n_added = _enrich_with_resources(conn, groups)
            pb.set_postfix_str(f"+{n_added:,} resource edges")
            pb.update(1)

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


def _resolve_object_types(
    conn,
    business_obj_types: Optional[List[str]],
    resource_types: Optional[List[str]],
    leading_type: Optional[str],
) -> tuple[set[str], set[str]]:
    """
    Resolve the (business, resource) obj_type partition. Rules:

      both None         → all types business, no resources
      only resources    → all other types are business
      only business     → all other types are resources
      both given        → types not in either set are ignored
    """
    if business_obj_types is None and resource_types is None:
        all_types = {
            r[0]
            for r in conn.execute("SELECT DISTINCT obj_type FROM objects").fetchall()
        }
        return all_types, set()

    business = set(business_obj_types) if business_obj_types is not None else None
    resources = set(resource_types) if resource_types is not None else None

    if business is not None and resources is not None:
        if business & resources:
            raise ValueError(
                "business_obj_types and resource_types must be disjoint; "
                f"overlap: {sorted(business & resources)}"
            )
    elif business is None:  # resources given, infer business from rest
        all_types = {
            r[0]
            for r in conn.execute("SELECT DISTINCT obj_type FROM objects").fetchall()
        }
        business = all_types - resources
    else:  # business given, infer resources from rest
        all_types = {
            r[0]
            for r in conn.execute("SELECT DISTINCT obj_type FROM objects").fetchall()
        }
        resources = all_types - business

    if not business:
        raise ValueError(
            "business object set is empty after resolution — pass at least "
            "one type via business_obj_types or remove some entries from "
            "resource_types"
        )
    if leading_type is not None and leading_type in resources:
        raise ValueError(
            f"leading_type={leading_type!r} is declared as a resource type; "
            "leading_type must be a business object type"
        )
    if leading_type is not None and leading_type not in business:
        raise ValueError(
            f"leading_type={leading_type!r} is not in the business object "
            f"set {sorted(business)}"
        )
    return business, resources


def _materialise_type_partition(
    conn, business: set[str], resources: set[str]
) -> None:
    """
    Materialise TEMP TABLEs ``business_objects(obj_id, obj_type)`` and
    ``resource_objects(obj_id, obj_type)`` from the chosen partition.
    """
    biz_df = pl.DataFrame(  # noqa: F841 — picked up by DuckDB replacement scan
        {"obj_type": sorted(business)}, schema={"obj_type": pl.Utf8}
    )
    conn.execute(
        "CREATE OR REPLACE TEMP TABLE business_objects AS "
        "SELECT o.obj_id, o.obj_type "
        "FROM objects o JOIN biz_df t ON o.obj_type = t.obj_type"
    )
    res_df = pl.DataFrame(  # noqa: F841
        {"obj_type": sorted(resources)}, schema={"obj_type": pl.Utf8}
    )
    conn.execute(
        "CREATE OR REPLACE TEMP TABLE resource_objects AS "
        "SELECT o.obj_id, o.obj_type "
        "FROM objects o JOIN res_df t ON o.obj_type = t.obj_type"
    )


def _enrich_with_resources(
    conn, groups: List[_iso.VariantGroup]
) -> int:
    """
    Add resource-induced EOG edges to each representative graph in
    ``groups``. Edges between events that already exist in a rep graph
    have their ``type`` and ``objects`` attributes merged with the
    resource obj_type / obj_id; new edges are added with the same schema.
    Returns the number of (src, tgt, obj_id) rows reintroduced.
    """
    if not groups:
        return 0

    # rep_events(rep_case_id, event_id): one row per (rep, event) in any rep graph
    rep_rows: list[tuple[str, str]] = []
    by_rep: dict[str, nx.DiGraph] = {}
    for rep_id, _members, rep_g in groups:
        by_rep[rep_id] = rep_g
        for n in rep_g.nodes():
            rep_rows.append((rep_id, n))

    rep_df = pl.DataFrame(  # noqa: F841
        {
            "rep_case_id": [r[0] for r in rep_rows],
            "event_id":    [r[1] for r in rep_rows],
        },
        schema={"rep_case_id": pl.Utf8, "event_id": pl.Utf8},
    )
    conn.execute(
        "CREATE OR REPLACE TEMP TABLE rep_events AS SELECT * FROM rep_df"
    )

    rows = conn.execute(_RESOURCE_EDGES_SQL).fetchall()

    # Aggregate per (rep_case_id, src, tgt): set of types, set of obj_ids
    pair_data: dict[tuple[str, str, str], dict] = defaultdict(
        lambda: {"types": set(), "objects": set()}
    )
    for rep_case_id, obj_id, obj_type, src, tgt in rows:
        d = pair_data[(rep_case_id, src, tgt)]
        d["types"].add(obj_type)
        d["objects"].add(obj_id)

    # Merge into rep graphs.
    for (rep_case_id, src, tgt), d in pair_data.items():
        g = by_rep.get(rep_case_id)
        if g is None:
            continue
        if g.has_edge(src, tgt):
            edata = g[src][tgt]
            existing_types = (
                set(edata.get("type", "").split("|"))
                if edata.get("type")
                else set()
            )
            existing_objs = set(edata.get("objects", []) or [])
            edata["type"] = "|".join(sorted(existing_types | d["types"]))
            edata["objects"] = sorted(existing_objs | d["objects"])
        else:
            g.add_edge(
                src,
                tgt,
                type="|".join(sorted(d["types"])),
                objects=sorted(d["objects"]),
            )

    return len(rows)


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
    *,
    business_only: bool = False,
) -> List[_iso.VariantGroup]:
    """
    Bucket cases by their timestamp-ordered trace (with per-event obj-type
    counts), then build a representative graph only for the first rep of
    each bucket. ``business_only`` restricts the per-event obj-type
    counts to objects in TEMP TABLE ``business_objects``.
    """
    return _group_from_sql_buckets(
        conn,
        cases_with_edges,
        _iso.trace_buckets(conn, business_only=business_only),
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
