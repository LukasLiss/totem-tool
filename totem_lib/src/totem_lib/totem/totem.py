from typing import Dict, Set, List
import networkx as nx
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

# Event cardinality constants
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


def totemDiscovery(db, tau=0.9):
    """
    Given an OcelDuckDB database, compute the temporal graph and related
    information using the TOTeM algorithm.

    All heavy computation (object lifetimes, co-occurrence pairs, cardinality
    counting, temporal relation classification) is performed inside DuckDB via
    SQL queries exposed by the OcelDuckDB convenience methods. Python code here
    only converts the compact, type-pair-level aggregates into the data
    structures expected by the downstream ``get_most_precise_*`` helpers and
    ``mlpaDiscovery``.

    Args:
        db: An OcelDuckDB instance (from ``import_ocel_db`` or
            ``OcelDuckDB(ocel)``).
        tau: Threshold for determining strong relations (default 0.9).

    Returns:
        A Totem object containing the temporal graph and related information.
    """
    from datetime import datetime

    # ------------------------------------------------------------------
    # 1. Object type → event type mapping  &  all event types
    # ------------------------------------------------------------------
    print(f"computing type-event mapping, start time: {datetime.now()}")
    type_event_df = db.get_type_event_mapping()

    obj_typ_to_ev_type: dict[str, set[str]] = {}
    all_event_types: set[str] = set()
    for row in type_event_df.iter_rows(named=True):
        obj_typ_to_ev_type.setdefault(row["obj_type"], set()).add(row["activity"])
        all_event_types.add(row["activity"])

    # ------------------------------------------------------------------
    # 2. Type relations (co-occurring type pairs)
    # ------------------------------------------------------------------
    print(f"computing type relations, start time: {datetime.now()}")
    type_relations_df = db.get_type_relations()

    type_relations: set[frozenset[str]] = set()
    for row in type_relations_df.iter_rows(named=True):
        type_relations.add(frozenset({row["t1"], row["t2"]}))

    # ------------------------------------------------------------------
    # 3. Event cardinalities
    # ------------------------------------------------------------------
    print(f"computing event cardinalities, start time: {datetime.now()}")
    ec_df = db.get_event_cardinality_counts()

    h_event_cardinalities: dict[tuple[str, str], dict[str, int]] = {}
    for row in ec_df.iter_rows(named=True):
        key = (row["type_source"], row["type_target"])
        total = int(row["total"])
        zero  = int(row["zero"])
        one   = int(row["one"])
        gt_one = int(row["gt_one"])
        h_event_cardinalities[key] = {
            EC_TOTAL:     total,
            EC_ZERO:      zero,
            EC_ONE:       one,
            EC_ZERO_ONE:  zero + one,
            EC_MANY:      one + gt_one,
            EC_ZERO_MANY: total,
        }

    # ------------------------------------------------------------------
    # 4. Log cardinalities
    # ------------------------------------------------------------------
    print(f"computing log cardinalities, start time: {datetime.now()}")
    lc_df = db.get_log_cardinality_counts()

    h_log_cardinalities: dict[tuple[str, str], dict[str, int]] = {}
    for row in lc_df.iter_rows(named=True):
        key = (row["type_source"], row["type_target"])
        total  = int(row["total"])
        zero   = int(row["zero"])
        one    = int(row["one"])
        gt_one = int(row["gt_one"])
        h_log_cardinalities[key] = {
            LC_TOTAL:     total,
            LC_ZERO:      zero,
            LC_ONE:       one,
            LC_ZERO_ONE:  zero + one,
            LC_MANY:      one + gt_one,
            LC_ZERO_MANY: total,
        }

    # ------------------------------------------------------------------
    # 5. Temporal relations
    # ------------------------------------------------------------------
    print(f"computing temporal relations, start time: {datetime.now()}")
    tr_df = db.get_temporal_relation_counts()

    h_temporal_relations: dict[tuple[str, str], dict[str, int]] = {}
    for row in tr_df.iter_rows(named=True):
        key = (row["type_source"], row["type_target"])
        h_temporal_relations[key] = {
            TR_TOTAL:              int(row["total"]),
            TR_DEPENDENT:          int(row["D"]),
            TR_DEPENDENT_INVERSE:  int(row["Di"]),
            TR_INITIATING:         int(row["I"]),
            TR_INITIATING_REVERSE: int(row["Ii"]),
            TR_PARALLEL:           int(row["P"]),
        }

    # ------------------------------------------------------------------
    # 6. Build the temporal graph
    # ------------------------------------------------------------------
    print(f"building the temporal graph, start time: {datetime.now()}")
    tempgraph = {
        "nodes": set(),
        TR_PARALLEL: set(),
        TR_INITIATING: set(),
        TR_DEPENDENT: set(),
    }

    cardinalities = {}

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
        print("")

        cardinalities[(t1, t2)] = {"LC": lc, "EC": ec}
        cardinalities[(t2, t1)] = {"LC": lc_i, "EC": ec_i}

    print(f"Finished building the temporal graph, end time: {datetime.now()}")
    totem = Totem(
        tempgraph, cardinalities, type_relations, all_event_types, obj_typ_to_ev_type
    )
    return totem


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
