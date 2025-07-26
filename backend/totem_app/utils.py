from typing import Dict, Set, List
import networkx as nx

class Totem:
    def __init__(self):
        self.graph = nx.DiGraph()
        self.cardinality_types = ["0", "0..1", "1", "1..", "0.."]
        self.temporal_types = ["paral", "prec", "prec_inv", "dur", "dur_inv"]

    def add_object_type(self, obj_type: str) -> None:
        self.graph.add_node(obj_type)

    def add_relation(self, source: str, target: str,
                    log_cardinalities: Dict[str, float],
                    event_cardinalities: Dict[str, float],
                    temporal_relations: Dict[str, float]) -> None:
        # use additional attributes to store cardinalities and temporal relations
        self.graph.add_edge(source, target, 
                           log_cardinalities=log_cardinalities,
                           event_cardinalities=event_cardinalities,
                           temporal_relations=temporal_relations)