"""Dashboard CRUD plus layout read/write and per-component image upload."""

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser

from ..models import (
    Dashboard,
    ImageAsset,
    Project,
    NumberofEventsComponent,
    TextBoxComponent,
    ImageComponent,
    VariantsComponent,
    ProcessAreaComponent,
    LogStatisticsComponent,
    OCDFGComponent,
    OCDottedChartComponent,
    NewOCDFGComponent,
    OCCNComponent,
    OCPNComponent,
    SQLQueryComponent,
    PieChartComponent,
    TotemMinerComponent,
    FilterStackComponent,
)
from ..serializers import DashboardComponentPolymorphicSerializer, DashboardSerializer


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
            return Response(
                {"error": "Name is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        dashboard.name = new_name
        dashboard.save()
        return Response(self.get_serializer(dashboard).data)

    # component_name -> concrete model used to re-fetch the polymorphic child row.
    _LAYOUT_COMPONENT_MODELS = {
        "TextBoxComponent": TextBoxComponent,
        "NumberofEventsComponent": NumberofEventsComponent,
        "ImageComponent": ImageComponent,
        "VariantsComponent": VariantsComponent,
        "ProcessAreaComponent": ProcessAreaComponent,
        "TotemMinerComponent": TotemMinerComponent,
        "LogStatisticsComponent": LogStatisticsComponent,
        "OCDFGComponent": OCDFGComponent,
        "OCDottedChartComponent": OCDottedChartComponent,
        "NewOCDFGComponent": NewOCDFGComponent,
        "NewOCDFGVariantsComponent": NewOCDFGComponent,
        "OCPNComponent": OCPNComponent,
        "SQLQueryComponent": SQLQueryComponent,
        "PieChartComponent": PieChartComponent,
        "OCCNComponent": OCCNComponent,
    }

    @action(detail=True, methods=["GET"])
    def get_layout(self, request, pk=None):
        dashboard = self.get_object()
        components = []
        for comp in dashboard.components.all():
            model = self._LAYOUT_COMPONENT_MODELS.get(comp.component_name)
            components.append(model.objects.get(id=comp.id) if model else comp)
        serializer = DashboardComponentPolymorphicSerializer(components, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["POST"])
    def save_layout(self, request, pk=None):
        dashboard = self.get_object()
        layout = request.data.get("layout")

        if not isinstance(layout, list):
            return Response(
                {"error": "layout must be a list"}, status=status.HTTP_400_BAD_REQUEST
            )

        # Clear existing components
        dashboard.components.all().delete()

        for item in layout:
            component_name = item["component_name"]
            if component_name == "TextBoxComponent":
                TextBoxComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    text=item.get("text", ""),
                    font_size=item.get("font_size", 14),
                )

            elif component_name == "NumberOfEventsComponent":
                NumberofEventsComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    color=item.get("color", "blue"),
                )
            elif component_name == "ImageComponent":
                # Legacy image path, stripping /files/ prefix if present
                image_path = item.get("image", None)
                if (
                    image_path
                    and isinstance(image_path, str)
                    and image_path.startswith("/files/")
                ):
                    image_path = image_path[7:]  # Remove '/files/' prefix

                # Image asset reference: only accept assets of this
                # dashboard's project the user can actually see.
                image_asset = None
                image_asset_id = item.get("image_asset")
                if image_asset_id:
                    image_asset = ImageAsset.objects.filter(
                        pk=image_asset_id,
                        project=dashboard.project,
                        project__users=request.user,
                    ).first()

                image_fit = item.get("image_fit") or "contain"
                if image_fit not in ("contain", "cover", "fill", "none", "scale-down"):
                    image_fit = "contain"
                image_alignment = item.get("image_alignment") or "center"
                if image_alignment not in (
                    "center",
                    "top",
                    "bottom",
                    "left",
                    "right",
                    "top left",
                    "top right",
                    "bottom left",
                    "bottom right",
                ):
                    image_alignment = "center"

                ImageComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    image=image_path,
                    image_asset=image_asset,
                    image_fit=image_fit,
                    image_alignment=image_alignment,
                )
            elif component_name == "VariantsComponent":
                VariantsComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    automatic_loading=item.get("automatic_loading", False),
                    leading_object_type=item.get("leading_object_type", ""),
                    extraction=item.get("extraction") or "leading_1hop",
                    iso=item.get("iso") or "wl+vf2",
                    timeout_s=item.get("timeout_s", 10.0),
                )
            elif component_name == "ProcessAreaComponent":
                ProcessAreaComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    algorithm=item.get("algorithm") or "advanced",
                    w_temporal=item.get("w_temporal", 1.0),
                    w_cardinality=item.get("w_cardinality", 1.0),
                    w_divergence=item.get("w_divergence", 1.0),
                    alpha=item.get("alpha", 1.0),
                    beta=item.get("beta", 1.0),
                )
            elif component_name == "TotemMinerComponent":
                TotemMinerComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                )
            elif component_name == "LogStatisticsComponent":
                LogStatisticsComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    show_num_events=item.get("show_num_events", True),
                    show_num_activities=item.get("show_num_activities", True),
                    show_num_objects=item.get("show_num_objects", True),
                    show_num_object_types=item.get("show_num_object_types", True),
                    show_earliest_timestamp=item.get("show_earliest_timestamp", False),
                    show_newest_timestamp=item.get("show_newest_timestamp", False),
                    show_duration=item.get("show_duration", False),
                )
            elif component_name == "OCDFGComponent":
                OCDFGComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    show_controls=item.get("show_controls", True),
                    initial_interaction_locked=item.get(
                        "initial_interaction_locked", True
                    ),
                )
            elif component_name == "OCDottedChartComponent":
                OCDottedChartComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    file_id=item.get("file_id"),
                    x_axis=item.get("x_axis") or "time",
                    y_axis=item.get("y_axis") or "activity",
                    color_by=item.get("color_by") or "activity",
                    shape_by=item.get("shape_by") or "none",
                    row_order=item.get("row_order") or "first_occurrence",
                    max_points=item.get("max_points", 10000),
                    show_minimap=item.get("show_minimap", True),
                    show_controls=item.get("show_controls", True),
                )
            elif component_name in ("NewOCDFGComponent", "NewOCDFGVariantsComponent"):
                NewOCDFGComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    show_controls=item.get("show_controls", True),
                    initial_interaction_locked=item.get(
                        "initial_interaction_locked", True
                    ),
                    layout_direction=item.get("layout_direction", "TB"),
                )
            elif component_name == "OCCNComponent":
                OCCNComponent.objects.create(
                    dashboard=dashboard,
                    x=item["x"],
                    y=item["y"],
                    w=item["w"],
                    h=item["h"],
                    component_name=component_name,
                    relative_occurrence_threshold=item.get(
                        "relative_occurrence_threshold", 0.0
                    ),
                    show_controls=item.get("show_controls", True),
                    initial_interaction_locked=item.get(
                        "initial_interaction_locked", True
                    ),
                    layout_direction=item.get("layout_direction", "LR"),
                    object_types=item.get("object_types") or "",
                )
            elif component_name == 'OCPNComponent':
                OCPNComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    automatic_loading=item.get('automatic_loading', False),
                    timeout_s=item.get('timeout_s', 30.0),
                )
            elif component_name == 'FilterStackComponent':
                FilterStackComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    filter_stack_json=item.get('filter_stack_json', []),
                )
            elif component_name == 'SQLQueryComponent':
                SQLQueryComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    query=item.get('query', 'SELECT * FROM data LIMIT 10'),
                )
            # Add more as needed
            elif component_name == 'PieChartComponent':
                PieChartComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    query=item.get('query', ''),
                    ring_text=item.get('ring_text', ''),
                    chart_type=item.get('chart_type', 'donut'),
                    title=item.get('title', ''),
                    show_legend=item.get('show_legend', True),
                    show_tooltip=item.get('show_tooltip', True),
                    label_column=item.get('label_column', ''),
                    value_column=item.get('value_column', ''),
                )

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
