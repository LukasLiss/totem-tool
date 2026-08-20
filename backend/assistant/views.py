import json
import uuid

from django.http import StreamingHttpResponse
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
    the LLM response back as Server-Sent Events when the client requests
    ``Accept: text/event-stream``.

    Agentic loop (per turn):
      1. Build system prompt with current context + knowledge RAG.
      2. Send user message to Gemini with tool definitions.
      3. If LLM returns tool calls:
         - Execute read-only tools immediately, append results, re-prompt.
         - Surface mutating/frontend tools as pending_actions to the client.
      4. Stream text tokens to the client as they arrive.
      5. End with a ``done`` frame.
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

        accept = request.META.get("HTTP_ACCEPT", "")
        if "text/event-stream" in accept:
            return self._run_streaming(user, message, context)

        return self._run_non_streaming(user, message, context)

    # ------------------------------------------------------------------
    # SSE streaming path
    # ------------------------------------------------------------------

    def _run_streaming(self, user, message, context):
        """Run the agentic loop and yield SSE frames."""
        system_prompt = build_system_prompt(user, context)
        tool_specs = get_tool_specs()

        def event_stream():
            text_chunks = []
            tool_calls = []
            pending_actions = []

            for event in stream_chat(
                system_prompt=system_prompt,
                user_message=message,
                tools=tool_specs,
            ):
                if event["type"] == "text":
                    text_chunks.append(event["content"])
                    yield _sse_frame(event)

                elif event["type"] == "tool_call":
                    tool_calls.append(event)
                    category = get_category(event["name"])
                    if category == ToolCategory.READ_ONLY:
                        try:
                            result = call_tool(
                                event["name"], event["arguments"],
                                user=user, context=context,
                            )
                            yield _sse_frame({
                                "type": "tool_result",
                                "id": event["id"],
                                "name": event["name"],
                                "result": result,
                            })
                        except Exception as exc:
                            yield _sse_frame({
                                "type": "tool_result",
                                "id": event["id"],
                                "name": event["name"],
                                "result": {"error": str(exc)},
                            })
                    else:
                        pa = {
                            "id": str(uuid.uuid4()),
                            "name": event["name"],
                            "description": _describe_action(event["name"], event["arguments"]),
                            "arguments": event["arguments"],
                        }
                        pending_actions.append(pa)
                        yield _sse_frame({
                            "type": "pending_action",
                            **pa,
                        })

                elif event["type"] in ("done", "error"):
                    yield _sse_frame(event)
                    return

            # Stream finished — if the LLM asked for read-only tool results
            # and we executed them inline, re-prompt for a final answer.
            if tool_calls:
                read_only_results = [
                    tc for tc in tool_calls
                    if get_category(tc["name"]) == ToolCategory.READ_ONLY
                ]
                if read_only_results:
                    tool_result_msg = "\n\n".join(
                        f"[Tool result: {tc['name']}]"
                        for tc in read_only_results
                    )
                    followup_text = []
                    for evt in stream_chat(
                        system_prompt=system_prompt,
                        user_message=f"{message}\n\n{tool_result_msg}",
                        tools=[],
                    ):
                        if evt["type"] == "text":
                            followup_text.append(evt["content"])
                            yield _sse_frame(evt)
                        elif evt["type"] in ("done", "error"):
                            break

            yield _sse_frame({"type": "done", "usage": {}})

        response = StreamingHttpResponse(
            event_stream(),
            content_type="text/event-stream",
        )
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response

    # ------------------------------------------------------------------
    # Non-streaming JSON path
    # ------------------------------------------------------------------

    def _run_non_streaming(self, user, message, context):
        """Run the agentic loop without streaming. Returns JSON."""
        from .llm import complete

        system_prompt = build_system_prompt(user, context)
        tool_specs = get_tool_specs()

        response = complete(
            system_prompt=system_prompt,
            user_message=message,
            tools=tool_specs,
        )

        text = response.get("text", "")
        tool_calls = response.get("tool_calls", [])
        pending_actions = []

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


def _sse_frame(event: dict) -> bytes:
    """Format a dict as an SSE ``data:`` frame with double-newline terminator."""
    payload = json.dumps(event, default=str)
    return f"data: {payload}\n\n".encode("utf-8")


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
