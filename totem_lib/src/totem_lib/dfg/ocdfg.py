import networkx as nx
from typing import List, Optional
from totem_lib import ObjectCentricEventLog as OCEL 
from . import CCDFG

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
