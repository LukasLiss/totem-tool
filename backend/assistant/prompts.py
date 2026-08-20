"""
Dynamic system prompt builder incorporating UI context, mode directives,
tour element catalog, and knowledge RAG chunks.
"""

from typing import Any, Dict, List, Optional
from .retriever import retrieve_knowledge

# Synchronized catalog of data-tour-id element identifiers matching frontend/src/tour/tourIds.ts
TOUR_IDS: Dict[str, str] = {
    "NAV_OVERVIEW": "nav-overview",
    "NAV_ANALYSIS": "nav-analysis",
    "NAV_CONFORMANCE": "nav-conformance",
    "NAV_PLAYOUT": "nav-playout",
    "NAV_DASHBOARD": "nav-dashboard",
    "NAV_PROJECT": "nav-project",
    "UPLOAD_BUTTON": "upload-button",
    "CHAT_TOGGLE": "chat-toggle",
    "CHAT_DRAWER": "chat-drawer",
    "CHAT_INPUT": "chat-input",
    "CHAT_MODE_TEACH": "chat-mode-teach",
    "CHAT_MODE_ACT": "chat-mode-act",
    "DASHBOARD_GRID": "dashboard-grid",
    "DASHBOARD_ADD_CARD": "dashboard-add-card",
    "FILE_SELECTOR": "file-selector",
    "PROJECT_SWITCHER": "project-switcher",
    "VIEW_MODE_SELECTOR": "view-mode-selector",
}

VALID_TOUR_IDS: List[str] = list(TOUR_IDS.values())


def normalize_context(context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Normalize context aliases from various frontend calling patterns."""
    if not isinstance(context, dict):
        context = {}

    active_file_id = (
        context.get("active_file_id")
        or context.get("selected_file_id")
        or context.get("file_id")
    )
    view_mode = (
        context.get("view_mode")
        or context.get("current_view")
        or "overview"
    )
    pathname = (
        context.get("pathname")
        or f"/{view_mode}"
    )

    return {
        "active_file_id": active_file_id,
        "view_mode": str(view_mode),
        "pathname": str(pathname),
        "session_id": str(context.get("session_id", "")),
        "current_dashboard_id": context.get("current_dashboard_id"),
        "mode": str(context.get("mode", "teach")),
    }


def build_system_prompt(
    user: Any,
    context: Optional[Dict[str, Any]] = None,
    mode: Optional[str] = None,
    query: str = "",
) -> str:
    """
    Construct dynamic system prompt with persona, UI context, mode directives,
    valid tour identifiers, and RAG knowledge snippets.
    """
    ctx = normalize_context(context)
    active_mode = str(mode or ctx.get("mode") or "teach").lower()
    username = getattr(user, "username", "anonymous") or "anonymous"

    # Base persona and active environment
    prompt_lines = [
        "You are the TOTeM Process Mining Assistant, an expert in Object-Centric Process Mining (OCPM).",
        f"User: {username}",
        f"Active View: {ctx['view_mode']}",
        f"Active File ID: {ctx['active_file_id'] if ctx['active_file_id'] is not None else 'None'}",
        f"Current Path: {ctx['pathname']}",
    ]

    if ctx.get("current_dashboard_id") is not None:
        prompt_lines.append(f"Active Dashboard ID: {ctx['current_dashboard_id']}")

    prompt_lines.append("")

    # Mode-specific instructions
    if active_mode == "teach":
        prompt_lines.extend([
            "### TEACH MODE ACTIVE",
            "Your role is an interactive coach and instructor:",
            "1. Explain Object-Centric Process Mining (OCPM) concepts, algorithms, and TOTEM features clearly.",
            "2. Provide step-by-step walkthroughs to guide the user on how to accomplish their goals.",
            "3. When guiding the user to UI features, refer to elements by their valid `data-tour-id`.",
            "4. You can invoke the `highlight_element` tool to spotlight UI elements with helpful callout tooltips.",
            "5. Do NOT perform unrequested mutating operations in Teach Mode.",
            "",
        ])
    else:  # Act Mode
        prompt_lines.extend([
            "### ACT MODE ACTIVE",
            "Your role is an autonomous process mining and dashboard co-pilot:",
            "1. Autonomously execute read-only analysis tools (`get_statistics`, `find_variants`, `discover_totem`, `discover_occn`, `discover_mlpa`, `get_oc_dotted_chart`, `list_dashboards`, `list_assets`) to retrieve real data and answer analytical questions.",
            "2. For mutating actions (`create_dashboard`, `add_component`, `remove_component`, `update_component`, `rename_dashboard`) or navigation, call the corresponding tool. The system will prompt the user with an interactive confirmation chip before execution.",
            "3. Always interpret analysis results accurately and summarize key takeaways for the user.",
            "",
        ])

    # Valid Tour IDs Catalog
    prompt_lines.extend([
        "### VALID TOUR IDENTIFIERS (data-tour-id)",
        "When referencing UI elements or calling `highlight_element`, use ONLY these tour IDs:",
    ])
    for key, tour_id in TOUR_IDS.items():
        prompt_lines.append(f"- `{tour_id}`")
    prompt_lines.append("")

    # Knowledge RAG Context Injection
    search_query = query or ""
    if search_query:
        knowledge_chunks = retrieve_knowledge(search_query, top_k=3)
        if knowledge_chunks:
            prompt_lines.extend([
                "### RELEVANT TOTEM DOCUMENTATION",
                "Use the following authoritative documentation to answer questions accurately:",
                "",
            ])
            for chunk in knowledge_chunks:
                prompt_lines.append(chunk)
                prompt_lines.append("\n---\n")

    return "\n".join(prompt_lines).strip()
