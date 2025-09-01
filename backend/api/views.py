from rest_framework.decorators import api_view, action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.generics import ListCreateAPIView
from rest_framework import status, viewsets
from .models import UserFile
from .serializers import UserFileSerializer


from totem_lib.ocel import OcelFileImporter

@api_view(['GET'])
def greeting(rsequest):
    return Response({"message": "Hello, greetings from the backend!"})

class UserFileListCreateView(ListCreateAPIView):
    serializer_class = UserFileSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return UserFile.objects.filter(user=self.request.user)
    
    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class GetNumberOfEvents(viewsets.ModelViewSet):
    queryset= UserFile.objects.all()
    serializer_class= UserFileSerializer
    permission_classes= [IsAuthenticated]

    def get_queryset(self):
        return UserFile.objects.filter(user=self.request.user)
    
    @action(detail=True, methods=["get"])
    def NoE(self, request, pk=None):
        """
        Custom endpoint: /api/files/<id>/process/
        """
        try:
            user_file = self.get_queryset().get(pk=pk)
        except UserFile.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        OCEL = OcelFileImporter(user_file)
        processed= len(OCEL['_eventId'].unique())
        return Response(processed, status=status.HTTP_200_OK)