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
    "DASHBOARD_ADD_BTN": "dashboard-add-btn",
    "DASHBOARD_NAME_INPUT": "dashboard-name-input",
    "DASHBOARD_SAVE_BTN": "dashboard-save-btn",
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
            "Your role is an intelligent, versatile interactive coach and instructor:",
            "1. CONCEPTUAL & EXPLANATORY QUESTIONS (TEXT-BASED TEACHING):",
            "   - When the user asks conceptual, theoretical, or explanatory questions (e.g. 'What is...', 'What does TOTeM conformance mean?', 'Explain conformance checking', 'How does the MLPA algorithm work?', 'Why do object types diverge?'):",
            "   - DO NOT invoke `highlight_element` or launch a tour wizard.",
            "   - Provide a thorough, educational, and well-structured markdown explanation directly in the chat with definitions, context, examples, and practical interpretations.",
            "2. PROCEDURAL, NAVIGATIONAL & 'HOW-TO' QUESTIONS (INTERACTIVE TOUR WIZARD):",
            "   - When the user asks how to perform an action in the UI, where to find a feature, or requests a walkthrough (e.g. 'Where do I select event logs?', 'How do I create a dashboard in the UI?', 'Create new dashboard', 'Guide me through dashboard creation', 'Show me where to run conformance', 'Walk me through discovering a model', 'Guide me...'):",
            "   - Invoke the `highlight_element` tool with a multi-step sequence `steps: [{\"tour_id\": \"...\", \"label\": \"...\"}, ...]`: ",
            "   - FOR DASHBOARD CREATION IN TEACH MODE ('Create new dashboard', 'Guide me through dashboard creation', 'How do I create a dashboard'):",
            "       You MUST invoke `highlight_element` with this exact sequence of steps:",
            "       1. `nav-dashboard`: 'Click Dashboards in the sidebar to open the dashboard dropdown menu'",
            "       2. `dashboard-add-btn`: 'Click Add Dashboard in the dropdown to open the creation dialog'",
            "       3. `dashboard-name-input`: 'Enter a name for your new dashboard in the dialog'",
            "       4. `dashboard-save-btn`: 'Click Save changes to create the dashboard and open it'",
            "       5. `dashboard-add-card`: 'Click the plus (+) button in the top right to open the component catalog'",
            "       6. `dashboard-grid`: 'Drag and drop process mining components from the side panel onto the grid to add components as you wish'",
            "3. For selecting or switching event logs/projects: Guide the user to `project-switcher` (in top-left sidebar) followed by `nav-overview`.",
            "4. Do NOT perform mutating operations in Teach Mode; always guide the user through the interactive tour.",
            "",
        ])
    else:  # Act Mode
        prompt_lines.extend([
            "### ACT MODE ACTIVE",
            "Your role is an autonomous process mining and dashboard co-pilot:",
            "1. DIRECT ACTION FOR DASHBOARDS & MUTATING TASKS: When the user asks to CREATE, BUILD, CONFIGURE, ADD, or DELETE a dashboard or component (e.g. 'Create a summary dashboard...', 'Create a process overview dashboard...', 'Add a throughput card...'), YOU MUST DIRECTLY CALL the corresponding mutating tool (`create_dashboard`, `add_component`, `remove_component`, `delete_dashboard`, `rename_dashboard`). NEVER just write text instructions explaining how to do it in the UI. In Act Mode, you must invoke the tool so the platform can create it for the user!",
            "2. When calling `create_dashboard`, specify a meaningful `name` (e.g. 'Process Overview Dashboard') and include an initial `layout` array with 5 essential process mining components:",
            "   - `LogStatisticsComponent`: KPI Header Banner (x: 0, y: 0, w: 12, h: 2)",
            "   - `VariantsComponent`: Process Execution Paths (x: 0, y: 2, w: 6, h: 6)",
            "   - `OCDottedChartComponent`: Time-Series Throughput & Latency (x: 6, y: 2, w: 6, h: 6)",
            "   - `NewOCDFGComponent`: Object-Centric Directed Follows Graph (x: 0, y: 8, w: 6, h: 6)",
            "   - `OCCNComponent`: Object-Centric Causal Net (x: 6, y: 8, w: 6, h: 6)",
            "3. ANALYTICAL QUERIES: For analytical questions (e.g. 'Show me top 5 variants', 'Identify bottleneck activities', 'Calculate case durations'), autonomously execute the read-only analysis tools (`get_statistics`, `find_variants`, `get_oc_dotted_chart`, `discover_totem`, `discover_occn`, `discover_mlpa`, `list_dashboards`, `list_assets`) to extract live data.",
            "4. Always synthesize tool outputs into clear markdown summaries with key metrics and actionable process takeaways.",
            "",
        ])

    # Valid Tour IDs Catalog
    prompt_lines.extend([
        "### VALID TOUR IDENTIFIERS (data-tour-id)",
        "When referencing UI elements or calling `highlight_element`, use ONLY these tour IDs:",
        "NOTE ON EVENT LOGS: In TOTeM, each project is a database event log file. The active event log selector is `project-switcher` in the top-left sidebar. Use `project-switcher` whenever asking or guiding the user to select or switch event logs.",
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
