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
"""

from __future__ import annotations

from typing import Dict, Optional, Set

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
