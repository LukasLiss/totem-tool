from typing import Dict, Set, List
import networkx as nx
from datetime import datetime
from pulp import *
import graphviz
import os
from pathlib import Path

TR_TOTAL = "total"
TR_DEPENDENT = "D"
TR_DEPENDENT_INVERSE = "Di"
TR_INITIATING = "I"
TR_INITIATING_REVERSE = "Ii"
TR_PARALLEL = "P"

# Event cardinality constants
EC_TOTAL = "total"
EC_ZERO = "0"
EC_ONE = "1"
EC_ZERO_ONE = "0...1"
EC_MANY = "1..*"
EC_ZERO_MANY = "0...*"

# Log cardinality constants
LC_TOTAL = "total"
LC_ZERO = "0"
LC_ONE = "1"
LC_ZERO_ONE = "0...1"
LC_MANY = "1..*"
LC_ZERO_MANY = "0...*"

DATEFORMAT = "%Y-%m-%d %H:%M:%S"

# For visualization
# map 'Dependent' to 'during' (box), 'Initiating' to 'precedes' (normal), and 'Parallel' to 'parallel' (teetee).
YOUR_TR_TO_EDGE_ARROWHEAD = {
    TR_DEPENDENT: "box",
    TR_DEPENDENT_INVERSE: "obox",
    TR_INITIATING: "normal",
    TR_INITIATING_REVERSE: "onormal",
    TR_PARALLEL: "teetee",
    None: "none",
}

# Constants used for styling in the visualize method
GV_FONT = "Helvetica"
GV_GRAPH_FONTSIZE = "10"
GV_NODE_FONTSIZE = "10"
GV_EDGE_FONTSIZE = "8"
TR_EDGE_ATTR = {"arrowtail": "none", "dir": "both", "decorate": "false"}


class Totem:
    """
    A class to represent the temporal graph and related information mined from an Object Centric Event Log using the totemDiscovery algorithm.
    """

    def __init__(
        self,
        tempgraph: Dict,
        cardinalities: Dict,
        type_relations: Set[Set[str]],
        all_event_types: Set[str],
        object_type_to_event_types: Dict[str, Set[str]],
    ):
        """
        Initialize the Totem object with the temporal graph and related information.
        :param tempgraph: A dictionary representing the temporal graph with nodes and edges categorized by temporal relations.
        :param type_relations: A set of sets representing all connected object type pairs.
        :param all_event_types: A set of all event types present in the Object Centric Event Log.
        :param object_type_to_event_types: A dictionary mapping each object type to the set of event types associated with it.
        """
        # Attributes output by totemDiscovery and used by mlpaDiscovery
        self.tempgraph = tempgraph
        self.cardinalities = cardinalities
        self.type_relations = type_relations
        self.all_event_types = all_event_types
        self.object_type_to_event_types = object_type_to_event_types

        # TODO: implement networkx representation

    #     self.graph = nx.DiGraph()
    #     self.cardinality_types = ["0", "0..1", "1", "1..", "0.."]
    #     self.temporal_types = ["paral", "prec", "prec_inv", "dur", "dur_inv"]

    # def add_object_type(self, obj_type: str) -> None:
    #     self.graph.add_node(obj_type)

    # def add_relation(self, source: str, target: str,
    #                 log_cardinalities: Dict[str, float],
    #                 event_cardinalities: Dict[str, float],
    #                 temporal_relations: Dict[str, float]) -> None:
    #     # use additional attributes to store cardinalities and temporal relations
    #     self.graph.add_edge(source, target,
    #                        log_cardinalities=log_cardinalities,
    #                        event_cardinalities=event_cardinalities,
    #                        temporal_relations=temporal_relations)

    def visualize(
        self, output_dir: Path, output_file: str, ot_to_hex_color: dict
    ) -> None:
        """
        Draws the discovered TOTeM model using graphviz.
        This method is adapted from the implementation by Löseke et al.

        Parameters:
        - output_dir (Path): Directory to save the output PDF.
        - output_file (str): Filename for the output PDF.
        - ot_to_hex_color (dict): A mapping of object types to their hex color codes.
        """
        # --- Corrected Data Transformation Step ---
        # 1. Extract nodes directly from the tempgraph
        nodes = self.tempgraph.get("nodes", set())

        # 2. Reconstruct the edges dictionary from your tempgraph structure
        edges = {}
        # Iterate over relation types ('P', 'I', 'D', etc.) in the tempgraph
        for relation_type, relation_set in self.tempgraph.items():
            if relation_type == "nodes":
                continue  # Skip the nodes entry
            # Iterate over each pair of object types for the current relation
            if isinstance(relation_set, set):
                for ot_a, ot_b in relation_set:
                    edges[(ot_a, ot_b)] = {"TR": relation_type}

        # --- Visualization Logic ---
        G = graphviz.Digraph(
            graph_attr={
                # 'label': f'Filter parameter: tau = {tau}',
                "fontname": GV_FONT,
                "fontsize": GV_GRAPH_FONTSIZE,
                "margin": "0.1,0.1",
                "overlap": "false",
                "rankdir": "LR",
            }
        )

        for ot in nodes:
            color = ot_to_hex_color.get(ot, "#000000")  # Default to black if not in map
            G.node(
                ot,
                label=ot,
                shape="box",
                fontname=GV_FONT,
                fontsize=GV_NODE_FONTSIZE,
                color=color,
            )

        for (ot_a, ot_b), edge_dict in edges.items():
            tr_relation = edge_dict.get("TR")
            # prepare label with cardinalities
            card_info = self.cardinalities.get((ot_a, ot_b), {})
            lc = card_info.get("LC", "")
            ec = card_info.get("EC", "")

            edge_label = f"{lc}\n({ec})"
            arrowhead_shape = YOUR_TR_TO_EDGE_ARROWHEAD.get(tr_relation, "none")

            G.edge(
                ot_a,
                ot_b,
                label=edge_label,
                fontname=GV_FONT,
                fontsize=GV_EDGE_FONTSIZE,
                arrowhead=arrowhead_shape,
                **TR_EDGE_ATTR,
            )

        os.makedirs(output_dir, exist_ok=True)
        temp_file_path = output_dir + "/tmp_graph"
        # TODO: handle exceptions if graphviz is not installed
        # TODO: handle bug when output_file is not a .pdf
        G.render(filename=str(temp_file_path), cleanup=True, format="pdf")
        os.replace(f"{temp_file_path}.pdf", output_dir + "/" + output_file)
        print(f"Graph successfully saved to {output_dir + '/' + output_file}")


# Help functions for OCEL2.0


def get_all_event_objects(ocel, event_id):
    # obj_ids = []
    # for obj_type in ocel.object_types:
    #     obj_ids += ocel.get_value(event_id, obj_type)
    # return obj_ids
    return ocel.get_value(event_id, "event_objects")


def get_most_precise_lc(directed_type_tuple, tau, log_cardinalities):
    total = 0
    if (
        directed_type_tuple in log_cardinalities.keys()
        and LC_TOTAL in log_cardinalities[directed_type_tuple].keys()
    ):
        total = log_cardinalities[directed_type_tuple][LC_TOTAL]

    if total == 0:
        return "ERROR 0"

    if (LC_ZERO in log_cardinalities[directed_type_tuple].keys()) and (
        (log_cardinalities[directed_type_tuple][LC_ZERO] / total) >= tau
    ):
        return LC_ZERO
    if (LC_ONE in log_cardinalities[directed_type_tuple].keys()) and (
        (log_cardinalities[directed_type_tuple][LC_ONE] / total) >= tau
    ):
        return LC_ONE
    if (LC_ZERO_ONE in log_cardinalities[directed_type_tuple].keys()) and (
        (log_cardinalities[directed_type_tuple][LC_ZERO_ONE] / total) >= tau
    ):
        return LC_ZERO_ONE
    if (LC_MANY in log_cardinalities[directed_type_tuple].keys()) and (
        (log_cardinalities[directed_type_tuple][LC_MANY] / total) >= tau
    ):
        return LC_MANY
    if (LC_ZERO_MANY in log_cardinalities[directed_type_tuple].keys()) and (
        (log_cardinalities[directed_type_tuple][LC_ZERO_MANY] / total) >= tau
    ):
        return LC_ZERO_MANY

    return "None"


