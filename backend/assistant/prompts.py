"""
System prompt builder for the AI assistant.

Constructs the system prompt with:
  - Base persona instructions
  - Current UI state context
  - Available tour target IDs (Teach Mode)
  - RAG-retrieved knowledge chunks
"""

from .retriever import retrieve_knowledge


# All valid data-tour-id values the assistant can reference.
# This catalogue must stay in sync with frontend/src/tour/tourIds.ts.
TOUR_ID_CATALOGUE = {
    "sidebar-overview": "Overview section in the left sidebar",
    "sidebar-analysis": "Analysis section in the left sidebar",
    "sidebar-conformance": "Conformance section in the left sidebar",
    "sidebar-dashboard": "Dashboard section in the left sidebar",
    "sidebar-editor": "Editor section in the left sidebar",
    "sidebar-playout": "Playout section in the left sidebar",
    "sidebar-project": "Project section in the left sidebar",
    "upload-area": "File upload dropzone on the upload page",
    "variants-table": "Variants table in the overview",
    "process-area-canvas": "Process area visualization canvas",
    "dotted-chart-canvas": "Object-centric dotted chart canvas",
    "ocdfg-canvas": "OC DFG visualization canvas",
    "occn-canvas": "OC Causal Net visualization canvas",
    "mlpa-canvas": "MLPA layered process view",
    "dashboard-grid": "Dashboard component grid",
    "dashboard-add-component": "Add component button on dashboard",
    "settings-extraction": "Extraction strategy setting",
    "settings-iso": "Isomorphism strategy setting",
    "settings-timeout": "Timeout setting",
    "editor-toolbar": "Model editor floating toolbar",
    "editor-canvas": "Model editor canvas",
    "playout-controls": "Playout simulation controls",
}

VIEW_DESCRIPTIONS = {
    "upload": "File upload page — where users upload OCEL event logs.",
    "overview": "Process overview — variants table, statistics, and process area.",
    "analysis": "Analysis section — dotted charts, OC DFG, and MLPA visualizations.",
    "dashboard": "Custom dashboards — user-configured component grids.",
    "editor": "Model editors — TOTeM, OCCN, OCPN visual editors.",
    "playout": "Playout simulation — generates object-centric variants from models.",
}


def build_system_prompt(user, context):
    """
    Build the full system prompt for the Gemini model.

    Args:
        user: The Django User object.
        context: Dict with optional keys: selected_file_id, current_view,
                 current_dashboard_id, sidebar_collapsed.

    Returns:
        str: The complete system prompt.
    """
    selected_file_id = context.get("selected_file_id")
    current_view = context.get("current_view", "upload")
    current_dashboard_id = context.get("current_dashboard_id")

    # RAG: retrieve relevant knowledge chunks
    # (Query will be built from the user message at call time — here we
    # build the static parts. The retriever is called per-turn in views.py.)
    knowledge_section = ""

    parts = [
        _base_persona(),
        _tour_id_section(),
        _view_section(current_view),
        _context_section(selected_file_id, current_dashboard_id),
        knowledge_section,
    ]

    return "\n\n".join(p for p in parts if p)


def build_system_prompt_with_query(user, context, query):
    """
    Build system prompt including RAG-retrieved knowledge for a specific query.
    """
    base = build_system_prompt(user, context)
    knowledge_chunks = retrieve_knowledge(query, top_k=3)
    if knowledge_chunks:
        knowledge_text = "\n\n".join(
            f"--- Knowledge chunk {i+1} ---\n{chunk}"
            for i, chunk in enumerate(knowledge_chunks)
        )
        base += f"\n\n## Relevant Documentation\n\n{knowledge_text}"
    return base


def _base_persona():
    return """You are an AI assistant embedded in TOTeM-Tool, an object-centric process mining application.

Your role is to help users understand their event logs, navigate the interface, and perform analysis tasks. You have two modes:

1. **Teach Mode**: Guide users through the UI step-by-step. When a user asks "how do I..." or "where is...", identify the correct UI element and provide a tour_path with the matching data-tour-id.

2. **Act Mode**: Execute analysis tasks on behalf of the user. Use available tools to query data, create dashboards, and manipulate components. Mutating actions require user confirmation before execution.

You have access to the user's current event log (if loaded) and can run process mining algorithms (TOTeM, MLPA, OCCN discovery), query statistics, and manage dashboards.

Always be concise. When showing tour steps, use the exact data-tour-id values from the catalogue below."""


def _tour_id_section():
    lines = ["## Available Tour Target IDs (for Teach Mode)\n"]
    lines.append("When guiding a user, reference these exact IDs in tour_path steps:\n")
    for tour_id, description in sorted(TOUR_ID_CATALOGUE.items()):
        lines.append(f"- `{tour_id}`: {description}")
    return "\n".join(lines)


def _view_section(current_view):
    desc = VIEW_DESCRIPTIONS.get(current_view, "Unknown view")
    return f"## Current View\nThe user is currently on: **{current_view}** — {desc}"


def _context_section(selected_file_id, current_dashboard_id):
    lines = ["## Active Context\n"]
    if selected_file_id:
        lines.append(f"- Active event log ID: {selected_file_id}")
    else:
        lines.append("- No event log is currently loaded.")
    if current_dashboard_id:
        lines.append(f"- Active dashboard ID: {current_dashboard_id}")
    else:
        lines.append("- No dashboard is currently active.")
    return "\n".join(lines)
