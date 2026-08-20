"""
MCP Tool Server — Act Mode tool definitions and dispatcher.

Defines ~18 tools for process mining queries and dashboard manipulation.
Each tool has a JSON schema, a category (READ_ONLY, MUTATING, or
REQUIRES_FRONTEND), and a callable implementation.

The assistant brain calls `call_tool(name, arguments, user, context)`
directly — this is an internal Python module, not an HTTP server.
"""

from .policy import ToolCategory, get_category


# ---------------------------------------------------------------------------
# Tool specifications (what the LLM sees)
# ---------------------------------------------------------------------------

TOOL_SPECS = [
    # Read-only tools
    {
        "name": "get_statistics",
        "description": "Get statistics for the currently loaded event log.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "integer",
                    "description": "Event log ID. Uses active file if omitted.",
                }
            },
            "required": [],
        },
    },
    {
        "name": "get_object_types",
        "description": "List distinct object types in the event log.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "integer",
                    "description": "Event log ID. Uses active file if omitted.",
                }
            },
            "required": [],
        },
    },
    {
        "name": "discover_totem",
        "description": (
            "Run TOTeM (Temporal Object Type Model) discovery. Returns object "
            "types, temporal relations (D/Di, I/Ii, P), and cardinalities."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "integer",
                    "description": "Event log ID. Uses active file if omitted.",
                }
            },
            "required": [],
        },
    },
    {
        "name": "discover_occn",
        "description": "Discover an Object-Centric Causal Net from the event log.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "integer",
                    "description": "Event log ID. Uses active file if omitted.",
                }
            },
            "required": [],
        },
    },
    {
        "name": "discover_mlpa",
        "description": (
            "Run Multi-Level Process Abstraction (MLPA) discovery. Returns "
            "layered process view with object types and event types per level."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "integer",
                    "description": "Event log ID. Uses active file if omitted.",
                }
            },
            "required": [],
        },
    },
    {
        "name": "find_variants",
        "description": (
            "Find trace variants in the event log with configurable extraction "
            "and isomorphism strategy."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "integer",
                    "description": "Event log ID. Uses active file if omitted.",
                },
                "extraction": {
                    "type": "string",
                    "enum": ["leading_1hop", "leading_bfs", "connected"],
                    "default": "leading_1hop",
                },
                "leading_type": {
                    "type": "string",
                    "description": (
                        "Object type to lead with (required for leading_* extraction)."
                    ),
                },
                "iso": {
                    "type": "string",
                    "enum": [
                        "db_signature", "trace", "signature",
                        "wl", "wl+vf2", "exact",
                    ],
                    "default": "wl+vf2",
                },
                "timeout_s": {
                    "type": "number",
                    "default": 10.0,
                    "minimum": 0.1,
                    "maximum": 120.0,
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_oc_dotted_chart",
        "description": "Get data for the object-centric dotted chart visualization.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "integer",
                    "description": "Event log ID. Uses active file if omitted.",
                },
                "x_axis": {
                    "type": "string",
                    "enum": ["time", "activity", "start_time", "end_time"],
                    "default": "time",
                },
                "y_axis": {"type": "string", "default": "activity"},
                "color_by": {
                    "type": "string",
                    "enum": ["activity", "object_type", "none"],
                    "default": "activity",
                },
                "max_points": {
                    "type": "integer",
                    "default": 3000,
                    "minimum": 100,
                    "maximum": 50000,
                },
            },
            "required": [],
        },
    },
    {
        "name": "get_layout",
        "description": "Get the component layout of a dashboard.",
        "parameters": {
            "type": "object",
            "properties": {
                "dashboard_id": {
                    "type": "integer",
                    "description": "Dashboard ID. Uses active dashboard if omitted.",
                }
            },
            "required": [],
        },
    },
    {
        "name": "list_dashboards",
        "description": "List all dashboards for the current project.",
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "list_assets",
        "description": "List model assets (TOTEM, OCCN) for the current project.",
        "parameters": {
            "type": "object",
            "properties": {
                "asset_type": {
                    "type": "string",
                    "enum": ["TOTEM", "OCCN"],
                }
            },
            "required": [],
        },
    },
    # Mutating tools (require confirmation)
    {
        "name": "create_dashboard",
        "description": "Create a new empty dashboard in the current project.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Dashboard name."},
                "project_id": {
                    "type": "integer",
                    "description": "Project ID. Uses active project if omitted.",
                },
            },
            "required": ["name"],
        },
    },
    {
        "name": "add_component",
        "description": "Add a component to a dashboard layout.",
        "parameters": {
            "type": "object",
            "properties": {
                "dashboard_id": {"type": "integer"},
                "component_name": {
                    "type": "string",
                    "enum": [
                        "NumberofEventsComponent", "TextBoxComponent",
                        "ImageComponent", "VariantsComponent",
                        "ProcessAreaComponent", "LogStatisticsComponent",
                        "OCDFGComponent", "OCDottedChartComponent",
                        "NewOCDFGComponent", "OCCNComponent",
                    ],
                },
                "x": {"type": "integer", "default": 0},
                "y": {"type": "integer", "default": 0},
                "w": {"type": "integer", "default": 4},
                "h": {"type": "integer", "default": 3},
                "config": {
                    "type": "object",
                    "description": "Component-specific configuration fields.",
                },
            },
            "required": ["dashboard_id", "component_name"],
        },
    },
    {
        "name": "remove_component",
        "description": "Remove a component from a dashboard.",
        "parameters": {
            "type": "object",
            "properties": {
                "dashboard_id": {"type": "integer"},
                "component_id": {"type": "integer"},
            },
            "required": ["dashboard_id", "component_id"],
        },
    },
    {
        "name": "update_component",
        "description": "Update a dashboard component's settings or position.",
        "parameters": {
            "type": "object",
            "properties": {
                "dashboard_id": {"type": "integer"},
                "component_id": {"type": "integer"},
                "config": {
                    "type": "object",
                    "description": (
                        "Fields to update (x, y, w, h, or component-specific settings)."
                    ),
                },
            },
            "required": ["dashboard_id", "component_id", "config"],
        },
    },
    {
        "name": "rename_dashboard",
        "description": "Rename an existing dashboard.",
        "parameters": {
            "type": "object",
            "properties": {
                "dashboard_id": {"type": "integer"},
                "name": {"type": "string"},
            },
            "required": ["dashboard_id", "name"],
        },
    },
    # Frontend-only tools (require WS bridge)
    {
        "name": "navigate",
        "description": "Navigate the frontend to a specific route.",
        "parameters": {
            "type": "object",
            "properties": {
                "route": {
                    "type": "string",
                    "description": "Target route path (e.g. '/overview', '/upload').",
                }
            },
            "required": ["route"],
        },
    },
    {
        "name": "set_view_mode",
        "description": "Switch the dashboard view mode.",
        "parameters": {
            "type": "object",
            "properties": {
                "mode": {
                    "type": "string",
                    "enum": ["overview", "analysis", "dashboard"],
                }
            },
            "required": ["mode"],
        },
    },
    {
        "name": "highlight_element",
        "description": "Highlight a UI element for Teach Mode guided tour.",
        "parameters": {
            "type": "object",
            "properties": {
                "tour_id": {
                    "type": "string",
                    "description": "The data-tour-id attribute value.",
                },
                "label": {
                    "type": "string",
                    "description": "Instructional text for the tooltip.",
                },
            },
            "required": ["tour_id"],
        },
    },
]