def get_most_precise_ec(directed_type_tuple, tau, event_cardinalities):
    total = 0
    if (
        directed_type_tuple in event_cardinalities.keys()
        and EC_TOTAL in event_cardinalities[directed_type_tuple].keys()
    ):
        total = event_cardinalities[directed_type_tuple][EC_TOTAL]

    if total == 0:
        return "ERROR 0"

    if (EC_ZERO in event_cardinalities[directed_type_tuple].keys()) and (
        (event_cardinalities[directed_type_tuple][EC_ZERO] / total) >= tau
    ):
        return EC_ZERO
    if (EC_ONE in event_cardinalities[directed_type_tuple].keys()) and (
        (event_cardinalities[directed_type_tuple][EC_ONE] / total) >= tau
    ):
        return EC_ONE
    if (EC_ZERO_ONE in event_cardinalities[directed_type_tuple].keys()) and (
        (event_cardinalities[directed_type_tuple][EC_ZERO_ONE] / total) >= tau
    ):
        return EC_ZERO_ONE
    if (EC_MANY in event_cardinalities[directed_type_tuple].keys()) and (
        (event_cardinalities[directed_type_tuple][EC_MANY] / total) >= tau
    ):
        return EC_MANY
    if (EC_ZERO_MANY in event_cardinalities[directed_type_tuple].keys()) and (
        (event_cardinalities[directed_type_tuple][EC_ZERO_MANY] / total) >= tau
    ):
        return EC_ZERO_MANY

    return "None"


def get_most_precise_tr(directed_type_tuple, tau, temporal_relation):
    total = 0
    if (
        directed_type_tuple in temporal_relation.keys()
        and EC_TOTAL in temporal_relation[directed_type_tuple].keys()
    ):
        total = temporal_relation[directed_type_tuple][EC_TOTAL]

    if total == 0:
        return "ERROR 0"

    if (TR_DEPENDENT in temporal_relation[directed_type_tuple].keys()) and (
        (temporal_relation[directed_type_tuple][TR_DEPENDENT] / total) >= tau
    ):
        return TR_DEPENDENT
    if (TR_DEPENDENT_INVERSE in temporal_relation[directed_type_tuple].keys()) and (
        (temporal_relation[directed_type_tuple][TR_DEPENDENT_INVERSE] / total) >= tau
    ):
        return TR_DEPENDENT_INVERSE
    if (TR_INITIATING in temporal_relation[directed_type_tuple].keys()) and (
        (temporal_relation[directed_type_tuple][TR_INITIATING] / total) >= tau
    ):
        return TR_INITIATING
    if (TR_INITIATING_REVERSE in temporal_relation[directed_type_tuple].keys()) and (
        (temporal_relation[directed_type_tuple][TR_INITIATING_REVERSE] / total) >= tau
    ):
        return TR_INITIATING_REVERSE
    if (TR_PARALLEL in temporal_relation[directed_type_tuple].keys()) and (
        (temporal_relation[directed_type_tuple][TR_PARALLEL] / total) >= tau
    ):
        return TR_PARALLEL

    return "None"


def connected_components_undirected(used_nodes, edges):
    graph = {}
    for relation in edges:
        for node in relation:
            if node in used_nodes:  # Only add nodes that are in the types_of_level list
                if node not in graph:
                    graph[node] = set()
                for other in relation:
                    if other != node and other in used_nodes:
                        graph[node].add(other)

    # Step 2: DFS to find connected components
    def dfs(node, visited, component):
        # Adding node to visited set and current component list
        visited.add(node)
        component.append(node)
        for neighbor in graph.get(node, []):
            if neighbor not in visited:
                dfs(neighbor, visited, component)

    # Step 3: Find all connected components
    visited = set()
    connected_components = []

    for node in used_nodes:
        if node not in visited:
            component = []
            dfs(node, visited, component)
            connected_components.append(component)

    return connected_components


