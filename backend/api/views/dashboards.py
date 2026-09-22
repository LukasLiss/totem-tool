"""Dashboard CRUD plus layout read/write and per-component image upload."""

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from django.conf import settings
from django.db import transaction
import os

from ..models import (
    Dashboard,
    ImageAsset,
    Project,
    ProjectAsset,
    NumberofEventsComponent,
    TextBoxComponent,
    ImageComponent,
    VariantsComponent,
    ProcessAreaComponent,
    LogStatisticsComponent,
    OCDottedChartComponent,
    NewOCDFGComponent,
    OCCNComponent,
    OCPNComponent,
    SqlQueryComponent,
    PieChartComponent,
    KpiComponent,
    BarChartComponent,
    ScatterPlotComponent,
    TotemMinerComponent,
    FilterStackComponent,
    OCHandoverComponent,
    ResourceProfilingComponent,
)
from ..serializers import (
    DashboardComponentPolymorphicSerializer,
    DashboardSerializer,
    ImageAssetSerializer,
)
from rest_framework import serializers as drf_serializers


def _validated_legacy_image_path(raw, project):
    """Return ``raw`` (minus the ``/files/`` prefix) only if it names an existing
    file under MEDIA_ROOT inside the project's own upload directory."""
    if not raw or not isinstance(raw, str):
        return None
    rel = raw[len("/files/"):] if raw.startswith("/files/") else raw
    rel = rel.lstrip("/")
    if not rel or "\\" in rel or ".." in rel.split("/"):
        return None
    media_root = os.path.realpath(str(settings.MEDIA_ROOT))
    project_dir = os.path.realpath(os.path.join(media_root, project.name))
    candidate = os.path.realpath(os.path.join(media_root, rel))
    if not candidate.startswith(project_dir + os.sep):
        return None
    if not os.path.isfile(candidate):
        return None
    return os.path.relpath(candidate, media_root).replace(os.sep, "/")


def _query_asset_for(item, dashboard, request):
    """The stored query (``ProjectAsset`` of type QUERY) a layout item links.

    Only assets of the dashboard's own project that the requesting user can
    see are accepted; anything else silently unlinks (the component then
    falls back to its local ``query`` text).
    """
    asset_id = item.get("query_asset")
    if not asset_id:
        return None
    try:
        asset_id = int(asset_id)
    except (TypeError, ValueError):
        return None
    return ProjectAsset.objects.filter(
        pk=asset_id,
        project=dashboard.project,
        project__users=request.user,
        asset_type=ProjectAsset.AssetType.QUERY,
    ).first()


def _bounded_int(item, key: str, default: int, lo: int, hi: int) -> int:
    try:
        value = int(item.get(key, default))
    except (TypeError, ValueError):
        return default
    return min(max(value, lo), hi)


def _string_list_field(item, key: str) -> list:
    """A JSON list of strings from a layout item; anything else becomes []."""
    value = item.get(key)
    if not isinstance(value, (list, tuple)):
        return []
    return [v for v in value if isinstance(v, str) and v]


def _choice_field(item, key: str, choices, default: str) -> str:
    """A string field restricted to ``choices``; anything else is the default."""
    value = item.get(key)
    return value if isinstance(value, str) and value in choices else default


def _bounded_float(item, key: str, default: float, lo: float, hi: float) -> float:
    try:
        value = float(item.get(key, default))
    except (TypeError, ValueError):
        return default
    if value != value:  # NaN
        return default
    return min(max(value, lo), hi)


def _optional_non_negative_int(item, key: str):
    """``None`` when absent/empty/invalid, else the value clamped to >= 0."""
    value = item.get(key)
    if value in (None, ""):
        return None
    try:
        return max(int(value), 0)
    except (TypeError, ValueError):
        return None