def get_tool_specs():
    """Return the full list of tool specs for the LLM."""
    return TOOL_SPECS


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------

def call_tool(name, arguments, user=None, context=None):
    """
    Execute a tool by name with the given arguments.

    Args:
        name: Tool name (must be in TOOL_SPECS).
        arguments: Dict of tool arguments.
        user: Django User (for ORM queries).
        context: Dict with selected_file_id, current_dashboard_id, etc.

    Returns:
        dict: Tool result.

    Raises:
        ValueError: If tool name is unknown.
        RuntimeError: If tool execution fails.
    """
    if name not in TOOLS_CATALOGUE:
        raise ValueError(f"Unknown tool: {name}")

    category = get_category(name)
    handler = TOOLS_CATALOGUE[name]

    try:
        return handler(arguments, user=user, context=context)
    except Exception as e:
        raise RuntimeError(f"Tool '{name}' failed: {e}")


# ---------------------------------------------------------------------------
# Read-only tool implementations
# ---------------------------------------------------------------------------

def _get_statistics(arguments, user=None, context=None):
    """Get event log statistics via totem_lib (computation stays in-lib)."""
    from api.models import EventLog
    from api.views import _with_ocel_db
    from totem_lib.ocel.statistics import get_event_log_statistics

    file_id = arguments.get("file_id") or (context or {}).get("selected_file_id")
    if not file_id:
        return {"error": "No file_id provided and no active file in context."}

    try:
        user_file = EventLog.objects.get(pk=file_id, project__users=user)
    except EventLog.DoesNotExist:
        return {"error": f"Event log {file_id} not found."}

    with _with_ocel_db(user_file) as db:
        return get_event_log_statistics(db)


