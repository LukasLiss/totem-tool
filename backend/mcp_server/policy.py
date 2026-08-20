"""
MCP Tool Security Classification and Policy Engine.
"""

from enum import Enum


class ToolCategory(str, Enum):
    READ_ONLY = "read_only"
    MUTATING = "mutating"
    REQUIRES_FRONTEND = "requires_frontend"


TOOL_CATEGORIES = {
    # 10 Read-Only Tools
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

    # 5 Mutating Tools (require user confirmation)
    "create_dashboard": ToolCategory.MUTATING,
    "add_component": ToolCategory.MUTATING,
    "remove_component": ToolCategory.MUTATING,
    "update_component": ToolCategory.MUTATING,
    "rename_dashboard": ToolCategory.MUTATING,

    # 3 Frontend Live-Wire Tools
    "navigate": ToolCategory.REQUIRES_FRONTEND,
    "set_view_mode": ToolCategory.REQUIRES_FRONTEND,
    "highlight_element": ToolCategory.REQUIRES_FRONTEND,
}


def get_category(tool_name: str) -> ToolCategory:
    """Retrieve security category for a given tool."""
    if tool_name not in TOOL_CATEGORIES:
        raise ValueError(f"Unknown tool: {tool_name}")
    return TOOL_CATEGORIES[tool_name]


def is_mutable(tool_name: str) -> bool:
    """Return True if tool mutates state or requires confirmation/frontend interaction."""
    category = get_category(tool_name)
    return category in (ToolCategory.MUTATING, ToolCategory.REQUIRES_FRONTEND)
