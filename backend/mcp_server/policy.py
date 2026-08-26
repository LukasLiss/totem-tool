"""
MCP Tool Security Classification and Policy Engine.
Classifies all 18 MCP tools into security categories, danger levels, and confirmation gates.
"""

from enum import Enum
from typing import Any, Dict


class ToolCategory(str, Enum):
    READ_ONLY = "read_only"
    MUTATING = "mutating"
    REQUIRES_FRONTEND = "requires_frontend"


class DangerLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


TOOL_POLICIES: Dict[str, Dict[str, Any]] = {
    # -------------------------------------------------------------------------
    # 10 Read-Only Tools (Autonomous Analytics & Retrieval)
    # -------------------------------------------------------------------------
    "get_statistics": {
        "category": ToolCategory.READ_ONLY,
        "danger_level": DangerLevel.LOW,
        "requires_confirmation": False,
        "description": "Calculates aggregate OCEL statistics.",
    },
    "get_object_types": {
        "category": ToolCategory.READ_ONLY,
        "danger_level": DangerLevel.LOW,
        "requires_confirmation": False,
        "description": "Lists distinct object types in the event log.",
    },
    "discover_totem": {
        "category": ToolCategory.READ_ONLY,
        "danger_level": DangerLevel.LOW,
        "requires_confirmation": False,
        "description": "Discovers a TOTeM temporal process model.",
    },
    "discover_occn": {
        "category": ToolCategory.READ_ONLY,
        "danger_level": DangerLevel.LOW,
        "requires_confirmation": False,
        "description": "Discovers an Object-Centric C-Net process model.",
    },
    "discover_mlpa": {
        "category": ToolCategory.READ_ONLY,
        "danger_level": DangerLevel.LOW,
        "requires_confirmation": False,
        "description": "Computes Multi-Level Process Architecture (MLPA).",
    },
    "find_variants": {
        "category": ToolCategory.READ_ONLY,
        "danger_level": DangerLevel.LOW,
        "requires_confirmation": False,
        "description": "Extracts and clusters trace execution variants.",
    },
    "get_oc_dotted_chart": {
        "category": ToolCategory.READ_ONLY,
        "danger_level": DangerLevel.LOW,
        "requires_confirmation": False,
        "description": "Retrieves sampled time-series dotted chart data.",
    },
    "get_layout": {
        "category": ToolCategory.READ_ONLY,
        "danger_level": DangerLevel.LOW,
        "requires_confirmation": False,
        "description": "Calculates graph visualization layout coordinates.",
    },
    "list_dashboards": {
        "category": ToolCategory.READ_ONLY,
        "danger_level": DangerLevel.LOW,
        "requires_confirmation": False,
        "description": "Lists user dashboards and component summaries.",
    },
    "list_assets": {
        "category": ToolCategory.READ_ONLY,
        "danger_level": DangerLevel.LOW,
        "requires_confirmation": False,
        "description": "Lists saved process models and playout assets.",
    },

    # -------------------------------------------------------------------------
    # 5 Mutating Tools (Guarded Operations Requiring User Approval)
    # -------------------------------------------------------------------------
    "create_dashboard": {
        "category": ToolCategory.MUTATING,
        "danger_level": DangerLevel.MEDIUM,
        "requires_confirmation": True,
        "description": "Creates a new dashboard in the project.",
    },
    "add_component": {
        "category": ToolCategory.MUTATING,
        "danger_level": DangerLevel.MEDIUM,
        "requires_confirmation": True,
        "description": "Adds a new component card to a dashboard.",
    },
    "remove_component": {
        "category": ToolCategory.MUTATING,
        "danger_level": DangerLevel.HIGH,
        "requires_confirmation": True,
        "description": "Deletes a component card from a dashboard.",
    },
    "update_component": {
        "category": ToolCategory.MUTATING,
        "danger_level": DangerLevel.MEDIUM,
        "requires_confirmation": True,
        "description": "Modifies geometry or properties of a component card.",
    },
    "rename_dashboard": {
        "category": ToolCategory.MUTATING,
        "danger_level": DangerLevel.MEDIUM,
        "requires_confirmation": True,
        "description": "Renames an existing dashboard.",
    },

    # -------------------------------------------------------------------------
    # 3 Frontend Live-Wire Tools (UI Dispatch via WebSockets/SSE)
    # -------------------------------------------------------------------------
    "navigate": {
        "category": ToolCategory.REQUIRES_FRONTEND,
        "danger_level": DangerLevel.LOW,
        "requires_confirmation": False,
        "description": "Dispatches client-side navigation to a target route.",
    },
    "set_view_mode": {
        "category": ToolCategory.REQUIRES_FRONTEND,
        "danger_level": DangerLevel.LOW,
        "requires_confirmation": False,
        "description": "Switches the active visualization mode in the UI.",
    },
    "highlight_element": {
        "category": ToolCategory.REQUIRES_FRONTEND,
        "danger_level": DangerLevel.LOW,
        "requires_confirmation": False,
        "description": "Triggers Teach Mode spotlight on a DOM element.",
    },
}

TOOL_CATEGORIES: Dict[str, ToolCategory] = {
    name: policy["category"] for name, policy in TOOL_POLICIES.items()
}


def get_category(tool_name: str) -> ToolCategory:
    """Retrieve security category for a given tool."""
    if not isinstance(tool_name, str) or tool_name not in TOOL_CATEGORIES:
        raise ValueError(f"Unknown tool: {tool_name}")
    return TOOL_CATEGORIES[tool_name]


def get_danger_level(tool_name: str) -> DangerLevel:
    """Retrieve danger level (LOW, MEDIUM, HIGH) for a given tool."""
    if not isinstance(tool_name, str) or tool_name not in TOOL_POLICIES:
        raise ValueError(f"Unknown tool: {tool_name}")
    return TOOL_POLICIES[tool_name]["danger_level"]


def requires_confirmation(tool_name: str) -> bool:
    """Return True if tool requires explicit user confirmation before execution."""
    if not isinstance(tool_name, str) or tool_name not in TOOL_POLICIES:
        raise ValueError(f"Unknown tool: {tool_name}")
    return TOOL_POLICIES[tool_name]["requires_confirmation"]


def is_mutable(tool_name: str) -> bool:
    """Return True if tool mutates state or requires confirmation/frontend interaction."""
    category = get_category(tool_name)
    return category in (ToolCategory.MUTATING, ToolCategory.REQUIRES_FRONTEND)
