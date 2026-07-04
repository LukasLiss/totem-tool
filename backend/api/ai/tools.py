"""MCP-style tool registry for the AI assistant.

Each tool is declared with a JSON-Schema input definition (the same shape an
MCP server would expose) and executed in-process against the Django models.
Every tool is scoped to the requesting user — exactly like the REST API,
data access always goes through ``project__users=user``.

Tools receive a ``ToolContext`` whose ``actions`` list collects predefined
frontend instructions (navigation, data refresh) that are returned to the
browser alongside the chat response.
"""

import json
from dataclasses import dataclass, field

from django.db.models import Max

from ..models import (
    Dashboard,
    EventLog,
    LogStatisticsComponent,
    NewOCDFGComponent,
    NumberofEventsComponent,
    OCDFGComponent,
    OCDottedChartComponent,
    ProcessAreaComponent,
    Project,
    TextBoxComponent,
    VariantsComponent,
)
from ..serializers import DashboardComponentPolymorphicSerializer

ANALYSIS_TYPES = ("processArea", "ocdfg", "variants", "dottedChart")


@dataclass
class ToolContext:
    user: object
    actions: list = field(default_factory=list)


class ToolError(Exception):
    """Raised by tools for user/model-facing validation errors."""


def _get_dashboard(user, dashboard_id):
    try:
        return Dashboard.objects.get(id=dashboard_id, project__users=user)
    except (Dashboard.DoesNotExist, ValueError, TypeError):
        raise ToolError(f"Dashboard {dashboard_id} does not exist (or is not accessible).")


# --------------------------------------------------------------------------
# Tool implementations
# --------------------------------------------------------------------------

def list_event_logs(ctx, args):
    logs = EventLog.objects.filter(project__users=ctx.user).select_related("project")
    return [
        {
            "file_id": log.id,
            "file_name": log.file.name,
            "project_id": log.project_id,
            "project_name": log.project.name,
        }
        for log in logs
    ]


def list_dashboards(ctx, args):
    dashboards = Dashboard.objects.filter(project__users=ctx.user)
    project_id = args.get("project_id")
    if project_id is not None:
        dashboards = dashboards.filter(project_id=project_id)
    return [
        {
            "dashboard_id": dashboard.id,
            "name": dashboard.name,
            "project_id": dashboard.project_id,
        }
        for dashboard in dashboards.order_by("project_id", "order_in_project")
    ]


def create_dashboard(ctx, args):
    name = (args.get("name") or "").strip()
    if not name:
        raise ToolError("A dashboard name is required.")
    if len(name) > 30:
        raise ToolError("Dashboard names are limited to 30 characters.")
    try:
        project = Project.objects.get(id=args.get("project_id"), users=ctx.user)
    except (Project.DoesNotExist, ValueError, TypeError):
        raise ToolError(
            f"Project {args.get('project_id')} does not exist (or is not accessible). "
            "Use list_event_logs to find valid project ids."
        )
    last_order = (
        Dashboard.objects.filter(project=project).aggregate(Max("order_in_project"))[
            "order_in_project__max"
        ]
        or 0
    )
    dashboard = Dashboard.objects.create(
        project=project, name=name, order_in_project=last_order + 1
    )
    ctx.actions.append({"type": "refresh_data"})
    return {"dashboard_id": dashboard.id, "name": dashboard.name, "project_id": project.id}


def rename_dashboard(ctx, args):
    dashboard = _get_dashboard(ctx.user, args.get("dashboard_id"))
    name = (args.get("name") or "").strip()
    if not name:
        raise ToolError("A new dashboard name is required.")
    if len(name) > 30:
        raise ToolError("Dashboard names are limited to 30 characters.")
    dashboard.name = name
    dashboard.save()
    ctx.actions.append({"type": "refresh_data"})
    return {"dashboard_id": dashboard.id, "name": dashboard.name}


def get_dashboard_layout(ctx, args):
    dashboard = _get_dashboard(ctx.user, args.get("dashboard_id"))
    components = []
    for comp in dashboard.components.all():
        # Multi-table inheritance: fetch the concrete subclass so the
        # polymorphic serializer emits the type-specific fields.
        subclass = COMPONENT_MODELS.get(comp.component_name)
        if subclass is not None:
            components.append(subclass.objects.get(id=comp.id))
        else:
            components.append(comp)
    return DashboardComponentPolymorphicSerializer(components, many=True).data


