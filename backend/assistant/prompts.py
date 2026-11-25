"""
System prompt and per-turn context for the TOTeM assistant.

The system prompt depends only on the chat mode, so it stays byte-identical for
the whole conversation: that keeps provider prompt caches warm and keeps
replayed reasoning blocks valid. Everything that changes between turns (the
selected log, the open view) travels in the user turn via ``render_ui_context``.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any, Dict, Optional

# data-tour-id values that are rendered in the UI (frontend/src/tour/tourIds.ts).
TOUR_TARGETS: Dict[str, str] = {
    "nav-overview": "Sidebar: Overview (log statistics)",
    "nav-analysis": "Sidebar: Analysis (process maps, variants, dotted chart, OCCN, process areas)",
    "nav-conformance": "Sidebar: Conformance checking",
    "nav-playout": "Sidebar: Playout / simulation",
    "nav-dashboard": "Sidebar: Dashboards menu",
    "nav-project": "Sidebar: Project section",
    "project-switcher": "Top-left switcher for project and event log",
    "file-selector": "Event-log file selector",
    "upload-button": "Upload button on the Upload page; on any other page this spotlights the project switcher, whose 'Add project' entry starts an upload",
    "dashboard-add-btn": "Dashboards menu: Add Dashboard",
    "dashboard-name-input": "New dashboard dialog: name field",
    "dashboard-save-btn": "New dashboard dialog: save button",
    "dashboard-add-card": "Dashboard: edit button that opens the component catalog",
    "dashboard-grid": "Dashboard: the component grid",
    "chat-toggle": "Button that opens this assistant",
    "chat-input": "Assistant message box",
    "chat-mode-teach": "Assistant: Teach mode switch",
    "chat-mode-act": "Assistant: Act mode switch",
}

_KNOWLEDGE_PATH = os.path.join(os.path.dirname(__file__), "knowledge", "help.md")


@lru_cache(maxsize=1)
def _knowledge() -> str:
    try:
        with open(_KNOWLEDGE_PATH, encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


_BASE = """You are the assistant built into TOTeM, an object-centric process mining (OCPM) tool. You help analysts understand their event logs and use the tool.

# How to work
- Ground every statement about the user's data in tool results from this conversation. Never invent numbers, activity names or object types; if you have not looked something up, look it up or say you haven't.
- Plan briefly, then call tools. Independent lookups can be issued together in one step. Prefer the specific tools (get_log_overview, get_activity_stats, get_directly_follows, find_variants, discover_*) and use query_event_log for anything they don't cover. Check column names with get_log_overview before writing SQL.
- If a tool returns an error, read the message and hint, fix the call and retry, or explain what blocked you. Do not repeat an identical failing call.
- The user's UI context (selected event log, open view) is given at the start of each of their messages. "This log" means the selected log; if none is selected, call list_event_logs and ask or choose sensibly.
- Refer to event logs by file name (and project), not only by numeric id.
- Timestamps in the logs are UTC.

# Answering
- Lead with the answer. Use short paragraphs, bullet lists and markdown tables for numbers. No filler, no restating the question.
- Anything you write before or between tool calls is already on the user's screen. Keep it to a short line at most, and never repeat it in the final answer.
- The chat renders plain markdown only: no LaTeX or math syntax ($...$, \\rightarrow, \\times). Write arrows as → and dimensions as 12×2.
- When an answer rests on an assumption (for example which object type defines a case), state it in one line.
- Explain process-mining concepts precisely when asked; connect them to the user's log when that helps.
"""

_ACT = """
# Mode: Act
You can analyse data and change the workspace.
- Data changes (create_dashboard, add_component, update_component, remove_component, rename_dashboard, delete_dashboard) are only proposals: the user sees an approval card and the change happens only if they approve. After proposing, say what you proposed and that it awaits their approval. Never claim a proposed change is done. Outcomes of earlier proposals are reported to you at the start of the user's next message.
- Before updating or removing components, call get_dashboard to get the right component ids.
- A good default overview dashboard: LogStatisticsComponent (x0 y0 w12 h2), NewOCDFGComponent (x0 y2 w6 h7), VariantsComponent (x6 y2 w6 h7), OCDottedChartComponent (x0 y9 w12 h6).
- open_view switches the user's screen immediately; use it when the user asks to see or open something, not as a side effect of answering a question.
"""

_TEACH = """
# Mode: Teach
You are a tutor. Explain concepts and show the user how to do things themselves; you cannot change the workspace in this mode.
- For "how do I / where is" questions about the UI, call start_tour with the steps in order, each with a short imperative label, and add a one-paragraph explanation in your reply. Only use tour_id values from the catalog below.
- For conceptual questions, explain in text (no tour), using the user's log as an example when it helps.
- If the user asks you to make a change, explain how they can do it (a tour helps) and mention that Act mode can do it for them with their approval.
"""


def build_system_prompt(mode: str) -> str:
    mode = "act" if mode == "act" else "teach"
    parts = [_BASE, _ACT if mode == "act" else _TEACH]
    parts.append("# UI elements for start_tour (tour_id: what it is)\n" + "\n".join(f"- {k}: {v}" for k, v in TOUR_TARGETS.items()))
    knowledge = _knowledge()
    if knowledge:
        parts.append("# Product reference\n" + knowledge)
    return "\n".join(p.strip() + "\n" for p in parts).strip()


def resolve_ui_context(user: Any, raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Normalize the context the frontend sends; only ids the user can access are kept."""
    raw = raw if isinstance(raw, dict) else {}

    def as_int(value):
        try:
            return int(value) if value is not None and value != "" else None
        except (TypeError, ValueError):
            return None

    ctx: Dict[str, Any] = {
        "active_file_id": as_int(raw.get("active_file_id") or raw.get("selected_file_id")),
        "project_id": as_int(raw.get("project_id")),
        "dashboard_id": as_int(raw.get("current_dashboard_id")),
        "view": str(raw.get("view_mode") or raw.get("current_view") or "")[:80],
        "pathname": str(raw.get("pathname") or "")[:200],
        "file_name": None,
        "project_name": None,
    }
    if ctx["active_file_id"] is not None and user is not None and getattr(user, "is_authenticated", False):
        from api.models import EventLog

        log = EventLog.objects.select_related("project").filter(id=ctx["active_file_id"], project__users=user).first()
        if log is None:
            ctx["active_file_id"] = None
        else:
            ctx["file_name"] = os.path.basename(log.file.name) if log.file else None
            ctx["project_name"] = log.project.name if log.project_id else None
            ctx["project_id"] = ctx["project_id"] or log.project_id
    return ctx


def render_ui_context(ctx: Dict[str, Any]) -> str:
    if ctx.get("active_file_id") is not None:
        log = f"{ctx.get('file_name') or 'unnamed'} (file_id {ctx['active_file_id']}, project {ctx.get('project_name') or ctx.get('project_id')})"
    else:
        log = "none selected"
    lines = [f"Selected event log: {log}", f"Current view: {ctx.get('view') or 'unknown'}"]
    if ctx.get("dashboard_id") is not None:
        lines.append(f"Open dashboard id: {ctx['dashboard_id']}")
    return "<ui_context>\n" + "\n".join(lines) + "\n</ui_context>"