def totemDiscovery(ocel, tau=0.9):
    """
    Given an Object Centric Event Log, compute the temporal graph and related information.
    :param ocel: The Object Centric Event Log to analyze.
    :param tau: The threshold for determining strong relations (default is 0.9).
    :return: A Totem object containing the temporal graph and related information.
    """
    # object type to event type dict
    obj_typ_to_ev_type: dict[str, set[str]] = dict()
    all_event_types = set()

    # temporal relations results
    h_temporal_relations: dict[tuple[str, str], dict[str, int]] = (
        dict()
    )  # stores all the temporal relations found
    # event cardinality results
    h_event_cardinalities: dict[tuple[str, str], dict[str, int]] = (
        dict()
    )  # stores all the temporal cardinalities found
    # event cardinality results
    h_log_cardinalities: dict[tuple[str, str], dict[str, int]] = (
        dict()
    )  # stores all the temporal cardinalities found

    # object min times (omint_L(o))
    o_min_times: dict[str, datetime] = (
        dict()
    )  # str identifier of the object maps to the earliest time recorded for that object in the event log
    # object max times (omaxt_L(o))
    o_max_times: dict[str, datetime] = (
        dict()
    )  # str identifier of the object maps to the last time recorded for that object in the event log

    # get a list of all object types (or variable that is filled while passing through the process executions)
    type_relations: set[set[str, str]] = set()  # stores all connected types

    o2o_o2o: dict[str, dict[str, set[str]]] = (
        dict()
    )  # dict that describes which objects are connected to which types and for each type which object
    # o2o[obj1][type3] = [obj5, obj6]
    o2o_e2o: dict[str, dict[str, set[str]]] = dict()
    o2o: dict[str, dict[str, set[str]]] = dict()

    # a mapping from type to its objects
    type_to_object = dict()

    print(f"looping through events, start time: {datetime.now()}")
    for px in (
        ocel.process_executions
    ):  # TODO: for ev in all events instead of process_executions
        for ev in px:
            # print(f"Processing event {ev}")
            # event infos: objects and timestamps
            # ev_timestamp = datetime.strptime(str(ocel.get_value(ev, 'event_timestamp')), DATEFORMAT)  #TODO: just use unix timestamp?
            # ev_timestamp = ocel.get_value(ev, 'event_timestamp')  # use unix timestamp directly
            ev_timestamp = ocel.get_event_timestamp(ev)  # use unix timestamp directly

            objects_of_event = get_all_event_objects(ocel, ev)
            for obj in objects_of_event:
                # o2o updating
                o2o.setdefault(obj, dict())
                for type in ocel.object_types:
                    o2o[obj].setdefault(type, set())
                    o2o[obj][type].update(
                        # ocel.get_value(ev, type))  # add all objects connected via e2o to each object involved
                        ocel.get_event_objects_by_type(ev, type)
                    )  # add all objects connected via e2o to each object involved
                # update lifespan information
                o_min_times.setdefault(obj, ev_timestamp)
                if (
                    ev_timestamp < o_min_times[obj]
                ):  # todo check if comparison of datetimes works correctly here
                    o_min_times[obj] = ev_timestamp
                o_max_times.setdefault(obj, ev_timestamp)
                if (
                    ev_timestamp > o_max_times[obj]
                ):  # todo check if comparison of datetimes works correctly here
                    o_max_times[obj] = ev_timestamp

            # maintain object type to event type dictionary
            # eventtype = ocel.get_value(ev, 'event_activity')
            eventtype = ocel.get_event_activity(ev)
            all_event_types.add(eventtype)
            for type in ocel.object_types:
                # if len(ocel.get_value(ev, type)) > 0:
                if len(ocel.get_event_objects_by_type(ev, type)) > 0:
                    obj_typ_to_ev_type.setdefault(type, set())
                    obj_typ_to_ev_type[type].add(eventtype)

            # compute event cardinality
            involved_types = []
            obj_count_per_type = dict()
            for type in ocel.object_types:
                # obj_list = ocel.get_value(ev, type)
                obj_list = ocel.get_event_objects_by_type(ev, type)
                if not obj_list:
                    continue
                else:
                    type_to_object.setdefault(type, set())
                    type_to_object[type].update(obj_list)
                    involved_types.append(type)
                    obj_count_per_type[type] = len(obj_list)
            # created related types
            for t1 in involved_types:
                for t2 in involved_types:
                    if t1 != t2:
                        type_relations.add(frozenset({t1, t2}))
            # for all type pairs determine
            for type_source in involved_types:
                for type_target in ocel.object_types:
                    # add one to total
                    h_event_cardinalities.setdefault((type_source, type_target), dict())
                    h_event_cardinalities[(type_source, type_target)].setdefault(
                        EC_TOTAL, 0
                    )
                    h_event_cardinalities[(type_source, type_target)][EC_TOTAL] += 1
                    # determine cardinality
                    cardinality = 0
                    if type_target in obj_count_per_type.keys():
                        cardinality = obj_count_per_type[type_target]
                    # add one to matching cardinalities
                    if cardinality == 0:
                        h_event_cardinalities[(type_source, type_target)].setdefault(
                            EC_ZERO, 0
                        )
                        h_event_cardinalities[(type_source, type_target)][EC_ZERO] += 1
                        h_event_cardinalities[(type_source, type_target)].setdefault(
                            EC_ZERO_ONE, 0
                        )
                        h_event_cardinalities[(type_source, type_target)][
                            EC_ZERO_ONE
                        ] += 1
                        h_event_cardinalities[(type_source, type_target)].setdefault(
                            EC_ZERO_MANY, 0
                        )
                        h_event_cardinalities[(type_source, type_target)][
                            EC_ZERO_MANY
                        ] += 1
                    elif cardinality == 1:
                        h_event_cardinalities[(type_source, type_target)].setdefault(
                            EC_ONE, 0
                        )
                        h_event_cardinalities[(type_source, type_target)][EC_ONE] += 1
                        h_event_cardinalities[(type_source, type_target)].setdefault(
                            EC_ZERO_ONE, 0
                        )
                        h_event_cardinalities[(type_source, type_target)][
                            EC_ZERO_ONE
                        ] += 1
                        h_event_cardinalities[(type_source, type_target)].setdefault(
                            EC_MANY, 0
                        )
                        h_event_cardinalities[(type_source, type_target)][EC_MANY] += 1
                        h_event_cardinalities[(type_source, type_target)].setdefault(
                            EC_ZERO_MANY, 0
                        )
                        h_event_cardinalities[(type_source, type_target)][
                            EC_ZERO_MANY
                        ] += 1
                    elif cardinality > 1:
                        h_event_cardinalities[(type_source, type_target)].setdefault(
                            EC_MANY, 0
                        )
                        h_event_cardinalities[(type_source, type_target)][EC_MANY] += 1
                        h_event_cardinalities[(type_source, type_target)].setdefault(
                            EC_ZERO_MANY, 0
                        )
                        h_event_cardinalities[(type_source, type_target)][
                            EC_ZERO_MANY
                        ] += 1

    # merge o2o and e2o connected objects (make symmetric)
    print(f"mergeing o2o and e2o, start time: {datetime.now()}")
    for source_o, target_o in ocel.o2o_graph_edges:
        # Find types of both objects
        type_of_source_o = None
        type_of_target_o = None
        for obj_type in ocel.object_types:
            if obj_type in type_to_object:
                if source_o in type_to_object[obj_type]:
                    type_of_source_o = obj_type
                if target_o in type_to_object[obj_type]:
                    type_of_target_o = obj_type

        # Add source -> target direction
        if type_of_target_o is not None:
            o2o.setdefault(source_o, dict())
            o2o[source_o].setdefault(type_of_target_o, set())
            o2o[source_o][type_of_target_o].add(target_o)

        # Add target -> source direction (make symmetric)
        if type_of_source_o is not None:
            o2o.setdefault(target_o, dict())
            o2o[target_o].setdefault(type_of_source_o, set())
            o2o[target_o][type_of_source_o].add(source_o)

    # compute log cardinality and temporal relations
    print(f"computing log cardinalities, start time: {datetime.now()}")
    for type_source in ocel.object_types:
        for type_target in ocel.object_types:
            h_temporal_relations.setdefault((type_source, type_target), dict())
            for obj in type_to_object[type_source]:
                h_log_cardinalities.setdefault((type_source, type_target), dict())
                h_log_cardinalities[(type_source, type_target)].setdefault(LC_TOTAL, 0)
                h_log_cardinalities[(type_source, type_target)][LC_TOTAL] += 1

                cardinality = len(o2o[obj][type_target])
                # if type_source == 'products':
                #    print(f"Obj: {obj} Typ: {type_target} Card: {cardinality}")

                if cardinality == 0:
                    h_log_cardinalities[(type_source, type_target)].setdefault(
                        LC_ZERO, 0
                    )
                    h_log_cardinalities[(type_source, type_target)][LC_ZERO] += 1
                    h_log_cardinalities[(type_source, type_target)].setdefault(
                        LC_ZERO_ONE, 0
                    )
                    h_log_cardinalities[(type_source, type_target)][LC_ZERO_ONE] += 1
                    h_log_cardinalities[(type_source, type_target)].setdefault(
                        LC_ZERO_MANY, 0
                    )
                    h_log_cardinalities[(type_source, type_target)][LC_ZERO_MANY] += 1
                elif cardinality == 1:
                    h_log_cardinalities[(type_source, type_target)].setdefault(
                        LC_ONE, 0
                    )
                    h_log_cardinalities[(type_source, type_target)][LC_ONE] += 1
                    h_log_cardinalities[(type_source, type_target)].setdefault(
                        LC_ZERO_ONE, 0
                    )
                    h_log_cardinalities[(type_source, type_target)][LC_ZERO_ONE] += 1
                    h_log_cardinalities[(type_source, type_target)].setdefault(
                        LC_MANY, 0
                    )
                    h_log_cardinalities[(type_source, type_target)][LC_MANY] += 1
                    h_log_cardinalities[(type_source, type_target)].setdefault(
                        LC_ZERO_MANY, 0
                    )
                    h_log_cardinalities[(type_source, type_target)][LC_ZERO_MANY] += 1
                elif cardinality > 1:
                    h_log_cardinalities[(type_source, type_target)].setdefault(
                        LC_MANY, 0
                    )
                    h_log_cardinalities[(type_source, type_target)][LC_MANY] += 1
                    h_log_cardinalities[(type_source, type_target)].setdefault(
                        LC_ZERO_MANY, 0
                    )
                    h_log_cardinalities[(type_source, type_target)][LC_ZERO_MANY] += 1

                # compute temporal relations
                for obj_target in o2o[obj][type_target]:
                    h_temporal_relations[(type_source, type_target)].setdefault(
                        TR_TOTAL, 0
                    )
                    h_temporal_relations[(type_source, type_target)][TR_TOTAL] += 1
                    if (
                        o_min_times[obj_target]
                        <= o_min_times[obj]
                        <= o_max_times[obj]
                        <= o_max_times[obj_target]
                    ):
                        h_temporal_relations[(type_source, type_target)].setdefault(
                            TR_DEPENDENT, 0
                        )
                        h_temporal_relations[(type_source, type_target)][
                            TR_DEPENDENT
                        ] += 1
                    if (
                        o_min_times[obj]
                        <= o_min_times[obj_target]
                        <= o_max_times[obj_target]
                        <= o_max_times[obj]
                    ):
                        h_temporal_relations[(type_source, type_target)].setdefault(
                            TR_DEPENDENT_INVERSE, 0
                        )
                        h_temporal_relations[(type_source, type_target)][
                            TR_DEPENDENT_INVERSE
                        ] += 1
                    if (
                        o_min_times[obj]
                        <= o_max_times[obj]
                        <= o_min_times[obj_target]
                        <= o_max_times[obj_target]
                    ) or (
                        o_min_times[obj]
                        < o_min_times[obj_target]
                        <= o_max_times[obj]
                        < o_max_times[obj_target]
                    ):
                        h_temporal_relations[(type_source, type_target)].setdefault(
                            TR_INITIATING, 0
                        )
                        h_temporal_relations[(type_source, type_target)][
                            TR_INITIATING
                        ] += 1
                    if (
                        o_min_times[obj_target]
                        <= o_max_times[obj_target]
                        <= o_min_times[obj]
                        <= o_max_times[obj]
                    ) or (
                        o_min_times[obj_target]
                        < o_min_times[obj]
                        <= o_max_times[obj_target]
                        < o_max_times[obj]
                    ):
                        h_temporal_relations[(type_source, type_target)].setdefault(
                            TR_INITIATING_REVERSE, 0
                        )
                        h_temporal_relations[(type_source, type_target)][
                            TR_INITIATING_REVERSE
                        ] += 1
                    # allways parallel
                    h_temporal_relations[(type_source, type_target)].setdefault(
                        TR_PARALLEL, 0
                    )
                    h_temporal_relations[(type_source, type_target)][TR_PARALLEL] += 1

    # setup temporal graph
    print(f"building the temporal graph, start time: {datetime.now()}")
    tempgraph = {
        "nodes": set(),
        TR_PARALLEL: set(),
        TR_INITIATING: set(),
        TR_DEPENDENT: set(),
    }

    cardinalities = {}

    # for each connection give the 6 relations
    for connected_types in type_relations:
        t1, t2 = connected_types
        tempgraph["nodes"].add(t1)
        tempgraph["nodes"].add(t2)
        print(f"{t1} -> {t2}")

        # get log cardinality
        lc = get_most_precise_lc((t1, t2), tau, h_log_cardinalities)
        lc_i = get_most_precise_lc((t2, t1), tau, h_log_cardinalities)
        print(f"LC: {lc_i} - {lc}")
        # get event cardinality
        ec = get_most_precise_ec((t1, t2), tau, h_event_cardinalities)
        ec_i = get_most_precise_ec((t2, t1), tau, h_event_cardinalities)
        print(f"EC: {ec_i} - {ec}")
        # get temporal relation
        tr = get_most_precise_tr((t1, t2), tau, h_temporal_relations)
        tr_i = get_most_precise_tr((t2, t1), tau, h_temporal_relations)
        print(f"TR: {tr}")
        # add relation to tempgraph
        if tr == TR_DEPENDENT_INVERSE or tr == TR_INITIATING_REVERSE:
            tempgraph[tr_i].add((t2, t1))
        else:
            tempgraph[tr].add((t1, t2))
        # print(f"TRi: {tr_i}")
        print("")

        cardinalities[(t1, t2)] = {"LC": lc, "EC": ec}
        cardinalities[(t2, t1)] = {"LC": lc_i, "EC": ec_i}

    print(f"Finished building the temporal graph, end time: {datetime.now()}")
    totem = Totem(
        tempgraph, cardinalities, type_relations, all_event_types, obj_typ_to_ev_type
    )
    return totem


