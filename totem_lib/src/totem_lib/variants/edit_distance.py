"""
Edit distance between two process executions.

A process execution is the representative graph of a variant: a directed graph
whose nodes are events (`label` activity, `timestamp` int) and whose edges are
colored with the objects that flow between consecutive events for that object
(edge attrs `type` = pipe-joined object types, `objects` = sorted obj-id list).

`process_execution_edit_distance(source, target, *, ocel_db=None, costs=None)`
returns `(total_cost, edits)` where `edits` is a list of `Edit` records
describing the operations that turn `source` into `target`. Five operations
are supported, all with user-tunable cost functions defaulting to the number
of involved objects:

    delete_event       per source event
    add_event          per target event
    move_event         when matched events have different activity labels
    add_objects        objects on a matched target event missing from the source
    remove_objects     objects on a matched source event missing from the target

Edge changes are not separately reported — they are captured implicitly by the
per-event object-set diffs.

Implementation: bipartite assignment relaxation (Riesen-Bunke). Builds a
(n+m) x (n+m) cost matrix and solves it with the Hungarian algorithm
(`scipy.optimize.linear_sum_assignment`). O((n+m)^3) — fast enough for the
hundreds of events typical of one process execution.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, List, Literal, Optional, Tuple, Union

import networkx as nx
import numpy as np
from scipy.optimize import linear_sum_assignment


CostFn = Callable[[Iterable[str]], float]


def _len_cost(objs: Iterable[str]) -> float:
    return float(len(list(objs)))


def _as_cost_fn(value: Union[CostFn, float, int]) -> CostFn:
    if callable(value):
        return value
    constant = float(value)
    return lambda _objs, _c=constant: _c


@dataclass
class EditCosts:
    """User-tunable cost functions for each edit operation.

    Each field is a callable taking the involved object ids and returning a
    non-negative float. Defaults assign cost equal to the number of involved
    objects, matching the spec.
    """

    delete_event:   CostFn = field(default=_len_cost)
    add_event:      CostFn = field(default=_len_cost)
    move_event:     CostFn = field(default=_len_cost)
    add_objects:    CostFn = field(default=_len_cost)
    remove_objects: CostFn = field(default=_len_cost)

    @staticmethod
    def from_constants(**kwargs: Union[CostFn, float, int]) -> "EditCosts":
        """Build an EditCosts where each provided value may be a callable or a number.

        Numbers are wrapped into constant-cost functions. Unspecified fields
        keep their default (`len(objects)`).
        """
        coerced = {k: _as_cost_fn(v) for k, v in kwargs.items()}
        return EditCosts(**coerced)


EditOp = Literal[
    "delete_event", "add_event", "move_event", "add_objects", "remove_objects"
]


@dataclass(frozen=True)
class Edit:
    """A single edit operation produced by `process_execution_edit_distance`."""

    op: EditOp
    source_event: Optional[str]
    target_event: Optional[str]
    objects: List[str]
    cost: float


def _unwrap(graph_like: Any) -> nx.DiGraph:
    if isinstance(graph_like, nx.DiGraph):
        return graph_like
    if hasattr(graph_like, "graph") and isinstance(graph_like.graph, nx.DiGraph):
        return graph_like.graph
    raise TypeError(
        f"Expected nx.DiGraph or Variant-like with .graph, got {type(graph_like).__name__}"
    )


def _objects_from_graph(graph: nx.DiGraph, event_id: str) -> set[str]:
    """Union of `objects` lists across edges incident to `event_id`."""
    objs: set[str] = set()
    for _, _, data in graph.in_edges(event_id, data=True):
        objs.update(data.get("objects", []))
    for _, _, data in graph.out_edges(event_id, data=True):
        objs.update(data.get("objects", []))
    return objs


def _objects_from_db(ocel_db, event_ids: List[str]) -> dict[str, set[str]]:
    """Batched `event_id -> set(obj_id)` lookup against the event_object table."""
    if not event_ids:
        return {}
    placeholders = ", ".join("?" * len(event_ids))
    rows = ocel_db.conn.execute(
        f"SELECT event_id, obj_id FROM event_object WHERE event_id IN ({placeholders})",
        list(event_ids),
    ).fetchall()
    out: dict[str, set[str]] = {eid: set() for eid in event_ids}
    for eid, oid in rows:
        out.setdefault(eid, set()).add(oid)
    return out


def _resolve_objects(
    graph: nx.DiGraph,
    ocel_db,
    warned: list[bool],
) -> dict[str, frozenset[str]]:
    """Resolve `event_id -> frozenset(obj_id)` for every node in `graph`."""
    event_ids = list(graph.nodes())
    if ocel_db is not None:
        db_map = _objects_from_db(ocel_db, event_ids)
    else:
        db_map = {}

    out: dict[str, frozenset[str]] = {}
    any_empty = False
    for eid in event_ids:
        objs = db_map.get(eid)
        if not objs:
            objs = _objects_from_graph(graph, eid)
        if not objs:
            any_empty = True
        out[eid] = frozenset(objs)

    if any_empty and not warned[0]:
        warnings.warn(
            "process_execution_edit_distance: at least one event has no "
            "involved objects (no incident edges and no ocel_db lookup). "
            "Default costs will treat such events as cost 0.",
            stacklevel=3,
        )
        warned[0] = True
    return out


def process_execution_edit_distance(
    source: Any,
    target: Any,
    *,
    ocel_db: Any = None,
    costs: Optional[EditCosts] = None,
) -> Tuple[float, List[Edit]]:
    """Compute the edit distance between two process executions.

    Parameters
    ----------
    source, target : nx.DiGraph or Variant
        The two process executions to compare. `Variant` objects are unwrapped
        to their `.graph` attribute automatically.
    ocel_db : OcelDuckDB, optional
        If provided, the involved objects of each event are read from the
        `event_object` table for higher fidelity. Otherwise they are derived
        from the `objects` lists on incident edges.
    costs : EditCosts, optional
        Override the default cost functions. Each defaults to `len(objects)`.

    Returns
    -------
    total_cost : float
        Sum of the cost of every emitted Edit.
    edits : list[Edit]
        The concrete edit operations that turn `source` into `target`.
    """
    g_src = _unwrap(source)
    g_tgt = _unwrap(target)
    costs = costs or EditCosts()

    src_events = list(g_src.nodes())
    tgt_events = list(g_tgt.nodes())
    n, m = len(src_events), len(tgt_events)

    warned = [False]
    src_objs = _resolve_objects(g_src, ocel_db, warned)
    tgt_objs = _resolve_objects(g_tgt, ocel_db, warned)

    src_labels = {e: g_src.nodes[e].get("label") for e in src_events}
    tgt_labels = {e: g_tgt.nodes[e].get("label") for e in tgt_events}

    if n == 0 and m == 0:
        return 0.0, []

    size = n + m
    M = np.full((size, size), np.inf, dtype=float)

    for i, s in enumerate(src_events):
        s_objs = src_objs[s]
        for j, t in enumerate(tgt_events):
            t_objs = tgt_objs[t]
            move_part = (
                costs.move_event(s_objs | t_objs)
                if src_labels[s] != tgt_labels[t]
                else 0.0
            )
            add_part = costs.add_objects(t_objs - s_objs)
            rem_part = costs.remove_objects(s_objs - t_objs)
            M[i, j] = move_part + add_part + rem_part

    for i, s in enumerate(src_events):
        M[i, m + i] = costs.delete_event(src_objs[s])

    for j, t in enumerate(tgt_events):
        M[n + j, j] = costs.add_event(tgt_objs[t])

    M[n:, m:] = 0.0

    row_ind, col_ind = linear_sum_assignment(M)

    edits: List[Edit] = []
    total_cost = 0.0
    for i, j in zip(row_ind, col_ind):
        cell = float(M[i, j])
        total_cost += cell
        if i < n and j < m:
            s, t = src_events[i], tgt_events[j]
            s_objs, t_objs = src_objs[s], tgt_objs[t]
            if src_labels[s] != tgt_labels[t]:
                union = sorted(s_objs | t_objs)
                c = costs.move_event(union)
                if c > 0 or union:
                    edits.append(Edit("move_event", s, t, union, float(c)))
            added = sorted(t_objs - s_objs)
            if added:
                c = costs.add_objects(added)
                if c > 0:
                    edits.append(Edit("add_objects", s, t, added, float(c)))
            removed = sorted(s_objs - t_objs)
            if removed:
                c = costs.remove_objects(removed)
                if c > 0:
                    edits.append(Edit("remove_objects", s, t, removed, float(c)))
        elif i < n and j >= m:
            s = src_events[i]
            objs = sorted(src_objs[s])
            edits.append(Edit("delete_event", s, None, objs, cell))
        elif i >= n and j < m:
            t = tgt_events[j]
            objs = sorted(tgt_objs[t])
            edits.append(Edit("add_event", None, t, objs, cell))

    return total_cost, edits
