from rest_framework.decorators import api_view, action, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework import status, viewsets
from django.utils.text import slugify
from .models import EventLog, Project, Dashboard, EventLog, DashboardComponent, NumberofEventsComponent, TextBoxComponent, ImageComponent, VariantsComponent, ProcessAreaComponent, LogStatisticsComponent, OCDFGComponent, TotemModelComponent
from .serializers import EventLogSerializer, DashboardSerializer, DashboardComponentPolymorphicSerializer
from django.db.models import Max

from totem_lib.dfg import OCDFG, CCDFG
import polars as pl
from totem_lib.ocel import ObjectCentricEventLog
from totem_lib.variants.ocvariants import find_variants, calculate_layout
from totem_lib.totem import totemDiscovery, mlpaDiscovery, Totem, conformance_of_totem
from totem_lib.ocel.importer import (
    load_events_from_sqlite, load_objects_from_sqlite,
    load_events_from_json, load_objects_from_json,
    load_events_from_xml, load_objects_from_xml,
    import_ocel_from_csv,
)
import networkx as nx

from collections import defaultdict

from django.core.cache import cache

import os
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
            ocel = _build_ocel_from_path(user_file.file.path)
            processed = len(ocel.events.unique(subset='_eventId'))
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

        cache_key = f"ocel_object_{pk}"
        ocel = cache.get(cache_key)

        if not ocel:
            try:
                # We reuse the utility function that handles file format detection
                ocel = _build_ocel_from_path(user_file.file.path)
                cache.set(cache_key, ocel, timeout=3600)
            except Exception as e:
                return Response({"error": f"Failed to load OCEL: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(ocel.object_types, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"])
    def discover_totem(self, request, pk=None):
        # Extract tau from query parameters
        tau_str = request.query_params.get('tau', '0.9')
        try:
            tau = float(tau_str)
            tau = max(0.0, min(1.0, tau))  # Clamp to valid range
        except (ValueError, TypeError):
            tau = 0.9

        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            # Include tau in cache key
            cache_key = f"totem_discovery_{user_file.pk}_{tau}"
            cached_result = cache.get(cache_key)
            if cached_result:
                return Response(cached_result, status=status.HTTP_200_OK)

            ocel = _build_ocel_from_path(user_file.file.path)
            totem = totemDiscovery(ocel, tau=tau)
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

            ocel = _build_ocel_from_path(user_file.file.path)
            totem = totemDiscovery(ocel)
            process_view = mlpaDiscovery(totem)
            serialized = _serialize_mlpa(process_view, totem)

            cache.set(cache_key, serialized, timeout=3600)
            return Response(serialized, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": f"An error occurred during Totem and MLPA discovery: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=["get"])
    def compute_conformance(self, request, pk=None):
        """API endpoint to compute conformance metrics for a TOTEM model against the OCEL."""
        tau_str = request.query_params.get('tau', '0.9')
        try:
            tau = float(tau_str)
            tau = max(0.0, min(1.0, tau))
        except (ValueError, TypeError):
            tau = 0.9

        try:
            user_file = self.get_queryset().get(pk=pk)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        try:
            cache_key = f"conformance_{user_file.pk}_{tau}"
            cached_result = cache.get(cache_key)
            if cached_result:
                return Response(cached_result, status=status.HTTP_200_OK)

            ocel = _build_ocel_from_path(user_file.file.path)
            totem = totemDiscovery(ocel, tau=tau)
            conformance = conformance_of_totem(totem, ocel)

            # Serialize for JSON (convert tuple keys to strings)
            serialized = _serialize_conformance(conformance)

            cache.set(cache_key, serialized, timeout=3600)
            return Response(serialized, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": f"Failed to compute conformance: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=["get"])
    def statistics(self, request, pk=None):
        """Returns basic statistics of the event log."""
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
            num_events = len(ocel.events.unique(subset='_eventId'))
            num_unique_activities = ocel.events.select('_activity').unique().height
            num_objects = ocel.objects.unique(subset='_objId').height
            num_object_types = len(ocel.object_types)
            earliest_timestamp = ocel.events.select('_timestampUnix').min().item()
            newest_timestamp = ocel.events.select('_timestampUnix').max().item()

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
            elif comp.component_name == 'NumberOfEventsComponent':
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
            elif comp.component_name == 'TotemModelComponent':
                components.append(TotemModelComponent.objects.get(id=comp.id))
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
                ImageComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    image=item.get('image', None),
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
            elif component_name == 'TotemModelComponent':
                TotemModelComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    initial_tau=item.get('initial_tau', 0.9),
                )
            # Add more as needed

        return Response({"status": "saved"})

    @action(
        detail=True,
        methods=["post"],
        url_path="upload-image",
        parser_classes=[MultiPartParser, FormParser],
    )
    def upload_image(self, request, pk=None):
        dashboard = self.get_object()

        image = request.FILES.get("image")
        if not image:
            return Response({"error": "No image provided"}, status=400)
        if image:
            if not image.content_type in ['image/jpeg', 'image/png', 'image/gif']:
                return Response({'error': 'Invalid file type'}, status=status.HTTP_400_BAD_REQUEST)
            if image.size > 5 * 1024 * 1024:  # 5MB limit
                return Response({'error': 'File too large'}, status=status.HTTP_400_BAD_REQUEST)
            
            dashboard.image = image
            dashboard.save()
            serializer = ImageComponentSerializer(dashboard)

        return Response({
            serializer.data
        })