# Helper functions for conformance checking - precision hierarchy

def get_more_precise_tr(relation):
    """Returns list of more precise temporal relations for precision calculation."""
    if relation == TR_PARALLEL:
        return [TR_DEPENDENT, TR_DEPENDENT_INVERSE, TR_INITIATING, TR_INITIATING_REVERSE]
    elif relation in [TR_INITIATING, TR_INITIATING_REVERSE]:
        return [TR_DEPENDENT, TR_DEPENDENT_INVERSE]
    else:  # TR_DEPENDENT, TR_DEPENDENT_INVERSE - most precise
        return []


def get_more_precise_lc(relation):
    """Returns list of more precise log cardinalities for precision calculation."""
    if relation == LC_ZERO_MANY:
        return [LC_ZERO, LC_ONE, LC_ZERO_ONE, LC_MANY]
    elif relation == LC_ZERO_ONE:
        return [LC_ZERO, LC_ONE]
    elif relation == LC_MANY:
        return [LC_ONE]
    else:  # LC_ZERO, LC_ONE - most precise
        return []


def get_more_precise_ec(relation):
    """Returns list of more precise event cardinalities for precision calculation."""
    if relation == EC_ZERO_MANY:
        return [EC_ZERO, EC_ONE, EC_ZERO_ONE, EC_MANY]
    elif relation == EC_ZERO_ONE:
        return [EC_ZERO, EC_ONE]
    elif relation == EC_MANY:
        return [EC_ONE]
    else:  # EC_ZERO, EC_ONE - most precise
        return []


