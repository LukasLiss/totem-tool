"""
Dashboard component CRUD operations.

Pure computation / ORM layer — no algorithmic logic, but keeps the
Django model interactions out of the MCP tool dispatcher so server.py
never touches models directly.
"""

from __future__ import annotations

from typing import Any


_COMPONENT_MODEL_MAP: dict[str, str] = {
    "NumberofEventsComponent": "api.NumberofEventsComponent",
    "TextBoxComponent": "api.TextBoxComponent",
    "ImageComponent": "api.ImageComponent",
    "VariantsComponent": "api.VariantsComponent",
    "ProcessAreaComponent": "api.ProcessAreaComponent",
    "LogStatisticsComponent": "api.LogStatisticsComponent",
    "OCDFGComponent": "api.OCDFGComponent",
    "OCDottedChartComponent": "api.OCDottedChartComponent",
    "NewOCDFGComponent": "api.NewOCDFGComponent",
    "OCCNComponent": "api.OCCNComponent",
}


def _resolve_model(component_name: str):
    """Return the Django model class for a component_name string."""
    from django.apps import apps

    label = _COMPONENT_MODEL_MAP.get(component_name)
    if label is None:
        raise ValueError(f"Unknown component type: {component_name}")
    return apps.get_model(label)


def add_component(
    *,
    dashboard_id: int,
    component_name: str,
    x: int = 0,
    y: int = 0,
    w: int = 4,
    h: int = 3,
    config: dict[str, Any] | None = None,
) -> dict:
    """
    Create a new dashboard component and return its serialized form.

    Returns dict with ``component_id`` on success or ``error`` on failure.
    """
    from api.models import Dashboard

    try:
        dashboard = Dashboard.objects.get(pk=dashboard_id)
    except Dashboard.DoesNotExist:
        return {"error": f"Dashboard {dashboard_id} not found."}

    Model = _resolve_model(component_name)

    max_order = dashboard.components.count()
    instance = Model.objects.create(
        dashboard=dashboard,
        component_name=component_name,
        x=x,
        y=y,
        w=w,
        h=h,
        order=max_order,
        **(_extra_fields(config) or {}),
    )
    return {"component_id": instance.id, "component_name": component_name}


def remove_component(*, dashboard_id: int, component_id: int) -> dict:
    """Delete a component. Returns status dict."""
    from api.models import DashboardComponent

    try:
        comp = DashboardComponent.objects.get(pk=component_id, dashboard_id=dashboard_id)
    except DashboardComponent.DoesNotExist:
        return {"error": f"Component {component_id} not found on dashboard {dashboard_id}."}

    comp.delete()
    return {"status": "removed", "component_id": component_id}


def update_component(
    *,
    dashboard_id: int,
    component_id: int,
    config: dict[str, Any],
) -> dict:
    """
    Update a component's position, size, or type-specific settings.

    *config* may contain ``x``, ``y``, ``w``, ``h``, plus any
    component-specific fields.
    """
    from api.models import DashboardComponent

    try:
        comp = DashboardComponent.objects.get(pk=component_id, dashboard_id=dashboard_id)
    except DashboardComponent.DoesNotExist:
        return {"error": f"Component {component_id} not found on dashboard {dashboard_id}."}

    position_keys = {"x", "y", "w", "h"}
    for key in position_keys:
        if key in config:
            setattr(comp, key, config[key])

    model_fields = {f.name for f in comp._meta.get_fields()}  # type: ignore[attr-defined]
    for key, value in config.items():
        if key not in position_keys and key in model_fields and key not in (
            "id", "dashboard", "component_name", "order",
        ):
            setattr(comp, key, value)

    comp.save()
    return {"component_id": comp.id, "status": "updated"}


def _extra_fields(config: dict[str, Any] | None) -> dict[str, Any] | None:
    """Extract component-type-specific fields from a config dict."""
    if not config:
        return None
    # Strip generic layout keys — the caller already set x/y/w/h on the model.
    layout_keys = {"x", "y", "w", "h"}
    return {k: v for k, v in config.items() if k not in layout_keys}
