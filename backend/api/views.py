from rest_framework.decorators import api_view
from rest_framework.response import Response

@api_view(['GET'])
def greeting(request):
    return Response({"message": "Hello, greetings from the backend!"})