# Per component type: (model class, default width, default height, editable fields)
# component_name strings and defaults mirror the frontend palette
# (frontend/src/gridstack/lib/sidepanel.tsx) and views.save_layout.
COMPONENT_SPECS = {
    "TextBoxComponent": (TextBoxComponent, 6, 1, {"text": "", "font_size": 14}),
    "NumberOfEventsComponent": (NumberofEventsComponent, 4, 2, {"color": "blue"}),
    "VariantsComponent": (
        VariantsComponent,
        6,
        4,
        {
            "automatic_loading": False,
            "leading_object_type": "",
            "extraction": "leading_1hop",
            "iso": "wl+vf2",
            "timeout_s": 10.0,
        },
    ),
    "ProcessAreaComponent": (ProcessAreaComponent, 8, 6, {}),
    "LogStatisticsComponent": (
        LogStatisticsComponent,
        4,
        2,
        {
            "show_num_events": True,
            "show_num_activities": True,
            "show_num_objects": True,
            "show_num_object_types": True,
            "show_earliest_timestamp": False,
            "show_newest_timestamp": False,
            "show_duration": False,
        },
    ),
    "OCDFGComponent": (OCDFGComponent, 8, 6, {"show_controls": True, "initial_interaction_locked": True}),
    "OCDottedChartComponent": (
        OCDottedChartComponent,
        10,
        7,
        {
            "file_id": None,
            "x_axis": "time",
            "y_axis": "activity",
            "color_by": "activity",
            "shape_by": "none",
            "row_order": "first_occurrence",
            "max_points": 10000,
            "show_minimap": True,
            "show_controls": True,
        },
    ),
    "NewOCDFGComponent": (
        NewOCDFGComponent,
        8,
        6,
        {"show_controls": True, "initial_interaction_locked": True, "layout_direction": "TB"},
    ),
    "NewOCDFGVariantsComponent": (
        NewOCDFGComponent,
        8,
        6,
        {"show_controls": True, "initial_interaction_locked": True, "layout_direction": "TB"},
    ),
}

COMPONENT_MODELS = {name: spec[0] for name, spec in COMPONENT_SPECS.items()}
# get_layout stores the model name for the events component; map it too so
# layouts saved through the UI upcast correctly.
COMPONENT_MODELS["NumberofEventsComponent"] = NumberofEventsComponent


def add_dashboard_component(ctx, args):
    dashboard = _get_dashboard(ctx.user, args.get("dashboard_id"))
    component_name = args.get("component_name")
    if component_name not in COMPONENT_SPECS:
        raise ToolError(
            f"Unknown component type '{component_name}'. "
            f"Valid types: {', '.join(sorted(COMPONENT_SPECS))}."
        )
    model, default_w, default_h, editable = COMPONENT_SPECS[component_name]

    config = args.get("config") or {}
    if not isinstance(config, dict):
        raise ToolError("config must be an object of component settings.")
    unknown = set(config) - set(editable) - {"w", "h", "x", "y"}
    if unknown:
        raise ToolError(
            f"Unknown config fields for {component_name}: {', '.join(sorted(unknown))}. "
            f"Allowed: {', '.join(sorted(editable))} plus x, y, w, h."
        )

    # Place the new component below everything already on the dashboard
    bottom = 0
    for comp in dashboard.components.all():
        bottom = max(bottom, comp.y + comp.h)

    fields = dict(editable)
    fields.update({key: value for key, value in config.items() if key in editable})
    # OCDottedChartComponent.file_id has no meaning as None-keyed kwarg filter;
    # drop explicit Nones so model defaults apply.
    fields = {key: value for key, value in fields.items() if value is not None}

    component = model.objects.create(
        dashboard=dashboard,
        component_name=component_name,
        x=int(config.get("x", 0)),
        y=int(config.get("y", bottom)),
        w=int(config.get("w", default_w)),
        h=int(config.get("h", default_h)),
        order=dashboard.components.count(),
        **fields,
    )
    ctx.actions.append({"type": "refresh_data"})
    return {
        "component_id": component.id,
        "component_name": component_name,
        "dashboard_id": dashboard.id,
        "x": component.x,
        "y": component.y,
        "w": component.w,
        "h": component.h,
    }


def navigate_user(ctx, args):
    target = args.get("target")
    action = {"type": "navigate", "target": target}

    if target == "dashboard":
        dashboard = _get_dashboard(ctx.user, args.get("dashboard_id"))
        action["dashboard_id"] = dashboard.id
    elif target == "analysis":
        analysis_type = args.get("analysis_type")
        if analysis_type not in ANALYSIS_TYPES:
            raise ToolError(
                f"analysis_type must be one of: {', '.join(ANALYSIS_TYPES)}."
            )
        action["analysis_type"] = analysis_type
    elif target not in ("overview", "upload", "variants_view"):
        raise ToolError(
            "target must be one of: overview, upload, variants_view, analysis, dashboard."
        )

    file_id = args.get("file_id")
    if file_id is not None:
        if not EventLog.objects.filter(id=file_id, project__users=ctx.user).exists():
            raise ToolError(f"Event log {file_id} does not exist (or is not accessible).")
        action["file_id"] = file_id

    ctx.actions.append(action)
    return {"status": "ok", "navigated_to": target}


# --------------------------------------------------------------------------
# Registry (MCP-style declarations)
# --------------------------------------------------------------------------

