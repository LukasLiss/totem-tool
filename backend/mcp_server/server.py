"""
MCP Tool Server and Schema Catalog.
Defines JSON Schema specifications for all 18 process mining & dashboard tools.
"""

from typing import Any, Dict, List, Optional
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
                    "description": "Clustering threshold.",
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
                    "description": "Extraction method.",
                    "default": "leading_1hop"
                },
                "iso": {
                    "type": "string",
                    "description": "Isomorphism checking algorithm.",
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


def call_tool(name: str, arguments: dict, user=None, context=None) -> Any:
    """
    Execute tool by name. In M1 scaffolding, dispatches read-only tool calls
    or returns placeholder data; expanded in M4.
    """
    category = get_category(name)
    if category != ToolCategory.READ_ONLY:
        raise PermissionError(f"Tool {name} is {category} and requires approval or frontend dispatch.")

    # Scaffolding mock dispatcher for M1 unit tests
    if name == "get_statistics":
        return {"num_events": 100, "num_activities": 10, "num_objects": 25}
    if name == "get_object_types":
        return {"object_types": ["order", "item", "delivery"]}
    if name == "list_dashboards":
        return {"dashboards": []}
    if name == "list_assets":
        return {"assets": []}
    return {"status": "success", "tool": name, "arguments": arguments}
