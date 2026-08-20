"""
Gemini API wrapper for the AI assistant.

Supports both streaming (SSE) and non-streaming (complete) modes.
Uses the google-generativeai SDK.
"""

import os
import json
import uuid

import google.generativeai as genai


def _get_api_key():
    try:
        from django.conf import settings
        if hasattr(settings, "GEMINI_API_KEY"):
            return settings.GEMINI_API_KEY or ""
        return os.environ.get("GEMINI_API_KEY", "")
    except Exception:
        return os.environ.get("GEMINI_API_KEY", "")


def _get_model():
    try:
        from django.conf import settings
        return getattr(settings, "ASSISTANT_MODEL", "") or os.environ.get("ASSISTANT_MODEL", "gemini-3.6-flash")
    except Exception:
        return os.environ.get("ASSISTANT_MODEL", "gemini-3.6-flash")


_TYPE_MAP = {
    "object": genai.protos.Type.OBJECT,
    "string": genai.protos.Type.STRING,
    "integer": genai.protos.Type.INTEGER,
    "number": genai.protos.Type.NUMBER,
    "boolean": genai.protos.Type.BOOLEAN,
    "array": genai.protos.Type.ARRAY,
}


def _json_schema_to_proto_schema(d):
    """Convert a JSON schema dict into a genai.protos.Schema object."""
    if not isinstance(d, dict):
        return genai.protos.Schema(type_=_TYPE_MAP["object"])
    t = _TYPE_MAP.get(d.get("type", "object"), genai.protos.Type.OBJECT)
    kwargs = {"type_": t}
    if "description" in d:
        kwargs["description"] = d["description"]
    if "properties" in d and isinstance(d["properties"], dict):
        kwargs["properties"] = {
            k: _json_schema_to_proto_schema(v) for k, v in d["properties"].items()
        }
    if "required" in d and d["required"]:
        kwargs["required"] = d["required"]
    if "items" in d and isinstance(d["items"], dict):
        kwargs["items"] = _json_schema_to_proto_schema(d["items"])
    return genai.protos.Schema(**kwargs)


def _build_gemini_tools(tools):
    """Convert our tool spec format to Gemini function declarations."""
    if not tools:
        return None

    function_declarations = []
    for tool in tools:
        fd = genai.protos.FunctionDeclaration(
            name=tool["name"],
            description=tool.get("description", ""),
            parameters=_json_schema_to_proto_schema(
                tool.get("parameters", {"type": "object", "properties": {}})
            ),
        )
        function_declarations.append(fd)

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
    api_key = _get_api_key()
    if not api_key:
        return {
            "text": "[Assistant is not configured. Set GEMINI_API_KEY to enable.]",
            "tool_calls": [],
            "usage": {},
        }

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        model_name=_get_model(),
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
    api_key = _get_api_key()
    if not api_key:
        yield {"type": "error", "error": "Assistant is not configured. Set GEMINI_API_KEY."}
        return

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        model_name=_get_model(),
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
