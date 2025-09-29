import polars as pl
import networkx as nx
from typing import Dict, List, Optional
from ocel import ObjectCentricEventLog as OCEL 

class CCDFG(nx.DiGraph):
    """
    Represents a Case-Centric Directly-Follows Graph for a single object type.
    Nodes are activities, and edges represent the directly-follows relation,
    weighted by frequency.
    """
    def __init__(self, obj_type: str, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.object_type = obj_type

    @classmethod
    def from_ocel(cls, ocel: OCEL, object_type: str, base_df: pl.DataFrame) -> 'CCDFG':
        """Factory method to build a CCDFG for a specific object type from an OCEL."""
        
        # 1. Get relevant object IDs using the new helper method
        obj_ids = ocel.get_object_ids_by_type(object_type)
        if not obj_ids:
            return cls(obj_type=object_type) # Return an empty graph

        per_type_df = base_df.filter(pl.col("_objId").is_in(obj_ids))
        if per_type_df.is_empty():
            return cls(obj_type=object_type)

        # 2. Compute directly-follows pairs and their weights
        pairs = (
            per_type_df
            .with_columns(pl.col("_activity").shift(-1).over("_objId").alias("_next"))
            .filter(pl.col("_next").is_not_null())
            .group_by(["_activity", "_next"])
            .agg(pl.len().alias("weight"))
        )

        # 3. Compute activity frequencies for node weights
        act_freq = per_type_df.group_by("_activity").agg(pl.len().alias("count"))
        
        # 4. Build the graph
        graph = cls(obj_type=object_type)
        for row in act_freq.iter_rows(named=True):
            graph.add_node(row["_activity"], label=row["_activity"], count=row["count"])

        for row in pairs.iter_rows(named=True):
            graph.add_edge(row["_activity"], row["_next"], weight=row["weight"])
            
        return graph

class OCDFG(nx.DiGraph):
    """
    Represents an Object-Centric Directly-Follows Graph, aggregating
    all case-centric DFGs from an OCEL.
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.graph['kind'] = 'ocdfg'

    def merge_graph(self, other_graph: nx.DiGraph, otype: str):
        """Merges nodes and edges from another graph (like a CCDFG)."""
        # Merge nodes
        for node, data in other_graph.nodes(data=True):
            if not self.has_node(node):
                self.add_node(node, label=data.get('label', node), types=set())
            self.nodes[node]['types'].add(otype)
        
        # Merge edges
        for u, v, data in other_graph.edges(data=True):
            w = data.get("weight", 1)
            if self.has_edge(u, v):
                self.edges[u, v]["weights"][otype] = self.edges[u, v]["weights"].get(otype, 0) + w
                self.edges[u, v]["weight"] += w
            else:
                self.add_edge(u, v, weights={otype: w}, weight=w, owners=set())
            self.edges[u, v]['owners'].add(otype)

    @classmethod
    def from_ocel(cls, ocel: OCEL, object_types: Optional[List[str]] = None) -> 'OCDFG':
        """Factory method to build the entire OCDFG from an OCEL."""
        
        # 1. Prepare a single, sorted base DataFrame from the ocel.events property
        base_df = (
            ocel.events
            .select(["_eventId", "_activity", "_timestampUnix", "_objects"])
            .explode("_objects")
            .rename({"_objects": "_objId"})
            .sort(["_objId", "_timestampUnix", "_eventId"])
        )

        # Use the ocel.object_types property if no specific types are given
        if object_types is None:
            object_types = ocel.object_types

        # 2. Build the aggregated graph
        graph = cls()
        for otype in sorted(object_types):
            ccdfg = CCDFG.from_ocel(ocel, otype, base_df)
            graph.merge_graph(ccdfg, otype)

        # 3. Finalize attributes for clean output (e.g., for JSON)
        for node in graph.nodes():
            graph.nodes[node]['types'] = sorted(list(graph.nodes[node].get('types', [])))
        for u, v in graph.edges():
            graph.edges[u, v]['owners'] = sorted(list(graph.edges[u, v].get('owners', [])))
            
        return graph