# TODO: change to equivalent totem_lib.ocel import function 
def _build_ocel_from_path(path: str) -> ObjectCentricEventLog:

    ext = os.path.splitext(path)[1].lower()
    if ext in (".sqlite", ".db"):
        events_df  = load_events_from_sqlite(path)
        objects_df = load_objects_from_sqlite(path)
        log = ObjectCentricEventLog(events=events_df, objects=objects_df)
    elif ext == ".json":
        events_df  = load_events_from_json(path)
        objects_df = load_objects_from_json(path)
        log = ObjectCentricEventLog(events=events_df, objects=objects_df)
    elif ext == ".xml":
        events_df  = load_events_from_xml(path)
        objects_df = load_objects_from_xml(path)
        log = ObjectCentricEventLog(events=events_df, objects=objects_df)
    elif ext == ".csv":
        # CSV importer returns the complete ObjectCentricEventLog with attributes
        log = import_ocel_from_csv(path)
    else:
        raise ValueError(f"Unsupported file type: {ext}. Supported formats: .sqlite, .db, .json, .xml, .csv")

    return log


def _filter_ocel_by_object_types(ocel: ObjectCentricEventLog, object_types: set[str]) -> ObjectCentricEventLog:
    """
    Lightweight filter for our in-house OCEL representation.
    Keeps objects whose _objType is in object_types and events that reference at least one kept object.
    """
    if not object_types:
        return ocel

    filtered_objects = ocel.objects.filter(pl.col("_objType").is_in(list(object_types)))

    if filtered_objects.is_empty():
        return ObjectCentricEventLog(events=ocel.events.slice(0, 0), objects=filtered_objects)

    kept_ids = set(filtered_objects.select("_objId").to_series().to_list())

    # Keep events that reference at least one kept object
    filtered_events = ocel.events.filter(
        pl.col("_objects")
        .list.eval(pl.element().is_in(list(kept_ids)))
        .list.any()
        .fill_null(False)
    )

    return ObjectCentricEventLog(events=filtered_events, objects=filtered_objects)


def _extract_trace_variants_per_type(ocel: ObjectCentricEventLog, object_types: set[str]) -> dict:
    """
    Extract actual trace variants from the OCEL for each object type.

    For each object type, filters the log to only that type and extracts
    the activity sequence (trace) for each object instance. Identical traces
    are grouped as variants.

    Returns:
        Dict mapping object_type -> {
            "variants": [
                {"trace": ["activity1", "activity2", ...], "count": N, "objects": ["obj1", ...]},
                ...
            ],
            "total_objects": M
        }
    """
    from collections import defaultdict

    result = {}

    # Build lookup: object_id -> object_type
    obj_type_map = dict(ocel.objects.select(["_objId", "_objType"]).iter_rows())

    # Build lookup: object_id -> list of (timestamp, activity) tuples
    obj_events = defaultdict(list)
    for row in ocel.events.iter_rows(named=True):
        activity = row["_activity"]
        timestamp = row["_timestampUnix"]
        objects_in_event = row["_objects"] or []
        for obj_id in objects_in_event:
            obj_events[obj_id].append((timestamp, activity))

    for obj_type in object_types:
        # Get all objects of this type
        type_objects = ocel.objects.filter(
            pl.col("_objType") == obj_type
        ).select("_objId").to_series().to_list()

        if not type_objects:
            result[obj_type] = {"variants": [], "total_objects": 0}
            continue

        # For each object, extract its trace (activity sequence sorted by time)
        trace_to_objects = defaultdict(list)
        for obj_id in type_objects:
            events = obj_events.get(obj_id, [])
            if not events:
                continue
            # Sort by timestamp and extract activity sequence
            sorted_events = sorted(events, key=lambda x: x[0])
            trace = tuple(activity for _, activity in sorted_events)
            trace_to_objects[trace].append(obj_id)

        # Convert to list of variants, sorted by count (descending)
        variants = []
        for trace, objects in trace_to_objects.items():
            variants.append({
                "trace": list(trace),
                "count": len(objects),
                "objects": objects
            })
        variants.sort(key=lambda v: v["count"], reverse=True)

        result[obj_type] = {
            "variants": variants,
            "total_objects": len(type_objects)
        }

        # Debug: Print trace variants
        if variants:
            print(f"[TRACE_VARIANTS] {obj_type}: {len(variants)} variants, first trace: {variants[0]['trace']}")

    return result


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


