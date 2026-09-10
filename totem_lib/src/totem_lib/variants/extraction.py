"""
Process execution extraction techniques over the object graph of an OCEL.

A "case" maps a case_id (chosen as the lexicographically smallest object id
in the case for stability) to the set of object ids belonging to it. The
caller then materialises (case_id, event_id) pairs to drive downstream
SQL queries for variant grouping.

Three techniques are provided:
  - extract_leading_1hop    : case = {leading_obj} ∪ neighbours(leading_obj)
                              Fast simplification; current find_variants_naive_db.
  - extract_leading_bfs     : paper Definition 6 — BFS from each leading object,
                              dropping objects whose type already appeared at a
                              shorter distance.
  - extract_connected_components : paper Definition 5 — one case per connected
                                   component of the object graph.
  - extract_resource_aware  : one case per connected component of the *business
                              object* graph. Only business objects are nodes and
                              only events of business activities connect them,
                              so shared resources (a worker, a machine, ...)
                              never glue unrelated executions together.
"""

from __future__ import annotations

from typing import Dict, Iterable, Optional, Set

import duckdb
import networkx as nx


def build_object_graph(conn: duckdb.DuckDBPyConnection) -> tuple[nx.Graph, dict[str, str]]:
    """Build the undirected object co-occurrence graph and an obj_id→type map."""
    edges = conn.execute(
        """
        SELECT DISTINCT eo1.obj_id AS a, eo2.obj_id AS b
        FROM event_object eo1
        JOIN event_object eo2
          ON eo1.event_id = eo2.event_id
        WHERE eo1.obj_id < eo2.obj_id
        """
    ).fetchall()
    types = dict(conn.execute("SELECT obj_id, obj_type FROM objects").fetchall())

    g = nx.Graph()
    g.add_nodes_from(types.keys())
    g.add_edges_from(edges)
    return g, types


def _leading_object_ids(
    conn: duckdb.DuckDBPyConnection, leading_type: str
) -> list[str]:
    return [
        r[0]
        for r in conn.execute(
            "SELECT obj_id FROM objects WHERE obj_type = $t",
            {"t": leading_type},
        ).fetchall()
    ]


def extract_leading_1hop(
    conn: duckdb.DuckDBPyConnection,
    object_graph: nx.Graph,
    leading_type: str,
    *,
    _progress_bar=None,
) -> Dict[str, Set[str]]:
    """case = {leading_obj} ∪ neighbours(leading_obj). One case per leading object."""
    cases: Dict[str, Set[str]] = {}
    leads = _leading_object_ids(conn, leading_type)
    if _progress_bar is not None:
        _progress_bar.reset(total=len(leads))
    for o in leads:
        cases[o] = {o, *object_graph.neighbors(o)} if o in object_graph else {o}
        if _progress_bar is not None:
            _progress_bar.update(1)
    return cases


def extract_leading_bfs(
    conn: duckdb.DuckDBPyConnection,
    object_graph: nx.Graph,
    obj_type: dict[str, str],
    leading_type: str,
    *,
    _progress_bar=None,
) -> Dict[str, Set[str]]:
    """
    Paper Definition 6: BFS in OG from each leading object.

    At each level, include o' iff no o'' of the same type was already included
    at a strictly smaller distance. Multiple objects of the same type at the
    same distance are all included (matches the paper's set-builder).
    """
    cases: Dict[str, Set[str]] = {}
    leads = _leading_object_ids(conn, leading_type)
    if _progress_bar is not None:
        _progress_bar.reset(total=len(leads))
    for o in leads:
        if o not in object_graph:
            cases[o] = {o}
        else:
            # NetworkX BFS: dict insertion order is BFS (non-decreasing distance),
            # so we can iterate without sorting and still respect the per-type rule.
            case: Set[str] = set()
            seen_type_dist: dict[str, int] = {}
            for v, d in nx.single_source_shortest_path_length(object_graph, o).items():
                t = obj_type.get(v, "")
                prev = seen_type_dist.get(t)
                if prev is None or prev >= d:
                    case.add(v)
                    if prev is None:
                        seen_type_dist[t] = d
            cases[o] = case
        if _progress_bar is not None:
            _progress_bar.update(1)
    return cases


def extract_connected_components(
    object_graph: nx.Graph,
) -> Dict[str, Set[str]]:
    """One case per connected component of the object graph."""
    cases: Dict[str, Set[str]] = {}
    for comp in nx.connected_components(object_graph):
        comp_set = set(comp)
        case_id = min(comp_set)
        cases[case_id] = comp_set
    return cases


# ---------------------------------------------------------------------------
# Resource-aware extraction
# ---------------------------------------------------------------------------


