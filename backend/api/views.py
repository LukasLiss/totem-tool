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
        OCEL = load_events_from_sqlite(user_file.file.path)
        processed= len(OCEL.unique(subset='_eventId'))
        return Response(processed, status=status.HTTP_200_OK)
    

