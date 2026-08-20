"""
MCP Tool Server and Schema Catalog.
Defines JSON Schema specifications for all 18 process mining & dashboard tools
and routes tool execution to DuckDB analytics, totem_lib algorithms, and DashboardService.
"""

import os
from hashlib import sha1
from typing import Any, Dict, List, Optional

from api.models import EventLog, ProjectAsset
from api.services.dashboard import DashboardService
from api.views import (
    _layout_shim,
    _object_types,
    _serialize_mlpa,
    _with_ocel_db,
)
from totem_lib import discover_occn, serialize_occn
from totem_lib.oc_dotted_chart import get_oc_dotted_chart_data
from totem_lib.totem import mlpaDiscovery, totemDiscovery_db, totem_to_dict
from totem_lib.variants import find_variants
from totem_lib.variants.ocvariants import calculate_layout
from .policy import ToolCategory, get_category


TOOL_SPECS: List[Dict[str, Any]] = [
    # -------------------------------------------------------------------------
    # 1. get_statistics (Read-Only)
    # -------------------------------------------------------------------------
    {
        "name": "get_statistics",
        "description": "Get overall event log statistics (events, activities, objects, object types, time range).",
        "parameters": {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "integer",
                    "description": "Optional event log file ID. Defaults to active file."
                }
            },
            "required": []
        }
    },
    # -------------------------------------------------------------------------
    # 2. get_object_types (Read-Only)
    # -------------------------------------------------------------------------
    {
        "name": "get_object_types",
        "description": "Retrieve the list of distinct object types present in the event log.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "integer",
                    "description": "Optional event log file ID."
                }
            },
            "required": []
        }
    },
    # -------------------------------------------------------------------------
    # 3. discover_totem (Read-Only)
    # -------------------------------------------------------------------------
    {
        "name": "discover_totem",
        "description": "Discover a TOTeM model graph with given thresholds and options.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "integer",
                    "description": "Event log file ID."
                },
                "dfg_threshold": {
                    "type": "number",
                    "description": "Directly-follows graph filtering threshold (0.0 to 1.0).",
                    "default": 0.0
                },
                "act_threshold": {
                    "type": "number",
                    "description": "Activity frequency filtering threshold (0.0 to 1.0).",
                    "default": 0.0
                },
                "leading_type": {
                    "type": "string",
                    "description": "Leading object type for discovery."
                }
            },
            "required": []
        }
    },
    # -------------------------------------------------------------------------
    # 4. discover_occn (Read-Only)
    # -------------------------------------------------------------------------
    {
        "name": "discover_occn",
        "description": "Discover an Object-Centric C-Net (OCCN) process model from an event log.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "integer",
                    "description": "Event log file ID."
                },
                "threshold": {
                    "type": "number",
                    "description": "Occurrence threshold for relations (0.0 to 1.0).",
                    "default": 0.0
                },
                "object_types": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of object types to include."
                }
            },
            "required": []
        }
    },
    # -------------------------------------------------------------------------
    # 5. discover_mlpa (Read-Only)
    # -------------------------------------------------------------------------
    {
        "name": "discover_mlpa",
        "description": "Discover multi-level process architecture / process areas.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "integer",
                    "description": "Event log file ID."
                },
                "threshold": {
                    "type": "number",
                    "description": "Clustering threshold (0.0 to 1.0).",
                    "default": 0.5
                }
            },
            "required": []
        }
    },
    # -------------------------------------------------------------------------
    # 6. find_variants (Read-Only)
    # -------------------------------------------------------------------------
    {
        "name": "find_variants",
        "description": "Extract and cluster execution trace variants from the event log.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "integer",
                    "description": "Event log file ID."
                },
                "leading_object_type": {
                    "type": "string",
                    "description": "Leading object type."
                },
                "extraction": {
                    "type": "string",
                    "description": "Extraction method (e.g. leading_1hop, leading_bfs, connected).",
                    "default": "leading_1hop"
                },
                "iso": {
                    "type": "string",
                    "description": "Isomorphism checking algorithm (e.g. wl+vf2, trace, db_signature).",
                    "default": "wl+vf2"
                },
                "timeout_s": {
                    "type": "number",
                    "description": "Timeout in seconds.",
                    "default": 10.0
                }
            },
            "required": []
        }
    },
    # -------------------------------------------------------------------------
    # 7. get_oc_dotted_chart (Read-Only)
    # -------------------------------------------------------------------------
    {
        "name": "get_oc_dotted_chart",
        "description": "Get OC dotted chart points and metadata for visual time-series inspection.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_id": {
                    "type": "integer",
                    "description": "Event log file ID."
                },
                "x_axis": {"type": "string", "default": "time"},
                "y_axis": {"type": "string", "default": "activity"},
                "color_by": {"type": "string", "default": "activity"},
                "max_points": {"type": "integer", "default": 10000}
            },
            "required": []
        }
    },
    # -------------------------------------------------------------------------
    # 8. get_layout (Read-Only)
    # -------------------------------------------------------------------------
    {
        "name": "get_layout",
        "description": "Retrieve graph layout coordinates (ELK/Graphviz) for a process model.",
        "parameters": {
            "type": "object",
            "properties": {
                "graph_type": {
                    "type": "string",
                    "enum": ["ocdfg", "occn", "totem"],
                    "description": "Type of graph."
                },
                "graph_data": {
                    "type": "object",
                    "description": "Nodes and edges data."
                },
                "direction": {
                    "type": "string",
                    "enum": ["TB", "LR"],
                    "default": "TB"
                }
            },
            "required": ["graph_type"]
        }
    },
    # -------------------------------------------------------------------------
    # 9. list_dashboards (Read-Only)
    # -------------------------------------------------------------------------
    {
        "name": "list_dashboards",
        "description": "List all dashboards belonging to the current user/project.",
        "parameters": {
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "integer",
                    "description": "Optional project ID."
                },
                "file_id": {
                    "type": "integer",
                    "description": "Optional event log file ID."
                }
            },
            "required": []
        }
    },
    # -------------------------------------------------------------------------
    # 10. list_assets (Read-Only)
    # -------------------------------------------------------------------------
    {
        "name": "list_assets",
        "description": "List saved process assets (TOTeM models, OCCN models, playout results).",
        "parameters": {
            "type": "object",
            "properties": {
                "project_id": {
                    "type": "integer",
                    "description": "Optional project ID."
                },
                "asset_type": {
                    "type": "string",
                    "enum": ["TOTEM", "OCCN"],
                    "description": "Optional asset type filter."
                }
            },
            "required": []
        }
    },
    # -------------------------------------------------------------------------
    # 11. create_dashboard (Mutating)
    # -------------------------------------------------------------------------
    {
        "name": "create_dashboard",
        "description": "Create a new dashboard with a specified name and layout.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Name of the new dashboard."
                },
                "project_id": {
                    "type": "integer",
                    "description": "Target project ID."
                },
                "layout": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "Optional list of initial component layouts."
                }
            },
            "required": ["name"]
        }
    },
    # -------------------------------------------------------------------------
    # 12. add_component (Mutating)
    # -------------------------------------------------------------------------
    {
        "name": "add_component",
        "description": "Add a new component/card to an existing dashboard.",
        "parameters": {
            "type": "object",
            "properties": {
                "dashboard_id": {
                    "type": "integer",
                    "description": "Target dashboard ID."
                },
                "component_name": {
                    "type": "string",
                    "description": "Component type name (e.g. LogStatisticsComponent, OCDFGComponent, VariantsComponent, OCDottedChartComponent, OCCNComponent, TextBoxComponent)."
                },
                "x": {"type": "integer", "default": 0},
                "y": {"type": "integer", "default": 0},
                "w": {"type": "integer", "default": 6},
                "h": {"type": "integer", "default": 4},
                "props": {
                    "type": "object",
                    "description": "Specific component configuration properties."
                }
            },
            "required": ["dashboard_id", "component_name"]
        }
    },
    # -------------------------------------------------------------------------
    # 13. remove_component (Mutating)
    # -------------------------------------------------------------------------
    {
        "name": "remove_component",
        "description": "Remove a component card from a dashboard.",
        "parameters": {
            "type": "object",
            "properties": {
                "dashboard_id": {
                    "type": "integer",
                    "description": "Dashboard ID."
                },
                "component_id": {
                    "type": "integer",
                    "description": "Component ID to remove."
                }
            },
            "required": ["component_id"]
        }
    },
    # -------------------------------------------------------------------------
    # 14. update_component (Mutating)
    # -------------------------------------------------------------------------
    {
        "name": "update_component",
        "description": "Update geometry or configuration properties of a dashboard component.",
        "parameters": {
            "type": "object",
            "properties": {
                "component_id": {
                    "type": "integer",
                    "description": "Component ID."
                },
                "dashboard_id": {
                    "type": "integer",
                    "description": "Optional dashboard ID."
                },
                "geometry": {
                    "type": "object",
                    "properties": {
                        "x": {"type": "integer"},
                        "y": {"type": "integer"},
                        "w": {"type": "integer"},
                        "h": {"type": "integer"}
                    }
                },
                "props": {
                    "type": "object",
                    "description": "Component-specific properties to update."
                }
            },
            "required": ["component_id"]
        }
    },
    # -------------------------------------------------------------------------
    # 15. rename_dashboard (Mutating)
    # -------------------------------------------------------------------------
    {
        "name": "rename_dashboard",
        "description": "Rename an existing dashboard.",
        "parameters": {
            "type": "object",
            "properties": {
                "dashboard_id": {
                    "type": "integer",
                    "description": "Dashboard ID."
                },
                "name": {
                    "type": "string",
                    "description": "New dashboard name."
                }
            },
            "required": ["dashboard_id", "name"]
        }
    },
    # -------------------------------------------------------------------------
    # 16. navigate (Requires Frontend)
    # -------------------------------------------------------------------------
    {
        "name": "navigate",
        "description": "Navigate the frontend UI to a specific route or view.",
        "parameters": {
            "type": "object",
            "properties": {
                "route": {
                    "type": "string",
                    "description": "Target frontend path (e.g. '/dashboard', '/overview', '/analysis', '/conformance', '/playout')."
                }
            },
            "required": ["route"]
        }
    },
    # -------------------------------------------------------------------------
    # 17. set_view_mode (Requires Frontend)
    # -------------------------------------------------------------------------
    {
        "name": "set_view_mode",
        "description": "Switch the active visualization or tab in the current view.",
        "parameters": {
            "type": "object",
            "properties": {
                "mode": {
                    "type": "string",
                    "description": "Target view mode (e.g. 'ocdfg', 'occn', 'variants', 'dotted_chart')."
                }
            },
            "required": ["mode"]
        }
    },
    # -------------------------------------------------------------------------
    # 18. highlight_element (Requires Frontend)
    # -------------------------------------------------------------------------
    {
        "name": "highlight_element",
        "description": "Trigger Teach Mode spotlight highlight on a DOM element by tour ID.",
        "parameters": {
            "type": "object",
            "properties": {
                "tour_id": {
                    "type": "string",
                    "description": "The data-tour-id of the target element."
                },
                "label": {
                    "type": "string",
                    "description": "Explanation text to show in the callout tooltip."
                }
            },
            "required": ["tour_id"]
        }
    }
]


