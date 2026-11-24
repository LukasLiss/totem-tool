"""
Security classification of assistant tools, derived from the tool catalog.

``server.TOOLS`` is the single source of truth: a tool's ``kind`` decides
whether it runs autonomously (read), needs explicit user approval (propose),
or is executed by the browser (client).
"""

from enum import Enum

from .server import TOOLS_BY_NAME, ToolKind


class ToolCategory(str, Enum):
    READ_ONLY = "read_only"
    MUTATING = "mutating"
    REQUIRES_FRONTEND = "requires_frontend"


_KIND_TO_CATEGORY = {
    ToolKind.READ: ToolCategory.READ_ONLY,
    ToolKind.PROPOSE: ToolCategory.MUTATING,
    ToolKind.CLIENT: ToolCategory.REQUIRES_FRONTEND,
}


def get_category(tool_name: str) -> ToolCategory:
    tool = TOOLS_BY_NAME.get(tool_name) if isinstance(tool_name, str) else None
    if tool is None:
        raise ValueError(f"Unknown tool: {tool_name}")
    return _KIND_TO_CATEGORY[tool.kind]


def requires_confirmation(tool_name: str) -> bool:
    return get_category(tool_name) == ToolCategory.MUTATING
