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
from totem_lib.ocvariants import find_variants, calculate_layout
from totem_lib.totem import totemDiscovery, mlpaDiscovery, Totem

from django.core.cache import cache

import os
import networkx as nx
from hashlib import sha1

from totem_lib.ocel import (
    load_events_from_sqlite, load_objects_from_sqlite,
    load_events_from_json,   load_objects_from_json,
    load_events_from_xml,    load_objects_from_xml,
)


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
            cache_key = f"totem_discovery_{user_file.pk}"
            cached_result = cache.get(cache_key)
            if cached_result:
                return Response(cached_result, status=status.HTTP_200_OK)

            ocel = _build_ocel_from_path(user_file.file.path)
            totem = totemDiscovery(ocel)
            serialized = _serialize_totem(totem)

            cache.set(cache_key, serialized, timeout=3600)
            return Response(serialized, status=status.HTTP_200_OK)
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


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def discover_totem_mock(request, pk: int):
    """
    Temporary mock endpoint for Totem discovery until backend integration is ready.
    """
    return Response(TOTEM_MOCK, status=status.HTTP_200_OK)

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
    
    return Response({"dfg": mockup}, status=status.HTTP_200_OK)
    
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

        return Response({"dfg": dfg_json}, status=status.HTTP_200_OK)
    
    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
