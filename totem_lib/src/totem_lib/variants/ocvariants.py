from __future__ import annotations
from collections import defaultdict
from typing import Dict, List, Iterator, Tuple, Optional, Set
import networkx as nx
import polars as pl
import os
import networkx as nx
from typing import Dict
from collections import defaultdict
import itertools
import time

EventId = str
ExecIdx = int
VariantId = str


class Variant:
    """Represents one variant, with support (frequency) and its executions."""

    def __init__(
        self,
        vid: VariantId,
        support: int,
        executions: List[List[EventId]],
        graph: nx.DiGraph,
    ):
        self.id = vid
        self.support = support
        self.executions = executions
        self.graph = graph  # representative graph

    def __iter__(self) -> Iterator[List[EventId]]:
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


def _calculate_x_positions(G):
    """
    Correctly calculates the x-coordinate for each node in a DAG.
    The x-coordinate is the length of the longest path from a source node.
    """
    distances = {node: 0 for node in G.nodes()}
    # Process nodes in topological order to ensure predecessors are calculated first
    for node in nx.topological_sort(G):
        for successor in G.successors(node):
            # The distance to a successor is the max of its current distance
            # or the distance to the current node + 1
            distances[successor] = max(distances[successor], distances[node] + 1)
    return distances


def calculate_layout(variant, ocel):
    """
    Calculates the (x, y) layout for a variant graph to create a chevron diagram.
    """
    G = variant.graph

    # Y-Mapping (Lanes): Assign a unique y-coordinate to each object instance.
    y_mappings = {}
    lane_info = {}
    y_counter = 0

    variant_objects = set()
    for _, _, edge_data in G.edges(data=True):
        for obj_id in edge_data.get("objects", []):
            variant_objects.add(obj_id)

    obj_details = []
    for obj_id in variant_objects:
        obj_type = ocel.obj_type_map.get(obj_id)
        if obj_type:
            obj_details.append({"id": obj_id, "type": obj_type})

    obj_details.sort(key=lambda o: (o["type"], o["id"]))

    for obj in obj_details:
        y_mappings[obj["id"]] = y_counter
        lane_info[y_counter] = {
            "id": f"lane::{y_counter}::{obj['type']}",  # Unique ID per lane
            "type": obj["type"],
            "label": obj["type"],
        }
        y_counter += 1

    # X-Mapping (Sequence): Use the corrected algorithm.
    node_x_coords = _calculate_x_positions(G)

    # Final Serialization: Build the lists for the JSON response.
    nodes = []
    # Each lane is unique (one per object instance), so include all of them
    objects_for_lanes = [lane_info[i] for i in range(len(lane_info))]

    for node_id, data in G.nodes(data=True):
        object_ids_for_node = set()
        for u, v, edge_data in G.in_edges(node_id, data=True):
            object_ids_for_node.update(edge_data.get("objects", []))
        for u, v, edge_data in G.out_edges(node_id, data=True):
            object_ids_for_node.update(edge_data.get("objects", []))

        y_coords = sorted(
            [y_mappings[oid] for oid in object_ids_for_node if oid in y_mappings]
        )

        nodes.append(
            {
                "id": node_id,
                "activity": data.get("label", str(node_id)),
                "x": node_x_coords.get(node_id, 0),
                "y_lane": y_coords[0] if y_coords else 0,
                "y_lanes": y_coords,
                "types": sorted({lane_info[y]["type"] for y in y_coords}),
            }
        )

    edges = [
        {"from": u, "to": v, "label": data.get("type", "")}
        for u, v, data in G.edges(data=True)
    ]

    return {"nodes": nodes, "edges": edges, "objects": objects_for_lanes}


