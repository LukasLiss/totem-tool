from rest_framework.decorators import api_view, action, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework import status, viewsets
from django.utils.text import slugify
from .models import EventLog, Project, Dashboard, EventLog, DashboardComponent, NumberofEventsComponent, TextBoxComponent, ImageComponent, VariantsComponent, ProcessAreaComponent, LogStatisticsComponent, OCDFGComponent, OCDottedChartComponent, NewOCDFGComponent
from .serializers import EventLogSerializer, DashboardSerializer, DashboardComponentPolymorphicSerializer
from django.db.models import Max

# DuckDB-first imports. All algorithms exercised by the views below have
# DuckDB-backed implementations (`OCDFGDb`, `totemDiscovery_db`, `find_variants`
# with an `OcelDuckDB` arg), so we never construct the polars OCEL on the
# Django side. Polars-only algorithms (`discover_oc_petri_net_polars`,
# `discover_occn`) are not currently wired into the UI.
from totem_lib.dfg import OCDFGDb, NewOCDFGDb
from totem_lib.variants import find_variants
from totem_lib.variants.ocvariants import calculate_layout
from totem_lib.totem import totemDiscovery_db, totemDiscovery, mlpaDiscovery, Totem
from totem_lib.ocel import OcelDuckDB, import_ocel_db, ObjectCentricEventLog
from totem_lib.ocel.importer import (
    load_events_from_sqlite, load_objects_from_sqlite,
    load_events_from_json, load_objects_from_json,
    load_events_from_xml, load_objects_from_xml,
    import_ocel_from_csv,
)
from totem_lib.oc_dotted_chart import get_oc_dotted_chart_columns, get_oc_dotted_chart_data
from types import SimpleNamespace
from totem_lib.ocel.exporter import build_ocel2_json
from totem_lib.simulation.simulation import OCProcessAreaSimulationModel, OCProcessAreaSimulationConfiguration
from totem_lib.simulation.evaluation.runtime import Timer as EvalTimer
from .simulation_evaluation import build_evaluation_payload, compute_graph_edit_distance
from totem_lib.simulation.utils.process_area import ProcessArea
from totem_lib.simulation.utils.basic_simulation_statistics import variant_arrival_distribution as compute_variant_arrival_distribution, resource_distribution_of_variants
from totem_lib.simulation.utils.resource_constraints import generate_resource_constraints
from totem_lib.simulation.utils.resource_calendar import discover_resource_calendars
from totem_lib.simulation.utils.resource_statistics import resource_cooldown_distribution as compute_resource_cooldown, calculate_resource_allocation_strategy
from totem_lib.variants.ocvariants import find_object_variants_connected_component
import networkx as nx
import polars as pl



from django.core.cache import cache
from django.core.files.base import ContentFile
from django.conf import settings
from django.http import HttpResponse

import os
import math
import uuid
import datetime as dt
from hashlib import sha1
import json
from rest_framework.parsers import MultiPartParser, FormParser


TOTEM_MOCK = {
    "tempgraph": {
        "nodes": ["Order", "Delivery", "Invoice"],
        "D": [
            ["Order", "Delivery"],
            ["Delivery", "Invoice"],
        ],
        "I": [
            ["Invoice", "Order"],
        ],
        "P": [
            ["Order", "Invoice"],
        ],
    },
    "cardinalities": [
        {
            "from": "Order",
            "to": "Delivery",
            "log_cardinality": "1..n",
            "event_cardinality": "1..5",
        },
        {
            "from": "Delivery",
            "to": "Invoice",
            "log_cardinality": "0..1",
            "event_cardinality": "0..3",
        },
        {
            "from": "Order",
            "to": "Invoice",
            "log_cardinality": "1..1",
            "event_cardinality": "1..2",
        },
    ],
    "type_relations": [
        ["Order", "Delivery", "Invoice"],
    ],
    "all_event_types": [
        "Create Order",
        "Dispatch Order",
        "Confirm Delivery",
        "Issue Invoice",
        "Receive Payment",
    ],
    "object_type_to_event_types": {
        "Order": ["Create Order", "Dispatch Order"],
        "Delivery": ["Dispatch Order", "Confirm Delivery"],
        "Invoice": ["Issue Invoice", "Receive Payment"],
    },
}

TOTEM_MOCK_2 = {
    "tempgraph": {
        "nodes": ["Company", "Factory", "Warehouse", "HR", "Worker", "Order", "Item"],
        "D": [
            #["Order", "HR"],
            ["Order", "Worker"],
            ["Item", "Worker"],
            ["Worker", "Factory"],
            ["Item", "Warehouse"],
            ["HR", "Company"],
            ["Factory", "Company"],
            ["Warehouse", "Company"],
        ],
        "P": [
            ["Factory", "Warehouse"],
            ["Warehouse", "Factory"],
            ["HR", "Worker"],
            ["Worker", "HR"],
        ],
        "I": [
            ["Order", "Item"],
        ],
    },
    "cardinalities": [
        {
            "from": "Order",
            "to": "HR",
            "log_cardinality": "1..1",
            "event_cardinality": "0..2",
        },
        {
            "from": "Order",
            "to": "Worker",
            "log_cardinality": "1..n",
            "event_cardinality": "1..5",
        },
        {
            "from": "Item",
            "to": "Worker",
            "log_cardinality": "0..n",
            "event_cardinality": "0..3",
        },
        {
            "from": "Worker",
            "to": "Factory",
            "log_cardinality": "1..n",
            "event_cardinality": "1..4",
        },
        {
            "from": "Worker",
            "to": "Warehouse",
            "log_cardinality": "1..n",
            "event_cardinality": "1..3",
        },
        {
            "from": "Factory",
            "to": "Company",
            "log_cardinality": "1..1",
            "event_cardinality": "1..1",
        },
        {
            "from": "Warehouse",
            "to": "Company",
            "log_cardinality": "1..1",
            "event_cardinality": "1..1",
        },
    ],
    "type_relations": [
        ["Company", "Factory"],
        ["Company", "Warehouse"],
        ["Company", "Worker"],
        ["Factory", "Warehouse"],
        ["Factory", "Worker"],
        ["HR", "Order"],
        ["HR", "Worker"],
        ["Item", "Worker"],
        ["Order", "Item"],
        ["Order", "Worker"],
    ],
    "all_event_types": [
        "Close Company",
        "Complete Order",
        "Create Order",
        "Dispatch Inventory",
        "Establish Company",
        "Hire Worker",
        "Maintain Equipment",
        "Package Item",
        "Process Contract",
        "Relocate Worker",
        "Ship Item",
        "Staff Shift",
        "Start Production",
        "Store Inventory",
    ],
    "object_type_to_event_types": {
        "Company": ["Establish Company", "Close Company"],
        "Factory": ["Start Production", "Maintain Equipment"],
        "Warehouse": ["Store Inventory", "Dispatch Inventory"],
        "HR": ["Hire Worker", "Process Contract"],
        "Worker": ["Staff Shift", "Relocate Worker"],
        "Order": ["Create Order", "Complete Order"],
        "Item": ["Package Item", "Ship Item"],
    },
}

@api_view(['OPTIONS'])
def debug_options(request):
    return Response({"headers": dict(request.headers)})

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def greeting(request):
    
    return Response({"message": "Hello, greetings from the backend!"})