def build_business_object_graph(
    conn: duckdb.DuckDBPyConnection,
    business_object_types: Iterable[str],
    business_activities: Optional[Iterable[str]] = None,
) -> nx.Graph:
    """
    Undirected graph over the *business objects* of the log.

    Nodes are the objects whose type is one of ``business_object_types`` and
    that occur in at least one event. Two nodes are connected iff they share
    an event whose activity is one of ``business_activities`` (``None`` means
    every activity counts).

    Objects of other types -- typically resources such as workers or machines
    -- are deliberately not part of the graph, so a resource that touches
    every execution cannot merge them into one giant component.
    """
    types = sorted({t for t in business_object_types if t})
    if not types:
        raise ValueError("business_object_types must contain at least one object type")
    activities = None if business_activities is None else sorted({a for a in business_activities})
    if activities is not None and not activities:
        raise ValueError("business_activities must contain at least one activity")

    type_placeholders = ", ".join("?" for _ in types)
    node_rows = conn.execute(
        f"""
        SELECT DISTINCT o.obj_id
        FROM objects o
        JOIN event_object eo ON eo.obj_id = o.obj_id
        WHERE o.obj_type IN ({type_placeholders})
        """,
        types,
    ).fetchall()

    activity_clause = ""
    params: list = [*types, *types]
    if activities is not None:
        activity_clause = f"AND e.activity IN ({', '.join('?' for _ in activities)})"
        params.extend(activities)
    edge_rows = conn.execute(
        f"""
        SELECT DISTINCT eo1.obj_id AS a, eo2.obj_id AS b
        FROM event_object eo1
        JOIN event_object eo2
          ON eo1.event_id = eo2.event_id AND eo1.obj_id < eo2.obj_id
        JOIN events  e  ON e.event_id = eo1.event_id
        JOIN objects o1 ON o1.obj_id = eo1.obj_id
        JOIN objects o2 ON o2.obj_id = eo2.obj_id
        WHERE o1.obj_type IN ({type_placeholders})
          AND o2.obj_type IN ({type_placeholders})
          {activity_clause}
        """,
        params,
    ).fetchall()

    g = nx.Graph()
    g.add_nodes_from(r[0] for r in node_rows)
    g.add_edges_from(edge_rows)
    return g


def extract_resource_aware(
    conn: duckdb.DuckDBPyConnection,
    business_object_types: Iterable[str],
    business_activities: Optional[Iterable[str]] = None,
) -> Dict[str, Set[str]]:
    """
    One case per connected component of the business-object graph.

    The case id is the lexicographically smallest business object id of the
    component (stable across runs). The case's *events* are materialised by
    the caller as every event that references one of the case's objects, so
    events of non-business activities (e.g. a resource picking up the item)
    still belong to the execution of the objects they touch.
    """
    graph = build_business_object_graph(conn, business_object_types, business_activities)
    return extract_connected_components(graph)


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

EXTRACTIONS = ("leading_1hop", "leading_bfs", "connected", "resource_aware")


def extract_cases(
    conn: duckdb.DuckDBPyConnection,
    extraction: str,
    *,
    leading_type: Optional[str] = None,
    business_object_types: Optional[Iterable[str]] = None,
    business_activities: Optional[Iterable[str]] = None,
    _progress_bar=None,
) -> Dict[str, Set[str]]:
    """
    Run the named extraction technique and return ``case_id -> object ids``.

    Every consumer of the techniques above (variant discovery, process
    execution materialisation) goes through this single dispatcher so the
    parameter validation lives in one place.
    """
    if extraction in ("leading_1hop", "leading_bfs"):
        if not leading_type:
            raise ValueError(f"extraction='{extraction}' requires leading_type")
        object_graph, obj_type = build_object_graph(conn)
        if extraction == "leading_1hop":
            return extract_leading_1hop(
                conn, object_graph, leading_type, _progress_bar=_progress_bar
            )
        return extract_leading_bfs(
            conn, object_graph, obj_type, leading_type, _progress_bar=_progress_bar
        )
    if extraction == "connected":
        object_graph, _ = build_object_graph(conn)
        cases = extract_connected_components(object_graph)
    elif extraction == "resource_aware":
        if not business_object_types:
            raise ValueError(
                "extraction='resource_aware' requires at least one business object type"
            )
        cases = extract_resource_aware(conn, business_object_types, business_activities)
    else:
        raise ValueError(f"unknown extraction: {extraction!r}")
    if _progress_bar is not None:
        _progress_bar.reset(total=len(cases))
        _progress_bar.update(len(cases))
    return cases
