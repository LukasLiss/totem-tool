"""
LLM client wrapper for streaming completions and tool calling.
Provides contract implementations for M1 scaffolding, extended in M3.
"""

import json
from django.conf import settings


def complete(system_prompt: str, user_message: str, tools: list = None) -> dict:
    """Non-streaming completion fallback."""
    api_key = getattr(settings, "GEMINI_API_KEY", "") or getattr(settings, "ANTHROPIC_API_KEY", "")
    if not api_key:
        return {
            "text": "LLM API key is not configured.",
            "tool_calls": [],
            "usage": {},
        }
    # Placeholder for live LLM call (M3)
    return {
        "text": f"Echo: {user_message}",
        "tool_calls": [],
        "usage": {},
    }


def stream_chat(system_prompt: str, user_message: str, tools: list = None):
    """Streaming generator yielding SSE-compatible event dictionaries."""
    api_key = getattr(settings, "GEMINI_API_KEY", "") or getattr(settings, "ANTHROPIC_API_KEY", "")
    if not api_key:
        yield {"type": "text", "content": "LLM API key is not configured."}
        yield {"type": "done", "usage": {}}
        return

    # Placeholder streaming response
    yield {"type": "text", "content": f"Echo: {user_message}"}
    yield {"type": "done", "usage": {}}