def compute_histograms(ocel):
    """
    Compute the histograms for temporal relations, event cardinalities, and log cardinalities.
    This is extracted from totemDiscovery to be reusable for conformance checking.

    :param ocel: The Object Centric Event Log to analyze.
    :return: Dictionary containing all histograms (aggregate and fine-grained).
    """
    # temporal relations results
    h_temporal_relations: dict[tuple[str, str], dict[str, int]] = dict()
    # event cardinality results
    h_event_cardinalities: dict[tuple[str, str], dict[str, int]] = dict()
    # log cardinality results
    h_log_cardinalities: dict[tuple[str, str], dict[str, int]] = dict()

    # Fine-grained histograms
    # Event cardinality by activity: (source_type, target_type, activity) -> counts
    h_event_cardinalities_by_activity: dict[tuple[str, str, str], dict[str, int]] = dict()
    # Temporal relations by relation type: (source_type, target_type, relation_type) -> counts
    h_temporal_relations_by_reltype: dict[tuple[str, str, str], dict[str, int]] = dict()
    # Log cardinality by relation type: (source_type, target_type, relation_type) -> counts
    h_log_cardinalities_by_reltype: dict[tuple[str, str, str], dict[str, int]] = dict()

    # object min times (omint_L(o))
    o_min_times: dict[str, datetime] = dict()
    # object max times (omaxt_L(o))
    o_max_times: dict[str, datetime] = dict()

    # o2o relations
    o2o: dict[str, dict[str, set[str]]] = dict()

    # Track relation type for each (source_obj, target_obj) pair
    # Value is either "e2o" (event-based) or the o2o qualifier
    o2o_relation_type: dict[tuple[str, str], str] = dict()

    # a mapping from type to its objects
    type_to_object = dict()

    # Loop through events
    for px in ocel.process_executions:
        for ev in px:
            ev_timestamp = ocel.get_event_timestamp(ev)
            ev_activity = ocel.get_event_activity(ev)
            objects_of_event = get_all_event_objects(ocel, ev)

            for obj in objects_of_event:
                # o2o updating
                o2o.setdefault(obj, dict())
                for type in ocel.object_types:
                    o2o[obj].setdefault(type, set())
                    o2o[obj][type].update(ocel.get_event_objects_by_type(ev, type))

                # Mark e2o relations (objects related via shared events)
                for other_obj in objects_of_event:
                    if obj != other_obj:
                        # Only set if not already set by o2o qualifier
                        if (obj, other_obj) not in o2o_relation_type:
                            o2o_relation_type[(obj, other_obj)] = "e2o"

                # update lifespan information
                o_min_times.setdefault(obj, ev_timestamp)
                if ev_timestamp < o_min_times[obj]:
                    o_min_times[obj] = ev_timestamp
                o_max_times.setdefault(obj, ev_timestamp)
                if ev_timestamp > o_max_times[obj]:
                    o_max_times[obj] = ev_timestamp

            # compute event cardinality
            involved_types = []
            obj_count_per_type = dict()
            for type in ocel.object_types:
                obj_list = ocel.get_event_objects_by_type(ev, type)
                if not obj_list:
                    continue
                else:
                    type_to_object.setdefault(type, set())
                    type_to_object[type].update(obj_list)
                    involved_types.append(type)
                    obj_count_per_type[type] = len(obj_list)

            # for all type pairs determine event cardinality
            for type_source in involved_types:
                for type_target in ocel.object_types:
                    # Aggregate event cardinality
                    h_event_cardinalities.setdefault((type_source, type_target), dict())
                    h_event_cardinalities[(type_source, type_target)].setdefault(EC_TOTAL, 0)
                    h_event_cardinalities[(type_source, type_target)][EC_TOTAL] += 1

                    # Event cardinality by activity
                    key_by_activity = (type_source, type_target, ev_activity)
                    h_event_cardinalities_by_activity.setdefault(key_by_activity, dict())
                    h_event_cardinalities_by_activity[key_by_activity].setdefault(EC_TOTAL, 0)
                    h_event_cardinalities_by_activity[key_by_activity][EC_TOTAL] += 1

                    cardinality = obj_count_per_type.get(type_target, 0)

                    if cardinality == 0:
                        h_event_cardinalities[(type_source, type_target)].setdefault(EC_ZERO, 0)
                        h_event_cardinalities[(type_source, type_target)][EC_ZERO] += 1
                        h_event_cardinalities[(type_source, type_target)].setdefault(EC_ZERO_ONE, 0)
                        h_event_cardinalities[(type_source, type_target)][EC_ZERO_ONE] += 1
                        h_event_cardinalities[(type_source, type_target)].setdefault(EC_ZERO_MANY, 0)
                        h_event_cardinalities[(type_source, type_target)][EC_ZERO_MANY] += 1
                        # By activity
                        h_event_cardinalities_by_activity[key_by_activity].setdefault(EC_ZERO, 0)
                        h_event_cardinalities_by_activity[key_by_activity][EC_ZERO] += 1
                        h_event_cardinalities_by_activity[key_by_activity].setdefault(EC_ZERO_ONE, 0)
                        h_event_cardinalities_by_activity[key_by_activity][EC_ZERO_ONE] += 1
                        h_event_cardinalities_by_activity[key_by_activity].setdefault(EC_ZERO_MANY, 0)
                        h_event_cardinalities_by_activity[key_by_activity][EC_ZERO_MANY] += 1
                    elif cardinality == 1:
                        h_event_cardinalities[(type_source, type_target)].setdefault(EC_ONE, 0)
                        h_event_cardinalities[(type_source, type_target)][EC_ONE] += 1
                        h_event_cardinalities[(type_source, type_target)].setdefault(EC_ZERO_ONE, 0)
                        h_event_cardinalities[(type_source, type_target)][EC_ZERO_ONE] += 1
                        h_event_cardinalities[(type_source, type_target)].setdefault(EC_MANY, 0)
                        h_event_cardinalities[(type_source, type_target)][EC_MANY] += 1
                        h_event_cardinalities[(type_source, type_target)].setdefault(EC_ZERO_MANY, 0)
                        h_event_cardinalities[(type_source, type_target)][EC_ZERO_MANY] += 1
                        # By activity
                        h_event_cardinalities_by_activity[key_by_activity].setdefault(EC_ONE, 0)
                        h_event_cardinalities_by_activity[key_by_activity][EC_ONE] += 1
                        h_event_cardinalities_by_activity[key_by_activity].setdefault(EC_ZERO_ONE, 0)
                        h_event_cardinalities_by_activity[key_by_activity][EC_ZERO_ONE] += 1
                        h_event_cardinalities_by_activity[key_by_activity].setdefault(EC_MANY, 0)
                        h_event_cardinalities_by_activity[key_by_activity][EC_MANY] += 1
                        h_event_cardinalities_by_activity[key_by_activity].setdefault(EC_ZERO_MANY, 0)
                        h_event_cardinalities_by_activity[key_by_activity][EC_ZERO_MANY] += 1
                    elif cardinality > 1:
                        h_event_cardinalities[(type_source, type_target)].setdefault(EC_MANY, 0)
                        h_event_cardinalities[(type_source, type_target)][EC_MANY] += 1
                        h_event_cardinalities[(type_source, type_target)].setdefault(EC_ZERO_MANY, 0)
                        h_event_cardinalities[(type_source, type_target)][EC_ZERO_MANY] += 1
                        # By activity
                        h_event_cardinalities_by_activity[key_by_activity].setdefault(EC_MANY, 0)
                        h_event_cardinalities_by_activity[key_by_activity][EC_MANY] += 1
                        h_event_cardinalities_by_activity[key_by_activity].setdefault(EC_ZERO_MANY, 0)
                        h_event_cardinalities_by_activity[key_by_activity][EC_ZERO_MANY] += 1

    # merge o2o and e2o connected objects (make symmetric)
    # Use o2o_graph_edges_with_qualifiers to get the relation type
    for source_o, target_o, qualifier in ocel.o2o_graph_edges_with_qualifiers:
        # Find types of both objects
        type_of_source_o = None
        type_of_target_o = None
        for obj_type in ocel.object_types:
            if obj_type in type_to_object:
                if source_o in type_to_object[obj_type]:
                    type_of_source_o = obj_type
                if target_o in type_to_object[obj_type]:
                    type_of_target_o = obj_type

        # Track the relation type (qualifier) for this object pair
        # This overwrites any e2o relation type set earlier
        o2o_relation_type[(source_o, target_o)] = qualifier
        o2o_relation_type[(target_o, source_o)] = qualifier  # symmetric

        # Add source -> target direction
        if type_of_target_o is not None:
            o2o.setdefault(source_o, dict())
            o2o[source_o].setdefault(type_of_target_o, set())
            o2o[source_o][type_of_target_o].add(target_o)

        # Add target -> source direction (make symmetric)
        if type_of_source_o is not None:
            o2o.setdefault(target_o, dict())
            o2o[target_o].setdefault(type_of_source_o, set())
            o2o[target_o][type_of_source_o].add(source_o)

    # compute log cardinality and temporal relations
    for type_source in ocel.object_types:
        if type_source not in type_to_object:
            continue
        for type_target in ocel.object_types:
            h_temporal_relations.setdefault((type_source, type_target), dict())
            for obj in type_to_object[type_source]:
                # Aggregate log cardinality
                h_log_cardinalities.setdefault((type_source, type_target), dict())
                h_log_cardinalities[(type_source, type_target)].setdefault(LC_TOTAL, 0)
                h_log_cardinalities[(type_source, type_target)][LC_TOTAL] += 1

                cardinality = len(o2o[obj][type_target]) if obj in o2o and type_target in o2o[obj] else 0

                if cardinality == 0:
                    h_log_cardinalities[(type_source, type_target)].setdefault(LC_ZERO, 0)
                    h_log_cardinalities[(type_source, type_target)][LC_ZERO] += 1
                    h_log_cardinalities[(type_source, type_target)].setdefault(LC_ZERO_ONE, 0)
                    h_log_cardinalities[(type_source, type_target)][LC_ZERO_ONE] += 1
                    h_log_cardinalities[(type_source, type_target)].setdefault(LC_ZERO_MANY, 0)
                    h_log_cardinalities[(type_source, type_target)][LC_ZERO_MANY] += 1
                elif cardinality == 1:
                    h_log_cardinalities[(type_source, type_target)].setdefault(LC_ONE, 0)
                    h_log_cardinalities[(type_source, type_target)][LC_ONE] += 1
                    h_log_cardinalities[(type_source, type_target)].setdefault(LC_ZERO_ONE, 0)
                    h_log_cardinalities[(type_source, type_target)][LC_ZERO_ONE] += 1
                    h_log_cardinalities[(type_source, type_target)].setdefault(LC_MANY, 0)
                    h_log_cardinalities[(type_source, type_target)][LC_MANY] += 1
                    h_log_cardinalities[(type_source, type_target)].setdefault(LC_ZERO_MANY, 0)
                    h_log_cardinalities[(type_source, type_target)][LC_ZERO_MANY] += 1
                elif cardinality > 1:
                    h_log_cardinalities[(type_source, type_target)].setdefault(LC_MANY, 0)
                    h_log_cardinalities[(type_source, type_target)][LC_MANY] += 1
                    h_log_cardinalities[(type_source, type_target)].setdefault(LC_ZERO_MANY, 0)
                    h_log_cardinalities[(type_source, type_target)][LC_ZERO_MANY] += 1

                # Log cardinality by relation type
                # Group targets by their relation type
                if obj in o2o and type_target in o2o[obj]:
                    targets_by_reltype: dict[str, set[str]] = dict()
                    for obj_target in o2o[obj][type_target]:
                        rel_type = o2o_relation_type.get((obj, obj_target), "e2o")
                        targets_by_reltype.setdefault(rel_type, set()).add(obj_target)

                    # Track log cardinality for each relation type
                    for rel_type, targets in targets_by_reltype.items():
                        key_by_reltype = (type_source, type_target, rel_type)
                        h_log_cardinalities_by_reltype.setdefault(key_by_reltype, dict())
                        h_log_cardinalities_by_reltype[key_by_reltype].setdefault(LC_TOTAL, 0)
                        h_log_cardinalities_by_reltype[key_by_reltype][LC_TOTAL] += 1

                        rel_cardinality = len(targets)
                        if rel_cardinality == 0:
                            h_log_cardinalities_by_reltype[key_by_reltype].setdefault(LC_ZERO, 0)
                            h_log_cardinalities_by_reltype[key_by_reltype][LC_ZERO] += 1
                            h_log_cardinalities_by_reltype[key_by_reltype].setdefault(LC_ZERO_ONE, 0)
                            h_log_cardinalities_by_reltype[key_by_reltype][LC_ZERO_ONE] += 1
                            h_log_cardinalities_by_reltype[key_by_reltype].setdefault(LC_ZERO_MANY, 0)
                            h_log_cardinalities_by_reltype[key_by_reltype][LC_ZERO_MANY] += 1
                        elif rel_cardinality == 1:
                            h_log_cardinalities_by_reltype[key_by_reltype].setdefault(LC_ONE, 0)
                            h_log_cardinalities_by_reltype[key_by_reltype][LC_ONE] += 1
                            h_log_cardinalities_by_reltype[key_by_reltype].setdefault(LC_ZERO_ONE, 0)
                            h_log_cardinalities_by_reltype[key_by_reltype][LC_ZERO_ONE] += 1
                            h_log_cardinalities_by_reltype[key_by_reltype].setdefault(LC_MANY, 0)
                            h_log_cardinalities_by_reltype[key_by_reltype][LC_MANY] += 1
                            h_log_cardinalities_by_reltype[key_by_reltype].setdefault(LC_ZERO_MANY, 0)
                            h_log_cardinalities_by_reltype[key_by_reltype][LC_ZERO_MANY] += 1
                        elif rel_cardinality > 1:
                            h_log_cardinalities_by_reltype[key_by_reltype].setdefault(LC_MANY, 0)
                            h_log_cardinalities_by_reltype[key_by_reltype][LC_MANY] += 1
                            h_log_cardinalities_by_reltype[key_by_reltype].setdefault(LC_ZERO_MANY, 0)
                            h_log_cardinalities_by_reltype[key_by_reltype][LC_ZERO_MANY] += 1

                # compute temporal relations
                if obj in o2o and type_target in o2o[obj]:
                    for obj_target in o2o[obj][type_target]:
                        if obj_target not in o_min_times or obj_target not in o_max_times:
                            continue
                        if obj not in o_min_times or obj not in o_max_times:
                            continue

                        # Get relation type for this object pair
                        rel_type = o2o_relation_type.get((obj, obj_target), "e2o")
                        key_by_reltype = (type_source, type_target, rel_type)

                        # Aggregate temporal relations
                        h_temporal_relations[(type_source, type_target)].setdefault(TR_TOTAL, 0)
                        h_temporal_relations[(type_source, type_target)][TR_TOTAL] += 1

                        # Temporal relations by relation type
                        h_temporal_relations_by_reltype.setdefault(key_by_reltype, dict())
                        h_temporal_relations_by_reltype[key_by_reltype].setdefault(TR_TOTAL, 0)
                        h_temporal_relations_by_reltype[key_by_reltype][TR_TOTAL] += 1

                        # TR_DEPENDENT: obj's lifespan is within obj_target's lifespan
                        if (o_min_times[obj_target] <= o_min_times[obj] <= o_max_times[obj] <= o_max_times[obj_target]):
                            h_temporal_relations[(type_source, type_target)].setdefault(TR_DEPENDENT, 0)
                            h_temporal_relations[(type_source, type_target)][TR_DEPENDENT] += 1
                            h_temporal_relations_by_reltype[key_by_reltype].setdefault(TR_DEPENDENT, 0)
                            h_temporal_relations_by_reltype[key_by_reltype][TR_DEPENDENT] += 1

                        # TR_DEPENDENT_INVERSE: obj_target's lifespan is within obj's lifespan
                        if (o_min_times[obj] <= o_min_times[obj_target] <= o_max_times[obj_target] <= o_max_times[obj]):
                            h_temporal_relations[(type_source, type_target)].setdefault(TR_DEPENDENT_INVERSE, 0)
                            h_temporal_relations[(type_source, type_target)][TR_DEPENDENT_INVERSE] += 1
                            h_temporal_relations_by_reltype[key_by_reltype].setdefault(TR_DEPENDENT_INVERSE, 0)
                            h_temporal_relations_by_reltype[key_by_reltype][TR_DEPENDENT_INVERSE] += 1

                        # TR_INITIATING: obj precedes or starts before obj_target
                        if ((o_min_times[obj] <= o_max_times[obj] <= o_min_times[obj_target] <= o_max_times[obj_target]) or
                            (o_min_times[obj] < o_min_times[obj_target] <= o_max_times[obj] < o_max_times[obj_target])):
                            h_temporal_relations[(type_source, type_target)].setdefault(TR_INITIATING, 0)
                            h_temporal_relations[(type_source, type_target)][TR_INITIATING] += 1
                            h_temporal_relations_by_reltype[key_by_reltype].setdefault(TR_INITIATING, 0)
                            h_temporal_relations_by_reltype[key_by_reltype][TR_INITIATING] += 1

                        # TR_INITIATING_REVERSE: obj_target precedes or starts before obj
                        if ((o_min_times[obj_target] <= o_max_times[obj_target] <= o_min_times[obj] <= o_max_times[obj]) or
                            (o_min_times[obj_target] < o_min_times[obj] <= o_max_times[obj_target] < o_max_times[obj])):
                            h_temporal_relations[(type_source, type_target)].setdefault(TR_INITIATING_REVERSE, 0)
                            h_temporal_relations[(type_source, type_target)][TR_INITIATING_REVERSE] += 1
                            h_temporal_relations_by_reltype[key_by_reltype].setdefault(TR_INITIATING_REVERSE, 0)
                            h_temporal_relations_by_reltype[key_by_reltype][TR_INITIATING_REVERSE] += 1

                        # TR_PARALLEL: always counted
                        h_temporal_relations[(type_source, type_target)].setdefault(TR_PARALLEL, 0)
                        h_temporal_relations[(type_source, type_target)][TR_PARALLEL] += 1
                        h_temporal_relations_by_reltype[key_by_reltype].setdefault(TR_PARALLEL, 0)
                        h_temporal_relations_by_reltype[key_by_reltype][TR_PARALLEL] += 1

    return {
        "temporal": h_temporal_relations,
        "event_cardinality": h_event_cardinalities,
        "log_cardinality": h_log_cardinalities,
        "event_cardinality_by_activity": h_event_cardinalities_by_activity,
        "temporal_by_relation_type": h_temporal_relations_by_reltype,
        "log_cardinality_by_relation_type": h_log_cardinalities_by_reltype,
    }