def _get_object_types(arguments, user=None, context=None):
    """List object types in the active event log."""
    from api.models import EventLog
    from api.views import _with_ocel_db, _object_types

    file_id = arguments.get("file_id") or (context or {}).get("selected_file_id")
    if not file_id:
        return {"error": "No file_id provided and no active file in context."}

    try:
        user_file = EventLog.objects.get(pk=file_id, project__users=user)
    except EventLog.DoesNotExist:
        return {"error": f"Event log {file_id} not found."}

    with _with_ocel_db(user_file) as db:
        types = _object_types(db)

    return {"object_types": types}


def _discover_totem(arguments, user=None, context=None):
    """Run TOTeM discovery."""
    from api.models import EventLog
    from api.views import _with_ocel_db
    from totem_lib.totem import totemDiscovery_db, totem_to_dict
    from django.core.cache import cache

    file_id = arguments.get("file_id") or (context or {}).get("selected_file_id")
    if not file_id:
        return {"error": "No file_id provided and no active file in context."}

    try:
        user_file = EventLog.objects.get(pk=file_id, project__users=user)
    except EventLog.DoesNotExist:
        return {"error": f"Event log {file_id} not found."}

    cache_key = f"totem_discovery_{user_file.pk}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    with _with_ocel_db(user_file) as db:
        totem = totemDiscovery_db(db)
    result = totem_to_dict(totem)
    cache.set(cache_key, result, timeout=3600)
    return result


def _discover_occn(arguments, user=None, context=None):
    """Discover an OC Causal Net."""
    from api.models import EventLog
    from api.views import _with_ocel_db
    from totem_lib import discover_occn, serialize_occn

    file_id = arguments.get("file_id") or (context or {}).get("selected_file_id")
    if not file_id:
        return {"error": "No file_id provided and no active file in context."}

    try:
        user_file = EventLog.objects.get(pk=file_id, project__users=user)
    except EventLog.DoesNotExist:
        return {"error": f"Event log {file_id} not found."}

    with _with_ocel_db(user_file) as db:
        occn = discover_occn(db)

    return serialize_occn(occn)


def _discover_mlpa(arguments, user=None, context=None):
    """Run MLPA discovery."""
    from api.models import EventLog
    from api.views import _with_ocel_db, _serialize_mlpa
    from totem_lib.totem import totemDiscovery_db, mlpaDiscovery
    from django.core.cache import cache

    file_id = arguments.get("file_id") or (context or {}).get("selected_file_id")
    if not file_id:
        return {"error": "No file_id provided and no active file in context."}

    try:
        user_file = EventLog.objects.get(pk=file_id, project__users=user)
    except EventLog.DoesNotExist:
        return {"error": f"Event log {file_id} not found."}

    cache_key = f"mlpa_discovery_{user_file.pk}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    with _with_ocel_db(user_file) as db:
        totem = totemDiscovery_db(db)
    process_view = mlpaDiscovery(totem)
    result = _serialize_mlpa(process_view, totem)
    cache.set(cache_key, result, timeout=3600)
    return result


def _find_variants(arguments, user=None, context=None):
    """Find trace variants."""
    from api.models import EventLog
    from api.views import _with_ocel_db, _object_types
    from totem_lib.variants import find_variants

    file_id = arguments.get("file_id") or (context or {}).get("selected_file_id")
    if not file_id:
        return {"error": "No file_id provided and no active file in context."}

    try:
        user_file = EventLog.objects.get(pk=file_id, project__users=user)
    except EventLog.DoesNotExist:
        return {"error": f"Event log {file_id} not found."}

    extraction = arguments.get("extraction", "leading_1hop")
    iso = arguments.get("iso", "wl+vf2")
    timeout_s = arguments.get("timeout_s", 10.0)
    leading_type = arguments.get("leading_type")

    with _with_ocel_db(user_file) as db:
        obj_types = _object_types(db)
        if extraction.startswith("leading"):
            if not leading_type or leading_type not in obj_types:
                if obj_types:
                    leading_type = obj_types[0]
                else:
                    return {"variants": [], "object_types": []}

        mined = find_variants(
            db,
            extraction=extraction,
            leading_type=leading_type,
            iso=iso,
            timeout_s=timeout_s,
            verbose=False,
        )

    return {
        "variants": [
            {
                "id": str(v.id),
                "support": int(v.support),
            }
            for v in mined
        ],
        "object_types": obj_types,
    }