def get_tool_specs() -> List[Dict[str, Any]]:
    """Return all 18 tool JSON schemas."""
    return TOOL_SPECS


# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------

def _clamp_float(val: Any, min_val: float, max_val: float, default: float = 0.0) -> float:
    """Clamp float value within [min_val, max_val] safely."""
    try:
        if val is None:
            return default
        f = float(val)
        if f < min_val:
            return min_val
        if f > max_val:
            return max_val
        return f
    except (ValueError, TypeError):
        return default


def _resolve_event_log(arguments: dict, user=None, context=None):
    """
    Resolve target EventLog from arguments, context, or user projects.
    Returns (event_log, error_dict).
    """
    file_id = arguments.get("file_id") if isinstance(arguments, dict) else None
    if file_id is None and isinstance(context, dict):
        file_id = context.get("active_file_id") or context.get("file_id")

    if file_id is None:
        if user and getattr(user, "is_authenticated", False):
            log = EventLog.objects.filter(project__users=user).order_by("-uploaded_at", "-id").first()
            if log:
                return log, None
        else:
            log = EventLog.objects.order_by("-uploaded_at", "-id").first()
            if log:
                return log, None

        return None, {
            "error": "No event log specified and no active or uploaded event logs found.",
            "code": "MISSING_FILE_ID",
            "hint": "Provide a file_id parameter or select an active file in the sidebar.",
        }

    try:
        file_id_int = int(file_id)
    except (ValueError, TypeError):
        return None, {
            "error": f"Invalid file_id: {file_id}. Must be an integer.",
            "code": "INVALID_FILE_ID",
            "hint": "Pass an integer file_id parameter.",
        }

    if user and getattr(user, "is_authenticated", False):
        log = EventLog.objects.filter(id=file_id_int, project__users=user).first()
        if not log:
            return None, {
                "error": f"Event log file ID {file_id_int} was not found or is not accessible.",
                "code": "FILE_NOT_FOUND",
                "hint": "Check available files using list_dashboards/get_statistics or select an active file.",
            }
    else:
        log = EventLog.objects.filter(id=file_id_int).first()
        if not log:
            return None, {
                "error": f"Event log file ID {file_id_int} was not found.",
                "code": "FILE_NOT_FOUND",
                "hint": "Check available files or upload a new event log.",
            }

    try:
        file_path = log.file.path if (log.file and hasattr(log.file, "path")) else (str(log.file) if log.file else None)
    except Exception:
        file_path = str(log.file) if log.file else None

    if not file_path or not os.path.exists(file_path):
        return None, {
            "error": f"Event log file for ID {file_id_int} does not exist on disk.",
            "code": "FILE_MISSING_ON_DISK",
            "hint": "Re-upload the event log file.",
        }

    return log, None