def find_variants_naive(ocel: ObjectCentricEventLog, leading_type: str) -> Variants:
    """
    The provided naive implementation, now with performance timers for each step.
    Uses a slow, direct isomorphism check for variant grouping.
    """
    total_start_time = time.time()
    print("--- Starting Naive Variant Discovery ---")

    t0 = time.time()
    eog = ocel.eog
    object_graph = nx.Graph()
    for row in ocel.events.iter_rows(named=True):
        objects_in_event = row["_objects"]
        if objects_in_event and len(objects_in_event) > 1:
            for u, v in itertools.combinations(objects_in_event, 2):
                object_graph.add_edge(u, v)

    object_to_events = defaultdict(list)
    for row in ocel.events.iter_rows(named=True):
        if row["_objects"]:
            for obj_id in row["_objects"]:
                object_to_events[obj_id].append(row["_eventId"])

    leading_object_ids = ocel.objects.filter(
        ocel.objects["_objType"] == leading_type
    )["_objId"].to_list()

    print(f"✅ [Step 1/4] Graph & Lookups Built in: {time.time() - t0:.2f} seconds")

    if not leading_object_ids:
        print(f"WARNING: No objects found for leading type '{leading_type}'.")
        return Variants([])

    t1 = time.time()
    process_instances: List[nx.DiGraph] = []
    for leading_id in leading_object_ids:
        case_objects = {leading_id}
        if leading_id in object_graph:
            for neighbor in object_graph.neighbors(leading_id):
                case_objects.add(neighbor)

        case_event_ids = set()
        for obj_id in case_objects:
            case_event_ids.update(object_to_events[obj_id])

        if case_event_ids:
            instance_graph = eog.subgraph(case_event_ids).copy()
            if instance_graph.number_of_edges() > 0:
                process_instances.append(instance_graph)
    print(
        f"✅ [Step 2/4] Found {len(process_instances)} process instances in: {time.time() - t1:.2f} seconds"
    )

    t2 = time.time()
    variants_dict: Dict[int, Dict] = {}
    variant_counter = 0

    for instance_graph in process_instances:
        found_match = False
        for vid, variant_data in variants_dict.items():
            variant_graph = variant_data["graph"]
            if nx.is_isomorphic(
                instance_graph,
                variant_graph,
                node_match=lambda n1, n2: n1.get("label") == n2.get("label"),
                edge_match=lambda e1, e2: e1.get("type") == e2.get("type"),
            ):
                variant_data["support"] += 1
                variant_data["executions"].append(list(instance_graph.nodes()))
                found_match = True
                break

        if not found_match:
            instance_graph.graph["sequence"] = [
                d["label"]
                for _, d in sorted(
                    instance_graph.nodes(data=True), key=lambda x: x[1]["timestamp"]
                )
            ]
            variants_dict[variant_counter] = {
                "graph": instance_graph,
                "support": 1,
                "executions": [list(instance_graph.nodes())],
            }
            variant_counter += 1
    print(
        f"✅ [Step 3/4] Grouped into {len(variants_dict)} unique variants in: {time.time() - t2:.2f} seconds"
    )

    t3 = time.time()
    variant_list = []
    for vid, data in variants_dict.items():
        variant = Variant(
            vid=f"variant_{vid}",
            support=data["support"],
            executions=data["executions"],
            graph=data["graph"],
        )
        variant_list.append(variant)

    variant_list.sort(key=lambda v: v.support, reverse=True)
    print(f"✅ [Step 4/4] Final formatting in: {time.time() - t3:.2f} seconds")
    print(f"--- Naive Variant Discovery Complete ---")
    print(f"Total Time: {time.time() - total_start_time:.2f} seconds")

    return Variants(variant_list)