def conformance_of_totem(totem, ocel):
    """
    Compute conformance metrics (fitness and precision) for a TOTeM model against an OCEL log.

    :param totem: The Totem object containing the model to check conformance against.
    :param ocel: The Object Centric Event Log to analyze.
    :return: A dictionary containing fitness and precision values at multiple levels.
    """
    print(f"Starting conformance checking, start time: {datetime.now()}")

    # Step 1: Compute histograms from the log
    print(f"Computing histograms, start time: {datetime.now()}")
    histograms = compute_histograms(ocel)
    h_temporal_relations = histograms["temporal"]
    h_event_cardinalities = histograms["event_cardinality"]
    h_log_cardinalities = histograms["log_cardinality"]

    # Step 2: Build model relation mappings from the Totem object
    model_tr = {}  # (t1, t2) -> temporal relation
    for t1, t2 in totem.tempgraph.get(TR_DEPENDENT, set()):
        model_tr[(t1, t2)] = TR_DEPENDENT
    for t1, t2 in totem.tempgraph.get(TR_INITIATING, set()):
        model_tr[(t1, t2)] = TR_INITIATING
    for t1, t2 in totem.tempgraph.get(TR_PARALLEL, set()):
        model_tr[(t1, t2)] = TR_PARALLEL

    # Step 3: Compute per-pair metrics
    print(f"Computing per-pair metrics, start time: {datetime.now()}")
    type_pair_metrics = {}

    # Track metrics for overall aggregation
    overall_tr_occurrences = 0
    overall_tr_total = 0
    overall_tr_more_precise_max = 0

    overall_lc_occurrences = 0
    overall_lc_total = 0
    overall_lc_more_precise_max = 0

    overall_ec_occurrences = 0
    overall_ec_total = 0
    overall_ec_more_precise_max = 0

    # Process each directed type pair in the model's cardinalities
    for (t1, t2) in totem.cardinalities.keys():
        type_pair_metrics[(t1, t2)] = {}

        # --- Temporal Relation Metrics ---
        # Find the model's temporal relation for this pair
        tr_model = model_tr.get((t1, t2))
        if tr_model is None:
            # Check if the reverse direction has a relation
            tr_reverse = model_tr.get((t2, t1))
            if tr_reverse == TR_DEPENDENT:
                tr_model = TR_DEPENDENT_INVERSE
            elif tr_reverse == TR_INITIATING:
                tr_model = TR_INITIATING_REVERSE
            elif tr_reverse == TR_PARALLEL:
                tr_model = TR_PARALLEL

        tr_metrics = {"model_relation": tr_model, "fitness": None, "precision": None}

        if (t1, t2) in h_temporal_relations and tr_model is not None:
            tr_hist = h_temporal_relations[(t1, t2)]
            tr_total = tr_hist.get(TR_TOTAL, 0)

            if tr_total > 0:
                tr_occurrences = tr_hist.get(tr_model, 0)
                tr_fitness = tr_occurrences / tr_total

                # Compute precision: 1 - max(more precise relations) / total
                more_precise = get_more_precise_tr(tr_model)
                max_more_precise = 0
                for mp_rel in more_precise:
                    max_more_precise = max(max_more_precise, tr_hist.get(mp_rel, 0))
                tr_precision = 1.0 - (max_more_precise / tr_total)

                tr_metrics["fitness"] = tr_fitness
                tr_metrics["precision"] = tr_precision

                # Aggregate for overall
                overall_tr_occurrences += tr_occurrences
                overall_tr_total += tr_total
                overall_tr_more_precise_max += max_more_precise

        type_pair_metrics[(t1, t2)]["temporal"] = tr_metrics

        # --- Log Cardinality Metrics ---
        lc_model = totem.cardinalities[(t1, t2)].get("LC")
        lc_metrics = {"model_relation": lc_model, "fitness": None, "precision": None}

        if (t1, t2) in h_log_cardinalities and lc_model is not None and lc_model not in ["None", "ERROR 0"]:
            lc_hist = h_log_cardinalities[(t1, t2)]
            lc_total = lc_hist.get(LC_TOTAL, 0)

            if lc_total > 0:
                lc_occurrences = lc_hist.get(lc_model, 0)
                lc_fitness = lc_occurrences / lc_total

                # Compute precision
                more_precise = get_more_precise_lc(lc_model)
                max_more_precise = 0
                for mp_rel in more_precise:
                    max_more_precise = max(max_more_precise, lc_hist.get(mp_rel, 0))
                lc_precision = 1.0 - (max_more_precise / lc_total)

                lc_metrics["fitness"] = lc_fitness
                lc_metrics["precision"] = lc_precision

                # Aggregate for overall
                overall_lc_occurrences += lc_occurrences
                overall_lc_total += lc_total
                overall_lc_more_precise_max += max_more_precise

        type_pair_metrics[(t1, t2)]["log_cardinality"] = lc_metrics

        # --- Event Cardinality Metrics ---
        ec_model = totem.cardinalities[(t1, t2)].get("EC")
        ec_metrics = {"model_relation": ec_model, "fitness": None, "precision": None}

        if (t1, t2) in h_event_cardinalities and ec_model is not None and ec_model not in ["None", "ERROR 0"]:
            ec_hist = h_event_cardinalities[(t1, t2)]
            ec_total = ec_hist.get(EC_TOTAL, 0)

            if ec_total > 0:
                ec_occurrences = ec_hist.get(ec_model, 0)
                ec_fitness = ec_occurrences / ec_total

                # Compute precision
                more_precise = get_more_precise_ec(ec_model)
                max_more_precise = 0
                for mp_rel in more_precise:
                    max_more_precise = max(max_more_precise, ec_hist.get(mp_rel, 0))
                ec_precision = 1.0 - (max_more_precise / ec_total)

                ec_metrics["fitness"] = ec_fitness
                ec_metrics["precision"] = ec_precision

                # Aggregate for overall
                overall_ec_occurrences += ec_occurrences
                overall_ec_total += ec_total
                overall_ec_more_precise_max += max_more_precise

        type_pair_metrics[(t1, t2)]["event_cardinality"] = ec_metrics

    # Step 4: Aggregate per object type
    print(f"Computing per-object-type metrics, start time: {datetime.now()}")
    object_type_metrics = {}

    # Collect all object types from the model
    all_types = set()
    for (t1, t2) in totem.cardinalities.keys():
        all_types.add(t1)
        all_types.add(t2)

    for obj_type in all_types:
        # Collect metrics for pairs involving this type
        tr_fitness_values = []
        tr_precision_values = []
        lc_fitness_values = []
        lc_precision_values = []
        ec_fitness_values = []
        ec_precision_values = []

        for (t1, t2), metrics in type_pair_metrics.items():
            if t1 == obj_type or t2 == obj_type:
                if metrics["temporal"]["fitness"] is not None:
                    tr_fitness_values.append(metrics["temporal"]["fitness"])
                if metrics["temporal"]["precision"] is not None:
                    tr_precision_values.append(metrics["temporal"]["precision"])
                if metrics["log_cardinality"]["fitness"] is not None:
                    lc_fitness_values.append(metrics["log_cardinality"]["fitness"])
                if metrics["log_cardinality"]["precision"] is not None:
                    lc_precision_values.append(metrics["log_cardinality"]["precision"])
                if metrics["event_cardinality"]["fitness"] is not None:
                    ec_fitness_values.append(metrics["event_cardinality"]["fitness"])
                if metrics["event_cardinality"]["precision"] is not None:
                    ec_precision_values.append(metrics["event_cardinality"]["precision"])

        object_type_metrics[obj_type] = {
            "temporal": {
                "avg_fitness": sum(tr_fitness_values) / len(tr_fitness_values) if tr_fitness_values else None,
                "avg_precision": sum(tr_precision_values) / len(tr_precision_values) if tr_precision_values else None
            },
            "log_cardinality": {
                "avg_fitness": sum(lc_fitness_values) / len(lc_fitness_values) if lc_fitness_values else None,
                "avg_precision": sum(lc_precision_values) / len(lc_precision_values) if lc_precision_values else None
            },
            "event_cardinality": {
                "avg_fitness": sum(ec_fitness_values) / len(ec_fitness_values) if ec_fitness_values else None,
                "avg_precision": sum(ec_precision_values) / len(ec_precision_values) if ec_precision_values else None
            }
        }

    # Step 5: Compute overall metrics
    print(f"Computing overall metrics, start time: {datetime.now()}")
    overall_metrics = {
        "temporal": {
            "fitness": overall_tr_occurrences / overall_tr_total if overall_tr_total > 0 else None,
            "precision": 1.0 - (overall_tr_more_precise_max / overall_tr_total) if overall_tr_total > 0 else None
        },
        "log_cardinality": {
            "fitness": overall_lc_occurrences / overall_lc_total if overall_lc_total > 0 else None,
            "precision": 1.0 - (overall_lc_more_precise_max / overall_lc_total) if overall_lc_total > 0 else None
        },
        "event_cardinality": {
            "fitness": overall_ec_occurrences / overall_ec_total if overall_ec_total > 0 else None,
            "precision": 1.0 - (overall_ec_more_precise_max / overall_ec_total) if overall_ec_total > 0 else None
        }
    }

    print(f"Finished conformance checking, end time: {datetime.now()}")

    return {
        "type_pair_metrics": type_pair_metrics,
        "object_type_metrics": object_type_metrics,
        "overall_metrics": overall_metrics,
        "histograms": histograms  # Contains all histograms including fine-grained ones
    }