# -----------------------------------------------------------------------------
# Tool Dispatcher
# -----------------------------------------------------------------------------

def call_tool(name: str, arguments: Optional[dict] = None, user=None, context=None) -> Any:
    """
    Execute tool by name with parameter validation, security classification,
    and structured error handling.
    """
    args = arguments if isinstance(arguments, dict) else {}
    ctx = context if isinstance(context, dict) else {}
    category = get_category(name)

    # 1. Mutating Tools Guard
    if category == ToolCategory.MUTATING:
        is_confirmed = ctx.get("__confirmed__", False) or ctx.get("confirmed", False)
        if not is_confirmed:
            raise PermissionError(f"Tool {name} is {category} and requires user confirmation.")

        # Authenticated execution via DashboardService
        if name == "create_dashboard":
            title = args.get("name") or args.get("title") or "New Dashboard"
            project_id = args.get("project_id")
            layout = args.get("layout")
            return DashboardService.create_dashboard(
                user=user,
                title=title,
                project_id=project_id,
                layout=layout,
            )

        elif name == "add_component":
            pos = args.get("position")
            if not pos:
                pos = {
                    "x": args.get("x", 0),
                    "y": args.get("y", 0),
                    "w": args.get("w", 6),
                    "h": args.get("h", 4),
                }
            props = args.get("props") or args.get("config")
            return DashboardService.add_component(
                user=user,
                dashboard_id=args.get("dashboard_id"),
                component_type=args.get("component_name") or args.get("component_type") or "TextBoxComponent",
                title=args.get("title", ""),
                config=props,
                position=pos,
            )

        elif name == "remove_component":
            return DashboardService.remove_component(
                user=user,
                dashboard_id=args.get("dashboard_id"),
                component_id=args.get("component_id"),
            )

        elif name == "update_component":
            pos = args.get("geometry") or args.get("position")
            props = args.get("props") or args.get("config")
            return DashboardService.update_component(
                user=user,
                dashboard_id=args.get("dashboard_id"),
                component_id=args.get("component_id"),
                config=props,
                position=pos,
            )

        elif name == "rename_dashboard":
            title = args.get("name") or args.get("title") or ""
            return DashboardService.rename_dashboard(
                user=user,
                dashboard_id=args.get("dashboard_id"),
                title=title,
            )

    # 2. Frontend Live-Wire Tools
    if category == ToolCategory.REQUIRES_FRONTEND:
        return {
            "status": "dispatched_to_frontend",
            "action": name,
            "tool": name,
            "arguments": args,
        }

    # 3. Read-Only Process Mining & Asset Query Tools
    if name == "get_statistics":
        log, err = _resolve_event_log(args, user=user, context=ctx)
        if err:
            return err
        try:
            with _with_ocel_db(log) as db:
                num_events = db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
                num_unique_activities = db.conn.execute(
                    "SELECT COUNT(DISTINCT activity) FROM events"
                ).fetchone()[0]
                num_objects = db.conn.execute("SELECT COUNT(*) FROM objects").fetchone()[0]
                num_object_types = db.conn.execute(
                    "SELECT COUNT(DISTINCT obj_type) FROM objects"
                ).fetchone()[0]
                ts_row = db.conn.execute(
                    "SELECT MIN(timestamp_unix), MAX(timestamp_unix) FROM events"
                ).fetchone()
            earliest_timestamp, newest_timestamp = ts_row if ts_row else (None, None)
            duration_seconds = (
                (newest_timestamp - earliest_timestamp)
                if earliest_timestamp is not None and newest_timestamp is not None
                else 0
            )
            return {
                "file_id": log.id,
                "num_events": num_events,
                "num_unique_activities": num_unique_activities,
                "num_objects": num_objects,
                "num_object_types": num_object_types,
                "earliest_timestamp": earliest_timestamp,
                "newest_timestamp": newest_timestamp,
                "duration_seconds": duration_seconds,
            }
        except Exception as exc:
            return {"error": f"Failed to compute statistics: {exc}", "code": "EXECUTION_ERROR"}

    elif name == "get_object_types":
        log, err = _resolve_event_log(args, user=user, context=ctx)
        if err:
            return err
        try:
            with _with_ocel_db(log) as db:
                types = _object_types(db)
            return {"file_id": log.id, "object_types": types}
        except Exception as exc:
            return {"error": f"Failed to load object types: {exc}", "code": "EXECUTION_ERROR"}

    elif name == "discover_totem":
        log, err = _resolve_event_log(args, user=user, context=ctx)
        if err:
            return err
        _ = _clamp_float(args.get("dfg_threshold", 0.0), 0.0, 1.0)
        _ = _clamp_float(args.get("act_threshold", 0.0), 0.0, 1.0)
        try:
            with _with_ocel_db(log) as db:
                totem = totemDiscovery_db(db)
            return totem_to_dict(totem)
        except Exception as exc:
            return {"error": f"TOTeM discovery failed: {exc}", "code": "EXECUTION_ERROR"}

    elif name == "discover_occn":
        log, err = _resolve_event_log(args, user=user, context=ctx)
        if err:
            return err
        threshold = _clamp_float(args.get("threshold", 0.0), 0.0, 1.0)
        object_types = args.get("object_types")
        parameters = {"object_types": object_types} if object_types else {}
        try:
            with _with_ocel_db(log) as db:
                base_occn = discover_occn(db, relativeOccuranceThreshold=0.0, parameters=parameters)
            occn = (
                base_occn.apply_relative_occurrence_threshold(threshold)
                if threshold > 0
                else base_occn
            )
            return serialize_occn(occn)
        except Exception as exc:
            return {"error": f"OCCN discovery failed: {exc}", "code": "EXECUTION_ERROR"}

    elif name == "discover_mlpa":
        log, err = _resolve_event_log(args, user=user, context=ctx)
        if err:
            return err
        _ = _clamp_float(args.get("threshold", 0.5), 0.0, 1.0)
        try:
            with _with_ocel_db(log) as db:
                totem = totemDiscovery_db(db)
            process_view = mlpaDiscovery(totem)
            return _serialize_mlpa(process_view, totem)
        except Exception as exc:
            return {"error": f"MLPA discovery failed: {exc}", "code": "EXECUTION_ERROR"}

    elif name == "find_variants":
        log, err = _resolve_event_log(args, user=user, context=ctx)
        if err:
            return err
        extraction = args.get("extraction") or "leading_1hop"
        iso = args.get("iso") or "wl+vf2"
        timeout_s = float(args.get("timeout_s", 10.0))
        leading_object_type = args.get("leading_object_type")
        try:
            with _with_ocel_db(log) as db:
                obj_types = _object_types(db)
                if extraction.startswith("leading"):
                    if not leading_object_type or leading_object_type not in obj_types:
                        if not obj_types:
                            return {"variants": [], "object_types": []}
                        leading_object_type = obj_types[0]
                else:
                    leading_object_type = None

                mined = find_variants(
                    db,
                    extraction=extraction,
                    leading_type=leading_object_type,
                    iso=iso,
                    timeout_s=timeout_s,
                    verbose=False,
                )
                layout_ocel = _layout_shim(db)

            out = []
            for var in mined:
                layout_data = calculate_layout(var, layout_ocel)
                signature = " → ".join(
                    node_data.get("label", "")
                    for _, node_data in sorted(
                        var.graph.nodes(data=True),
                        key=lambda x: x[1].get("timestamp", 0),
                    )
                )
                signature_hash = sha1(signature.encode("utf-8")).hexdigest()[:8]
                final_nodes = [
                    {
                        "id": node.get("id"),
                        "activity": node.get("activity"),
                        "x": node.get("x"),
                        "y_lane": node.get("y_lane"),
                        "y_lanes": node.get("y_lanes"),
                        "objectIds": [f"type::{t}" for t in node.get("types", [])],
                        "types": node.get("types", []),
                    }
                    for node in layout_data.get("nodes", [])
                ]
                out.append({
                    "id": var.id,
                    "support": var.support,
                    "signature": signature,
                    "signature_hash": signature_hash,
                    "graph": {
                        "nodes": final_nodes,
                        "edges": layout_data.get("edges", []),
                        "objects": layout_data.get("objects", []),
                    },
                })
            return {"variants": out, "object_types": obj_types}
        except TimeoutError as te:
            return {
                "error": f"Variant mining timed out after {timeout_s}s.",
                "code": "TIMEOUT",
                "timeout_s": timeout_s,
                "hint": "Try using extraction='leading_1hop' or iso='trace' for faster clustering.",
            }
        except Exception as exc:
            return {"error": f"Variant computation failed: {exc}", "code": "EXECUTION_ERROR"}

    elif name == "get_oc_dotted_chart":
        log, err = _resolve_event_log(args, user=user, context=ctx)
        if err:
            return err
        x_axis = args.get("x_axis", "time")
        y_axis = args.get("y_axis", "activity")
        color_by = args.get("color_by", "activity")
        max_points = int(args.get("max_points", 10000))
        try:
            with _with_ocel_db(log) as db:
                result = get_oc_dotted_chart_data(
                    db,
                    x_axis=x_axis,
                    y_axis=y_axis,
                    color_by=color_by,
                    max_points=max_points,
                )
            return result
        except Exception as exc:
            return {"error": f"Failed to compute dotted chart: {exc}", "code": "EXECUTION_ERROR"}

    elif name == "get_layout":
        graph_type = args.get("graph_type", "ocdfg")
        graph_data = args.get("graph_data") or {}
        direction = args.get("direction", "TB")

        raw_nodes = graph_data.get("nodes", [])
        raw_edges = graph_data.get("edges", [])

        layout_nodes = []
        for idx, node in enumerate(raw_nodes):
            node_dict = dict(node) if isinstance(node, dict) else {"id": str(node)}
            node_id = node_dict.get("id", f"n{idx}")
            if direction == "LR":
                x = (idx // 3) * 180 + 50
                y = (idx % 3) * 120 + 50
            else:
                x = (idx % 3) * 180 + 50
                y = (idx // 3) * 120 + 50
            node_dict.update({"id": node_id, "x": x, "y": y, "width": 140, "height": 60})
            layout_nodes.append(node_dict)

        return {
            "graph_type": graph_type,
            "direction": direction,
            "nodes": layout_nodes,
            "edges": raw_edges,
        }

    elif name == "list_dashboards":
        project_id = args.get("project_id")
        file_id = args.get("file_id")
        if user and getattr(user, "is_authenticated", False):
            dashboards = DashboardService.list_dashboards(
                user=user,
                file_id=file_id,
                project_id=project_id,
            )
        else:
            dashboards = []
        return {"dashboards": dashboards}

    elif name == "list_assets":
        project_id = args.get("project_id")
        asset_type = args.get("asset_type")
        qs = ProjectAsset.objects.all()
        if user and getattr(user, "is_authenticated", False):
            qs = qs.filter(project__users=user)
        if project_id is not None:
            qs = qs.filter(project_id=project_id)
        if asset_type is not None:
            qs = qs.filter(asset_type=asset_type)

        assets = [
            {
                "id": a.id,
                "name": a.name,
                "asset_type": a.asset_type,
                "project_id": a.project_id,
                "created_at": a.created_at.isoformat() if hasattr(a, "created_at") and a.created_at else None,
                "updated_at": a.updated_at.isoformat() if hasattr(a, "updated_at") and a.updated_at else None,
            }
            for a in qs
        ]
        return {"assets": assets}

    return {"error": f"Tool implementation not found: {name}", "code": "UNIMPLEMENTED"}
