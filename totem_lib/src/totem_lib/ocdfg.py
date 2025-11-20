import polars as pl
import networkx as nx
from typing import Dict, List, Optional
from .ocel import ObjectCentricEventLog as OCEL 

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
        sequence = per_type_df.with_columns([
            pl.col("_activity").shift(1).over("_objId").alias("_prev"),
            pl.col("_activity").shift(-1).over("_objId").alias("_next"),
        ])

        pairs = (
            sequence
            .filter(pl.col("_next").is_not_null())
            .group_by(["_activity", "_next"])
            .agg(pl.len().alias("weight"))
        )

        # 3. Compute activity frequencies for node weights
        act_freq = sequence.group_by("_activity").agg(pl.len().alias("count"))

        # 4. Compute start and end activity frequencies
        starts = (
            sequence
            .filter(pl.col("_prev").is_null())
            .group_by("_activity")
            .agg(pl.len().alias("weight"))
        )
        ends = (
            sequence
            .filter(pl.col("_next").is_null())
            .group_by("_activity")
            .agg(pl.len().alias("weight"))
        )
        
        # 5. Build the graph
        graph = cls(obj_type=object_type)
        for row in act_freq.iter_rows(named=True):
            graph.add_node(row["_activity"], label=row["_activity"], count=row["count"])

        for row in pairs.iter_rows(named=True):
            graph.add_edge(row["_activity"], row["_next"], weight=row["weight"])

        # Add explicit start and end marker nodes and edges when available
        if not starts.is_empty():
            start_node_id = f"__start__:{object_type}"
            graph.add_node(
                start_node_id,
                label=f"{object_type} start",
                types={object_type},
                role="start",
                object_type=object_type,
            )
            for row in starts.iter_rows(named=True):
                target = row["_activity"]
                if graph.has_node(target):
                    graph.add_edge(
                        start_node_id,
                        target,
                        weight=row["weight"],
                        role="start",
                    )

        if not ends.is_empty():
            end_node_id = f"__end__:{object_type}"
            graph.add_node(
                end_node_id,
                label=f"{object_type} end",
                types={object_type},
                role="end",
                object_type=object_type,
            )
            for row in ends.iter_rows(named=True):
                source = row["_activity"]
                if graph.has_node(source):
                    graph.add_edge(
                        source,
                        end_node_id,
                        weight=row["weight"],
                        role="end",
                    )
            
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
            node_label = data.get('label', node)
            role = data.get('role')
            node_types = set(data.get('types', []))
            node_types.add(otype)
            object_type = data.get('object_type')

            if not self.has_node(node):
                self.add_node(
                    node,
                    label=node_label,
                    types=node_types,
                    role=role,
                    object_type=object_type,
                )
            else:
                self.nodes[node]['types'].update(node_types)
                if role and 'role' not in self.nodes[node]:
                    self.nodes[node]['role'] = role
                if object_type and 'object_type' not in self.nodes[node]:
                    self.nodes[node]['object_type'] = object_type
        
        # Merge edges
        for u, v, data in other_graph.edges(data=True):
            w = data.get("weight", 1)
            role = data.get('role')
            if self.has_edge(u, v):
                self.edges[u, v]["weights"][otype] = self.edges[u, v]["weights"].get(otype, 0) + w
                self.edges[u, v]["weight"] += w
                if role and 'role' not in self.edges[u, v]:
                    self.edges[u, v]['role'] = role
            else:
                edge_attributes = {
                    "weights": {otype: w},
                    "weight": w,
                    "owners": {otype},
                }
                if role:
                    edge_attributes["role"] = role
                self.add_edge(u, v, **edge_attributes)
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