TOOLS = [
    {
        "name": "list_event_logs",
        "description": (
            "List the event logs (OCEL files) the user has uploaded, including the "
            "project each belongs to. Dashboards live inside projects, so call this "
            "first to find the project_id for dashboard operations."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
        "func": list_event_logs,
    },
    {
        "name": "list_dashboards",
        "description": "List the user's dashboards, optionally filtered to one project.",
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "integer", "description": "Only list dashboards of this project."}
            },
            "required": [],
        },
        "func": list_dashboards,
    },
    {
        "name": "create_dashboard",
        "description": "Create a new (empty) dashboard in a project. Add components afterwards with add_dashboard_component.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Dashboard name (max 30 characters)."},
                "project_id": {"type": "integer", "description": "Project to create the dashboard in."},
            },
            "required": ["name", "project_id"],
        },
        "func": create_dashboard,
    },
    {
        "name": "rename_dashboard",
        "description": "Rename an existing dashboard.",
        "input_schema": {
            "type": "object",
            "properties": {
                "dashboard_id": {"type": "integer"},
                "name": {"type": "string", "description": "New name (max 30 characters)."},
            },
            "required": ["dashboard_id", "name"],
        },
        "func": rename_dashboard,
    },
    {
        "name": "get_dashboard_layout",
        "description": "Get the components currently placed on a dashboard, including their positions and settings.",
        "input_schema": {
            "type": "object",
            "properties": {"dashboard_id": {"type": "integer"}},
            "required": ["dashboard_id"],
        },
        "func": get_dashboard_layout,
    },
    {
        "name": "add_dashboard_component",
        "description": (
            "Add a visualization component to a dashboard. By default the component is "
            "placed below the existing ones; pass x/y/w/h in config to position it "
            "explicitly (the grid is 12 columns wide). Component types: "
            "TextBoxComponent (config: text, font_size), "
            "NumberOfEventsComponent (config: color), "
            "LogStatisticsComponent (config: show_num_events, show_num_activities, "
            "show_num_objects, show_num_object_types, show_earliest_timestamp, "
            "show_newest_timestamp, show_duration), "
            "VariantsComponent — process variants explorer (config: automatic_loading, "
            "leading_object_type, extraction, iso, timeout_s), "
            "ProcessAreaComponent — TOTeM temporal relations graph, "
            "OCDFGComponent — legacy object-centric directly-follows graph, "
            "NewOCDFGComponent — object-centric DFG with arc weights (config: "
            "show_controls, initial_interaction_locked, layout_direction TB|LR), "
            "NewOCDFGVariantsComponent — object-centric DFG variants view, "
            "OCDottedChartComponent — dotted chart (config: x_axis, y_axis, color_by, "
            "shape_by, row_order, max_points, show_minimap, show_controls)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "dashboard_id": {"type": "integer"},
                "component_name": {
                    "type": "string",
                    "enum": sorted(COMPONENT_SPECS.keys()),
                },
                "config": {
                    "type": "object",
                    "description": "Optional component settings and x/y/w/h grid placement.",
                },
            },
            "required": ["dashboard_id", "component_name"],
        },
        "func": add_dashboard_component,
    },
    {
        "name": "navigate_user",
        "description": (
            "Navigate the user's browser view. Targets: 'overview' (project overview), "
            "'upload' (upload a new event log), 'variants_view' (full-screen variants "
            "explorer), 'analysis' (single-analysis view; requires analysis_type: "
            "processArea = TOTeM temporal relations, ocdfg = object-centric DFG, "
            "variants = process variants, dottedChart = OC dotted chart), or "
            "'dashboard' (open a dashboard; requires dashboard_id). Optionally pass "
            "file_id to select that event log first (required context for analysis "
            "views if no file is selected yet)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "target": {
                    "type": "string",
                    "enum": ["overview", "upload", "variants_view", "analysis", "dashboard"],
                },
                "analysis_type": {"type": "string", "enum": list(ANALYSIS_TYPES)},
                "dashboard_id": {"type": "integer"},
                "file_id": {"type": "integer"},
            },
            "required": ["target"],
        },
        "func": navigate_user,
    },
]

TOOL_SPECS = [
    {"name": tool["name"], "description": tool["description"], "input_schema": tool["input_schema"]}
    for tool in TOOLS
]

_TOOLS_BY_NAME = {tool["name"]: tool for tool in TOOLS}


def execute_tool(ctx, name, arguments):
    """Run a tool and return its result serialized as a string for the model."""
    tool = _TOOLS_BY_NAME.get(name)
    if tool is None:
        return json.dumps({"error": f"Unknown tool '{name}'."})
    if not isinstance(arguments, dict):
        arguments = {}
    try:
        result = tool["func"](ctx, arguments)
    except ToolError as exc:
        return json.dumps({"error": str(exc)})
    except Exception as exc:  # pragma: no cover — defensive: surface to the model
        return json.dumps({"error": f"Tool failed unexpectedly: {exc}"})
    return json.dumps(result, default=str)