def mlpaDiscovery(totem: Totem):
    """
    Given a totem object (output of totemDiscovery), compute a process view using the MLPA algorithm.

    :param totem: The totem object containing the temporal graph and related information.
    :return: A dictionary representing the process view with layers and their associated object types and event types.
    """

    # object type to event type dict
    obj_typ_to_ev_type = totem.object_type_to_event_types
    all_event_types = totem.all_event_types

    # get a list of all object types (or variable that is filled while passing through the process executions)
    type_relations = totem.type_relations  # stores all connected types

    tempGraph = totem.tempgraph

    # print(f"Starting MLPA, start time: {datetime.now()}")
    # transform tempGraph to ILP
    model = LpProblem(name="layer-assignment")

    # Define the decision variables
    level = {
        i: LpVariable(name=f"level-{i}", lowBound=0, cat="Integer")
        for i in tempGraph["nodes"]
    }
    z_parallel = {
        str((t1, t2)): LpVariable(name=f"hp-{str((t1, t2))}")
        for (t1, t2) in tempGraph[TR_PARALLEL]
    }
    z_initiating = {
        str((t1, t2)): LpVariable(name=f"hi-{str((t1, t2))}")
        for (t1, t2) in tempGraph[TR_INITIATING]
    }

    # constraints
    for t1, t2 in tempGraph[TR_DEPENDENT]:
        c = level[t2] - level[t1] >= 1
        model += c

    # for parallel we want to minimize the absolute distance. For absolute values one needs an additional constraint
    for t1, t2 in tempGraph[TR_PARALLEL]:
        c1 = level[t1] - level[t2] - z_parallel[str((t1, t2))] <= 0
        c2 = level[t2] - level[t1] - z_parallel[str((t1, t2))] <= 0
        model += c1
        model += c2

    # for initiating we want to minimize the absolute distance. For absolute values one needs an additional constraint
    for t1, t2 in tempGraph[TR_INITIATING]:
        c1 = level[t1] - level[t2] - z_initiating[str((t1, t2))] <= 0
        c2 = level[t2] - level[t1] - z_initiating[str((t1, t2))] <= 0
        model += c1
        model += c2

    # objective Function
    obj_func = pulp.lpSum(
        [level[t2] - level[t1] for (t1, t2) in tempGraph[TR_DEPENDENT]]
        + [z_parallel[str((t1, t2))] for (t1, t2) in tempGraph[TR_PARALLEL]]
        + [z_initiating[str((t1, t2))] for (t1, t2) in tempGraph[TR_INITIATING]]
    )
    model += obj_func

    # solve the model
    status = model.solve()

    # print
    for var in level.values():
        print(f"{var.name}: {var.value()}")

    levels_dict = dict()
    for type in tempGraph["nodes"]:
        # print(f"{level[type].name}: {level[type].value()}")
        levels_dict.setdefault(level[type].value(), set())
        levels_dict[level[type].value()].add(type)

    resulting_process_view = {}
    print("Assignment of object types to layers:")
    print(levels_dict)
    print("")
    sorted_levels = [float(k) for k in levels_dict.keys()]
    sorted_levels.sort()  # starting from the lowest level to the highest level
    for l in sorted_levels:
        types_of_level = list(levels_dict[l])
        connected_components_undirected(types_of_level, type_relations)
        resulting_process_view[l] = connected_components_undirected(
            types_of_level, type_relations
        )

    print("Process View (without matching event types):")
    print(resulting_process_view)
    print("")

    resulting_process_view_with_events = {}
    # starting from the lowest to the highest level assign the eventtypes to the object groups
    remaining_ev_types = set(list(all_event_types))
    for l in sorted_levels:
        ccs_with_event_types = []
        for cc in resulting_process_view[l]:
            requested_event_types = set()
            for type in cc:
                requested_event_types = requested_event_types.union(
                    obj_typ_to_ev_type[type]
                )
                # print(f"{type} requests: {requested_event_types}")

            assigned_event_types = requested_event_types.intersection(
                remaining_ev_types
            )
            # add cc and event types to result
            ccs_with_event_types.append((cc, assigned_event_types))
            # upadate remaining eventtypes
            remaining_ev_types = remaining_ev_types - assigned_event_types

        resulting_process_view_with_events[l] = ccs_with_event_types

    print("Resulting Process Views with matching Eventtypes:")
    print(resulting_process_view_with_events)
    # print(f"Finished MLPA, end time: {datetime.now()}")
    return resulting_process_view_with_events
