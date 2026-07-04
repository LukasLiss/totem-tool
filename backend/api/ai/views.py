"""HTTP endpoints for the AI assistant."""

import os

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .agent import run_agent
from .providers import DEFAULT_MODELS, ProviderError, build_provider

MAX_HISTORY_MESSAGES = 200

VALID_ROLES = {"user", "assistant", "tool"}


def _env_defaults():
    return {
        "provider": os.environ.get("AI_PROVIDER", "ollama"),
        "model": os.environ.get("AI_MODEL", ""),
        "anthropic_api_key": os.environ.get("ANTHROPIC_API_KEY", ""),
        "openai_api_key": os.environ.get("OPENAI_API_KEY", ""),
        "ollama_base_url": os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434"),
    }


def _sanitize_messages(raw_messages):
    if not isinstance(raw_messages, list) or not raw_messages:
        raise ValueError("messages must be a non-empty list")
    if len(raw_messages) > MAX_HISTORY_MESSAGES:
        raw_messages = raw_messages[-MAX_HISTORY_MESSAGES:]
    messages = []
    for raw in raw_messages:
        if not isinstance(raw, dict) or raw.get("role") not in VALID_ROLES:
            raise ValueError("each message needs a role of user, assistant or tool")
        message = {"role": raw["role"], "content": str(raw.get("content") or "")}
        if raw["role"] == "assistant":
            tool_calls = raw.get("tool_calls") or []
            if not isinstance(tool_calls, list):
                raise ValueError("tool_calls must be a list")
            message["tool_calls"] = [
                {
                    "id": str(call.get("id") or ""),
                    "name": str(call.get("name") or ""),
                    "arguments": call.get("arguments") if isinstance(call.get("arguments"), dict) else {},
                }
                for call in tool_calls
                if isinstance(call, dict)
            ]
        elif raw["role"] == "tool":
            message["tool_call_id"] = str(raw.get("tool_call_id") or "")
            message["name"] = str(raw.get("name") or "")
        messages.append(message)
    if messages[-1]["role"] != "user":
        raise ValueError("the last message must be a user message")
    return messages


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def chat(request):
    """Run one assistant turn.

    Body: ``{"messages": [...], "settings": {"provider", "model", "api_key",
    "ollama_base_url"}}``. Settings are optional per field; environment
    variables provide the defaults. Returns ``{"messages": [...new...],
    "actions": [...]}``.
    """
    try:
        messages = _sanitize_messages(request.data.get("messages"))
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    env = _env_defaults()
    settings_in = request.data.get("settings") or {}
    if not isinstance(settings_in, dict):
        settings_in = {}

    provider_name = (settings_in.get("provider") or env["provider"]).strip().lower()
    model = (settings_in.get("model") or env["model"]).strip()
    api_key = (settings_in.get("api_key") or "").strip()
    if not api_key:
        api_key = env["anthropic_api_key"] if provider_name == "anthropic" else env["openai_api_key"]
    base_url = (settings_in.get("ollama_base_url") or env["ollama_base_url"]).strip()

    try:
        provider = build_provider(provider_name, model, api_key, base_url)
        new_messages, actions = run_agent(request.user, messages, provider)
    except ProviderError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

    return Response({"messages": new_messages, "actions": actions})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def config(request):
    """Report backend-side defaults so the settings UI can show sensible hints."""
    env = _env_defaults()
    return Response(
        {
            "default_provider": env["provider"],
            "default_models": DEFAULT_MODELS,
            "env_model": env["model"],
            "has_anthropic_key": bool(env["anthropic_api_key"]),
            "has_openai_key": bool(env["openai_api_key"]),
            "ollama_base_url": env["ollama_base_url"],
        }
    )