def _serialize_conformance(conformance: dict) -> dict:
    """
    Convert conformance dict for JSON serialization (tuple keys → string keys).
    """
    result = {
        "overall_metrics": conformance["overall_metrics"],
        "object_type_metrics": conformance["object_type_metrics"],
        "type_pair_metrics": {},
        "histograms": {}
    }

    # Convert tuple keys to "type1|type2" strings
    for key, metrics in conformance["type_pair_metrics"].items():
        if isinstance(key, tuple):
            str_key = f"{key[0]}|{key[1]}"
        else:
            str_key = str(key)
        result["type_pair_metrics"][str_key] = metrics

    # Serialize histograms
    for hist_name, hist_data in conformance["histograms"].items():
        result["histograms"][hist_name] = {}
        for key, counts in hist_data.items():
            if isinstance(key, tuple):
                if len(key) == 2:
                    str_key = f"{key[0]}|{key[1]}"
                else:  # len == 3 (fine-grained)
                    str_key = f"{key[0]}|{key[1]}|{key[2]}"
            else:
                str_key = str(key)
            result["histograms"][hist_name][str_key] = counts

    return result


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

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def variants(request):

    file_id = request.query_params.get("file_id")
    if not file_id:
        return Response({"error": "Missing ?file_id"}, status=status.HTTP_400_BAD_REQUEST)

    # Verify user has access to this file
    try:
        EventLog.objects.get(pk=file_id, project__users=request.user)
    except EventLog.DoesNotExist:
        return Response({"error": "File not found or access denied"}, status=status.HTTP_404_NOT_FOUND)

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
        leading_object_type = request.query_params.get("leading_type")

        # If no leading_type provided or it doesn't exist, use first alphabetically sorted type
        if not leading_object_type or leading_object_type not in ocel.object_types:
            if ocel.object_types and len(ocel.object_types) > 0:
                leading_object_type = sorted(ocel.object_types)[0]
            else:
                return Response({
                    "variants": [],
                    "object_types": []
                }, status=status.HTTP_200_OK)

        mined = find_variants(ocel, leading_type=leading_object_type)
    except Exception as e:
        import traceback
        print(f"ERROR in find_variants: {e}")
        traceback.print_exc()
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

    return Response({
        "variants": out,
        "object_types": ocel.object_types
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
        # Full OCDFG (unfiltered) for register
        ocdfg_full = OCDFG.from_ocel(ocel)
        dfg_json_full = nx.node_link_data(ocdfg_full)
        all_nodes = [
            {
                "id": n.get("id"),
                "types": n.get("types", []),
                "role": n.get("role"),
                "object_type": n.get("object_type"),
            }
            for n in dfg_json_full.get("nodes", [])
        ]

        # Filtered OCEL if object types specified
        filter_error = None
        trace_variants = None
        if object_type_filter:
            try:
                filtered_ocel = _filter_ocel_by_object_types(ocel, object_type_filter)

                # If filtering removes everything, return an empty OCDFG instead of raising
                if filtered_ocel.events is None or len(filtered_ocel.events) == 0 or filtered_ocel.events.is_empty():
                    dfg_json = {"directed": True, "multigraph": False, "graph": {"kind": "ocdfg"}, "nodes": [], "links": []}
                else:
                    ocdfg_filtered = OCDFG.from_ocel(filtered_ocel)
                    dfg_json = nx.node_link_data(ocdfg_filtered)

                # Extract actual trace variants from the OCEL per object type
                trace_variants = _extract_trace_variants_per_type(ocel, object_type_filter)
            except Exception as e:
                # Gracefully fall back to unfiltered graph to avoid frontend breakage, but surface warning
                filter_error = f"Failed to compute filtered OCDFG: {e}"
                dfg_json = dfg_json_full
        else:
            dfg_json = dfg_json_full

        # Always compute trace_variants if not already computed
        # Use all object types from the OCEL when no filter is specified
        if trace_variants is None:
            try:
                all_object_types = set(ocel.objects.select("_objType").to_series().unique().to_list())
                if all_object_types:
                    trace_variants = _extract_trace_variants_per_type(ocel, all_object_types)
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
