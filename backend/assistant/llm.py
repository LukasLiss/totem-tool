"""
Gemini API wrapper for the AI assistant.

Supports both streaming (SSE) and non-streaming (complete) modes.
Uses the google-generativeai SDK.
"""

import os
import json
import uuid

import google.generativeai as genai


GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
ASSISTANT_MODEL = os.environ.get("ASSISTANT_MODEL", "gemini-3.6-flash")

# Configure the Gemini client at module load time.
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)


def _build_gemini_tools(tools):
    """Convert our tool spec format to Gemini function declarations."""
    if not tools:
        return None

    function_declarations = []
    for tool in tools:
        func_decl = {
            "name": tool["name"],
            "description": tool.get("description", ""),
            "parameters": tool.get("parameters", {"type": "object", "properties": {}}),
        }
        function_declarations.append(func_decl)

    return genai.protos.Tool(function_declarations=function_declarations)


def complete(system_prompt, user_message, tools=None):
    """
    Send a single-turn request to Gemini and return the response.

    Returns:
        dict with keys:
            - text: str — the LLM's text response
            - tool_calls: list[dict] — any tool calls the LLM requested
            - usage: dict — token counts
    """
    if not GEMINI_API_KEY:
        return {
            "text": "[Assistant is not configured. Set GEMINI_API_KEY to enable.]",
            "tool_calls": [],
            "usage": {},
        }

    model = genai.GenerativeModel(
        model_name=ASSISTANT_MODEL,
        system_instruction=system_prompt,
    )

    kwargs = {}
    if tools:
        kwargs["tools"] = _build_gemini_tools(tools)

    response = model.generate_content(user_message, **kwargs)

    text = ""
    tool_calls = []

    for part in response.parts:
        if hasattr(part, "text") and part.text:
            text += part.text
        elif hasattr(part, "function_call") and part.function_call:
            fc = part.function_call
            tool_calls.append({
                "id": str(uuid.uuid4()),
                "name": fc.name,
                "arguments": dict(fc.args) if fc.args else {},
            })

    usage = {}
    if response.usage_metadata:
        usage = {
            "prompt_tokens": response.usage_metadata.prompt_token_count,
            "completion_tokens": response.usage_metadata.candidates_token_count,
        }

    return {
        "text": text,
        "tool_calls": tool_calls,
        "usage": usage,
    }


def stream_chat(system_prompt, user_message, tools=None):
    """
    Generator that yields SSE event dicts for streaming to the client.

    Yields dicts matching the SSE frame spec in ASSISTANT_CONTRACTS.md:
        {"type": "text", "content": "..."}
        {"type": "tool_call", "id": "...", "name": "...", "arguments": {...}}
        {"type": "tool_result", "id": "...", "name": "...", "result": {...}}
        {"type": "done", "usage": {...}}
        {"type": "error", "error": "..."}
    """
    if not GEMINI_API_KEY:
        yield {"type": "error", "error": "Assistant is not configured. Set GEMINI_API_KEY."}
        return

    model = genai.GenerativeModel(
        model_name=ASSISTANT_MODEL,
        system_instruction=system_prompt,
    )

    kwargs = {"stream": True}
    if tools:
        kwargs["tools"] = _build_gemini_tools(tools)

    try:
        response = model.generate_content(user_message, **kwargs)

        for chunk in response:
            for part in chunk.parts:
                if hasattr(part, "text") and part.text:
                    yield {"type": "text", "content": part.text}
                elif hasattr(part, "function_call") and part.function_call:
                    fc = part.function_call
                    yield {
                        "type": "tool_call",
                        "id": str(uuid.uuid4()),
                        "name": fc.name,
                        "arguments": dict(fc.args) if fc.args else {},
                    }

        yield {"type": "done", "usage": {}}

    except Exception as e:
        yield {"type": "error", "error": str(e)}
