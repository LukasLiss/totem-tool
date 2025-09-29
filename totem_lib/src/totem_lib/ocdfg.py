from ocel import ObjectCentricEventLog as OCEL
# from ocel import import_ocel 

import polars as pl
import networkx as nx
from typing import Dict, List, Optional


class OCDFG(nx.DiGraph):
    
    def __init__(self):
        
        super().__init__()
        self.object_types = []
        self.node_coloring = {}
        self.edge_coloring = {}
    
    def add_variant(self, variant):
        pass
    
class CCDFG(nx.DiGraph):
    
    def __init__(self):
        
        super().__init__()
        self.object_type = None
    
    def add_variant(self, variant):
        pass


def build_case_centric_dfgs(
    ocel,                       
    object_types: Optional[List[str]] = None,
    weight_attr: str = "weight"
) -> Dict[str, nx.DiGraph]:
    """
    Return {obj_type -> nx.DiGraph} where nodes are activities and edges (A->B)
    count directly-follows within each object's ordered event sequence.
    Self-loops are kept. Edge attribute 'weight' holds the count.
    """

    # obj_type -> [obj_id]
    type_to_ids: Dict[str, List[str]] = {}
    for oid, otype in ocel.obj_type_map.items():
        type_to_ids.setdefault(otype, []).append(oid)

    # explode events to per-object rows, sort deterministically
    base = (
        ocel.events
        .select(["_eventId", "_activity", "_timestampUnix", "_objects"])
        .explode("_objects")
        .rename({"_objects": "_objId"})
        .sort(["_objId", "_timestampUnix", "_eventId"])
    )

    if object_types is None:
        object_types = sorted(type_to_ids.keys())

    out: Dict[str, nx.DiGraph] = {}

    for otype in object_types:
        obj_ids = type_to_ids.get(otype, [])
        if not obj_ids:
            out[otype] = nx.DiGraph(obj_type=otype)
            continue

        per_type = base.filter(pl.col("_objId").is_in(obj_ids))
        if per_type.is_empty():
            out[otype] = nx.DiGraph(obj_type=otype)
            continue

        # compute next activity per case (object id)
        pairs = (
            per_type
            .with_columns([
                pl.col("_activity").shift(-1).over("_objId").alias("_next"),
            ])
            .filter(pl.col("_next").is_not_null())
            .group_by(["_activity", "_next"])
            .agg(pl.len().alias(weight_attr))
            .sort([weight_attr, "_activity", "_next"], descending=[True, False, False])
        )

        # optional: activity frequency (for node weights)
        act_freq = (
            per_type
            .group_by("_activity")
            .agg(pl.len().alias("count"))
        )
        act_cnt = dict(zip(act_freq["_activity"].to_list(), act_freq["count"].to_list()))

        # build graph
        G = nx.DiGraph(obj_type=otype)
        for a, cnt in act_cnt.items():
            G.add_node(a, label=a, obj_type=otype, count=int(cnt))

        for a, b, w in pairs.iter_rows():
            a = str(a); b = str(b); w = int(w)
            if G.has_edge(a, b):
                G[a][b][weight_attr] += w
            else:
                G.add_edge(a, b, **{weight_attr: w}, obj_type=otype)

        out[otype] = G

    return out



def build_ocdfg(ocel) -> nx.DiGraph:
    """
    Object-Centric DFG:
      - Nodes = activities. node['types'] = set of object-types where the activity occurs.
      - Edges A->B exist if any object of some type has A directly followed by B.
        Edge attributes:
          owners  : sorted list of object types contributing this edge
          weights : {obj_type: count}
          weight  : total count across types
    """
    per_type = build_case_centric_dfgs(ocel)

    G = nx.DiGraph(kind="ocdfg")

    # merge nodes
    for otype, dfg in per_type.items():
        for a in dfg.nodes():
            if not G.has_node(a):
                G.add_node(a, label=a, types=set([otype]))
            else:
                G.nodes[a]["types"].add(otype)

    # merge edges
    for otype, dfg in per_type.items():
        for u, v, d in dfg.edges(data=True):
            w = int(d.get("weight", 1))
            if G.has_edge(u, v):
                G[u][v]["weights"][otype] = G[u][v]["weights"].get(otype, 0) + w
                G[u][v]["weight"] = G[u][v]["weight"] + w
                G[u][v]["owners"] = sorted(set(G[u][v]["owners"]) | {otype})
            else:
                G.add_edge(u, v,
                           owners=[otype],
                           weights={otype: w},
                           weight=w)

    # finalize: turn node type-sets into sorted lists for JSON-friendliness
    for n in G.nodes():
        G.nodes[n]["types"] = sorted(G.nodes[n].get("types", []))

    return G
