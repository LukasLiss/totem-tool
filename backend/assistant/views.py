"""
HTTP endpoints of the assistant.

POST /api/assistant/chat/          run one turn of the agent loop, streamed as SSE
POST /api/assistant/confirm/       approve or decline a proposed change
POST /api/assistant/cancel/        stop the reply being generated (Stop button)
POST /api/assistant/reset/         forget a conversation
POST /api/assistant/validate-key/  check an LLM API key without running inference
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator, Dict, Iterator

from asgiref.sync import sync_to_async
from django.core.handlers.asgi import ASGIRequest
from django.http import StreamingHttpResponse
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import BaseRenderer, JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView

from mcp_server.server import ToolContext, ToolError, call_tool

from . import action_registry, conversation as conv_store
from .harness import run_turn
from .prompts import resolve_ui_context
from .providers import ProviderError, get_provider, validate_provider_key

logger = logging.getLogger(__name__)

MAX_MESSAGE_CHARS = 20_000


class EventStreamRenderer(BaseRenderer):
    """Lets clients send ``Accept: text/event-stream`` without a 406."""

    media_type = "text/event-stream"
    format = "txt"

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return json.dumps(data).encode("utf-8") if isinstance(data, (dict, list)) else data


def _sse(event: Dict[str, Any]) -> bytes:
    return f"data: {json.dumps(event, default=str, ensure_ascii=False)}\n\n".encode("utf-8")


_END = object()


async def _async_iter(sync_gen: Iterator[bytes]) -> AsyncIterator[bytes]:
    """Stream a sync generator under ASGI one item at a time.

    Django's ASGI handler would otherwise read a sync streaming iterator to the
    end before sending anything, so the user would see nothing until the whole
    agent turn finished. Each step runs in a worker thread; if the client goes
    away, the generator is closed so the turn is saved and its lock released.
    """
    step = sync_to_async(next, thread_sensitive=False)
    try:
        while True:
            chunk = await step(sync_gen, _END)
            if chunk is _END:
                break
            yield chunk
    finally:
        await sync_to_async(sync_gen.close, thread_sensitive=False)()


class ChatView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]
    renderer_classes = [JSONRenderer, EventStreamRenderer]

    def post(self, request):
        body = request.data if isinstance(request.data, dict) else None
        if body is None:
            return Response({"error": "Request body must be a JSON object."}, status=status.HTTP_400_BAD_REQUEST)

        message = body.get("message")
        if not isinstance(message, str) or not message.strip():
            return Response({"error": '"message" must be a non-empty string.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(message) > MAX_MESSAGE_CHARS:
            return Response({"error": f"Message exceeds {MAX_MESSAGE_CHARS} characters."}, status=status.HTTP_400_BAD_REQUEST)

        mode = "act" if body.get("mode") == "act" else "teach"
        conversation_id = body.get("conversation_id")
        if conversation_id is not None and not conv_store.valid_conversation_id(conversation_id):
            return Response({"error": "Invalid conversation_id."}, status=status.HTTP_400_BAD_REQUEST)

        # The key travels in a header so it never lands in request-body logs or stored context.
        api_key = request.META.get("HTTP_X_LLM_KEY") or ""
        provider_name = request.META.get("HTTP_X_LLM_PROVIDER") or body.get("provider") or ""
        model = body.get("model") if isinstance(body.get("model"), str) else None
        try:
            provider = get_provider(provider_name, api_key, model=model)
        except ProviderError as exc:
            return Response({"error": str(exc), "code": exc.kind}, status=status.HTTP_401_UNAUTHORIZED)

        ui_context = resolve_ui_context(request.user, body.get("context"))
        events = run_turn(
            user=request.user,
            conversation_id=conversation_id,
            mode=mode,
            text=message.strip(),
            ui_context=ui_context,
            provider=provider,
        )

        def stream():
            try:
                for event in events:
                    yield _sse(event)
            except Exception:  # never leave the client hanging without a terminal frame
                logger.exception("Assistant turn crashed")
                yield _sse({"type": "error", "code": "internal", "message": "The assistant hit an internal error.", "retryable": True})
                yield _sse({"type": "done", "usage": {}})
            finally:
                events.close()

        response = StreamingHttpResponse(
            _async_iter(stream()) if isinstance(request._request, ASGIRequest) else stream(),
            content_type="text/event-stream",
        )
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def confirm_action(request):
    body = request.data if isinstance(request.data, dict) else {}
    action_id = body.get("pending_action_id") or body.get("action_id")
    if not isinstance(action_id, str) or not action_id.strip():
        return Response({"error": "pending_action_id is required."}, status=status.HTTP_400_BAD_REQUEST)
    approved = body.get("approved") is True or str(body.get("approved")).lower() in ("true", "1", "yes")

    claimed = action_registry.claim(action_id.strip(), request.user.id, "executing" if approved else "cancelled")
    if not claimed["ok"]:
        reason = claimed["reason"]
        if reason == "not_pending":
            rec = claimed["record"]
            return Response(
                {"status": rec.get("status"), "pending_action_id": rec["id"], "result": rec.get("result")},
                status=status.HTTP_409_CONFLICT,
            )
        # Same answer for unknown and foreign ids: don't reveal other users' actions.
        return Response({"error": "This action does not exist or has expired."}, status=status.HTTP_404_NOT_FOUND)

    record = claimed["record"]
    if not approved:
        conv_store.add_note(request.user.id, record.get("conversation_id"), f"The user declined: {record['description']}.")
        return Response({"status": "cancelled", "pending_action_id": record["id"]})

    ctx = ToolContext(user=request.user, **(record.get("tool_context") or {}))
    try:
        result = call_tool(record["tool_name"], record["arguments"], ctx)
    except ToolError as exc:
        action_registry.finish(record, "failed", exc.to_dict())
        conv_store.add_note(
            request.user.id, record.get("conversation_id"), f"The user approved '{record['description']}' but it failed: {exc}"
        )
        return Response({"status": "failed", "pending_action_id": record["id"], "error": str(exc)}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
    except Exception as exc:
        logger.exception("Approved assistant action %s failed", record["tool_name"])
        action_registry.finish(record, "failed", {"error": str(exc)})
        conv_store.add_note(request.user.id, record.get("conversation_id"), f"The user approved '{record['description']}' but it failed unexpectedly.")
        return Response({"status": "failed", "pending_action_id": record["id"], "error": "The change could not be applied."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    action_registry.finish(record, "executed", result)
    conv_store.add_note(
        request.user.id,
        record.get("conversation_id"),
        f"The user approved '{record['description']}'; it was applied. Result: {json.dumps(result, default=str)[:1500]}",
    )
    return Response({"status": "executed", "pending_action_id": record["id"], "tool_name": record["tool_name"], "result": result})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cancel_turn(request):
    """Stop the reply being generated in a conversation (the Stop button)."""
    conversation_id = (request.data or {}).get("conversation_id") if isinstance(request.data, dict) else None
    if not conv_store.valid_conversation_id(conversation_id):
        return Response({"error": "Invalid conversation_id."}, status=status.HTTP_400_BAD_REQUEST)
    conv_store.request_cancel(request.user.id, conversation_id)
    return Response({"status": "cancelling"})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def reset_conversation(request):
    conversation_id = (request.data or {}).get("conversation_id") if isinstance(request.data, dict) else None
    if conv_store.valid_conversation_id(conversation_id):
        conv_store.delete(request.user.id, conversation_id)
    return Response({"status": "reset"})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def validate_api_key(request):
    body = request.data if isinstance(request.data, dict) else {}
    result = validate_provider_key(str(body.get("provider") or ""), str(body.get("api_key") or ""))
    return Response(result, status=status.HTTP_200_OK if result.get("valid") else status.HTTP_400_BAD_REQUEST)