@api_view(['GET'])
@permission_classes([AllowAny])
def health_check(request):
    return Response({"status": "ok", "message": "Backend is running."})


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

        try:
            with _with_ocel_db(user_file) as db:
                processed = db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        except Exception as e:
            return Response({"error": f"Failed to process file: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(processed, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"])
    def object_types(self, request, pk=None):
        """Returns the list of object types present in the event log."""
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            with _with_ocel_db(user_file) as db:
                types = _object_types(db)
        except Exception as e:
            return Response({"error": f"Failed to load OCEL: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(types, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"])
    def discover_totem(self, request, pk=None):
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            cache_key = f"totem_discovery_{user_file.pk}"
            cached_result = cache.get(cache_key)
            if cached_result:
                return Response(cached_result, status=status.HTTP_200_OK)

            with _with_ocel_db(user_file) as db:
                totem = totemDiscovery_db(db)
            serialized = _serialize_totem(totem)

            cache.set(cache_key, serialized, timeout=3600)
            return Response(serialized, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": f"An error occurred during Totem discovery: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=["get"])
    def discover_mlpa(self, request, pk=None):
        """API endpoint to perform MLPA discovery on a given event log.
        It applies totem discovery first, then MLPA discovery."""
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            cache_key = f"mlpa_discovery_{user_file.pk}"
            cached_result = cache.get(cache_key)
            if cached_result:
                return Response(cached_result, status=status.HTTP_200_OK)

            with _with_ocel_db(user_file) as db:
                totem = totemDiscovery_db(db)
            # mlpaDiscovery operates on the Totem object (no DB access),
            # so it can run outside the per-file lock.
            process_view = mlpaDiscovery(totem)
            serialized = _serialize_mlpa(process_view, totem)

            cache.set(cache_key, serialized, timeout=3600)
            return Response(serialized, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": f"An error occurred during Totem and MLPA discovery: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=["get"])
    def statistics(self, request, pk=None):
        """Returns basic statistics of the event log."""
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            with _with_ocel_db(user_file) as db:
                # Single round-trip per scalar. All counts are O(table scan)
                # in DuckDB which dominates over the round-trip cost.
                num_events            = db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
                num_unique_activities = db.conn.execute(
                    "SELECT COUNT(DISTINCT activity) FROM events"
                ).fetchone()[0]
                num_objects           = db.conn.execute("SELECT COUNT(*) FROM objects").fetchone()[0]
                num_object_types      = db.conn.execute(
                    "SELECT COUNT(DISTINCT obj_type) FROM objects"
                ).fetchone()[0]
                ts_row = db.conn.execute(
                    "SELECT MIN(timestamp_unix), MAX(timestamp_unix) FROM events"
                ).fetchone()
            earliest_timestamp, newest_timestamp = ts_row if ts_row else (None, None)

            return Response({
                "num_events": num_events,
                "num_unique_activities": num_unique_activities,
                "num_objects": num_objects,
                "num_object_types": num_object_types,
                "earliest_timestamp": earliest_timestamp,
                "newest_timestamp": newest_timestamp,
            }, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": f"Failed to compute statistics: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=["get"])
    def export(self, request, pk=None):
        """Export the event log as a downloadable OCEL 2.0 JSON file.

        Re-derives a standard OCEL 2.0 document from our internal representation
        via the totem_lib exporter, regardless of the original upload format
        (sqlite/xml/csv/json).
        """
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        cache_key = f"ocel_object_{pk}"
        ocel = cache.get(cache_key)
        if not ocel:
            try:
                ocel = _build_ocel_from_path(user_file.file.path)
                cache.set(cache_key, ocel, timeout=3600)
            except Exception as e:
                return Response({"error": f"Failed to load OCEL: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        try:
            json_content = _export_ocel_to_json(ocel)
        except Exception as e:
            return Response({"error": f"Failed to export OCEL: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        base_name = os.path.splitext(os.path.basename(user_file.file.name))[0]
        response = HttpResponse(json_content, content_type="application/json")
        response["Content-Disposition"] = f'attachment; filename="{base_name}.json"'
        return response

    @action(detail=True, methods=["get"])
    def oc_dotted_chart(self, request, pk=None):
        """Returns sampled event data for the object-centric dotted chart."""
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            row_min = _optional_int(request.query_params.get("row_min"))
            row_max = _optional_int(request.query_params.get("row_max"))
            max_points = int(request.query_params.get("max_points", 3000))
            sample_seed = int(request.query_params.get("sample_seed", 0))
        except ValueError:
            return Response(
                {"error": "row_min, row_max, max_points, and sample_seed must be integers"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            with _with_ocel_db(user_file) as db:
                result = get_oc_dotted_chart_data(
                    db,
                    t_min=request.query_params.get("t_min"),
                    t_max=request.query_params.get("t_max"),
                    row_min=row_min,
                    row_max=row_max,
                    x_axis=request.query_params.get("x_axis", "time"),
                    y_axis=request.query_params.get("y_axis"),
                    color_by=request.query_params.get("color_by", "activity"),
                    shape_by=request.query_params.get("shape_by", "none"),
                    sort_by=request.query_params.get("sort_by", "time"),
                    row_order=request.query_params.get("row_order", "first_occurrence"),
                    max_points=max_points,
                    sample_seed=sample_seed,
                )
        except Exception as e:
            return Response(
                {"error": f"Failed to load OC dotted chart data: {e}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(result, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"])
    def oc_dotted_chart_columns(self, request, pk=None):
        """Returns configurable dimensions for the object-centric dotted chart."""
        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            with _with_ocel_db(user_file) as db:
                result = get_oc_dotted_chart_columns(db)
        except Exception as e:
            return Response(
                {"error": f"Failed to load OC dotted chart columns: {e}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(result, status=status.HTTP_200_OK)

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
    
    @action(detail=True, methods=["PATCH"])
    def rename(self, request, pk=None):
        """
        Rename a dashboard. Only accepts `name` in the body.
        """
        dashboard = self.get_object()
        new_name = request.data.get("name")
        if not new_name:
            return Response({"error": "Name is required"}, status=status.HTTP_400_BAD_REQUEST)
        
        dashboard.name = new_name
        dashboard.save()
        return Response(self.get_serializer(dashboard).data)

        
        serializer.save(project=project)
    
    @action(detail=True, methods=["GET"])
    def get_layout(self, request, pk=None):
        dashboard = self.get_object()
        base_components = dashboard.components.all()
        components = []
        for comp in base_components:
            if comp.component_name == 'TextBoxComponent':
                components.append(TextBoxComponent.objects.get(id=comp.id))
            elif comp.component_name == 'NumberofEventsComponent':
                components.append(NumberofEventsComponent.objects.get(id=comp.id))
            elif comp.component_name == 'ImageComponent':
                components.append(ImageComponent.objects.get(id=comp.id))
            elif comp.component_name == 'VariantsComponent':
                components.append(VariantsComponent.objects.get(id=comp.id))
            elif comp.component_name == 'ProcessAreaComponent':
                components.append(ProcessAreaComponent.objects.get(id=comp.id))
            elif comp.component_name == 'LogStatisticsComponent':
                components.append(LogStatisticsComponent.objects.get(id=comp.id))
            elif comp.component_name == 'OCDFGComponent':
                components.append(OCDFGComponent.objects.get(id=comp.id))
            elif comp.component_name == 'OCDottedChartComponent':
                components.append(OCDottedChartComponent.objects.get(id=comp.id))
            elif comp.component_name in ('NewOCDFGComponent', 'NewOCDFGVariantsComponent'):
                components.append(NewOCDFGComponent.objects.get(id=comp.id))
            else:
                components.append(comp)
        print(f"Dashboard {pk} has {len(components)} components")
        for comp in components:
            print(f"Component {comp.id}: type {type(comp).__name__}, component_name {comp.component_name}, text {getattr(comp, 'text', 'N/A')}")
        serializer = DashboardComponentPolymorphicSerializer(components, many=True)
        data = serializer.data
        print("Serialized data:", data)
        return Response(data)
    
    @action(detail=True, methods=["POST"])
    def save_layout(self, request, pk=None):
        dashboard = self.get_object()
        layout = request.data.get("layout")

        if not isinstance(layout, list):
            return Response({"error": "layout must be a list"}, status=status.HTTP_400_BAD_REQUEST)

            # Clear existing components
        dashboard.components.all().delete()
        
        for item in layout:
            component_name = item['component_name']
            print(f"Saving item: {item}")
            if component_name == 'TextBoxComponent':
                comp = TextBoxComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    text=item.get('text', ''),
                    font_size=item.get('font_size', 14),
                )
                print(f"Created TextBoxComponent {comp.id} with text '{comp.text}'")

            elif component_name == 'NumberOfEventsComponent':
                NumberofEventsComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    color=item.get('color', 'blue'),
                )
            elif component_name == 'ImageComponent':
                # Extract image path, stripping /files/ prefix if present
                image_path = item.get('image', None)
                if image_path and isinstance(image_path, str) and image_path.startswith('/files/'):
                    image_path = image_path[7:]  # Remove '/files/' prefix
                
                ImageComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    image=image_path,
                )
            elif component_name == 'VariantsComponent':
                VariantsComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    automatic_loading=item.get('automatic_loading', False),
                    leading_object_type=item.get('leading_object_type', ''),
                    extraction=item.get('extraction') or 'leading_1hop',
                    iso=item.get('iso') or 'wl+vf2',
                    timeout_s=item.get('timeout_s', 10.0),
                )
            elif component_name == 'ProcessAreaComponent':
                ProcessAreaComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                )
            elif component_name == 'LogStatisticsComponent':
                LogStatisticsComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    show_num_events=item.get('show_num_events', True),
                    show_num_activities=item.get('show_num_activities', True),
                    show_num_objects=item.get('show_num_objects', True),
                    show_num_object_types=item.get('show_num_object_types', True),
                    show_earliest_timestamp=item.get('show_earliest_timestamp', False),
                    show_newest_timestamp=item.get('show_newest_timestamp', False),
                    show_duration=item.get('show_duration', False),
                )
            elif component_name == 'OCDFGComponent':
                OCDFGComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    show_controls=item.get('show_controls', True),
                    initial_interaction_locked=item.get('initial_interaction_locked', True),
                )
            elif component_name == 'OCDottedChartComponent':
                OCDottedChartComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    file_id=item.get('file_id'),
                    x_axis=item.get('x_axis') or 'time',
                    y_axis=item.get('y_axis') or 'activity',
                    color_by=item.get('color_by') or 'activity',
                    shape_by=item.get('shape_by') or 'none',
                    row_order=item.get('row_order') or 'first_occurrence',
                    max_points=item.get('max_points', 10000),
                    show_minimap=item.get('show_minimap', True),
                    show_controls=item.get('show_controls', True),
                )
            elif component_name in ('NewOCDFGComponent', 'NewOCDFGVariantsComponent'):
                NewOCDFGComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    show_controls=item.get('show_controls', True),
                    initial_interaction_locked=item.get('initial_interaction_locked', True),
                    layout_direction=item.get('layout_direction', 'TB'),
                )
            # Add more as needed

        return Response({"status": "saved"})

    @action(
    detail=True,
    methods=["post"],
    url_path="components/(?P<component_id>[^/.]+)/image",
    parser_classes=[MultiPartParser, FormParser],
    )
    def upload_image(self, request, pk=None, component_id=None):
        dashboard = self.get_object()

        image_file = request.FILES.get("image")
        if not image_file:
            return Response(
                {"error": "No image file provided"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            image_component = ImageComponent.objects.get(
                dashboardcomponent_ptr_id=component_id,
                dashboard=dashboard,
            )
        except ImageComponent.DoesNotExist:
            return Response(
                {"error": "ImageComponent not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        image_component.image = image_file
        image_component.save()
        
        return Response(
        {
            "id": image_component.id,
            "component_name": image_component.component_name,
            "image": image_component.image.url,
        },
        status=status.HTTP_200_OK,
    )



# ---------------------------------------------------------------------------
# OCEL loading — DuckDB-first
# ---------------------------------------------------------------------------
#
# Every endpoint below operates on an in-memory `OcelDuckDB`. For non-`.duckdb`
# uploads we go through `import_ocel_db` which materialises a fresh DuckDB
# from the source (one-time cost per cache lifetime). For `.duckdb` uploads
# we use the native `OcelDuckDB.load` which is essentially a file-handle open.
#
# Long-term we may also persist the converted DuckDB to disk on upload so
# cache misses skip the re-import — that's a follow-up, not done here.

def _build_ocel_db_from_path(path: str) -> OcelDuckDB:
    """Open an uploaded OCEL file as an `OcelDuckDB`, dispatching on extension."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".duckdb":
        return OcelDuckDB.load(path)
    if ext in (".sqlite", ".db", ".json", ".xml", ".csv"):
        # `import_ocel_db` infers the format from the extension.
        return import_ocel_db(path)
    raise ValueError(
        f"Unsupported file type: {ext}. "
        "Supported formats: .sqlite, .db, .json, .xml, .csv, .duckdb"
    )


def _build_ocel_from_path(path: str) -> ObjectCentricEventLog:
    """Load an uploaded OCEL file into an in-memory polars `ObjectCentricEventLog`.

    The simulation engine (`totem_lib.simulation`) operates on the polars OCEL
    model rather than `OcelDuckDB`, so simulation endpoints load through this
    helper instead of `_build_ocel_db_from_path`.
    """
    ext = os.path.splitext(path)[1].lower()
    if ext in (".sqlite", ".db"):
        events_df = load_events_from_sqlite(path)
        objects_df = load_objects_from_sqlite(path)
        log = ObjectCentricEventLog(events=events_df, objects=objects_df)
    elif ext == ".json":
        events_df = load_events_from_json(path)
        objects_df = load_objects_from_json(path)
        log = ObjectCentricEventLog(events=events_df, objects=objects_df)
    elif ext == ".xml":
        events_df = load_events_from_xml(path)
        objects_df = load_objects_from_xml(path)
        log = ObjectCentricEventLog(events=events_df, objects=objects_df)
    elif ext == ".csv":
        # CSV importer returns the complete ObjectCentricEventLog with attributes.
        log = import_ocel_from_csv(path)
    else:
        raise ValueError(
            f"Unsupported file type: {ext}. "
            "Supported formats: .sqlite, .db, .json, .xml, .csv"
        )

    return log


# Module-level process-local registry for OcelDuckDB instances.
#
# We can't use Django's cache here even though LocMemCache is "in-process":
# LocMemCache pickles every value on set() to preserve copy-on-read
# semantics, and `duckdb.DuckDBPyConnection` is a native C handle that
# cannot be pickled. Serializable derived results (totem_discovery_{pk},
# mlpa_discovery_{pk}) still use Django's cache normally.
#
# Concurrency model — a DuckDB connection is documented as "thread-safe but
# only one thread can execute a query at a time". Worse, our algorithms
# create connection-scoped TEMP TABLEs (e.g. `case_events` in
# `find_variants`), so two concurrent algorithm runs on the same connection
# would corrupt each other's temp state and can SIGSEGV the worker. The
# React dashboard fires four endpoints in parallel on first load, so this
# is not hypothetical.
#
# Solution: a per-file `threading.Lock`, acquired by every view for the
# duration of its algorithm work via `_with_ocel_db(user_file)`. Requests
# for different files still run in parallel.
#
# Both dicts live for the lifetime of the gunicorn/runserver worker. There
# is no TTL — the connection stays open until the process exits.
import threading
from contextlib import contextmanager
_OCEL_DB_REGISTRY: dict[int, OcelDuckDB]       = {}
_OCEL_DB_LOCKS:    dict[int, threading.Lock]   = {}
_OCEL_DB_REGISTRY_LOCK = threading.Lock()  # guards the dicts themselves


def _get_or_load_ocel_db(user_file) -> OcelDuckDB:
    """
    Return the process-local `OcelDuckDB` for this file, loading it on first
    call. **Does NOT acquire the per-file lock** — callers that intend to
    run a query against the connection must use `_with_ocel_db(...)` so
    concurrent requests are serialised. Read-only helpers that only need
    cheap, non-temp-table scalar queries can still call this directly.
    """
    pk = int(user_file.pk)
    db = _OCEL_DB_REGISTRY.get(pk)
    if db is not None:
        return db
    # Double-checked locking so concurrent first-loads only import once.
    with _OCEL_DB_REGISTRY_LOCK:
        db = _OCEL_DB_REGISTRY.get(pk)
        if db is None:
            db = _build_ocel_db_from_path(user_file.file.path)
            _OCEL_DB_REGISTRY[pk] = db
            _OCEL_DB_LOCKS[pk]    = threading.Lock()
    return db


@contextmanager
def _with_ocel_db(user_file):
    """
    Context manager that yields a loaded `OcelDuckDB` with the per-file lock
    held. Every view that runs an algorithm on the connection must use this
    so DuckDB never executes two queries on the same connection in parallel.

    Usage::

        with _with_ocel_db(user_file) as db:
            totem = totemDiscovery_db(db)
    """
    db = _get_or_load_ocel_db(user_file)
    lock = _OCEL_DB_LOCKS[int(user_file.pk)]
    with lock:
        yield db


def _object_types(db: OcelDuckDB) -> list[str]:
    """Distinct object types in the log (sorted, frontend-friendly)."""
    return sorted(
        r[0] for r in db.conn.execute(
            "SELECT DISTINCT obj_type FROM objects"
        ).fetchall()
    )


def _optional_int(value):
    if value in (None, ""):
        return None
    return int(value)


def _layout_shim(db: OcelDuckDB):
    """
    `calculate_layout` (in `ocvariants.py`) reads `ocel.obj_type_map` to label
    swim-lanes. The polars OCEL exposes that as a `cached_property` on the
    log object; the DuckDB OCEL doesn't. We materialise the same dict here
    and wrap it in a `SimpleNamespace` so the existing layout function
    works unchanged.
    """
    obj_type_map = dict(
        db.conn.execute("SELECT obj_id, obj_type FROM objects").fetchall()
    )
    return SimpleNamespace(obj_type_map=obj_type_map)


# NOTE: _extract_trace_variants_per_type and _apply_trace_limits have been
# removed from this file. That logic now lives in totem-lib:
#   NewOCDFGDb.compute_variants()               (variant extraction)
#   NewOCDFGDb.from_ocel_db_with_variant_ranks() (full annotated graph)




def _serialize_totem(totem: Totem) -> dict:
    """
    Convert a Totem object into a JSON-serializable structure matching the frontend contract.
    """
    tempgraph = {}
    raw_tempgraph = getattr(totem, "tempgraph", {}) or {}

    nodes = raw_tempgraph.get("nodes", [])
    if isinstance(nodes, set):
        tempgraph["nodes"] = sorted(nodes)
    else:
        tempgraph["nodes"] = list(nodes) if isinstance(nodes, (list, tuple)) else nodes

    for relation, edges in raw_tempgraph.items():
        if relation == "nodes":
            continue
        if isinstance(edges, set):
            tempgraph[relation] = [list(edge) for edge in sorted(edges)]
        elif isinstance(edges, list):
            tempgraph[relation] = [list(edge) if isinstance(edge, tuple) else edge for edge in edges]
        else:
            tempgraph[relation] = edges

    cardinalities = []
    for (source, target), data in getattr(totem, "cardinalities", {}).items():
        if not isinstance(data, dict):
            continue
        cardinalities.append({
            "from": source,
            "to": target,
            "log_cardinality": data.get("LC"),
            "event_cardinality": data.get("EC"),
        })
    cardinalities.sort(key=lambda item: (item["from"], item["to"]))

    type_relations = []
    for relation in getattr(totem, "type_relations", set()):
        relation_list = sorted(list(relation)) if isinstance(relation, (set, frozenset)) else relation
        type_relations.append(relation_list)
    type_relations.sort()

    all_event_types = sorted(getattr(totem, "all_event_types", []))

    object_type_to_event_types = {}
    for obj_type, events in getattr(totem, "object_type_to_event_types", {}).items():
        if isinstance(events, set):
            object_type_to_event_types[obj_type] = sorted(events)
        elif isinstance(events, (list, tuple)):
            object_type_to_event_types[obj_type] = list(events)
        else:
            object_type_to_event_types[obj_type] = []

    return {
        "tempgraph": tempgraph,
        "cardinalities": cardinalities,
        "type_relations": type_relations,
        "all_event_types": all_event_types,
        "object_type_to_event_types": object_type_to_event_types,
    }


def _serialize_mlpa(process_view: dict, totem: Totem) -> dict:
    """
    Convert MLPA output into a JSON-serializable structure for the frontend.

    MLPA returns: {level: [(object_types_set, event_types_set), ...], ...}
    We convert to: {layers: [{level, areas: [{objectTypes, eventTypes}]}], ...}
    """
    layers = []

    # Sort levels (they are floats like 0.0, 1.0, 2.0)
    sorted_levels = sorted(process_view.keys())

    for level in sorted_levels:
        areas = []
        for object_types_set, event_types_set in process_view[level]:
            # Convert sets to sorted lists for JSON serialization
            object_types = sorted(list(object_types_set)) if isinstance(object_types_set, set) else list(object_types_set)
            event_types = sorted(list(event_types_set)) if isinstance(event_types_set, set) else list(event_types_set)

            areas.append({
                "objectTypes": object_types,
                "eventTypes": event_types,
            })

        layers.append({
            "level": int(level),  # Convert float to int for cleaner JSON
            "areas": areas,
        })

    # Also include the serialized totem data for edge information
    totem_data = _serialize_totem(totem)

    return {
        "layers": layers,
        "tempgraph": totem_data["tempgraph"],
        "type_relations": totem_data["type_relations"],
        "all_event_types": totem_data["all_event_types"],
        "object_type_to_event_types": totem_data["object_type_to_event_types"],
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def discover_totem_mock(request, pk: int):
    """
    Temporary mock endpoint for Totem discovery until backend integration is ready.
    """
    variant = request.query_params.get("variant")
    payload = TOTEM_MOCK_2 # if variant == "2" else TOTEM_MOCK
    return Response(payload, status=status.HTTP_200_OK)

# Accepted enums for the advanced-settings query params on the variants
# endpoint. Keep in sync with totem_lib.variants.ocvariants_db.{Extraction,IsoStrategy}.
_VALID_EXTRACTIONS = {"leading_1hop", "leading_bfs", "connected"}
_VALID_ISOS = {"db_signature", "trace", "signature", "wl", "wl+vf2", "exact"}


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def variants(request):

    file_id = request.query_params.get("file_id")
    if not file_id:
        return Response({"error": "Missing ?file_id"}, status=status.HTTP_400_BAD_REQUEST)

    # Verify user has access to this file
    try:
        user_file = EventLog.objects.get(pk=file_id, project__users=request.user)
    except EventLog.DoesNotExist:
        return Response({"error": "File not found or access denied"}, status=status.HTTP_404_NOT_FOUND)

    if not os.path.exists(user_file.file.path):
        return Response(
            {"error": f"Path does not exist: {user_file.file.path}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # --- Advanced settings (query params, all optional with sane defaults) ---
    extraction = request.query_params.get("extraction") or "leading_1hop"
    iso        = request.query_params.get("iso")        or "wl+vf2"
    if extraction not in _VALID_EXTRACTIONS:
        return Response(
            {"error": f"Invalid extraction '{extraction}'. "
                      f"Allowed: {sorted(_VALID_EXTRACTIONS)}"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if iso not in _VALID_ISOS:
        return Response(
            {"error": f"Invalid iso '{iso}'. Allowed: {sorted(_VALID_ISOS)}"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        timeout_s = float(request.query_params.get("timeout_s", "10.0"))
        if timeout_s <= 0:
            timeout_s = None  # disable
    except (TypeError, ValueError):
        timeout_s = 10.0

    try:
        with _with_ocel_db(user_file) as db:
            obj_types = _object_types(db)

            # Leading type is only needed for the leading_* extractions.
            # For "connected" we skip the default-to-first-alphabetical
            # fallback entirely — the param is ignored downstream anyway.
            leading_object_type = request.query_params.get("leading_type")
            if extraction.startswith("leading"):
                if not leading_object_type or leading_object_type not in obj_types:
                    if not obj_types:
                        return Response({
                            "variants": [],
                            "object_types": [],
                        }, status=status.HTTP_200_OK)
                    leading_object_type = obj_types[0]
            else:
                leading_object_type = None

            # The default iso strategy ("wl+vf2") is sound and exact.
            # `find_variants` creates connection-scoped TEMP TABLEs — the
            # per-file lock from `_with_ocel_db` makes that safe under
            # concurrent requests. `timeout_s` arms a watchdog that
            # interrupts long SQL and raises TimeoutError.
            mined = find_variants(
                db,
                extraction=extraction,
                leading_type=leading_object_type,
                iso=iso,
                timeout_s=timeout_s,
                verbose=False,
            )
            # `calculate_layout` only reads `ocel.obj_type_map` — give it a
            # tiny shim backed by a SELECT against the DuckDB.
            layout_ocel = _layout_shim(db)
    except TimeoutError as e:
        return Response(
            {
                "error": str(e),
                "code": "timeout",
                "timeout_s": timeout_s,
                "hint": "Try a coarser iso strategy (db_signature / trace) "
                        "or a different extraction.",
            },
            status=status.HTTP_408_REQUEST_TIMEOUT,
        )
    except Exception as e:
        import traceback
        print(f"ERROR in find_variants: {e}")
        traceback.print_exc()
        return Response({"error": f"Variant computation failed: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    out = []
    for var in mined:
        layout_data = calculate_layout(var, layout_ocel)

        signature = " → ".join(
            node_data['label']
            for _, node_data in sorted(
                var.graph.nodes(data=True), key=lambda x: x[1]['timestamp']
            )
        )
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
                "types": node["types"],
            })

        out.append({
            "id": str(var.id),
            "support": int(var.support),
            "signature": signature_hash,
            "signature_hash": signature_hash,
            "graph": {
                "nodes": final_nodes,
                "edges": layout_data["edges"],
                "objects": layout_data["objects"],
            },
        })

    return Response({
        "variants": out,
        "object_types": obj_types,
    }, status=status.HTTP_200_OK)

@api_view(['GET'])
@permission_classes([AllowAny])
def OCDFGViewSet(request):
    """

    Args:
        request (_type_): _description_
    """
    
    simple_mockup = ({
        "directed": True,
        "multigraph": False,
        "graph": {
            "kind": "ocdfg"
        },
        "nodes": [
            {
                "label": "Review Document",
                "types": [
                    "Document"
                ],
                "role": None,
                "object_type": None,
                "id": "Review Document"
            },
            {
                "label": "Document start",
                "types": [
                    "Document"
                ],
                "role": "start",
                "object_type": "Document",
                "id": "__start__:Document"
            },
            {
                "label": "Document end",
                "types": [
                    "Document"
                ],
                "role": "end",
                "object_type": "Document",
                "id": "__end__:Document"
            }
        ],
        "links": [
            {
                "weights": {
                    "Document": 100
                },
                "weight": 100,
                "owners": [
                    "Document"
                ],
                "role": "start",
                "source": "__start__:Document",
                "target": "Review Document"
            },
            {
                "weights": {
                    "Document": 20
                },
                "weight": 20,
                "owners": [
                    "Document"
                ],
                "source": "Review Document",
                "target": "Review Document"
            },
            {
                "weights": {
                    "Document": 80
                },
                "weight": 80,
                "owners": [
                    "Document"
                ],
                "role": "end",
                "source": "Review Document",
                "target": "__end__:Document"
            }
        ]
    })
    
    mockup = ({
        "directed": True,
        "multigraph": False,
        "graph": {
            "kind": "ocdfg"
        },
        "nodes": [
            {
                "label": "Load Truck",
                "types": [
                    "Container",
                    "Handling Unit",
                    "Truck"
                ],
                "role": None,
                "object_type": None,
                "id": "Load Truck"
            },
            {
                "label": "Load to Vehicle",
                "types": [
                    "Container",
                    "Forklift",
                    "Vehicle"
                ],
                "role": None,
                "object_type": None,
                "id": "Load to Vehicle"
            },
            {
                "label": "Place in Stock",
                "types": [
                    "Container",
                    "Forklift"
                ],
                "role": None,
                "object_type": None,
                "id": "Place in Stock"
            },
            {
                "label": "Depart",
                "types": [
                    "Container",
                    "Transport Document",
                    "Vehicle"
                ],
                "role": None,
                "object_type": None,
                "id": "Depart"
            },
            {
                "label": "Bring to Loading Bay",
                "types": [
                    "Container",
                    "Forklift"
                ],
                "role": None,
                "object_type": None,
                "id": "Bring to Loading Bay"
            },
            {
                "label": "Reschedule Container",
                "types": [
                    "Container",
                    "Transport Document",
                    "Vehicle"
                ],
                "role": None,
                "object_type": None,
                "id": "Reschedule Container"
            },
            {
                "label": "Pick Up Empty Container",
                "types": [
                    "Container"
                ],
                "role": None,
                "object_type": None,
                "id": "Pick Up Empty Container"
            },
            {
                "label": "Drive to Terminal",
                "types": [
                    "Container",
                    "Truck"
                ],
                "role": None,
                "object_type": None,
                "id": "Drive to Terminal"
            },
            {
                "label": "Order Empty Containers",
                "types": [
                    "Container",
                    "Transport Document"
                ],
                "role": None,
                "object_type": None,
                "id": "Order Empty Containers"
            },
            {
                "label": "Weigh",
                "types": [
                    "Container",
                    "Forklift"
                ],
                "role": None,
                "object_type": None,
                "id": "Weigh"
            },
            {
                "label": "Container start",
                "types": [
                    "Container"
                ],
                "role": "start",
                "object_type": "Container",
                "id": "__start__:Container"
            },
            {
                "label": "Container end",
                "types": [
                    "Container"
                ],
                "role": "end",
                "object_type": "Container",
                "id": "__end__:Container"
            },
            {
                "label": "Register Customer Order",
                "types": [
                    "Customer Order"
                ],
                "role": None,
                "object_type": None,
                "id": "Register Customer Order"
            },
            {
                "label": "Create Transport Document",
                "types": [
                    "Customer Order",
                    "Transport Document"
                ],
                "role": None,
                "object_type": None,
                "id": "Create Transport Document"
            },
            {
                "label": "Customer Order start",
                "types": [
                    "Customer Order"
                ],
                "role": "start",
                "object_type": "Customer Order",
                "id": "__start__:Customer Order"
            },
            {
                "label": "Customer Order end",
                "types": [
                    "Customer Order"
                ],
                "role": "end",
                "object_type": "Customer Order",
                "id": "__end__:Customer Order"
            },
            {
                "label": "Forklift start",
                "types": [
                    "Forklift"
                ],
                "role": "start",
                "object_type": "Forklift",
                "id": "__start__:Forklift"
            },
            {
                "label": "Forklift end",
                "types": [
                    "Forklift"
                ],
                "role": "end",
                "object_type": "Forklift",
                "id": "__end__:Forklift"
            },
            {
                "label": "Collect Goods",
                "types": [
                    "Handling Unit"
                ],
                "role": None,
                "object_type": None,
                "id": "Collect Goods"
            },
            {
                "label": "Handling Unit start",
                "types": [
                    "Handling Unit"
                ],
                "role": "start",
                "object_type": "Handling Unit",
                "id": "__start__:Handling Unit"
            },
            {
                "label": "Handling Unit end",
                "types": [
                    "Handling Unit"
                ],
                "role": "end",
                "object_type": "Handling Unit",
                "id": "__end__:Handling Unit"
            },
            {
                "label": "Book Vehicles",
                "types": [
                    "Transport Document",
                    "Vehicle"
                ],
                "role": None,
                "object_type": None,
                "id": "Book Vehicles"
            },
            {
                "label": "Transport Document start",
                "types": [
                    "Transport Document"
                ],
                "role": "start",
                "object_type": "Transport Document",
                "id": "__start__:Transport Document"
            },
            {
                "label": "Transport Document end",
                "types": [
                    "Transport Document"
                ],
                "role": "end",
                "object_type": "Transport Document",
                "id": "__end__:Transport Document"
            },
            {
                "label": "Truck start",
                "types": [
                    "Truck"
                ],
                "role": "start",
                "object_type": "Truck",
                "id": "__start__:Truck"
            },
            {
                "label": "Truck end",
                "types": [
                    "Truck"
                ],
                "role": "end",
                "object_type": "Truck",
                "id": "__end__:Truck"
            },
            {
                "label": "Vehicle start",
                "types": [
                    "Vehicle"
                ],
                "role": "start",
                "object_type": "Vehicle",
                "id": "__start__:Vehicle"
            },
            {
                "label": "Vehicle end",
                "types": [
                    "Vehicle"
                ],
                "role": "end",
                "object_type": "Vehicle",
                "id": "__end__:Vehicle"
            }
        ],
        "links": [
            {
                "weights": {
                    "Container": 1989,
                    "Truck": 1989
                },
                "weight": 3978,
                "owners": [
                    "Container",
                    "Truck"
                ],
                "source": "Load Truck",
                "target": "Drive to Terminal"
            },
            {
                "weights": {
                    "Container": 8559,
                    "Truck": 8559
                },
                "weight": 17118,
                "owners": [
                    "Container",
                    "Truck"
                ],
                "source": "Load Truck",
                "target": "Load Truck"
            },
            {
                "weights": {
                    "Container": 5
                },
                "weight": 5,
                "owners": [
                    "Container"
                ],
                "role": "end",
                "source": "Load Truck",
                "target": "__end__:Container"
            },
            {
                "weights": {
                    "Handling Unit": 10553
                },
                "weight": 10553,
                "owners": [
                    "Handling Unit"
                ],
                "role": "end",
                "source": "Load Truck",
                "target": "__end__:Handling Unit"
            },
            {
                "weights": {
                    "Truck": 5
                },
                "weight": 5,
                "owners": [
                    "Truck"
                ],
                "role": "end",
                "source": "Load Truck",
                "target": "__end__:Truck"
            },
            {
                "weights": {
                    "Container": 1956,
                    "Vehicle": 127
                },
                "weight": 2083,
                "owners": [
                    "Container",
                    "Vehicle"
                ],
                "source": "Load to Vehicle",
                "target": "Depart"
            },
            {
                "weights": {
                    "Container": 10
                },
                "weight": 10,
                "owners": [
                    "Container"
                ],
                "role": "end",
                "source": "Load to Vehicle",
                "target": "__end__:Container"
            },
            {
                "weights": {
                    "Forklift": 604
                },
                "weight": 604,
                "owners": [
                    "Forklift"
                ],
                "source": "Load to Vehicle",
                "target": "Weigh"
            },
            {
                "weights": {
                    "Forklift": 9,
                    "Vehicle": 1827
                },
                "weight": 1836,
                "owners": [
                    "Forklift",
                    "Vehicle"
                ],
                "source": "Load to Vehicle",
                "target": "Load to Vehicle"
            },
            {
                "weights": {
                    "Forklift": 1352
                },
                "weight": 1352,
                "owners": [
                    "Forklift"
                ],
                "source": "Load to Vehicle",
                "target": "Bring to Loading Bay"
            },
            {
                "weights": {
                    "Forklift": 1
                },
                "weight": 1,
                "owners": [
                    "Forklift"
                ],
                "role": "end",
                "source": "Load to Vehicle",
                "target": "__end__:Forklift"
            },
            {
                "weights": {
                    "Vehicle": 2
                },
                "weight": 2,
                "owners": [
                    "Vehicle"
                ],
                "source": "Load to Vehicle",
                "target": "Book Vehicles"
            },
            {
                "weights": {
                    "Container": 1794,
                    "Forklift": 438
                },
                "weight": 2232,
                "owners": [
                    "Container",
                    "Forklift"
                ],
                "source": "Place in Stock",
                "target": "Bring to Loading Bay"
            },
            {
                "weights": {
                    "Container": 20
                },
                "weight": 20,
                "owners": [
                    "Container"
                ],
                "role": "end",
                "source": "Place in Stock",
                "target": "__end__:Container"
            },
            {
                "weights": {
                    "Forklift": 1352
                },
                "weight": 1352,
                "owners": [
                    "Forklift"
                ],
                "source": "Place in Stock",
                "target": "Weigh"
            },
            {
                "weights": {
                    "Forklift": 24
                },
                "weight": 24,
                "owners": [
                    "Forklift"
                ],
                "source": "Place in Stock",
                "target": "Load to Vehicle"
            },
            {
                "weights": {
                    "Container": 1956
                },
                "weight": 1956,
                "owners": [
                    "Container"
                ],
                "role": "end",
                "source": "Depart",
                "target": "__end__:Container"
            },
            {
                "weights": {
                    "Transport Document": 21
                },
                "weight": 21,
                "owners": [
                    "Transport Document"
                ],
                "source": "Depart",
                "target": "Reschedule Container"
            },
            {
                "weights": {
                    "Transport Document": 160
                },
                "weight": 160,
                "owners": [
                    "Transport Document"
                ],
                "source": "Depart",
                "target": "Depart"
            },
            {
                "weights": {
                    "Transport Document": 573
                },
                "weight": 573,
                "owners": [
                    "Transport Document"
                ],
                "role": "end",
                "source": "Depart",
                "target": "__end__:Transport Document"
            },
            {
                "weights": {
                    "Vehicle": 127
                },
                "weight": 127,
                "owners": [
                    "Vehicle"
                ],
                "role": "end",
                "source": "Depart",
                "target": "__end__:Vehicle"
            },
            {
                "weights": {
                    "Container": 36
                },
                "weight": 36,
                "owners": [
                    "Container"
                ],
                "source": "Bring to Loading Bay",
                "target": "Reschedule Container"
            },
            {
                "weights": {
                    "Container": 1931,
                    "Forklift": 1933
                },
                "weight": 3864,
                "owners": [
                    "Container",
                    "Forklift"
                ],
                "source": "Bring to Loading Bay",
                "target": "Load to Vehicle"
            },
            {
                "weights": {
                    "Container": 2
                },
                "weight": 2,
                "owners": [
                    "Container"
                ],
                "role": "end",
                "source": "Bring to Loading Bay",
                "target": "__end__:Container"
            },
            {
                "weights": {
                    "Forklift": 4
                },
                "weight": 4,
                "owners": [
                    "Forklift"
                ],
                "source": "Bring to Loading Bay",
                "target": "Bring to Loading Bay"
            },
            {
                "weights": {
                    "Forklift": 30
                },
                "weight": 30,
                "owners": [
                    "Forklift"
                ],
                "source": "Bring to Loading Bay",
                "target": "Weigh"
            },
            {
                "weights": {
                    "Forklift": 2
                },
                "weight": 2,
                "owners": [
                    "Forklift"
                ],
                "role": "end",
                "source": "Bring to Loading Bay",
                "target": "__end__:Forklift"
            },
            {
                "weights": {
                    "Container": 35,
                    "Vehicle": 7
                },
                "weight": 42,
                "owners": [
                    "Container",
                    "Vehicle"
                ],
                "source": "Reschedule Container",
                "target": "Load to Vehicle"
            },
            {
                "weights": {
                    "Container": 1
                },
                "weight": 1,
                "owners": [
                    "Container"
                ],
                "role": "end",
                "source": "Reschedule Container",
                "target": "__end__:Container"
            },
            {
                "weights": {
                    "Transport Document": 33
                },
                "weight": 33,
                "owners": [
                    "Transport Document"
                ],
                "source": "Reschedule Container",
                "target": "Depart"
            },
            {
                "weights": {
                    "Transport Document": 2,
                    "Vehicle": 16
                },
                "weight": 18,
                "owners": [
                    "Transport Document",
                    "Vehicle"
                ],
                "source": "Reschedule Container",
                "target": "Reschedule Container"
            },
            {
                "weights": {
                    "Transport Document": 1
                },
                "weight": 1,
                "owners": [
                    "Transport Document"
                ],
                "role": "end",
                "source": "Reschedule Container",
                "target": "__end__:Transport Document"
            },
            {
                "weights": {
                    "Vehicle": 12
                },
                "weight": 12,
                "owners": [
                    "Vehicle"
                ],
                "source": "Reschedule Container",
                "target": "Book Vehicles"
            },
            {
                "weights": {
                    "Container": 1994
                },
                "weight": 1994,
                "owners": [
                    "Container"
                ],
                "source": "Pick Up Empty Container",
                "target": "Load Truck"
            },
            {
                "weights": {
                    "Container": 1
                },
                "weight": 1,
                "owners": [
                    "Container"
                ],
                "role": "end",
                "source": "Pick Up Empty Container",
                "target": "__end__:Container"
            },
            {
                "weights": {
                    "Container": 1989
                },
                "weight": 1989,
                "owners": [
                    "Container"
                ],
                "source": "Drive to Terminal",
                "target": "Weigh"
            },
            {
                "weights": {
                    "Truck": 1988
                },
                "weight": 1988,
                "owners": [
                    "Truck"
                ],
                "source": "Drive to Terminal",
                "target": "Load Truck"
            },
            {
                "weights": {
                    "Truck": 1
                },
                "weight": 1,
                "owners": [
                    "Truck"
                ],
                "role": "end",
                "source": "Drive to Terminal",
                "target": "__end__:Truck"
            },
            {
                "weights": {
                    "Container": 1995
                },
                "weight": 1995,
                "owners": [
                    "Container"
                ],
                "source": "Order Empty Containers",
                "target": "Pick Up Empty Container"
            },
            {
                "weights": {
                    "Container": 4
                },
                "weight": 4,
                "owners": [
                    "Container"
                ],
                "role": "end",
                "source": "Order Empty Containers",
                "target": "__end__:Container"
            },
            {
                "weights": {
                    "Transport Document": 13
                },
                "weight": 13,
                "owners": [
                    "Transport Document"
                ],
                "source": "Order Empty Containers",
                "target": "Reschedule Container"
            },
            {
                "weights": {
                    "Transport Document": 561
                },
                "weight": 561,
                "owners": [
                    "Transport Document"
                ],
                "source": "Order Empty Containers",
                "target": "Depart"
            },
            {
                "weights": {
                    "Transport Document": 19
                },
                "weight": 19,
                "owners": [
                    "Transport Document"
                ],
                "role": "end",
                "source": "Order Empty Containers",
                "target": "__end__:Transport Document"
            },
            {
                "weights": {
                    "Container": 1814,
                    "Forklift": 1814
                },
                "weight": 3628,
                "owners": [
                    "Container",
                    "Forklift"
                ],
                "source": "Weigh",
                "target": "Place in Stock"
            },
            {
                "weights": {
                    "Container": 175,
                    "Forklift": 175
                },
                "weight": 350,
                "owners": [
                    "Container",
                    "Forklift"
                ],
                "source": "Weigh",
                "target": "Bring to Loading Bay"
            },
            {
                "weights": {
                    "Container": 1999
                },
                "weight": 1999,
                "owners": [
                    "Container"
                ],
                "role": "start",
                "source": "__start__:Container",
                "target": "Order Empty Containers"
            },
            {
                "weights": {
                    "Customer Order": 594
                },
                "weight": 594,
                "owners": [
                    "Customer Order"
                ],
                "source": "Register Customer Order",
                "target": "Create Transport Document"
            },
            {
                "weights": {
                    "Customer Order": 6
                },
                "weight": 6,
                "owners": [
                    "Customer Order"
                ],
                "role": "end",
                "source": "Register Customer Order",
                "target": "__end__:Customer Order"
            },
            {
                "weights": {
                    "Customer Order": 594
                },
                "weight": 594,
                "owners": [
                    "Customer Order"
                ],
                "role": "end",
                "source": "Create Transport Document",
                "target": "__end__:Customer Order"
            },
            {
                "weights": {
                    "Transport Document": 594
                },
                "weight": 594,
                "owners": [
                    "Transport Document"
                ],
                "source": "Create Transport Document",
                "target": "Book Vehicles"
            },
            {
                "weights": {
                    "Customer Order": 600
                },
                "weight": 600,
                "owners": [
                    "Customer Order"
                ],
                "role": "start",
                "source": "__start__:Customer Order",
                "target": "Register Customer Order"
            },
            {
                "weights": {
                    "Forklift": 3
                },
                "weight": 3,
                "owners": [
                    "Forklift"
                ],
                "role": "start",
                "source": "__start__:Forklift",
                "target": "Weigh"
            },
            {
                "weights": {
                    "Handling Unit": 10553
                },
                "weight": 10553,
                "owners": [
                    "Handling Unit"
                ],
                "source": "Collect Goods",
                "target": "Load Truck"
            },
            {
                "weights": {
                    "Handling Unit": 10553
                },
                "weight": 10553,
                "owners": [
                    "Handling Unit"
                ],
                "role": "start",
                "source": "__start__:Handling Unit",
                "target": "Collect Goods"
            },
            {
                "weights": {
                    "Transport Document": 593
                },
                "weight": 593,
                "owners": [
                    "Transport Document"
                ],
                "source": "Book Vehicles",
                "target": "Order Empty Containers"
            },
            {
                "weights": {
                    "Transport Document": 1
                },
                "weight": 1,
                "owners": [
                    "Transport Document"
                ],
                "role": "end",
                "source": "Book Vehicles",
                "target": "__end__:Transport Document"
            },
            {
                "weights": {
                    "Vehicle": 122
                },
                "weight": 122,
                "owners": [
                    "Vehicle"
                ],
                "source": "Book Vehicles",
                "target": "Load to Vehicle"
            },
            {
                "weights": {
                    "Vehicle": 596
                },
                "weight": 596,
                "owners": [
                    "Vehicle"
                ],
                "source": "Book Vehicles",
                "target": "Book Vehicles"
            },
            {
                "weights": {
                    "Vehicle": 19
                },
                "weight": 19,
                "owners": [
                    "Vehicle"
                ],
                "source": "Book Vehicles",
                "target": "Reschedule Container"
            },
            {
                "weights": {
                    "Transport Document": 594
                },
                "weight": 594,
                "owners": [
                    "Transport Document"
                ],
                "role": "start",
                "source": "__start__:Transport Document",
                "target": "Create Transport Document"
            },
            {
                "weights": {
                    "Truck": 6
                },
                "weight": 6,
                "owners": [
                    "Truck"
                ],
                "role": "start",
                "source": "__start__:Truck",
                "target": "Load Truck"
            },
            {
                "weights": {
                    "Vehicle": 127
                },
                "weight": 127,
                "owners": [
                    "Vehicle"
                ],
                "role": "start",
                "source": "__start__:Vehicle",
                "target": "Book Vehicles"
            }
        ]
    })

    # return Response({"dfg": mockup}, status=status.HTTP_200_OK)

    file_id = request.query_params.get("file_id")
    if not file_id:
        return Response({"error": "Missing ?file_id parameter"}, status=status.HTTP_400_BAD_REQUEST)

    # Optional object-type filter (comma-separated)
    raw_object_types = request.query_params.get("object_types")
    object_type_filter = None
    if raw_object_types:
        object_type_filter = set([t.strip() for t in raw_object_types.split(",") if t.strip()])

    try:
        user_file = EventLog.objects.get(id=file_id)
    except EventLog.DoesNotExist:
        return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

    try:
        with _with_ocel_db(user_file) as db:
            # Full OCDFG (unfiltered) for register.
            # edges="links" preserves the pre-NetworkX-3.4 key name the
            # frontend expects.
            ocdfg_full = OCDFGDb.from_ocel_db(db)
            dfg_json_full = nx.node_link_data(ocdfg_full, edges="links")
            all_nodes = [
                {
                    "id": n.get("id"),
                    "types": n.get("types", []),
                    "role": n.get("role"),
                    "object_type": n.get("object_type"),
                }
                for n in dfg_json_full.get("nodes", [])
            ]

            # Filtered OCDFG if object types specified. `OCDFGDb.from_ocel_db`
            # pushes the type filter into SQL itself — no separate OCEL
            # subsetting step is needed.
            filter_error = None
            trace_variants = None
            if object_type_filter:
                try:
                    ocdfg_filtered = OCDFGDb.from_ocel_db(
                        db, object_types=sorted(object_type_filter)
                    )
                    if len(ocdfg_filtered.nodes) == 0:
                        dfg_json = {
                            "directed": True, "multigraph": False,
                            "graph": {"kind": "ocdfg"}, "nodes": [], "links": [],
                        }
                    else:
                        dfg_json = nx.node_link_data(ocdfg_filtered, edges="links")

                    # Per-object-type trace variants for the filtered types.
                    trace_variants = NewOCDFGDb.compute_variants(db, object_types=list(object_type_filter))
                except Exception as e:
                    # Gracefully fall back to unfiltered graph to avoid
                    # frontend breakage, but surface warning.
                    filter_error = f"Failed to compute filtered OCDFG: {e}"
                    dfg_json = dfg_json_full
            else:
                dfg_json = dfg_json_full

            # Always compute trace_variants if not already computed — use
            # all object types from the OCEL when no filter is specified.
            if trace_variants is None:
                try:
                    all_object_types = _object_types(db)
                    if all_object_types:
                        trace_variants = NewOCDFGDb.compute_variants(db, object_types=all_object_types)
                except Exception as e:
                    print(f"[OCDFG] Failed to compute trace variants: {e}")

        response_payload = {"dfg": dfg_json, "all_nodes": all_nodes}
        if filter_error:
            response_payload["filter_error"] = filter_error
        if trace_variants:
            response_payload["trace_variants"] = trace_variants

        return Response(response_payload, status=status.HTTP_200_OK)

    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(['GET'])
@permission_classes([AllowAny])
def NewOCDFGViewSet(request):
    """
    Thin routing layer for the New OC-DFG endpoint.

    Delegates all computation to ``NewOCDFGDb.from_ocel_db_with_variant_ranks``
    in totem-lib.  The only Django-layer responsibilities are:
      1. Parse / validate query params.
      2. Resolve the EventLog → open OcelDuckDB.
      3. Call the lib method.
      4. Serialize the NetworkX graph to JSON and return.

    Variant filtering is now done **entirely on the frontend** using the
    ``variant_rank`` attribute annotated on every edge by the lib.  No
    ``trace_limits`` query parameter is accepted or processed here.
    """
    file_id = request.query_params.get("file_id")
    if not file_id:
        return Response({"error": "Missing ?file_id parameter"}, status=status.HTTP_400_BAD_REQUEST)

    # Optional object-type filter (comma-separated)
    raw_object_types = request.query_params.get("object_types")
    object_type_filter = None
    if raw_object_types:
        object_type_filter = sorted(
            t.strip() for t in raw_object_types.split(",") if t.strip()
        ) or None

    try:
        user_file = EventLog.objects.get(id=file_id)
    except EventLog.DoesNotExist:
        return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

    try:
        with _with_ocel_db(user_file) as db:
            # Delegate all process-mining logic to totem-lib.
            # Returns the annotated graph and per-type variant counts for sliders.
            ocdfg, variant_counts = NewOCDFGDb.from_ocel_db_with_variant_ranks(
                db, object_types=object_type_filter
            )

            if len(ocdfg.nodes) == 0:
                dfg_json = {
                    "directed": True, "multigraph": True,
                    "graph": {"kind": "new_ocdfg"}, "nodes": [], "links": [],
                }
            else:
                dfg_json = nx.node_link_data(ocdfg, edges="links")

            all_nodes = [
                {
                    "id": n.get("id"),
                    "types": n.get("types", []),
                    "role": n.get("role"),
                    "object_type": n.get("object_type"),
                }
                for n in dfg_json.get("nodes", [])
            ]

        return Response(
            {
                "dfg": dfg_json,
                "all_nodes": all_nodes,
                "variant_counts": variant_counts,
            },
            status=status.HTTP_200_OK,
        )

    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def _sim_tmp_dir() -> str:
    """Directory holding simulated logs that have not (yet) been kept by the user.

    These files back a finished simulation run (graph edit distance, download,
    and the optional "keep as event log" step) without creating an EventLog
    row, so trial runs don't clutter the user's file list.
    """
    d = os.path.join(settings.MEDIA_ROOT, "sim_tmp")
    os.makedirs(d, exist_ok=True)
    return d


def _cleanup_sim_tmp(max_age_s: int = 7200) -> None:
    """Delete unsaved simulation temp files older than ``max_age_s``.

    Runs opportunistically on each simulation so logs the user never kept (and
    whose cache entry has long expired) don't accumulate on disk.
    """
    d = _sim_tmp_dir()
    now = dt.datetime.now().timestamp()
    for name in os.listdir(d):
        path = os.path.join(d, name)
        try:
            if os.path.isfile(path) and now - os.path.getmtime(path) > max_age_s:
                os.remove(path)
        except OSError:
            pass


def _export_ocel_to_json(ocel) -> str:
    """Export an ObjectCentricEventLog to an OCEL 2.0 JSON string.

    Delegates to the totem_lib exporter so the produced file is a standard
    OCEL 2.0 document (with objectTypes/eventTypes, attributes and inferred
    attribute types) that can be re-imported for further analyses.
    """
    return json.dumps(build_ocel2_json(ocel), ensure_ascii=False, indent=2)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def run_simulation(request):
    """
    Run an OC Process Area simulation.

    Expected JSON body:
    {
        "file_id": int,
        "object_types": ["Type1", "Type2"],
        "activities": ["Act1", "Act2"],
        "resource_pool": {"ResourceType1": 3, "ResourceType2": 5},
        "sim_duration_days": 7,
        "tick_size_s": 60,
        "resource_constraint_violation_degree": 0.0,
        "constraint_lookback_length": null
    }
    """
    file_id = request.data.get("file_id")
    object_types = request.data.get("object_types", [])
    activities = request.data.get("activities", [])
    resource_pool = request.data.get("resource_pool", {})
    sim_duration_days = request.data.get("sim_duration_days", 7)
    tick_size_s = request.data.get("tick_size_s", 30)
    sim_start_unix = request.data.get("sim_start_unix", None)
    violation_degree = request.data.get("resource_constraint_violation_degree", 0.0)
    lookback_length = request.data.get("constraint_lookback_length", None)
    model_activity_durations = request.data.get("model_activity_durations", True)
    mode = request.data.get("mode", "simple")  # "simple" or "advanced"

    if not file_id:
        return Response({"error": "Missing file_id"}, status=status.HTTP_400_BAD_REQUEST)
    if not object_types:
        return Response({"error": "Missing object_types"}, status=status.HTTP_400_BAD_REQUEST)
    if not activities:
        return Response({"error": "Missing activities"}, status=status.HTTP_400_BAD_REQUEST)
    if not resource_pool:
        return Response({"error": "Missing resource_pool"}, status=status.HTTP_400_BAD_REQUEST)

    # Verify user access
    try:
        EventLog.objects.get(pk=file_id, project__users=request.user)
    except EventLog.DoesNotExist:
        return Response({"error": "File not found or access denied"}, status=status.HTTP_404_NOT_FOUND)

    # Load OCEL
    cache_key = f"ocel_object_{file_id}"
    ocel = cache.get(cache_key)
    if not ocel:
        try:
            uf = EventLog.objects.get(pk=file_id)
            ocel = _build_ocel_from_path(uf.file.path)
            cache.set(cache_key, ocel, timeout=3600)
        except Exception as e:
            return Response({"error": f"Failed to load OCEL: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    try:
        # Build Process Area
        process_area = ProcessArea(object_types=object_types, activities=activities)

        # Build simulation model based on mode
        if mode == "advanced":
            simulation_model = OCProcessAreaSimulationModel.for_advanced_simulation(ocel, process_area)
        else:
            simulation_model = OCProcessAreaSimulationModel.for_simple_simulation(ocel, process_area)

        # Override config if provided
        simulation_model.simulation_config = OCProcessAreaSimulationConfiguration(
            resource_constraint_violation_degree=violation_degree,
            constraint_lookback_length=lookback_length,
            model_activity_durations=bool(model_activity_durations),
        )

        # Convert sim_start_unix to datetime
        start_datetime = (
            dt.datetime.fromtimestamp(int(sim_start_unix), tz=dt.timezone.utc)
            if sim_start_unix is not None
            else None
        )

        # Run simulation
        sim_duration_s = int(sim_duration_days * 24 * 3600)
        with EvalTimer() as sim_timer:
            sim_log, finished_count, spawned_count = simulation_model.run(
                sim_duration_s=sim_duration_s,
                resource_pool=resource_pool,
                tick_size_s=tick_size_s,
                start_datetime=start_datetime,
            )

        # Filter original OCEL by process area for comparison
        totem = totemDiscovery(ocel)
        mlpa = mlpaDiscovery(totem)
        filtered_ocel = ocel.filter_by_process_area(mlpa, process_area)

        # Multi-perspective evaluation (Chapela-Campa BPM 2023 + OC extras)
        evaluation = None
        evaluation_error = None
        try:
            cooldown_dist = getattr(simulation_model, "resource_cooldown_distribution", None)
            evaluation = build_evaluation_payload(
                filtered_ocel, sim_log,
                cooldown_distribution=cooldown_dist,
            )
            evaluation["runtime"] = {"simulation_s": sim_timer.elapsed_s}
        except Exception as eval_err:
            import traceback
            traceback.print_exc()
            evaluation_error = str(eval_err)

        # Persist the simulated OCEL (standard OCEL 2.0 JSON) to a temporary file
        # only -- NOT as an EventLog. It is integrated into the user's event log
        # collection lazily, when the user explicitly chooses to keep it (see
        # simulation_save_log). Keeping it out of the EventLog table avoids
        # cluttering the file list with every trial run.
        _cleanup_sim_tmp()
        original_log = EventLog.objects.get(pk=file_id)
        original_name = os.path.splitext(os.path.basename(original_log.file.name))[0]
        timestamp_str = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        sim_filename = f"{original_name}_sim_{timestamp_str}.json"

        json_content = _export_ocel_to_json(sim_log)
        sim_run_id = uuid.uuid4().hex
        tmp_path = os.path.join(_sim_tmp_dir(), f"{sim_run_id}.json")
        with open(tmp_path, "w", encoding="utf-8") as fh:
            fh.write(json_content)

        # Cache the actual (filtered) OCEL plus the path to the simulated log's
        # temp file, so the expensive graph edit distance can be computed lazily
        # by reloading the simulated log from disk instead of holding a second
        # full copy of the whole log in memory.
        cache.set(
            f"sim_run_{sim_run_id}",
            {
                "actual_ocel": filtered_ocel,
                "simulated_tmp_path": tmp_path,
                "sim_filename": sim_filename,
                "project_id": original_log.project_id,
            },
            timeout=3600,
        )

        # Build response
        response_data = {
            "finished_instances": finished_count,
            "spawned_instances": spawned_count,
            "completion_ratio": (finished_count / spawned_count) if spawned_count else 0.0,
            "simulated_events": sim_log.events.height if sim_log.events is not None else 0,
            "simulated_objects": sim_log.objects.height if sim_log.objects is not None else 0,
            "evaluation": evaluation,
            "evaluation_error": evaluation_error,
            "sim_run_id": sim_run_id,
            "simulated_filename": sim_filename,
            "simulated_saved": False,
        }

        return Response(response_data, status=status.HTTP_200_OK)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({"error": f"Simulation failed: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def simulation_graph_edit_distance(request):
    """
    Lazily compute the (expensive) Object Graph Edit Distance for a finished
    simulation run.

    The frontend calls this after the cheap metrics are already shown, using
    the ``sim_run_id`` returned by ``run_simulation``. The actual (filtered)
    OCEL is looked up from the server-side cache, while the simulated log is
    reloaded from its temp file rather than kept fully in memory.
    """
    sim_run_id = request.data.get("sim_run_id")
    if not sim_run_id:
        return Response({"error": "Missing sim_run_id"}, status=status.HTTP_400_BAD_REQUEST)

    cached = cache.get(f"sim_run_{sim_run_id}")
    if cached is None:
        return Response(
            {"error": "Simulation result expired. Re-run the simulation to compute the graph edit distance."},
            status=status.HTTP_404_NOT_FOUND,
        )

    filtered_ocel = cached["actual_ocel"]
    tmp_path = cached.get("simulated_tmp_path")

    if not tmp_path or not os.path.exists(tmp_path):
        return Response(
            {"error": "Simulated event log no longer available. Re-run the simulation."},
            status=status.HTTP_404_NOT_FOUND,
        )

    try:
        sim_log = _build_ocel_from_path(tmp_path)
        value = compute_graph_edit_distance(filtered_ocel, sim_log, timeout_s=1.0)
        return Response({"graph_edit_distance": value}, status=status.HTTP_200_OK)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({"error": f"Graph edit distance computation failed: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def simulation_save_log(request):
    """Keep a finished simulation run as an EventLog in the user's collection.

    A simulated log is only persisted (and thus shown in the file list) when the
    user explicitly chooses to keep it. Until then it lives only as a temporary
    file referenced by the cached simulation run. Idempotent: calling it twice
    for the same ``sim_run_id`` returns the already-saved entry.
    """
    sim_run_id = request.data.get("sim_run_id")
    if not sim_run_id:
        return Response({"error": "Missing sim_run_id"}, status=status.HTTP_400_BAD_REQUEST)

    cached = cache.get(f"sim_run_{sim_run_id}")
    if cached is None:
        return Response(
            {"error": "Simulation result expired. Re-run the simulation to keep the log."},
            status=status.HTTP_404_NOT_FOUND,
        )

    existing_id = cached.get("saved_file_id")
    if existing_id:
        try:
            existing = EventLog.objects.get(pk=existing_id, project__users=request.user)
            return Response(
                {
                    "id": existing.id,
                    "project": existing.project_id,
                    "file": existing.file.name,
                    "uploaded_at": existing.uploaded_at.isoformat(),
                },
                status=status.HTTP_200_OK,
            )
        except EventLog.DoesNotExist:
            pass

    tmp_path = cached.get("simulated_tmp_path")
    if not tmp_path or not os.path.exists(tmp_path):
        return Response(
            {"error": "Simulated event log no longer available. Re-run the simulation."},
            status=status.HTTP_404_NOT_FOUND,
        )

    try:
        project = Project.objects.get(pk=cached["project_id"], users=request.user)
    except Project.DoesNotExist:
        return Response({"error": "Project not found or access denied"}, status=status.HTTP_404_NOT_FOUND)

    with open(tmp_path, "r", encoding="utf-8") as fh:
        json_content = fh.read()

    sim_log_entry = EventLog(project=project)
    sim_log_entry.file.save(cached["sim_filename"], ContentFile(json_content.encode("utf-8")), save=True)

    cached["saved_file_id"] = sim_log_entry.id
    cache.set(f"sim_run_{sim_run_id}", cached, timeout=3600)

    return Response(
        {
            "id": sim_log_entry.id,
            "project": sim_log_entry.project_id,
            "file": sim_log_entry.file.name,
            "uploaded_at": sim_log_entry.uploaded_at.isoformat(),
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def simulation_download_log(request):
    """Stream a finished simulation run's log for download without persisting it.

    Lets the user export the simulated OCEL 2.0 JSON straight from the temp file,
    so they can download a trial run without adding it to their event logs.
    """
    sim_run_id = request.query_params.get("sim_run_id")
    if not sim_run_id:
        return Response({"error": "Missing sim_run_id"}, status=status.HTTP_400_BAD_REQUEST)

    cached = cache.get(f"sim_run_{sim_run_id}")
    if cached is None:
        return Response(
            {"error": "Simulation result expired. Re-run the simulation to download the log."},
            status=status.HTTP_404_NOT_FOUND,
        )

    tmp_path = cached.get("simulated_tmp_path")
    if not tmp_path or not os.path.exists(tmp_path):
        return Response(
            {"error": "Simulated event log no longer available. Re-run the simulation."},
            status=status.HTTP_404_NOT_FOUND,
        )

    with open(tmp_path, "r", encoding="utf-8") as fh:
        json_content = fh.read()

    response = HttpResponse(json_content, content_type="application/json")
    response["Content-Disposition"] = f'attachment; filename="{cached["sim_filename"]}"'
    return response


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_process_areas(request):
    """
    Get discovered process areas (via MLPA) for a given file.
    Returns object types, activities, their groupings, and the object_type_to_event_types mapping.
    """
    file_id = request.query_params.get("file_id")
    if not file_id:
        return Response({"error": "Missing ?file_id"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        EventLog.objects.get(pk=file_id, project__users=request.user)
    except EventLog.DoesNotExist:
        return Response({"error": "File not found or access denied"}, status=status.HTTP_404_NOT_FOUND)

    cache_key = f"ocel_object_{file_id}"
    ocel = cache.get(cache_key)
    if not ocel:
        try:
            uf = EventLog.objects.get(pk=file_id)
            ocel = _build_ocel_from_path(uf.file.path)
            cache.set(cache_key, ocel, timeout=3600)
        except Exception as e:
            return Response({"error": f"Failed to load OCEL: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    try:
        totem = totemDiscovery(ocel)
        mlpa = mlpaDiscovery(totem)

        # Get all object types and activities
        all_object_types = sorted(ocel.object_types)
        all_activities = sorted(ocel.events.select('_activity').unique().to_series().to_list())

        # Get object type counts
        obj_type_event_count = {}
        for obj_type in all_object_types:
            type_objects = ocel.objects.filter(pl.col("_objType") == obj_type).select("_objId").to_series().to_list()
            obj_type_event_count[obj_type] = len(type_objects)

        # Compute the time span of the source log so the frontend can default the
        # simulation duration to exactly match it.
        log_start_unix = None
        log_end_unix = None
        log_duration_days = None
        if ocel.events.height > 0:
            ts = ocel.events.select("_timestampUnix").to_series()
            log_start_unix = int(ts.min())
            log_end_unix = int(ts.max())
            span_s = max(0, log_end_unix - log_start_unix)
            # Round up so the full span is covered; at least 1 day.
            log_duration_days = max(1, math.ceil(span_s / 86400))

        # Build object_type_to_activities mapping from the totem
        object_type_to_activities = {}
        ot_to_evt = getattr(totem, "object_type_to_event_types", {})
        for obj_type, events in ot_to_evt.items():
            if isinstance(events, set):
                object_type_to_activities[obj_type] = sorted(events)
            else:
                object_type_to_activities[obj_type] = sorted(list(events))

        # Serialize MLPA process areas
        process_areas = []
        sorted_levels = sorted(mlpa.keys())
        for level in sorted_levels:
            for obj_types_set, evt_types_set in mlpa[level]:
                process_areas.append({
                    "level": int(level),
                    "object_types": sorted(list(obj_types_set)),
                    "activities": sorted(list(evt_types_set)),
                })

        return Response({
            "all_object_types": all_object_types,
            "all_activities": all_activities,
            "object_type_counts": obj_type_event_count,
            "object_type_to_activities": object_type_to_activities,
            "process_areas": process_areas,
            "log_start_unix": log_start_unix,
            "log_end_unix": log_end_unix,
            "log_duration_days": log_duration_days,
        }, status=status.HTTP_200_OK)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({"error": f"Failed to discover process areas: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def get_simulation_details(request):
    """
    Pre-compute all simulation details: variants, arrival distribution, resource distribution,
    constraints, cooldowns, allocation strategy, and resource calendars.

    Expected JSON body:
    {
        "file_id": int,
        "object_types": ["Type1", "Type2"],
        "activities": ["Act1", "Act2"],
        "resource_types": ["ResourceType1", "ResourceType2"],
        "support_threshold": 0.8,
        "min_occurrences_within": 5,
        "min_occurrences_across": 10
    }
    """
    file_id = request.data.get("file_id")
    object_types = request.data.get("object_types", [])
    activities = request.data.get("activities", [])
    resource_types = request.data.get("resource_types", [])
    support_threshold = request.data.get("support_threshold", 0.8)
    min_occurrences_within = request.data.get("min_occurrences_within", 5)
    min_occurrences_across = request.data.get("min_occurrences_across", 10)

    if not file_id:
        return Response({"error": "Missing file_id"}, status=status.HTTP_400_BAD_REQUEST)
    if not object_types or not activities:
        return Response({"error": "Missing object_types or activities"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        EventLog.objects.get(pk=file_id, project__users=request.user)
    except EventLog.DoesNotExist:
        return Response({"error": "File not found or access denied"}, status=status.HTTP_404_NOT_FOUND)

    cache_key = f"ocel_object_{file_id}"
    ocel = cache.get(cache_key)
    if not ocel:
        try:
            uf = EventLog.objects.get(pk=file_id)
            ocel = _build_ocel_from_path(uf.file.path)
            cache.set(cache_key, ocel, timeout=3600)
        except Exception as e:
            return Response({"error": f"Failed to load OCEL: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    try:
        # Build process area and filter OCEL
        process_area = ProcessArea(object_types=object_types, activities=activities)
        totem = totemDiscovery(ocel)
        mlpa = mlpaDiscovery(totem)
        filtered_ocel = ocel.filter_by_process_area(mlpa, process_area)

        # Compute variants
        variants = find_object_variants_connected_component(filtered_ocel)

        # Compute arrival distribution
        arrival_dist = compute_variant_arrival_distribution(filtered_ocel, variants)

        # Compute resource distribution
        res_dist = resource_distribution_of_variants(filtered_ocel, variants)

        # Compute constraints
        constraints = generate_resource_constraints(
            filtered_ocel, variants, support_threshold, min_occurrences_within, min_occurrences_across
        )

        # Serialize variants
        serialized_variants = []
        for idx, variant in enumerate(variants):
            # Serialize arrival distribution for this variant
            var_arrival = arrival_dist.get(variant, {})
            serialized_arrival = {
                "weekday_counts": var_arrival.get("weekday_counts", {}),
                "weekday_probabilities": var_arrival.get("weekday_probabilities", {}),
                "avg_arrivals_per_hour": var_arrival.get("avg_arrivals_per_hour", {}),
                "hourly_counts": var_arrival.get("hourly_counts", {}),
            }

            # Serialize resource distribution for this variant
            var_res_dist = res_dist.get(variant, {})
            serialized_res_dist = {}
            for act, type_stats in var_res_dist.items():
                serialized_res_dist[act] = {
                    res_type: {
                        "count_distribution": {
                            str(count): prob
                            for count, prob in stats["count_distribution"].items()
                        },
                    }
                    for res_type, stats in type_stats.items()
                }

            # Serialize constraints for this variant
            var_constraints = constraints.get(variant, {})

            # Get activity sequence from variant graph
            activity_sequence = []
            if hasattr(variant, 'graph') and variant.graph is not None:
                for _, node_data in sorted(variant.graph.nodes(data=True), key=lambda x: x[0]):
                    activity_sequence.append(node_data.get('label', ''))

            serialized_variants.append({
                "id": idx,
                "support": int(variant.support),
                "activity_sequence": activity_sequence,
                "arrival_distribution": serialized_arrival,
                "resource_distribution": serialized_res_dist,
                "constraints": var_constraints,
            })

        # Compute resource cooldown distribution
        cooldown_dist = compute_resource_cooldown(ocel, object_types, activities)
        serialized_cooldowns = {}
        for act, type_stats in cooldown_dist.items():
            serialized_cooldowns[act] = {
                res_type: {
                    "mean_duration_s": round(stats["mean_duration_s"], 2),
                    "std_duration_s": round(stats["std_duration_s"], 2),
                    "min_duration_s": round(stats["min_duration_s"], 2),
                    "max_duration_s": round(stats["max_duration_s"], 2),
                    "sample_count": stats["sample_count"],
                }
                for res_type, stats in type_stats.items()
            }

        # Compute resource allocation strategy
        allocation_strategy = calculate_resource_allocation_strategy(
            filtered_ocel, cooldown_dist, ocel.obj_type_map
        )

        # Compute resource calendars
        serialized_type_calendars = {}
        serialized_resource_calendars = {}
        if resource_types:
            try:
                type_cals, res_cals = discover_resource_calendars(
                    filtered_ocel, resource_types, activities
                )
                for rtype, cal in type_cals.items():
                    serialized_type_calendars[rtype] = cal.probability
                for rid, cal in res_cals.items():
                    serialized_resource_calendars[rid] = cal.probability
            except Exception as e:
                print(f"[SimDetails] Calendar discovery failed (non-critical): {e}")

        # Time window of the *filtered* log
        filtered_start_unix = None
        filtered_duration_days = None
        if filtered_ocel.events.height > 0:
            ts = filtered_ocel.events.select("_timestampUnix").to_series()
            filtered_start_unix = int(ts.min())
            span_s = max(0, int(ts.max()) - filtered_start_unix)
            filtered_duration_days = max(1, math.ceil(span_s / 86400))

        return Response({
            "variants": serialized_variants,
            "num_variants": len(variants),
            "cooldown_distribution": serialized_cooldowns,
            "allocation_strategy": allocation_strategy,
            "type_calendars": serialized_type_calendars,
            "resource_calendars": serialized_resource_calendars,
            "log_start_unix": filtered_start_unix,
            "log_duration_days": filtered_duration_days,
        }, status=status.HTTP_200_OK)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({"error": f"Failed to compute simulation details: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def get_resource_calendars(request):
    """
    Discover resource calendars for the given process area and resource types.

    Expected JSON body:
    {
        "file_id": int,
        "object_types": ["Type1", "Type2"],
        "activities": ["Act1", "Act2"],
        "resource_types": ["ResourceType1", "ResourceType2"]
    }

    Returns per-type and per-resource calendars as probability matrices (weekday x hour).
    """
    file_id = request.data.get("file_id")
    object_types = request.data.get("object_types", [])
    activities = request.data.get("activities", [])
    resource_types = request.data.get("resource_types", [])

    if not file_id:
        return Response({"error": "Missing file_id"}, status=status.HTTP_400_BAD_REQUEST)
    if not resource_types:
        return Response({"error": "Missing resource_types"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        EventLog.objects.get(pk=file_id, project__users=request.user)
    except EventLog.DoesNotExist:
        return Response({"error": "File not found or access denied"}, status=status.HTTP_404_NOT_FOUND)

    cache_key = f"ocel_object_{file_id}"
    ocel = cache.get(cache_key)
    if not ocel:
        try:
            uf = EventLog.objects.get(pk=file_id)
            ocel = _build_ocel_from_path(uf.file.path)
            cache.set(cache_key, ocel, timeout=3600)
        except Exception as e:
            return Response({"error": f"Failed to load OCEL: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    try:
        # Filter OCEL by process area
        process_area = ProcessArea(object_types=object_types, activities=activities)
        totem = totemDiscovery(ocel)
        mlpa = mlpaDiscovery(totem)
        filtered_ocel = ocel.filter_by_process_area(mlpa, process_area)

        # Discover calendars
        type_calendars, resource_calendars = discover_resource_calendars(
            filtered_ocel, resource_types, activities
        )

        # Serialize type calendars
        serialized_type_calendars = {}
        for rtype, cal in type_calendars.items():
            serialized_type_calendars[rtype] = cal.probability

        # Serialize individual resource calendars
        serialized_resource_calendars = {}
        for rid, cal in resource_calendars.items():
            serialized_resource_calendars[rid] = cal.probability

        return Response({
            "type_calendars": serialized_type_calendars,
            "resource_calendars": serialized_resource_calendars,
        }, status=status.HTTP_200_OK)

    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({"error": f"Failed to discover resource calendars: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['DELETE'])

@permission_classes([IsAuthenticated])
def delete_user_data(request):
    confirm = request.data.get("confirm")
    if confirm != "DELETE":
        return Response(
            {"error": "Please confirm by sending {'confirm': 'DELETE'}"},
            status=status.HTTP_400_BAD_REQUEST
        )

    user = request.user
    projects = Project.objects.filter(users=user)
    deleted_count = projects.count()
    projects.delete()

    return Response(
        {"detail": f"Deleted {deleted_count} project(s) and related data for user '{user.username}'."},
        status=status.HTTP_200_OK
    )