# Choice sets of the organizational mining widgets; mirror totem_lib.ochandover.
_HANDOVER_METHODS = ("oc", "flattened")
_HANDOVER_NORMALIZATIONS = ("by_source", "by_target", "by_arcs_in_eog", "by_total_weight")
_HANDOVER_SCOPES = ("global", "per_bo_type")
_HANDOVER_VIEW_MODES = ("graph", "table", "log")
_PROFILE_FEATURE_GROUPS = (
    "activity_fractions",
    "cooccurrence_fractions",
    "object_collaboration_fractions",
    "object_portfolio_fractions",
    "time_fractions",
    "weekday_fractions",
)
_PROFILE_CLUSTER_METHODS = ("kmeans", "agglomerative", "hdbscan")
_PROFILE_DISTANCE_METRICS = ("euclidean", "hellinger")
_PROFILE_VIEW_MODES = ("graph", "table")


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
        # `project` is validated against the user's memberships by
        # DashboardSerializer.validate_project.
        serializer.save()

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
        "OCDottedChartComponent": OCDottedChartComponent,
        "NewOCDFGComponent": NewOCDFGComponent,
        "NewOCDFGVariantsComponent": NewOCDFGComponent,
        "OCPNComponent": OCPNComponent,
        "SqlQueryComponent": SqlQueryComponent,
        "PieChartComponent": PieChartComponent,
        "KpiComponent": KpiComponent,
        "BarChartComponent": BarChartComponent,
        "ScatterPlotComponent": ScatterPlotComponent,
        "OCCNComponent": OCCNComponent,
        "FilterStackComponent": FilterStackComponent,
        "OCHandoverComponent": OCHandoverComponent,
        "ResourceProfilingComponent": ResourceProfilingComponent,
    }

    _REQUIRED_LAYOUT_KEYS = ("component_name", "x", "y", "w", "h")

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

        # Validate the whole payload before touching the database so a bad
        # item cannot leave the dashboard half-deleted.
        for index, item in enumerate(layout):
            if not isinstance(item, dict):
                return Response(
                    {"error": f"layout[{index}] must be an object"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            missing = [k for k in self._REQUIRED_LAYOUT_KEYS if k not in item]
            if missing:
                return Response(
                    {"error": f"layout[{index}] is missing {', '.join(missing)}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Replace the components atomically: either the new layout is stored
        # in full, or the previous one is kept.
        with transaction.atomic():
            self._replace_components(dashboard, layout, request)

        return Response({"status": "saved"})

    def _replace_components(self, dashboard, layout, request):
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
                # Legacy image path: only keep it when it points at an
                # existing upload of this dashboard's project. Anything else
                # (arbitrary paths, other projects' files) is dropped.
                image_path = _validated_legacy_image_path(
                    item.get("image"), dashboard.project
                )

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
                    business_object_types=_string_list_field(item, "business_object_types"),
                    business_activities=_string_list_field(item, "business_activities"),
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
            elif component_name == 'SqlQueryComponent':
                SqlQueryComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    name=item.get('name', ''),
                    query=item.get('query') or "SELECT activity, count(*) AS n FROM events GROUP BY activity",
                    query_asset=_query_asset_for(item, dashboard, request),
                    row_limit=_bounded_int(item, 'row_limit', 25, 1, 1000),
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
                    query_asset=_query_asset_for(item, dashboard, request),
                    ring_text=item.get('ring_text', ''),
                    chart_type=item.get('chart_type', 'donut'),
                    title=item.get('title', ''),
                    show_legend=item.get('show_legend', True),
                    show_tooltip=item.get('show_tooltip', True),
                    label_column=item.get('label_column', ''),
                    value_column=item.get('value_column', ''),
                )
            elif component_name == 'KpiComponent':
                KpiComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    title=item.get('title') or '',
                    query=item.get('query') or '',
                    query_asset=_query_asset_for(item, dashboard, request),
                    value_column=item.get('value_column') or '',
                    prefix=item.get('prefix') or '',
                    suffix=item.get('suffix') or '',
                    decimals=_bounded_int(item, 'decimals', 0, 0, 10),
                )
            elif component_name == 'BarChartComponent':
                BarChartComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    title=item.get('title') or '',
                    query=item.get('query') or '',
                    query_asset=_query_asset_for(item, dashboard, request),
                    label_column=item.get('label_column') or '',
                    value_column=item.get('value_column') or '',
                    horizontal=bool(item.get('horizontal', False)),
                    show_values=bool(item.get('show_values', False)),
                )
            elif component_name == 'ScatterPlotComponent':
                ScatterPlotComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    title=item.get('title') or '',
                    query=item.get('query') or '',
                    query_asset=_query_asset_for(item, dashboard, request),
                    x_column=item.get('x_column') or '',
                    y_column=item.get('y_column') or '',
                    series_column=item.get('series_column') or '',
                    x_label=item.get('x_label') or '',
                    y_label=item.get('y_label') or '',
                )
            elif component_name == 'OCHandoverComponent':
                OCHandoverComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    show_controls=bool(item.get('show_controls', True)),
                    automatic_loading=bool(item.get('automatic_loading', False)),
                    method=_choice_field(item, 'method', _HANDOVER_METHODS, 'oc'),
                    resource_types=_string_list_field(item, 'resource_types'),
                    businessobject_types=_string_list_field(item, 'businessobject_types'),
                    case_type=item.get('case_type') or '',
                    flat_resource_type=item.get('flat_resource_type') or '',
                    max_gap=_optional_non_negative_int(item, 'max_gap'),
                    normalization=_choice_field(item, 'normalization', _HANDOVER_NORMALIZATIONS, 'by_arcs_in_eog'),
                    normalization_scope=_choice_field(item, 'normalization_scope', _HANDOVER_SCOPES, 'global'),
                    parallel_filter_enabled=bool(item.get('parallel_filter_enabled', False)),
                    parallel_threshold=_bounded_float(item, 'parallel_threshold', 0.5, 0.0, 1.0),
                    min_parallel_observations=_bounded_int(item, 'min_parallel_observations', 1, 1, 1_000_000),
                    cluster_by_ot=bool(item.get('cluster_by_ot', False)),
                    view_mode=_choice_field(item, 'view_mode', _HANDOVER_VIEW_MODES, 'graph'),
                )
            elif component_name == 'ResourceProfilingComponent':
                feature_groups = [
                    g for g in _string_list_field(item, 'feature_groups') if g in _PROFILE_FEATURE_GROUPS
                ]
                tooltip_groups = [
                    g for g in _string_list_field(item, 'tooltip_feature_groups')
                    if g in _PROFILE_FEATURE_GROUPS and g not in feature_groups
                ]
                ResourceProfilingComponent.objects.create(
                    dashboard=dashboard,
                    x=item['x'],
                    y=item['y'],
                    w=item['w'],
                    h=item['h'],
                    component_name=component_name,
                    show_controls=bool(item.get('show_controls', True)),
                    automatic_loading=bool(item.get('automatic_loading', False)),
                    resource_types=_string_list_field(item, 'resource_types'),
                    business_object_types=_string_list_field(item, 'business_object_types'),
                    feature_groups=feature_groups,
                    tooltip_feature_groups=tooltip_groups,
                    compute_clusters=bool(item.get('compute_clusters', True)),
                    cluster_method=_choice_field(item, 'cluster_method', _PROFILE_CLUSTER_METHODS, 'hdbscan'),
                    n_clusters=_bounded_int(item, 'n_clusters', 3, 1, 1000),
                    min_cluster_size=_bounded_int(item, 'min_cluster_size', 2, 2, 100000),
                    distance_metric=_choice_field(item, 'distance_metric', _PROFILE_DISTANCE_METRICS, 'euclidean'),
                    view_mode=_choice_field(item, 'view_mode', _PROFILE_VIEW_MODES, 'graph'),
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
        # Same type/size rules as the image asset store.
        try:
            ImageAssetSerializer().validate_image(image_file)
        except drf_serializers.ValidationError as exc:
            return Response(
                {"error": " ".join(str(d) for d in exc.detail)},
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
