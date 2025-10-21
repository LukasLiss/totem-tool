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
import json

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
