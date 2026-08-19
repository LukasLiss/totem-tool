"""
Security policy for MCP tools.

Categorizes tools into:
  - READ_ONLY: Executed immediately, no user confirmation needed.
  - MUTATING: Changes dashboard/project state, requires user confirmation.
  - REQUIRES_FRONTEND: Must be dispatched via WebSocket to the client.
"""

from enum import Enum


class ToolCategory(Enum):
    READ_ONLY = "read_only"
    MUTATING = "mutating"
    REQUIRES_FRONTEND = "requires_frontend"


# Tool → category mapping
_POLICY = {
    # Read-only
    "get_statistics": ToolCategory.READ_ONLY,
    "get_object_types": ToolCategory.READ_ONLY,
    "discover_totem": ToolCategory.READ_ONLY,
    "discover_occn": ToolCategory.READ_ONLY,
    "discover_mlpa": ToolCategory.READ_ONLY,
    "find_variants": ToolCategory.READ_ONLY,
    "get_oc_dotted_chart": ToolCategory.READ_ONLY,
    "get_layout": ToolCategory.READ_ONLY,
    "list_dashboards": ToolCategory.READ_ONLY,
    "list_assets": ToolCategory.READ_ONLY,
    # Mutating (DB writes)
    "create_dashboard": ToolCategory.MUTATING,
    "add_component": ToolCategory.MUTATING,
    "remove_component": ToolCategory.MUTATING,
    "update_component": ToolCategory.MUTATING,
    "rename_dashboard": ToolCategory.MUTATING,
    # Frontend-only (require WS bridge)
    "navigate": ToolCategory.REQUIRES_FRONTEND,
    "set_view_mode": ToolCategory.REQUIRES_FRONTEND,
    "highlight_element": ToolCategory.REQUIRES_FRONTEND,
}


def get_category(tool_name):
    """
    Return the ToolCategory for a given tool name.

    Raises ValueError if the tool is not in the catalogue.
    """
    if tool_name not in _POLICY:
        raise ValueError(f"Unknown tool: {tool_name}")
    return _POLICY[tool_name]


def is_mutable(tool_name):
    """Check if a tool requires user confirmation."""
    return get_category(tool_name) != ToolCategory.READ_ONLY
