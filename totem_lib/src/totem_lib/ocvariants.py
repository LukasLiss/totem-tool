from __future__ import annotations
from collections import defaultdict
from typing import Dict, List, Iterator
import networkx as nx

from .ocel import ObjectCentricEventLog


EventId = str
ExecIdx = int
VariantId = str


class Variant:
    """Represents one variant, with support (frequency) and its executions."""

    def __init__(self, vid: VariantId, support: int, executions: List[List[EventId]], graph: nx.DiGraph):
        self.id = vid
        self.support = support
        self.executions = executions
        self.graph = graph  # representative graph

    def __iter__(self) -> Iterator[List[EventId]]:
        """Iterate over executions (each is a list of event ids)."""
        return iter(self.executions)

    def __repr__(self):
        return f"<Variant {self.id}, support={self.support}>"


class Variants:
    """Iterable container for multiple Variant objects."""

    def __init__(self, variants: List[Variant]):
        self._variants = variants

    def __iter__(self) -> Iterator[Variant]:
        return iter(self._variants)

    def __len__(self) -> int:
        return len(self._variants)

    def __getitem__(self, idx: int) -> Variant:
        return self._variants[idx]

    def __repr__(self):
        return f"<Variants n={len(self)}>"


##################################################
# Functions to create Variants from ocel data
##################################################


def find_variants(ocel: ObjectCentricEventLog) -> Variants:
    """
    One-phase variant discovery on an ObjectCentricEventLog.
    Returns a Variants object, iterable over Variant instances.
    """
    # -------------------------
    # STEP 0: indices
    # -------------------------
    cols = ["_eventId", "_activity", "_timestampUnix", "_objects"]
    sub = ocel.events.select(cols)

    ev_activity, ev_ts, ev_objs = {}, {}, {}
    obj_events: Dict[str, List[str]] = defaultdict(list)

    for row in sub.iter_rows(named=True):
        e = row["_eventId"]
        ev_activity[e] = row["_activity"]
        ev_ts[e] = int(row["_timestampUnix"]) if row["_timestampUnix"] is not None else 0
        objs = row["_objects"] or []
        ev_objs[e] = objs
        for o in objs:
            obj_events[o].append(e)

    all_events = list(ev_activity.keys())
    if not all_events:
        return Variants([])

    # -------------------------
    # STEP 1: executions via connected components (union–find)
    # -------------------------
    parent = {e: e for e in all_events}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for evs in obj_events.values():
        if len(evs) > 1:
            base = evs[0]
            for e in evs[1:]:
                union(base, e)

    comps: Dict[str, List[str]] = defaultdict(list)
    for e in all_events:
        comps[find(e)].append(e)

    executions: List[List[EventId]] = []
    for evs in comps.values():
        evs.sort(key=lambda x: (ev_ts[x], x))
        executions.append(evs)

    # -------------------------
    # STEP 2: build event graphs
    # -------------------------
    def build_exec_graph(evs: List[EventId]) -> nx.DiGraph:
        g = nx.DiGraph()
        for e in evs:
            g.add_node(e, activity=ev_activity[e])
        objs_in_exec: Dict[str, List[str]] = defaultdict(list)
        for e in evs:
            for o in ev_objs[e]:
                objs_in_exec[o].append(e)
        for o, o_events in objs_in_exec.items():
            if len(o_events) > 1:
                o_events.sort(key=lambda x: (ev_ts[x], x))
                for i in range(len(o_events) - 1):
                    g.add_edge(o_events[i], o_events[i + 1])
        return g

    exec_graphs = [build_exec_graph(evs) for evs in executions]

    # -------------------------
    # STEP 3: group by isomorphism
    # -------------------------
    rep_graphs, rep_ids = [], []
    variants_dict: Dict[VariantId, List[ExecIdx]] = defaultdict(list)

    def node_match(a, b) -> bool:
        return a.get("activity") == b.get("activity")

    for i, g in enumerate(exec_graphs):
        assigned = False
        for rep_idx, rep_g in enumerate(rep_graphs):
            if nx.is_isomorphic(rep_g, g, node_match=node_match):
                vid = rep_ids[rep_idx]
                variants_dict[vid].append(i)
                assigned = True
                break
        if not assigned:
            vid = f"V{len(rep_graphs) + 1:03d}"
            rep_graphs.append(g)
            rep_ids.append(vid)
            variants_dict[vid].append(i)

    # -------------------------
    # STEP 4: build Variants object
    # -------------------------
    variants: List[Variant] = []
    for vid in rep_ids:
        idxs = variants_dict[vid]
        exs = [executions[j] for j in idxs]
        graph = rep_graphs[rep_ids.index(vid)]
        v = Variant(vid, len(exs), exs, graph)
        variants.append(v)

    # Sort by support desc, then id
    variants.sort(key=lambda v: (-v.support, v.id))

    return Variants(variants)
