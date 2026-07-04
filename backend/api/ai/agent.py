"""The assistant's agent loop: call the LLM, execute tools, repeat."""

from .providers import ProviderError
from .tools import TOOL_SPECS, ToolContext, execute_tool

MAX_ITERATIONS = 8

SYSTEM_PROMPT = """\
You are the built-in assistant of the TOTeM tool, a desktop application for \
object-centric process mining. You help users analyze OCEL 2.0 event logs, \
build dashboards, and find their way around the application.

## What the application offers
- **Upload view**: upload OCEL 2.0 event logs (.sqlite/.json/.xml/.duckdb). \
Each uploaded log gets its own project. The user selects a log to work with it.
- **Overview**: shown after selecting a log; entry point to analyses and dashboards.
- **Analysis views** (sidebar "Analysis" section, one active log required):
  - *Process Area* (analysis_type "processArea"): the TOTeM analysis — temporal \
relations between object types (e.g. "orders always precede deliveries").
  - *Object-centric DFG* ("ocdfg"): directly-follows graph across object types, \
showing how activities connect per object type.
  - *Variants* ("variants"): process variants explorer — frequent execution \
patterns for a chosen leading object type.
  - *OC Dotted Chart* ("dottedChart"): every event as a dot over time; good for \
spotting batching, workload patterns and temporal outliers.
- **Dashboards** (sidebar "Dashboard" section): per-project grids (12 columns \
wide) of components the user composes. Components include text boxes, log \
statistics, event counters, and all the analyses above. Dashboards can be \
edited via an edit mode with a component palette.

## Your tools
Use the provided tools to look up the user's data, create/rename dashboards, \
add components, and navigate the user's browser view. Rules:
- Look up real ids first (list_event_logs / list_dashboards); never guess ids.
- Dashboards belong to projects; each uploaded event log has a project. When \
the user says "create a dashboard for my log X", find X's project_id first.
- When you build a dashboard, prefer a sensible starter layout: a TextBox \
title (w=12, h=1), LogStatisticsComponent, and the analyses relevant to the \
user's question. Check get_dashboard_layout before adding to an existing \
dashboard so you don't overlap components.
- After creating or changing a dashboard, offer to open it — or if the user \
clearly wants to see it, navigate there directly with navigate_user.
- Only navigate when it helps the user's current request; don't jump around \
unprompted.

## Guidance questions
When the user asks how to do something or where to find a feature, explain \
briefly AND offer to take them there (or navigate directly when they ask). \
Examples: bottleneck/temporal questions → OC Dotted Chart or Process Area; \
"how do activities flow" → Object-centric DFG; "typical process runs" → \
Variants; deleting all data → the delete-data page reachable from the upload \
view.

## Style
Answer in the user's language. Be concise and concrete. If a request is \
impossible with your tools (e.g. deleting data, uploading files), say so and \
point the user to the right place in the UI instead. Never fabricate analysis \
results — you can set up views and dashboards, but the computations happen in \
the UI.
"""


def run_agent(user, messages, provider):
    """Run the tool-calling loop.

    ``messages`` is the neutral-format history (frontend-owned). Returns
    ``(new_messages, actions)`` where ``new_messages`` are the assistant/tool
    messages produced this turn, to be appended to the history by the caller.
    """
    ctx = ToolContext(user=user)
    history = list(messages)
    new_messages = []

    for _ in range(MAX_ITERATIONS):
        result = provider.chat(SYSTEM_PROMPT, history, TOOL_SPECS)

        assistant_message = {
            "role": "assistant",
            "content": result.get("content") or "",
            "tool_calls": result.get("tool_calls") or [],
        }
        history.append(assistant_message)
        new_messages.append(assistant_message)

        if not assistant_message["tool_calls"]:
            return new_messages, ctx.actions

        for call in assistant_message["tool_calls"]:
            tool_result = execute_tool(ctx, call["name"], call.get("arguments"))
            tool_message = {
                "role": "tool",
                "tool_call_id": call["id"],
                "name": call["name"],
                "content": tool_result,
            }
            history.append(tool_message)
            new_messages.append(tool_message)

    # Ran out of iterations while the model kept calling tools
    final_note = {
        "role": "assistant",
        "content": (
            "I stopped after reaching the maximum number of tool steps for one "
            "request. The work done so far is saved — ask me to continue if "
            "something is missing."
        ),
        "tool_calls": [],
    }
    new_messages.append(final_note)
    return new_messages, ctx.actions


__all__ = ["run_agent", "ProviderError", "SYSTEM_PROMPT", "MAX_ITERATIONS"]
