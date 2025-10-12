from rest_framework.decorators import api_view, action, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework import status, viewsets
from django.utils.text import slugify
from .models import EventLog, Project, Dashboard, EventLog
from .serializers import EventLogSerializer, DashboardSerializer
from django.db.models import Max


from totem_lib.ocel import ObjectCentricEventLog
from totem_lib.ocvariants import find_variants, calculate_layout
from totem_lib.totem import totemDiscovery, mlpaDiscovery

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


@api_view(['OPTIONS'])
def debug_options(request):
    return Response({"headers": dict(request.headers)})

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def greeting(request):
    
    return Response({"message": "Hello, greetings from the backend!"})

class EventLogViewSet(viewsets.ModelViewSet):
    serializer_class = EventLogSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return EventLog.objects.filter(project__users=self.request.user)
    
    def perform_create(self, serializer):

        user = self.request.user

        file_name = serializer.validated_data['file'].name
        project_name = f"{slugify(file_name)}_{user.username}"    

        project = Project.objects.create(name=project_name)
        project.users.add(user)
        project.save()
        serializer.save(project=project)

    @action(detail=True, methods=["get"])
    def NoE(self, request, pk=None):

        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)
        
        if user_file.file.path.split('.')[-1] == 'sqlite':
            OCEL = load_events_from_sqlite(user_file.file.path)
            processed= len(OCEL.unique(subset='_eventId'))
        else:
            processed= "Filetype not yet supported"
        return Response(processed, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"])
    def discover_totem(self, request, pk=None):
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            ocel = _build_ocel_from_path(user_file.file.path)
            totem = totemDiscovery(ocel)
            # process_view = mlpaDiscovery(totem)
            return Response(totem, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": f"An error occurred during Totem discovery: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        
    @action(detail=True, methods=["get"])
    def discover_mlpa(self, request, pk=None):
        """API endpoint to perform MLPA discovery on a given event log.
        It applies totem discovery first, then MLPA discovery."""
        # the address would be like /api/eventlogs/{id}/discover_mlpa/ ?
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            ocel = _build_ocel_from_path(user_file.file.path)
            totem = totemDiscovery(ocel)
            process_view = mlpaDiscovery(totem)
            return Response(process_view, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": f"An error occurred during Totem and MLPA discovery: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class DashboardViewSet(viewsets.ModelViewSet):
    serializer_class = DashboardSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = Dashboard.objects.filter(project__users=self.request.user)
        project_id = self.request.query_params.get("project")
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs
    
    def perform_create(self, serializer):
        project_id = self.request.data.get("project")
        project = Project.objects.get(id=project_id, users=self.request.user)

        
        serializer.save(project=project)
# TODO: change to equivalent totem_lib.ocel import function 
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
            uf = EventLog.objects.get(pk=file_id)
            path = uf.file.path
            if not os.path.exists(path):
                return Response({"error": f"Path does not exist: {path}"}, status=status.HTTP_400_BAD_REQUEST)
            
            ocel = _build_ocel_from_path(path)
            cache.set(cache_key, ocel, timeout=3600)
        except EventLog.DoesNotExist:
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
    for var in mined:  
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