def find_variants(ocel: ObjectCentricEventLog, leading_type: str) -> Variants:
    """
    Finds variants using an optimized approach that normalizes activity labels
    before creating graph signatures to ensure correct grouping.
    """
    total_start_time = time.time()
    print("--- Starting Variant Discovery ---")

    # STEP 1: Build Object Co-occurrence Graph & Lookup Maps
    t0 = time.time()
    eog = ocel.eog
    object_graph = nx.Graph()
    for row in ocel.events.iter_rows(named=True):
        objects_in_event = row["_objects"]
        if objects_in_event and len(objects_in_event) > 1:
            for u, v in itertools.combinations(objects_in_event, 2):
                object_graph.add_edge(u, v)

    object_to_events = defaultdict(list)
    for row in ocel.events.iter_rows(named=True):
        if row["_objects"]:
            for obj_id in row["_objects"]:
                object_to_events[obj_id].append(row["_eventId"])

    leading_object_ids = ocel.objects.filter(
        ocel.objects["_objType"] == leading_type
    )["_objId"].to_list()

    print(f"✅ [Step 1/4] Graph & Lookups Built in: {time.time() - t0:.2f} seconds")

    if not leading_object_ids:
        print(f"WARNING: No objects found for leading type '{leading_type}'.")
        return Variants([])

    # STEP 2: Discover Process Instances (Cases)
    t1 = time.time()
    process_instances: List[nx.DiGraph] = []
    for leading_id in leading_object_ids:
        case_objects = {leading_id}
        if leading_id in object_graph:
            for neighbor in object_graph.neighbors(leading_id):
                case_objects.add(neighbor)

        case_event_ids = set()
        for obj_id in case_objects:
            case_event_ids.update(object_to_events[obj_id])

        if case_event_ids:
            instance_graph = eog.subgraph(case_event_ids).copy()
            if instance_graph.number_of_edges() > 0:
                process_instances.append(instance_graph)
    print(
        f"✅ [Step 2/4] Found {len(process_instances)} process instances in: {time.time() - t1:.2f} seconds"
    )

    # STEP 3: Group Variants Using Normalized Signatures
    t2 = time.time()
    variants_by_signature: Dict[str, Dict] = {}

    # Define a simple function to clean the activity labels
    normalize_label = lambda label: label.split("_")[0]

    for instance_graph in process_instances:
        # Create a canonical signature using the NORMALIZED labels
        node_labels = sorted(
            [normalize_label(d["label"]) for _, d in instance_graph.nodes(data=True)]
        )

        edge_tuples = sorted(
            [
                (
                    normalize_label(instance_graph.nodes[u]["label"]),
                    normalize_label(instance_graph.nodes[v]["label"]),
                    d["type"],
                )
                for u, v, d in instance_graph.edges(data=True)
            ]
        )

        signature = (
            f"nodes:{'|'.join(node_labels)};edges:{'|'.join(map(str, edge_tuples))}"
        )

        if signature not in variants_by_signature:
            # First time seeing this signature, create a new variant entry.
            instance_graph.graph["sequence"] = [
                d["label"]
                for _, d in sorted(
                    instance_graph.nodes(data=True), key=lambda x: x[1]["timestamp"]
                )
            ]
            variants_by_signature[signature] = {
                "graph": instance_graph,
                "support": 1,
                "executions": [list(instance_graph.nodes())],
            }
        else:
            # Signature already exists, just increment support.
            variants_by_signature[signature]["support"] += 1
            variants_by_signature[signature]["executions"].append(
                list(instance_graph.nodes())
            )
    print(
        f"✅ [Step 3/4] Grouped into {len(variants_by_signature)} unique variants in: {time.time() - t2:.2f} seconds"
    )

    # STEP 4: Final Formatting and Sorting
    t3 = time.time()
    variant_list = []
    for i, data in enumerate(variants_by_signature.values()):
        variant_list.append(
            Variant(
                vid=f"variant_{i}",
                support=data["support"],
                executions=data["executions"],
                graph=data["graph"],
            )
        )

    variant_list.sort(key=lambda v: v.support, reverse=True)
    print(f"✅ [Step 4/4] Final formatting in: {time.time() - t3:.2f} seconds")
    print(f"--- Variant Discovery Complete ---")
    print(f"Total Time: {time.time() - total_start_time:.2f} seconds")

    return Variants(variant_list)


if __name__ == "__main__":
    import polars as pl
    from totem_lib.ocel.ocel import ObjectCentricEventLog
    from hashlib import sha1
    import json
    from totem_lib.ocel.ocel import load_events_from_json, load_objects_from_json

    # load a sample OCEL
    path = "/Users/arbeitiv/Desktop/PADS HiWi/totem-tool/backend/totem_backend/Variants/example_data/ContainerLogistics.json"

    events_df = load_events_from_json(path)
    objects_df = load_objects_from_json(path)

    json_ocel = ObjectCentricEventLog()
    json_ocel.events = events_df
    json_ocel.object_df = objects_df

    mined = find_variants(json_ocel, leading_type="Container")
    print(json.dumps(mined, indent=2))
