"""Project-scoped model assets and image assets."""

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from django.utils.text import slugify

from ..models import ImageAsset, ProjectAsset
from ..serializers import ImageAssetSerializer, ProjectAssetSerializer


class ProjectAssetViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectAssetSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        queryset = ProjectAsset.objects.filter(
            project__users=self.request.user,
        ).select_related("project", "created_by")

        project_id = self.request.query_params.get("project")
        if project_id:
            queryset = queryset.filter(project_id=project_id)

        asset_type = self.request.query_params.get("asset_type")
        if asset_type:
            queryset = queryset.filter(asset_type=asset_type)

        return queryset

    def list(self, request, *args, **kwargs):
        asset_type = request.query_params.get("asset_type")
        if asset_type and asset_type not in ProjectAsset.AssetType.values:
            return Response(
                {"asset_type": "Unsupported asset type."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().list(request, *args, **kwargs)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        asset = self.get_object()
        response = Response(asset.content_json, status=status.HTTP_200_OK)
        filename = f"{slugify(asset.name) or 'model-asset'}.json"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


class ImageAssetViewSet(viewsets.ModelViewSet):
    """Project-scoped image assets: upload, rename (PATCH name), delete."""

    serializer_class = ImageAssetSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        queryset = ImageAsset.objects.filter(
            project__users=self.request.user,
        ).select_related("project", "created_by")

        project_id = self.request.query_params.get("project")
        if project_id:
            queryset = queryset.filter(project_id=project_id)

        return queryset.order_by("name")

    def perform_destroy(self, instance):
        stored_file = instance.image
        super().perform_destroy(instance)
        if stored_file:
            stored_file.delete(save=False)
