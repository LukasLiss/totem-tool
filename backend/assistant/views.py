"""
Assistant views and SSE streaming endpoint for AI Chat, Dual-Channel Teach/Act modes,
and Mutating Action confirmation.
"""

import json
import logging
import uuid
from typing import Any, Dict, List, Optional

from django.http import StreamingHttpResponse
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import BaseRenderer, BrowsableAPIRenderer, JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from django.conf import settings
from .action_registry import (
    cancel_action,
    get_action,
    register_action,
    update_action_status,
)
from .llm import complete, stream_chat, validate_provider_key
from .prompts import build_system_prompt, normalize_context
from mcp_server.policy import ToolCategory, get_category
from mcp_server.server import call_tool, get_tool_specs

logger = logging.getLogger(__name__)


def _is_read_only(tool_name: Optional[str]) -> bool:
    if not tool_name:
        return False
    try:
        return get_category(tool_name) == ToolCategory.READ_ONLY
    except ValueError:
        return False


class ServerSentEventRenderer(BaseRenderer):
    """Renderer to allow 'Accept: text/event-stream' without 406 Not Acceptable."""
    media_type = "text/event-stream"
    format = "txt"

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return data


class ChatView(APIView):
    """
    POST /api/assistant/chat/

    Accepts a user message + UI context, runs the agentic loop, and streams
    the LLM response back as Server-Sent Events when the client requests
    ``Accept: text/event-stream``.

    Agentic loop (per turn):
      1. Normalize context and build dynamic system prompt (with BM25 RAG & Tour IDs).
      2. Stream or complete via multi-provider LLM (Gemini / Anthropic / Mock).
      3. Dispatches tool calls:
         - Read-only tools: executed immediately and fed back for explanation.
         - Mutating tools: registered in ActionRegistry and surfaced as confirmation chips.
         - Teach mode highlights: emit tour_path events and pending actions.
      4. Terminates with done frame.
    """

    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]
    renderer_classes = [JSONRenderer, ServerSentEventRenderer, BrowsableAPIRenderer]

    def post(self, request):
        if not isinstance(request.data, dict):
            return Response(
                {"error": "Request body must be a JSON object."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        message = request.data.get("message")
        if not message or not isinstance(message, str):
            return Response(
                {"error": "\"message\" is required and must be a string."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if len(message) > 10000:
            return Response(
                {"error": "Message exceeds maximum length of 10,000 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_context = request.data.get("context", {})
        context = raw_context if isinstance(raw_context, dict) else {}
        mode = request.data.get("mode") or context.get("mode") or "teach"
        raw_history = request.data.get("history", [])
        history = raw_history if isinstance(raw_history, list) else []
        provider = request.data.get("provider") or request.META.get("HTTP_X_LLM_PROVIDER") or context.get("provider")
        api_key = request.data.get("api_key") or request.META.get("HTTP_X_LLM_KEY") or context.get("api_key")
        user = request.user

        accept = request.META.get("HTTP_ACCEPT", "")
        if "text/event-stream" in accept:
            return self._run_streaming(user, message, context, mode, history, provider, api_key)

        return self._run_non_streaming(user, message, context, mode, history, provider, api_key)

    # ------------------------------------------------------------------
    # SSE streaming path
    # ------------------------------------------------------------------

    def _run_streaming(
        self,
        user: Any,
        message: str,
        context: Dict[str, Any],
        mode: str,
        history: List[Dict[str, Any]],
        provider: Optional[str] = None,
        api_key: Optional[str] = None,
    ):
        """Run the agentic loop and yield SSE frames."""
        system_prompt = build_system_prompt(user, context=context, mode=mode, query=message)
        tool_specs = get_tool_specs()

        def event_stream():
            tool_calls = []
            total_text_emitted = False

            for event in stream_chat(
                system_prompt=system_prompt,
                user_message=message,
                tools=tool_specs,
                history=history,
                provider_name=provider,
                api_key=api_key,
            ):
                event_type = event.get("type")

                if event_type == "key_error":
                    yield _sse_frame(event)
                    return

                if event_type == "text":
                    total_text_emitted = True
                    yield _sse_frame(event)

                elif event_type == "tool_call":
                    tool_calls.append(event)
                    tool_name = event.get("name", "")
                    tool_args = event.get("arguments", {})

                    try:
                        category = get_category(tool_name)
                    except ValueError:
                        yield _sse_frame({
                            "type": "tool_result",
                            "id": event.get("id", ""),
                            "name": tool_name,
                            "result": {"error": f"Unknown tool: {tool_name}"},
                        })
                        continue

                    if category == ToolCategory.READ_ONLY:
                        try:
                            result = call_tool(
                                tool_name, tool_args,
                                user=user, context=context,
                            )
                            event["result"] = result
                            yield _sse_frame({
                                "type": "tool_result",
                                "id": event.get("id", ""),
                                "name": tool_name,
                                "result": result,
                            })
                        except Exception as exc:
                            event["result"] = {"error": str(exc)}
                            yield _sse_frame({
                                "type": "tool_result",
                                "id": event.get("id", ""),
                                "name": tool_name,
                                "result": {"error": str(exc)},
                            })

                    elif tool_name == "highlight_element":
                        # Extract steps (support single step or multi-step array)
                        raw_steps = tool_args.get("steps")
                        if isinstance(raw_steps, list) and raw_steps:
                            steps = [
                                {
                                    "tour_id": s.get("tour_id", ""),
                                    "title": s.get("title", "") or s.get("label", "") or "Guide Step",
                                    "label": s.get("label", "") or s.get("title", ""),
                                }
                                for s in raw_steps if isinstance(s, dict) and s.get("tour_id")
                            ]
                        else:
                            step = {
                                "tour_id": tool_args.get("tour_id", ""),
                                "title": tool_args.get("label", "") or "UI Highlight",
                                "label": tool_args.get("label", ""),
                            }
                            steps = [step] if step["tour_id"] else []

                        if steps:
                            yield _sse_frame({
                                "type": "tour_path",
                                "steps": steps,
                            })

                        # Register action
                        desc = _describe_action(tool_name, tool_args)
                        action_id = register_action(
                            user_id=getattr(user, "id", None),
                            tool_name=tool_name,
                            arguments=tool_args,
                            description=desc,
                            context=context,
                        )
                        yield _sse_frame({
                            "type": "pending_action",
                            "id": action_id,
                            "name": tool_name,
                            "description": desc,
                            "arguments": tool_args,
                        })

                    else:
                        # Mutating action requiring user approval chip
                        desc = _describe_action(tool_name, tool_args)
                        action_id = register_action(
                            user_id=getattr(user, "id", None),
                            tool_name=tool_name,
                            arguments=tool_args,
                            description=desc,
                            context=context,
                        )
                        yield _sse_frame({
                            "type": "pending_action",
                            "id": action_id,
                            "name": tool_name,
                            "description": desc,
                            "arguments": tool_args,
                        })
                        total_text_emitted = True
                        yield _sse_frame({
                            "type": "text",
                            "content": f"I have prepared the action: **{desc}**.\n\nPlease review and click the green checkmark on the action chip below to confirm and apply it to your workspace."
                        })

                elif event_type in ("done", "error"):
                    if not tool_calls:
                        if not total_text_emitted and event_type == "done":
                            total_text_emitted = True
                            yield _sse_frame({
                                "type": "text",
                                "content": "I have processed your request. Please ask if you need further analysis or actions on your active event log.",
                            })
                        yield _sse_frame(event)
                        return
                    # When tools were called, break to execute the synthesis turn
                    break

            # If read-only tools were invoked, synthesize findings with LLM
            if tool_calls:
                read_only_calls = [tc for tc in tool_calls if _is_read_only(tc.get("name"))]
                if read_only_calls:
                    results_text_parts = []
                    for tc in read_only_calls:
                        t_name = tc.get("name")
                        t_res = tc.get("result", {})
                        res_str = json.dumps(t_res, default=str)[:3500]
                        results_text_parts.append(f"Tool `{t_name}` returned:\n```json\n{res_str}\n```")

                    tool_result_msg = "\n\n".join(results_text_parts)
                    synthesis_sys_prompt = (
                        f"{system_prompt}\n\n"
                        "IMPORTANT: All requested process mining data and metrics have been extracted by the system and are provided in the message below. "
                        "Synthesize these findings into a detailed, well-structured markdown analytical response with key metrics, process insights, and conclusions. "
                        "Do not attempt to call any tools."
                    )
                    followup_prompt = (
                        f"{message}\n\n"
                        f"[Analysis Tool Execution Results]:\n{tool_result_msg}\n\n"
                        f"Please synthesize and present these findings clearly with key metrics, process insights, and markdown formatting."
                    )

                    for evt in stream_chat(
                        system_prompt=synthesis_sys_prompt,
                        user_message=followup_prompt,
                        tools=[],
                        history=history,
                        provider_name=provider,
                    ):
                        if evt.get("type") == "text":
                            total_text_emitted = True
                            yield _sse_frame(evt)
                        elif evt.get("type") in ("done", "error"):
                            break

            # Fallback if no text tokens were emitted across the entire request
            if not total_text_emitted:
                fallback_lines = ["### Process Analysis Summary\n"]
                if tool_calls:
                    for tc in tool_calls:
                        t_name = tc.get("name")
                        t_res = tc.get("result", {})
                        if isinstance(t_res, dict):
                            if "variants" in t_res:
                                variants_list = t_res.get("variants", [])
                                fallback_lines.append(f"Discovered **{len(variants_list)} process variants**.")
                                if variants_list:
                                    fallback_lines.append("\n| Variant | Cases | Sequence |")
                                    fallback_lines.append("| :--- | :--- | :--- |")
                                    for idx, v in enumerate(variants_list[:5], 1):
                                        sig = v.get("signature", "Unknown")
                                        supp = v.get("support", 0)
                                        fallback_lines.append(f"| **#{v.get('id', idx)}** | {supp:,} | `{sig}` |")
                            elif "num_events" in t_res:
                                fallback_lines.append(
                                    "\n| Metric | Value |\n| :--- | :--- |\n"
                                    f"| **Total Events** | {t_res.get('num_events', 0):,} |\n"
                                    f"| **Distinct Activities** | {t_res.get('num_unique_activities', 0):,} |\n"
                                    f"| **Total Objects** | {t_res.get('num_objects', 0):,} |\n"
                                    f"| **Object Types** | {t_res.get('num_object_types', 0):,} |"
                                )
                            elif "error" in t_res:
                                fallback_lines.append(f"- Tool `{t_name}` error: {t_res.get('error')}")
                            else:
                                fallback_lines.append(f"- Tool `{t_name}` executed successfully.")
                        else:
                            fallback_lines.append(f"- Tool `{t_name}` executed successfully.")
                else:
                    fallback_lines.append("Analysis completed. Please select an event log to view process metrics.")

                yield _sse_frame({"type": "text", "content": "\n".join(fallback_lines)})

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

    def _run_non_streaming(
        self,
        user: Any,
        message: str,
        context: Dict[str, Any],
        mode: str,
        history: List[Dict[str, Any]],
        provider: Optional[str] = None,
        api_key: Optional[str] = None,
    ):
        """Run the agentic loop without streaming. Returns JSON."""
        system_prompt = build_system_prompt(user, context=context, mode=mode, query=message)
        tool_specs = get_tool_specs()

        response = complete(
            system_prompt=system_prompt,
            user_message=message,
            tools=tool_specs,
            history=history,
            provider_name=provider,
            api_key=api_key,
        )

        if response.get("error_type") == "key_error":
            return Response(
                {"error": response.get("text"), "error_type": "key_error"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        text = response.get("text", "")
        tool_calls = response.get("tool_calls", [])
        pending_actions = []
        tour_steps = []
        results = []

        for tc in tool_calls:
            tool_name = tc.get("name", "")
            tool_args = tc.get("arguments", {})
            try:
                category = get_category(tool_name)
            except ValueError:
                results.append({
                    "id": tc.get("id", ""),
                    "name": tool_name,
                    "result": {"error": f"Unknown tool: {tool_name}"},
                })
                continue

            if category == ToolCategory.READ_ONLY:
                try:
                    result = call_tool(tool_name, tool_args, user=user, context=context)
                    results.append({
                        "id": tc.get("id", ""),
                        "name": tool_name,
                        "result": result,
                    })
                except Exception as exc:
                    results.append({
                        "id": tc.get("id", ""),
                        "name": tool_name,
                        "result": {"error": str(exc)},
                    })
            elif tool_name == "highlight_element":
                step = {
                    "tour_id": tool_args.get("tour_id", ""),
                    "title": tool_args.get("label", "") or "UI Highlight",
                    "description": tool_args.get("label", ""),
                }
                tour_steps.append(step)
                desc = _describe_action(tool_name, tool_args)
                action_id = register_action(
                    user_id=getattr(user, "id", None),
                    tool_name=tool_name,
                    arguments=tool_args,
                    description=desc,
                    context=context,
                )
                pending_actions.append({
                    "id": action_id,
                    "name": tool_name,
                    "description": desc,
                    "arguments": tool_args,
                })
            else:
                desc = _describe_action(tool_name, tool_args)
                action_id = register_action(
                    user_id=getattr(user, "id", None),
                    tool_name=tool_name,
                    arguments=tool_args,
                    description=desc,
                    context=context,
                )
                pending_actions.append({
                    "id": action_id,
                    "name": tool_name,
                    "description": desc,
                    "arguments": tool_args,
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
                history=history,
                provider_name=provider,
            )
            text = followup.get("text", text)

        return Response({
            "text": text,
            "tool_calls": results,
            "pending_actions": pending_actions,
            "tour_path": {"steps": tour_steps} if tour_steps else None,
        }, status=status.HTTP_200_OK)


def _describe_action(name: str, arguments: Any) -> str:
    """Generate a human-readable description for a pending action."""
    if not isinstance(arguments, dict):
        arguments = {}
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


def _sse_frame(event: Dict[str, Any]) -> bytes:
    """Format a dict as an SSE ``data:`` frame with double-newline terminator."""
    payload = json.dumps(event, default=str, ensure_ascii=False)
    return f"data: {payload}\n\n".encode("utf-8")


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def confirm_action(request):
    """
    POST /api/assistant/confirm/

    Execute or cancel a pending action after user confirmation.
    """
    if not isinstance(request.data, dict):
        return Response(
            {"error": "Request body must be a JSON object."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    raw_action_id = request.data.get("pending_action_id")
    if raw_action_id is None:
        raw_action_id = request.data.get("action_id")

    if not isinstance(raw_action_id, str) or not raw_action_id.strip():
        return Response(
            {"error": "Invalid or missing pending_action_id"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    pending_action_id = raw_action_id.strip()

    approved_raw = request.data.get("approved", False)
    if isinstance(approved_raw, str):
        approved = approved_raw.strip().lower() in ("true", "1", "yes", "t", "y")
    else:
        approved = bool(approved_raw)

    action_record = get_action(pending_action_id)

    # Cancel path
    if not approved:
        if action_record:
            cancel_action(pending_action_id, user_id=getattr(request.user, "id", None))
        return Response(
            {"status": "cancelled", "pending_action_id": pending_action_id},
            status=status.HTTP_200_OK,
        )

    # Approve path
    if action_record:
        user_id = getattr(request.user, "id", None)
        if user_id is not None and action_record.get("user_id") is not None:
            if action_record["user_id"] != user_id:
                return Response(
                    {"error": "Unauthorized to confirm this action."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        update_action_status(pending_action_id, "executed")
        tool_name = action_record.get("tool_name", "")
        tool_args = action_record.get("arguments", {})
        ctx = action_record.get("context", {}) or {}
        exec_ctx = {**ctx, "__confirmed__": True, "confirmed": True}

        try:
            result = call_tool(tool_name, tool_args, user=request.user, context=exec_ctx)
        except Exception as exc:
            result = {"error": str(exc)}
    else:
        result = {}

    return Response(
        {"status": "executed", "pending_action_id": pending_action_id, "result": result},
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def validate_api_key(request):
    """
    Probe the validity of a user-supplied LLM API key for Gemini, OpenAI, or Anthropic.
    Body: {"provider": "gemini" | "openai" | "anthropic", "api_key": "..."}
    """
    if not isinstance(request.data, dict):
        return Response(
            {"valid": False, "error": "Request body must be a JSON object."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    provider = (request.data.get("provider") or "").strip().lower()
    api_key = (request.data.get("api_key") or "").strip()

    if not api_key:
        return Response(
            {"valid": False, "provider": provider or "unknown", "error": "API key cannot be empty."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    result = validate_provider_key(provider=provider, api_key=api_key)
    return Response(
        result,
        status=status.HTTP_200_OK if result.get("valid") else status.HTTP_400_BAD_REQUEST,
    )