def _get_oc_dotted_chart(arguments, user=None, context=None):
    """Get OC dotted chart data."""
    from api.models import EventLog
    from api.views import _with_ocel_db
    from totem_lib.oc_dotted_chart import get_oc_dotted_chart_data

    file_id = arguments.get("file_id") or (context or {}).get("selected_file_id")
    if not file_id:
        return {"error": "No file_id provided and no active file in context."}

    try:
        user_file = EventLog.objects.get(pk=file_id, project__users=user)
    except EventLog.DoesNotExist:
        return {"error": f"Event log {file_id} not found."}

    with _with_ocel_db(user_file) as db:
        result = get_oc_dotted_chart_data(
            db,
            x_axis=arguments.get("x_axis", "time"),
            y_axis=arguments.get("y_axis", "activity"),
            color_by=arguments.get("color_by", "activity"),
            max_points=arguments.get("max_points", 3000),
        )

    return result


def _get_layout(arguments, user=None, context=None):
    """Get dashboard component layout."""
    from api.models import Dashboard

    dashboard_id = arguments.get("dashboard_id") or (context or {}).get("current_dashboard_id")
    if not dashboard_id:
        return {"error": "No dashboard_id provided and no active dashboard in context."}

    try:
        dashboard = Dashboard.objects.get(pk=dashboard_id, project__users=user)
    except Dashboard.DoesNotExist:
        return {"error": f"Dashboard {dashboard_id} not found."}

    from api.views import DashboardViewSet
    from api.serializers import DashboardComponentPolymorphicSerializer

    base_components = dashboard.components.all()
    components = []
    for comp in base_components:
        model_class = comp.__class__
        try:
            specific = model_class.objects.get(id=comp.id)
            components.append(specific)
        except model_class.DoesNotExist:
            components.append(comp)

    serializer = DashboardComponentPolymorphicSerializer(components, many=True)
    return {"components": serializer.data}


def _list_dashboards(arguments, user=None, context=None):
    """List dashboards for the current project."""
    from api.models import Dashboard, EventLog

    # Try to find the project from context
    selected_file_id = (context or {}).get("selected_file_id")
    if selected_file_id:
        try:
            el = EventLog.objects.get(pk=selected_file_id)
            project_id = el.project_id
        except EventLog.DoesNotExist:
            return {"dashboards": []}
    else:
        return {"error": "No active project context."}

    dashboards = Dashboard.objects.filter(project_id=project_id).values(
        "id", "name", "created_at"
    )
    return {"dashboards": list(dashboards)}


def _list_assets(arguments, user=None, context=None):
    """List model assets for the current project."""
    from api.models import ProjectAsset, EventLog

    selected_file_id = (context or {}).get("selected_file_id")
    if selected_file_id:
        try:
            el = EventLog.objects.get(pk=selected_file_id)
            project_id = el.project_id
        except EventLog.DoesNotExist:
            return {"assets": []}
    else:
        return {"error": "No active project context."}

    qs = ProjectAsset.objects.filter(project_id=project_id)
    asset_type = arguments.get("asset_type")
    if asset_type:
        qs = qs.filter(asset_type=asset_type)

    assets = list(qs.values("id", "name", "asset_type", "created_at"))
    return {"assets": assets}


# ---------------------------------------------------------------------------
# Mutating tool implementations (stubs — full implementation in Task 3)
# ---------------------------------------------------------------------------

def _create_dashboard(arguments, user=None, context=None):
    from api.models import Dashboard, EventLog

    name = arguments.get("name", "Untitled")
    project_id = arguments.get("project_id")
    if not project_id:
        selected_file_id = (context or {}).get("selected_file_id")
        if selected_file_id:
            try:
                el = EventLog.objects.get(pk=selected_file_id)
                project_id = el.project_id
            except EventLog.DoesNotExist:
                return {"error": "Cannot determine project from active file."}
    if not project_id:
        return {"error": "project_id is required."}

    max_order = Dashboard.objects.filter(project_id=project_id).count()
    dashboard = Dashboard.objects.create(
        project_id=project_id, name=name, order_in_project=max_order
    )
    return {"dashboard_id": dashboard.id, "name": dashboard.name}


