from rest_framework.decorators import api_view, action, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework import status, viewsets
from .models import UserFile
from .serializers import UserFileSerializer


from totem_lib.ocel import load_events_from_sqlite

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

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def variants(request):
    """
    Returns OC-variant data for the selected file.
    Accepts either:
      - ?file_id=<UserFile.pk>   (preferred)
      - or ?file_name=...&file_path=... (fallback for your current UI)
    """
    file_id   = request.query_params.get("file_id")
    file_name = request.query_params.get("file_name")
    file_path = request.query_params.get("file_path")

    # Resolve a path securely via the user's UserFile when an id is provided
    resolved_path = None
    if file_id:
        try:
            uf = UserFile.objects.get(pk=file_id, user=request.user)
            resolved_path = uf.file.path
        except UserFile.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)
    elif file_path:
        # Fallback (less secure) — keep for now since your UI passes file_path
        resolved_path = file_path

    # TODO: call your real computation here with `resolved_path`
    # For now, return a minimal example in the exact shape the React component expects.
    data = [
        {
            "id": "V001",
            "support": 3,
            "signature": "A->B->C",
            "signature_hash": "abc",
            "graph": {
                "nodes": [
                    {"id": "e1", "activity": "A", "objectIds": ["o1"]},
                    {"id": "e2", "activity": "B", "objectIds": ["o1", "o2"]},
                    {"id": "e3", "activity": "C", "objectIds": ["o2"]},
                ],
                "edges": [{"from": "e1", "to": "e2"}, {"from": "e2", "to": "e3"}],
                "objects": [
                    {"id": "o1", "type": "Order", "label": "Order #1"},
                    {"id": "o2", "type": "Item",  "label": "Item #A"},
                ],
            },
        }
    ]

    return Response({"variants": data}, status=status.HTTP_200_OK)

