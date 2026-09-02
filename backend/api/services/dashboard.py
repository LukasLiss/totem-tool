"""
Dashboard ORM Service.
Provides polymorphic CRUD operations for dashboards and their child components
with strict multi-tenant security verification.
"""

from typing import Any, Dict, List, Optional
from django.db import models, transaction
from django.core.exceptions import ObjectDoesNotExist

from api.models import (
    Dashboard,
    DashboardComponent,
    EventLog,
    ImageComponent,
    LogStatisticsComponent,
    NewOCDFGComponent,
    NumberofEventsComponent,
    OCCNComponent,
    OCDFGComponent,
    OCDottedChartComponent,
    ProcessAreaComponent,
    Project,
    SqlQueryComponent,
    TextBoxComponent,
    VariantsComponent,
)
from api.serializers import DashboardComponentPolymorphicSerializer


class DashboardService:
    """Service layer managing Dashboard entities and polymorphic DashboardComponent subclasses."""

    # Map of normalized string keys to concrete component model classes
    COMPONENT_REGISTRY = {
        "textboxcomponent": (TextBoxComponent, "TextBoxComponent"),
        "textbox": (TextBoxComponent, "TextBoxComponent"),
        "text_box": (TextBoxComponent, "TextBoxComponent"),
        "numberofeventscomponent": (NumberofEventsComponent, "NumberofEventsComponent"),
        "numberofevents": (NumberofEventsComponent, "NumberofEventsComponent"),
        "number_of_events": (NumberofEventsComponent, "NumberofEventsComponent"),
        "imagecomponent": (ImageComponent, "ImageComponent"),
        "image": (ImageComponent, "ImageComponent"),
        "variantscomponent": (VariantsComponent, "VariantsComponent"),
        "variants": (VariantsComponent, "VariantsComponent"),
        "processareacomponent": (ProcessAreaComponent, "ProcessAreaComponent"),
        "processarea": (ProcessAreaComponent, "ProcessAreaComponent"),
        "process_area": (ProcessAreaComponent, "ProcessAreaComponent"),
        "logstatisticscomponent": (LogStatisticsComponent, "LogStatisticsComponent"),
        "logstatistics": (LogStatisticsComponent, "LogStatisticsComponent"),
        "log_statistics": (LogStatisticsComponent, "LogStatisticsComponent"),
        "ocdfgcomponent": (OCDFGComponent, "OCDFGComponent"),
        "ocdfg": (OCDFGComponent, "OCDFGComponent"),
        "newocdfgcomponent": (NewOCDFGComponent, "NewOCDFGComponent"),
        "newocdfg": (NewOCDFGComponent, "NewOCDFGComponent"),
        "new_ocdfg": (NewOCDFGComponent, "NewOCDFGComponent"),
        "newocdfgvariantscomponent": (NewOCDFGComponent, "NewOCDFGComponent"),
        "ocdottedchartcomponent": (OCDottedChartComponent, "OCDottedChartComponent"),
        "ocdottedchart": (OCDottedChartComponent, "OCDottedChartComponent"),
        "oc_dotted_chart": (OCDottedChartComponent, "OCDottedChartComponent"),
        "dottedchart": (OCDottedChartComponent, "OCDottedChartComponent"),
        "dotted_chart": (OCDottedChartComponent, "OCDottedChartComponent"),
        "occncomponent": (OCCNComponent, "OCCNComponent"),
        "occn": (OCCNComponent, "OCCNComponent"),
        "sqlquerycomponent": (SqlQueryComponent, "SqlQueryComponent"),
        "sqlquery": (SqlQueryComponent, "SqlQueryComponent"),
        "sql_query": (SqlQueryComponent, "SqlQueryComponent"),
    }

    @staticmethod
    def _normalize_type(component_type: str):
        if not component_type or not isinstance(component_type, str):
            return TextBoxComponent, "TextBoxComponent"
        cleaned = component_type.strip().lower().replace("-", "_")
        if cleaned in DashboardService.COMPONENT_REGISTRY:
            return DashboardService.COMPONENT_REGISTRY[cleaned]
        # Default fallback
        return TextBoxComponent, component_type

    @staticmethod
    def _validate_user(user):
        if user is None or not getattr(user, "is_authenticated", False):
            raise PermissionError("User is unauthenticated or missing.")

    @staticmethod
    def get_concrete_instance(base_comp: DashboardComponent) -> DashboardComponent:
        """Resolve a base DashboardComponent instance to its polymorphic subclass."""
        name = base_comp.component_name
        for model_cls in (
            TextBoxComponent,
            NumberofEventsComponent,
            ImageComponent,
            VariantsComponent,
            ProcessAreaComponent,
            LogStatisticsComponent,
            OCDFGComponent,
            OCDottedChartComponent,
            NewOCDFGComponent,
            OCCNComponent,
            SqlQueryComponent,
        ):
            if (
                model_cls.__name__.lower() == name.lower()
                or (name in ("NewOCDFGComponent", "NewOCDFGVariantsComponent") and model_cls == NewOCDFGComponent)
            ):
                try:
                    return model_cls.objects.get(id=base_comp.id)
                except model_cls.DoesNotExist:
                    pass
        return base_comp

    # -------------------------------------------------------------------------
    # Dashboard CRUD Operations
    # -------------------------------------------------------------------------

    @classmethod
    def create_dashboard(
        cls,
        user,
        title: str,
        project_id: Optional[int] = None,
        description: str = "",
        layout: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Create a new dashboard associated with user's project and optional initial layout."""
        cls._validate_user(user)

        if not title or not isinstance(title, str) or not title.strip():
            title = "New Dashboard"
        title = title.strip()[:30]

        if project_id is not None:
            try:
                project = Project.objects.get(id=project_id, users=user)
            except Project.DoesNotExist:
                raise PermissionError(f"Project with ID {project_id} does not exist or user lacks access.")
        else:
            project = Project.objects.filter(users=user).first()
            if project is None:
                project = Project.objects.create(name=f"{getattr(user, 'username', 'User')}'s Project")
                project.users.add(user)

        with transaction.atomic():
            max_order = (
                Dashboard.objects.filter(project=project).aggregate(models.Max("order_in_project"))[
                    "order_in_project__max"
                ]
            )
            next_order = 0 if max_order is None else max_order + 1

            dashboard = Dashboard.objects.create(
                project=project,
                name=title,
                order_in_project=next_order,
            )

            if layout and isinstance(layout, list):
                for item in layout:
                    if not isinstance(item, dict):
                        continue
                    comp_type = item.get("component_name") or item.get("component_type") or item.get("type", "TextBoxComponent")
                    pos = {
                        "x": item.get("x", 0),
                        "y": item.get("y", 0),
                        "w": item.get("w", 6),
                        "h": item.get("h", 4),
                    }
                    props = item.get("props") or item.get("config") or item
                    cls.add_component(
                        user=user,
                        dashboard_id=dashboard.id,
                        component_type=comp_type,
                        config=props,
                        position=pos,
                    )

        return cls.get_dashboard(user, dashboard.id)

    @classmethod
    def get_dashboard(cls, user, dashboard_id: int) -> Dict[str, Any]:
        """Retrieve dashboard details and its polymorphic child components."""
        cls._validate_user(user)

        try:
            dashboard = Dashboard.objects.get(id=dashboard_id, project__users=user)
        except Dashboard.DoesNotExist:
            raise PermissionError(f"Dashboard with ID {dashboard_id} not found or user lacks access.")

        base_components = dashboard.components.all().order_by("order", "id")
        concrete_components = [cls.get_concrete_instance(c) for c in base_components]
        serialized_components = DashboardComponentPolymorphicSerializer(concrete_components, many=True).data

        return {
            "id": dashboard.id,
            "name": dashboard.name,
            "title": dashboard.name,
            "project_id": dashboard.project_id,
            "order_in_project": dashboard.order_in_project,
            "created_at": dashboard.created_at.isoformat() if dashboard.created_at else None,
            "components": serialized_components,
        }

    @classmethod
    def list_dashboards(
        cls,
        user,
        file_id: Optional[int] = None,
        project_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """List dashboards accessible to the user, optionally scoped to a file or project."""
        cls._validate_user(user)

        qs = Dashboard.objects.filter(project__users=user)

        if file_id is not None:
            try:
                log = EventLog.objects.get(id=file_id, project__users=user)
                qs = qs.filter(project=log.project)
            except EventLog.DoesNotExist:
                return []

        if project_id is not None:
            qs = qs.filter(project_id=project_id)

        qs = qs.order_by("order_in_project", "id")

        return [
            {
                "id": d.id,
                "name": d.name,
                "title": d.name,
                "project_id": d.project_id,
                "order_in_project": d.order_in_project,
                "created_at": d.created_at.isoformat() if d.created_at else None,
                "component_count": d.components.count(),
            }
            for d in qs
        ]

    @classmethod
    def rename_dashboard(cls, user, dashboard_id: int, title: str) -> Dict[str, Any]:
        """Rename an existing dashboard."""
        cls._validate_user(user)

        if not title or not isinstance(title, str) or not title.strip():
            raise ValueError("Dashboard title cannot be empty.")

        try:
            dashboard = Dashboard.objects.get(id=dashboard_id, project__users=user)
        except Dashboard.DoesNotExist:
            raise PermissionError(f"Dashboard with ID {dashboard_id} not found or user lacks access.")

        dashboard.name = title.strip()[:30]
        dashboard.save()

        return {
            "id": dashboard.id,
            "name": dashboard.name,
            "title": dashboard.name,
            "project_id": dashboard.project_id,
            "order_in_project": dashboard.order_in_project,
        }

    @classmethod
    def delete_dashboard(cls, user, dashboard_id: int) -> Dict[str, Any]:
        """Delete a dashboard and cascade deletion to all child components."""
        cls._validate_user(user)

        try:
            dashboard = Dashboard.objects.get(id=dashboard_id, project__users=user)
        except Dashboard.DoesNotExist:
            raise PermissionError(f"Dashboard with ID {dashboard_id} not found or user lacks access.")

        deleted_id = dashboard.id
        dashboard.delete()

        return {"status": "deleted", "dashboard_id": deleted_id}

    # -------------------------------------------------------------------------
    # Polymorphic Component CRUD Operations
    # -------------------------------------------------------------------------

    @classmethod
    def add_component(
        cls,
        user,
        dashboard_id: int,
        component_type: str,
        title: str = "",
        config: Optional[Dict[str, Any]] = None,
        position: Optional[Dict[str, int]] = None,
    ) -> Dict[str, Any]:
        """Instantiate and attach a concrete polymorphic component subclass to a dashboard."""
        cls._validate_user(user)

        try:
            dashboard = Dashboard.objects.get(id=dashboard_id, project__users=user)
        except Dashboard.DoesNotExist:
            raise PermissionError(f"Dashboard with ID {dashboard_id} not found or user lacks access.")

        model_cls, canonical_name = cls._normalize_type(component_type)
        pos = position or {}
        x = int(pos.get("x", 0))
        y = int(pos.get("y", 0))
        w = int(pos.get("w", 6))
        h = int(pos.get("h", 4))
        cfg = config or {}

        order = dashboard.components.count()

        if model_cls == TextBoxComponent:
            comp = TextBoxComponent.objects.create(
                dashboard=dashboard,
                x=x,
                y=y,
                w=w,
                h=h,
                component_name=canonical_name,
                order=order,
                text=str(cfg.get("text", title or "")),
                font_size=int(cfg.get("font_size", 14)),
            )
        elif model_cls == NumberofEventsComponent:
            comp = NumberofEventsComponent.objects.create(
                dashboard=dashboard,
                x=x,
                y=y,
                w=w,
                h=h,
                component_name=canonical_name,
                order=order,
                color=str(cfg.get("color", "blue")),
            )
        elif model_cls == ImageComponent:
            img_path = cfg.get("image", None)
            if img_path and isinstance(img_path, str) and img_path.startswith("/files/"):
                img_path = img_path[7:]
            comp = ImageComponent.objects.create(
                dashboard=dashboard,
                x=x,
                y=y,
                w=w,
                h=h,
                component_name=canonical_name,
                order=order,
                image=img_path,
            )
        elif model_cls == VariantsComponent:
            comp = VariantsComponent.objects.create(
                dashboard=dashboard,
                x=x,
                y=y,
                w=w,
                h=h,
                component_name=canonical_name,
                order=order,
                automatic_loading=bool(cfg.get("automatic_loading", False)),
                leading_object_type=str(cfg.get("leading_object_type", "") or ""),
                extraction=str(cfg.get("extraction") or "leading_1hop"),
                iso=str(cfg.get("iso") or "wl+vf2"),
                timeout_s=float(cfg.get("timeout_s", 10.0)),
            )
        elif model_cls == ProcessAreaComponent:
            comp = ProcessAreaComponent.objects.create(
                dashboard=dashboard,
                x=x,
                y=y,
                w=w,
                h=h,
                component_name=canonical_name,
                order=order,
            )
        elif model_cls == LogStatisticsComponent:
            comp = LogStatisticsComponent.objects.create(
                dashboard=dashboard,
                x=x,
                y=y,
                w=w,
                h=h,
                component_name=canonical_name,
                order=order,
                show_num_events=bool(cfg.get("show_num_events", True)),
                show_num_activities=bool(cfg.get("show_num_activities", True)),
                show_num_objects=bool(cfg.get("show_num_objects", True)),
                show_num_object_types=bool(cfg.get("show_num_object_types", True)),
                show_earliest_timestamp=bool(cfg.get("show_earliest_timestamp", False)),
                show_newest_timestamp=bool(cfg.get("show_newest_timestamp", False)),
                show_duration=bool(cfg.get("show_duration", False)),
            )
        elif model_cls == OCDFGComponent:
            comp = OCDFGComponent.objects.create(
                dashboard=dashboard,
                x=x,
                y=y,
                w=w,
                h=h,
                component_name=canonical_name,
                order=order,
                show_controls=bool(cfg.get("show_controls", True)),
                initial_interaction_locked=bool(cfg.get("initial_interaction_locked", True)),
            )
        elif model_cls == OCDottedChartComponent:
            raw_file_id = cfg.get("file_id")
            file_id_val = int(raw_file_id) if raw_file_id is not None else None
            comp = OCDottedChartComponent.objects.create(
                dashboard=dashboard,
                x=x,
                y=y,
                w=w,
                h=h,
                component_name=canonical_name,
                order=order,
                file_id=file_id_val,
                x_axis=str(cfg.get("x_axis") or "time"),
                y_axis=str(cfg.get("y_axis") or "activity"),
                color_by=str(cfg.get("color_by") or "activity"),
                shape_by=str(cfg.get("shape_by") or "none"),
                row_order=str(cfg.get("row_order") or "first_occurrence"),
                max_points=int(cfg.get("max_points", 10000)),
                show_minimap=bool(cfg.get("show_minimap", True)),
                show_controls=bool(cfg.get("show_controls", True)),
            )
        elif model_cls == NewOCDFGComponent:
            comp = NewOCDFGComponent.objects.create(
                dashboard=dashboard,
                x=x,
                y=y,
                w=w,
                h=h,
                component_name=canonical_name,
                order=order,
                show_controls=bool(cfg.get("show_controls", True)),
                initial_interaction_locked=bool(cfg.get("initial_interaction_locked", True)),
                layout_direction=str(cfg.get("layout_direction", "TB")),
            )
        elif model_cls == OCCNComponent:
            obj_types = cfg.get("object_types", "")
            if isinstance(obj_types, list):
                obj_types = ",".join(obj_types)
            comp = OCCNComponent.objects.create(
                dashboard=dashboard,
                x=x,
                y=y,
                w=w,
                h=h,
                component_name=canonical_name,
                order=order,
                relative_occurrence_threshold=float(cfg.get("relative_occurrence_threshold", 0.0)),
                show_controls=bool(cfg.get("show_controls", True)),
                initial_interaction_locked=bool(cfg.get("initial_interaction_locked", True)),
                layout_direction=str(cfg.get("layout_direction", "LR")),
                object_types=str(obj_types or ""),
            )
        elif model_cls == SqlQueryComponent:
            comp = SqlQueryComponent.objects.create(
                dashboard=dashboard,
                x=x,
                y=y,
                w=w,
                h=h,
                component_name=canonical_name,
                order=order,
                name=str(cfg.get("name", "")),
                query=str(cfg.get("query") or "SELECT activity, count(*) AS n FROM events GROUP BY activity"),
                expected_result=cfg.get("expected_result"),
                row_limit=int(cfg.get("row_limit", 25)),
            )
        else:
            comp = TextBoxComponent.objects.create(
                dashboard=dashboard,
                x=x,
                y=y,
                w=w,
                h=h,
                component_name=canonical_name,
                order=order,
                text=str(cfg.get("text", title or "")),
                font_size=int(cfg.get("font_size", 14)),
            )

        return DashboardComponentPolymorphicSerializer(comp).data

    @classmethod
    def update_component(
        cls,
        user,
        dashboard_id: Optional[int] = None,
        component_id: Optional[int] = None,
        config: Optional[Dict[str, Any]] = None,
        position: Optional[Dict[str, int]] = None,
    ) -> Dict[str, Any]:
        """Update geometry coordinates or configuration fields of an existing component."""
        cls._validate_user(user)

        if component_id is None:
            raise ValueError("component_id must be provided to update a component.")

        qs = DashboardComponent.objects.filter(id=component_id, dashboard__project__users=user)
        if dashboard_id is not None:
            qs = qs.filter(dashboard_id=dashboard_id)

        base_comp = qs.first()
        if base_comp is None:
            raise PermissionError(f"Component with ID {component_id} not found or user lacks access.")

        comp = cls.get_concrete_instance(base_comp)

        if position and isinstance(position, dict):
            if "x" in position:
                comp.x = int(position["x"])
            if "y" in position:
                comp.y = int(position["y"])
            if "w" in position:
                comp.w = int(position["w"])
            if "h" in position:
                comp.h = int(position["h"])

        if config and isinstance(config, dict):
            if isinstance(comp, TextBoxComponent):
                if "text" in config:
                    comp.text = str(config["text"])
                if "font_size" in config:
                    comp.font_size = int(config["font_size"])
            elif isinstance(comp, NumberofEventsComponent):
                if "color" in config:
                    comp.color = str(config["color"])
            elif isinstance(comp, ImageComponent):
                if "image" in config:
                    img = config["image"]
                    if img and isinstance(img, str) and img.startswith("/files/"):
                        img = img[7:]
                    comp.image = img
            elif isinstance(comp, VariantsComponent):
                if "automatic_loading" in config:
                    comp.automatic_loading = bool(config["automatic_loading"])
                if "leading_object_type" in config:
                    comp.leading_object_type = str(config["leading_object_type"] or "")
                if "extraction" in config:
                    comp.extraction = str(config["extraction"])
                if "iso" in config:
                    comp.iso = str(config["iso"])
                if "timeout_s" in config:
                    comp.timeout_s = float(config["timeout_s"])
            elif isinstance(comp, LogStatisticsComponent):
                for f in (
                    "show_num_events",
                    "show_num_activities",
                    "show_num_objects",
                    "show_num_object_types",
                    "show_earliest_timestamp",
                    "show_newest_timestamp",
                    "show_duration",
                ):
                    if f in config:
                        setattr(comp, f, bool(config[f]))
            elif isinstance(comp, OCDFGComponent):
                if "show_controls" in config:
                    comp.show_controls = bool(config["show_controls"])
                if "initial_interaction_locked" in config:
                    comp.initial_interaction_locked = bool(config["initial_interaction_locked"])
            elif isinstance(comp, OCDottedChartComponent):
                if "file_id" in config:
                    comp.file_id = int(config["file_id"]) if config["file_id"] is not None else None
                if "x_axis" in config:
                    comp.x_axis = str(config["x_axis"])
                if "y_axis" in config:
                    comp.y_axis = str(config["y_axis"])
                if "color_by" in config:
                    comp.color_by = str(config["color_by"])
                if "shape_by" in config:
                    comp.shape_by = str(config["shape_by"])
                if "row_order" in config:
                    comp.row_order = str(config["row_order"])
                if "max_points" in config:
                    comp.max_points = int(config["max_points"])
                if "show_minimap" in config:
                    comp.show_minimap = bool(config["show_minimap"])
                if "show_controls" in config:
                    comp.show_controls = bool(config["show_controls"])
            elif isinstance(comp, NewOCDFGComponent):
                if "show_controls" in config:
                    comp.show_controls = bool(config["show_controls"])
                if "initial_interaction_locked" in config:
                    comp.initial_interaction_locked = bool(config["initial_interaction_locked"])
                if "layout_direction" in config:
                    comp.layout_direction = str(config["layout_direction"])
            elif isinstance(comp, OCCNComponent):
                if "relative_occurrence_threshold" in config:
                    comp.relative_occurrence_threshold = float(config["relative_occurrence_threshold"])
                if "show_controls" in config:
                    comp.show_controls = bool(config["show_controls"])
                if "initial_interaction_locked" in config:
                    comp.initial_interaction_locked = bool(config["initial_interaction_locked"])
                if "layout_direction" in config:
                    comp.layout_direction = str(config["layout_direction"])
                if "object_types" in config:
                    ot = config["object_types"]
                    if isinstance(ot, list):
                        ot = ",".join(ot)
                    comp.object_types = str(ot or "")
            elif isinstance(comp, SqlQueryComponent):
                if "name" in config:
                    comp.name = str(config["name"] or "")
                if "query" in config:
                    comp.query = str(config["query"] or "")
                if "expected_result" in config:
                    comp.expected_result = config["expected_result"]
                if "row_limit" in config:
                    comp.row_limit = int(config["row_limit"])

        comp.save()
        return DashboardComponentPolymorphicSerializer(comp).data

    @classmethod
    def remove_component(
        cls,
        user,
        dashboard_id: Optional[int] = None,
        component_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Remove a component from a dashboard."""
        cls._validate_user(user)

        if component_id is None:
            raise ValueError("component_id must be provided to remove a component.")

        qs = DashboardComponent.objects.filter(id=component_id, dashboard__project__users=user)
        if dashboard_id is not None:
            qs = qs.filter(dashboard_id=dashboard_id)

        comp = qs.first()
        if comp is None:
            raise PermissionError(f"Component with ID {component_id} not found or user lacks access.")

        comp_id_val = comp.id
        comp.delete()

        return {"status": "deleted", "component_id": comp_id_val}
