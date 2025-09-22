from rest_framework.decorators import api_view, action, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework import status, viewsets
from .models import UserFile
from .serializers import UserFileSerializer

from totem_lib.ocel import ObjectCentricEventLog
from totem_lib.ocvariants import find_variants

from collections import defaultdict

from totem_lib.ocel import (
    load_events_from_sqlite, load_objects_from_sqlite,
    load_events_from_json,   load_objects_from_json,
    load_events_from_xml,    load_objects_from_xml,
)

import os
import networkx as nx
import polars as pl
from hashlib import sha1
import re
from django.core.cache import cache


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def greeting(rsequest):
    
    return Response({"message": "Hello, greetings from the backend!"})

class UserFileViewSet(viewsets.ModelViewSet):
    serializer_class = UserFileSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return UserFile.objects.filter(user=self.request.user)
    
    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
    @action(detail=True, methods=["get"])
    def NoE(self, request, pk=None):

        try:
            user_file = self.get_queryset().get(pk=pk)
        except UserFile.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)
        if user_file.file.path.split('.')[-1] == 'sqlite':
            OCEL = load_events_from_sqlite(user_file.file.path)
            processed= len(OCEL.unique(subset='_eventId'))
        else:
            processed= "Filetype not yet supported"
        return Response(processed, status=status.HTTP_200_OK)


def _build_ocel_from_path(path: str) -> ObjectCentricEventLog:
    
    ext = os.path.splitext(path)[1].lower()
    if ext in (".sqlite", ".db"):
        events_df  = load_events_from_sqlite(path)
        objects_df = load_objects_from_sqlite(path)
    elif ext == ".json":
        events_df  = load_events_from_json(path)
        objects_df = load_objects_from_json(path)
    elif ext == ".xml":
        events_df  = load_events_from_xml(path)
        objects_df = load_objects_from_xml(path)
    else:
        raise ValueError(f"Unsupported file type: {ext}")

    log = ObjectCentricEventLog()
    log.events = events_df
    log.object_df = objects_df

    return log

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
        for obj_id in edge_data.get('objects', []):
            variant_objects.add(obj_id)

    obj_details = []
    for obj_id in variant_objects:
        obj_type = ocel.obj_type_map.get(obj_id)
        if obj_type:
            obj_details.append({'id': obj_id, 'type': obj_type})
    
    obj_details.sort(key=lambda o: (o['type'], o['id']))

    for obj in obj_details:
        y_mappings[obj['id']] = y_counter
        lane_info[y_counter] = {"id": f"type::{obj['type']}", "type": obj['type'], "label": obj['type']}
        y_counter += 1

    # X-Mapping (Sequence): Use the corrected algorithm.
    node_x_coords = _calculate_x_positions(G)

    # Final Serialization: Build the lists for the JSON response.
    nodes = []
    unique_lanes = []
    seen_lane_ids = set()
    for lane in lane_info.values():
        if lane['id'] not in seen_lane_ids:
            unique_lanes.append(lane)
            seen_lane_ids.add(lane['id'])
    objects_for_lanes = unique_lanes

    for node_id, data in G.nodes(data=True):
        object_ids_for_node = set()
        for u, v, edge_data in G.in_edges(node_id, data=True):
            object_ids_for_node.update(edge_data.get('objects', []))
        for u, v, edge_data in G.out_edges(node_id, data=True):
            object_ids_for_node.update(edge_data.get('objects', []))
        
        y_coords = sorted([y_mappings[oid] for oid in object_ids_for_node if oid in y_mappings])

        nodes.append({
            "id": node_id,
            "activity": data.get("label", str(node_id)),
            "x": node_x_coords.get(node_id, 0),
            "y_lane": y_coords[0] if y_coords else 0,
            "y_lanes": y_coords,
            "types": sorted({lane_info[y]['type'] for y in y_coords})
        })
        
    edges = [{ "from": u, "to": v, "label": data.get("type", "") } for u, v, data in G.edges(data=True)]

    return {"nodes": nodes, "edges": edges, "objects": objects_for_lanes}


@api_view(["GET"])
@permission_classes([AllowAny])
def variants(request):
    
    file_id = request.query_params.get("file_id")
    if not file_id:
        return Response({"error": "Missing ?file_id"}, status=status.HTTP_400_BAD_REQUEST)

    cache_key = f"ocel_object_{file_id}"
    ocel = cache.get(cache_key)

    if not ocel:
        print(f"CACHE MISS for file_id: {file_id}. Building OCEL from scratch...")
        try:
            uf = UserFile.objects.get(pk=file_id)
            path = uf.file.path
            if not os.path.exists(path):
                return Response({"error": f"Path does not exist: {path}"}, status=status.HTTP_400_BAD_REQUEST)
            
            ocel = _build_ocel_from_path(path)
            cache.set(cache_key, ocel, timeout=3600)
        except UserFile.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": f"Failed to load OCEL: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    else:
        print(f"CACHE HIT for file_id: {file_id}. Using cached OCEL object.")

    try:
        leading_object_type = "Transport Document"  #request.query_params.get("leading_type", "Handling Unit")
        mined = find_variants(ocel, leading_type=leading_object_type)
    except Exception as e:
        return Response({"error": f"Variant computation failed: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    out = []
    for var in mined[:1]:  # TODO this :1 is obviously just for presenting
        layout_data = calculate_layout(var, ocel)

        sequence = var.graph.graph.get('sequence', [])
        signature = " → ".join([node_data['label'] for _, node_data in sorted(var.graph.nodes(data=True), key=lambda x: x[1]['timestamp'])])
        signature_hash = sha1(signature.encode("utf-8")).hexdigest()[:8]
        
        final_nodes = []
        for node in layout_data["nodes"]:
            final_nodes.append({
                "id": node["id"],
                "activity": node["activity"],
                "x": node["x"],
                "y_lane": node["y_lane"],
                "y_lanes": node["y_lanes"],
                "objectIds": [f"type::{t}" for t in node["types"]],
                "types": node["types"]
            })

        out.append({
            "id": str(var.id),
            "support": int(var.support),
            "signature": signature_hash,
            "signature_hash": signature_hash,
            "graph": {
                "nodes": final_nodes,
                "edges": layout_data["edges"],
                "objects": layout_data["objects"]
            },
        })

    return Response({"variants": out}, status=status.HTTP_200_OK)