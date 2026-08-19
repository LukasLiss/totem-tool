import json
import uuid

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from rest_framework.parsers import JSONParser

from .llm import stream_chat
from .prompts import build_system_prompt
from mcp_server.server import call_tool, get_tool_specs
from mcp_server.policy import ToolCategory, get_category


class ChatView(APIView):
    """
    POST /api/assistant/chat/

    Accepts a user message + UI context, runs the agentic loop, and streams
    the LLM response back as Server-Sent Events.

    Agentic loop (per turn):
      1. Build system prompt with current context + knowledge RAG.
      2. Send user message to Gemini with tool definitions.
      3. If LLM returns tool calls:
         - Execute read-only tools immediately, append results, re-prompt.
         - Surface mutating/frontend tools as pending_actions to the client.
      4. Stream text tokens to the client as they arrive.
      5. End with a `done` frame.
    """

    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def post(self, request):
        message = request.data.get("message")
        if not message or not isinstance(message, str):
            return Response(
                {"error": "\"message\" is required and must be a string."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        context = request.data.get("context", {})
        user = request.user

        # For non-streaming clients (Accept: application/json), run the
        # full agentic loop and return a single JSON response.
        accept = request.META.get("HTTP_ACCEPT", "")
        if "text/event-stream" not in accept:
            return self._run_non_streaming(user, message, context)

        # Streaming response — SSE via GeneratorResponse would go here.
        # For the architecture spike, we return the non-streaming path.
        # Full streaming implementation comes in Task 2.
        return self._run_non_streaming(user, message, context)

    def _run_non_streaming(self, user, message, context):
        """Run the agentic loop without streaming. Returns JSON."""
        system_prompt = build_system_prompt(user, context)
        tool_specs = get_tool_specs()

        # Single-turn: send to LLM, collect tool calls, execute read-only
        # tools, and return the final text + pending actions.
        from .llm import complete

        response = complete(
            system_prompt=system_prompt,
            user_message=message,
            tools=tool_specs,
        )

        text = response.get("text", "")
        tool_calls = response.get("tool_calls", [])
        pending_actions = []

        # Execute read-only tool calls inline
        results = []
        for tc in tool_calls:
            category = get_category(tc["name"])
            if category == ToolCategory.READ_ONLY:
                result = call_tool(tc["name"], tc["arguments"], user=user, context=context)
                results.append({
                    "id": tc["id"],
                    "name": tc["name"],
                    "result": result,
                })
            else:
                pending_actions.append({
                    "id": str(uuid.uuid4()),
                    "name": tc["name"],
                    "description": _describe_action(tc["name"], tc["arguments"]),
                    "arguments": tc["arguments"],
                })

        # If we executed read-only tools, re-prompt with results for a
        # more informed answer. (Single iteration for non-streaming.)
        if results:
            tool_result_msg = "\n\n".join(
                f"[Tool result: {r['name']}]\n{json.dumps(r['result'], default=str)}"
                for r in results
            )
            followup = complete(
                system_prompt=system_prompt,
                user_message=f"{message}\n\n{tool_result_msg}",
                tools=[],
            )
            text = followup.get("text", text)

        return Response({
            "text": text,
            "tool_calls": results,
            "pending_actions": pending_actions,
            "tour_path": None,
        }, status=status.HTTP_200_OK)


def _describe_action(name, arguments):
    """Generate a human-readable description for a pending action."""
    descriptions = {
        "create_dashboard": f"Create a new dashboard named \"{arguments.get('name', 'Untitled')}\"",
        "add_component": f"Add {arguments.get('component_name', 'component')} to dashboard",
        "remove_component": f"Remove component from dashboard",
        "update_component": f"Update component settings",
        "rename_dashboard": f"Rename dashboard to \"{arguments.get('name', '')}\"",
        "navigate": f"Navigate to {arguments.get('route', '/')}",
        "set_view_mode": f"Switch to {arguments.get('mode', '')} view",
        "highlight_element": f"Highlight element: {arguments.get('tour_id', '')}",
    }
    return descriptions.get(name, f"Execute {name}")


from rest_framework.decorators import api_view


@api_view(["POST"])
def confirm_action(request):
    """
    POST /api/assistant/confirm/

    Execute or cancel a pending action after user confirmation.
    """
    pending_action_id = request.data.get("pending_action_id")
    approved = request.data.get("approved", False)

    if not pending_action_id:
        return Response(
            {"error": "\"pending_action_id\" is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not approved:
        return Response({"status": "cancelled"}, status=status.HTTP_200_OK)

    # In the full implementation, the pending action payload is stored
    # server-side (or replayed). For now, return a placeholder.
    return Response(
        {"status": "executed", "result": {}},
        status=status.HTTP_200_OK,
    )
