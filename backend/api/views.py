from rest_framework.decorators import api_view, action, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework import status, viewsets
from django.utils.text import slugify
from .models import EventLog, Project, Dashboard
from .serializers import EventLogSerializer, DashboardSerializer
from django.db.models import Max

from totem_lib.ocdfg import OCDFG, CCDFG
from totem_lib.ocel import ObjectCentricEventLog
import networkx as nx


from totem_lib.ocel import load_events_from_sqlite
from django.core.cache import cache

import os
from totem_lib.ocel import (
    load_events_from_sqlite, load_objects_from_sqlite,
    load_events_from_json,   load_objects_from_json,
    load_events_from_xml,    load_objects_from_xml,
)


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

@api_view(['GET'])
@permission_classes([AllowAny])
def OCDFGViewSet(request):
    """

    Args:
        request (_type_): _description_
    """
    
    file_id = request.query.get("file_id")
    if not file_id:
        return Response({"error": "Missing ?file_id parameter"}, status=status.HTTP_400_BAD_REQUEST)
    
    cache_key = f"ocel_object_{file_id}"
    ocel = cache.get(cache_key)
    
    if not ocel:  # i.e. if we have a cache-miss
        try:
            user_file =  EventLog.objects.get(id=file_id)
            ocel = _build_ocel_from_path(user_file.file.path)
            cache.set(cache_key, ocel, timeout=3600)  # Cache for 1 hour
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": f"Failed to load OCEL from file: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        
    
    try:
        ocdfg = OCDFG.from_ocel(ocel)
        # build a json response from the dfg that is a OCDFG-object
        dfg_json = nx.node_link_data(ocdfg)

    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    return Response({"dfg": dfg_json}, status=status.HTTP_200_OK)