def _add_component(arguments, user=None, context=None):
    from totem_lib.dashboard import add_component

    dashboard_id = arguments.get("dashboard_id") or (context or {}).get("current_dashboard_id")
    if not dashboard_id:
        return {"error": "No dashboard_id provided and no active dashboard in context."}

    component_name = arguments.get("component_name")
    if not component_name:
        return {"error": "component_name is required."}

    return add_component(
        dashboard_id=dashboard_id,
        component_name=component_name,
        x=arguments.get("x", 0),
        y=arguments.get("y", 0),
        w=arguments.get("w", 4),
        h=arguments.get("h", 3),
        config=arguments.get("config"),
    )


def _remove_component(arguments, user=None, context=None):
    from totem_lib.dashboard import remove_component

    dashboard_id = arguments.get("dashboard_id") or (context or {}).get("current_dashboard_id")
    component_id = arguments.get("component_id")
    if not dashboard_id or not component_id:
        return {"error": "dashboard_id and component_id are required."}

    return remove_component(dashboard_id=dashboard_id, component_id=component_id)


def _update_component(arguments, user=None, context=None):
    from totem_lib.dashboard import update_component

    dashboard_id = arguments.get("dashboard_id") or (context or {}).get("current_dashboard_id")
    component_id = arguments.get("component_id")
    config = arguments.get("config", {})
    if not dashboard_id or not component_id:
        return {"error": "dashboard_id and component_id are required."}

    return update_component(dashboard_id=dashboard_id, component_id=component_id, config=config)


def _rename_dashboard(arguments, user=None, context=None):
    from api.models import Dashboard

    dashboard_id = arguments.get("dashboard_id")
    name = arguments.get("name")
    if not dashboard_id or not name:
        return {"error": "dashboard_id and name are required."}

    try:
        dashboard = Dashboard.objects.get(pk=dashboard_id, project__users=user)
    except Dashboard.DoesNotExist:
        return {"error": f"Dashboard {dashboard_id} not found."}

    dashboard.name = name
    dashboard.save()
    return {"dashboard_id": dashboard.id, "name": dashboard.name}


def _navigate(arguments, user=None, context=None):
    return _dispatch_frontend("navigate", arguments, user)


def _set_view_mode(arguments, user=None, context=None):
    return _dispatch_frontend("set_view_mode", arguments, user)


def _highlight_element(arguments, user=None, context=None):
    return _dispatch_frontend("highlight_element", arguments, user)


def _dispatch_frontend(command: str, arguments: dict, user) -> dict:
    """Try to push a command to the user's WebSocket session.

    If the user has an active WS connection the command is sent immediately
    and the result is returned.  If no connection exists, a pending_ws
    status is returned so the HTTP layer can surface it as a pending action.
    """
    try:
        from agent.registry import session_registry
    except ImportError:
        return {"status": "pending_ws", "action": command, "arguments": arguments}

    if user is None or not session_registry.is_online(user.pk):
        return {"status": "pending_ws", "action": command, "arguments": arguments}

    consumer = session_registry.get_consumer(user.pk)
    if consumer is None:
        return {"status": "pending_ws", "action": command, "arguments": arguments}

    import asyncio
    import threading

    def _send_in_new_loop(coro):
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(coro)
        finally:
            loop.close()

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # Called from a sync Django view — schedule on a dedicated thread
        # to avoid "cannot call running loop" errors.
        threading.Thread(
            target=_send_in_new_loop,
            args=(consumer.push_command(command, arguments),),
            daemon=True,
        ).start()
        return {"status": "dispatched", "action": command, "arguments": arguments}

    return {"status": "pending_ws", "action": command, "arguments": arguments}


# ---------------------------------------------------------------------------
# Tool registry
# ---------------------------------------------------------------------------

TOOLS_CATALOGUE = {
    "get_statistics": _get_statistics,
    "get_object_types": _get_object_types,
    "discover_totem": _discover_totem,
    "discover_occn": _discover_occn,
    "discover_mlpa": _discover_mlpa,
    "find_variants": _find_variants,
    "get_oc_dotted_chart": _get_oc_dotted_chart,
    "get_layout": _get_layout,
    "list_dashboards": _list_dashboards,
    "list_assets": _list_assets,
    "create_dashboard": _create_dashboard,
    "add_component": _add_component,
    "remove_component": _remove_component,
    "update_component": _update_component,
    "rename_dashboard": _rename_dashboard,
    "navigate": _navigate,
    "set_view_mode": _set_view_mode,
    "highlight_element": _highlight_element,
}
