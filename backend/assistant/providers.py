"""
LLM provider adapters for the assistant harness.

All providers speak one canonical transcript format (Anthropic-shaped):

    {"role": "user" | "assistant", "content": [block, ...]}

    {"type": "text", "text": str}
    {"type": "tool_use", "id": str, "name": str, "input": dict}
    {"type": "tool_result", "tool_use_id": str, "name": str, "content": str, "is_error": bool}

Assistant messages also carry ``"provider": {"name", "model", "raw"}`` with the
provider-native content (Anthropic thinking blocks with signatures, Gemini
parts with thought signatures). When the same provider sees the conversation
again, the native content is replayed verbatim; history is never edited.

``Provider.stream`` yields:

    {"type": "text", "text": str}           visible answer text, as generated
    {"type": "status", "status": "thinking"} the model is reasoning
    {"type": "message", "message": {...}, "stop_reason": str, "usage": {...}}   once, last

and raises ``ProviderError`` for failures (auth, rate limits, outages, ...).
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, Iterator, List, Optional

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

DEFAULT_MODELS = {
    "anthropic": "claude-opus-5-5",
    "gemini": "gemini-3.5-flash",
    "openai": "gpt-5.6-luna",
}

MAX_OUTPUT_TOKENS = 32000


class ProviderError(Exception):
    """A provider call failed. ``kind`` is one of auth, rate_limit, unavailable, bad_request, network."""

    def __init__(self, kind: str, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.kind = kind
        self.status = status

    @property
    def retryable(self) -> bool:
        return self.kind in ("rate_limit", "unavailable", "network")


def _http_error(provider: str, status: int, body: str) -> ProviderError:
    detail = body
    try:
        data = json.loads(body)
        err = data[0].get("error") if isinstance(data, list) and data else data.get("error")
        if isinstance(err, dict):
            detail = err.get("message") or detail
            if "API_KEY_INVALID" in json.dumps(err) or err.get("status") == "UNAUTHENTICATED":
                status = 401
        elif isinstance(err, str):
            detail = err
    except Exception:
        pass
    detail = (detail or "").strip()[:500]
    if status in (401, 403):
        return ProviderError("auth", f"{provider} rejected the API key: {detail}", status)
    if status == 429:
        return ProviderError("rate_limit", f"{provider} rate limit or quota reached: {detail}", status)
    if status >= 500:
        return ProviderError("unavailable", f"{provider} is unavailable ({status}): {detail}", status)
    if status == 404:
        return ProviderError("bad_request", f"{provider} model or endpoint not found: {detail}", status)
    return ProviderError("bad_request", f"{provider} rejected the request ({status}): {detail}", status)


def _texts(blocks: List[Dict[str, Any]]) -> str:
    return "".join(b.get("text", "") for b in blocks if b.get("type") == "text")


def _parse_json_object(raw: str) -> Dict[str, Any]:
    if not raw:
        return {}
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("tool arguments are not a JSON object")
    return value


class Provider:
    name = "base"

    def __init__(self, api_key: str, model: Optional[str] = None):
        self.api_key = api_key
        self.model = model or DEFAULT_MODELS.get(self.name, "")

    def stream(self, system: str, messages: List[Dict[str, Any]], tools: List[Dict[str, Any]]) -> Iterator[Dict[str, Any]]:
        raise NotImplementedError


# =============================================================================
# Anthropic (official SDK)
# =============================================================================

_EFFORT_PREFIXES = (
    "claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8", "claude-opus-5",
    "claude-sonnet-4-6", "claude-sonnet-5", "claude-haiku-5", "claude-fable", "claude-mythos",
)
_FALLBACK_PREFIXES = ("claude-opus-5", "claude-sonnet-5-5", "claude-fable-5")


class AnthropicProvider(Provider):
    name = "anthropic"

    def __init__(self, api_key: str, model: Optional[str] = None, http_client: Any = None):
        super().__init__(api_key, model or getattr(settings, "ANTHROPIC_MODEL", "") or DEFAULT_MODELS["anthropic"])
        self.http_client = http_client
        self.effort = getattr(settings, "ASSISTANT_EFFORT", "medium") or "medium"

    def _client(self):
        import anthropic

        kwargs: Dict[str, Any] = {"api_key": self.api_key, "max_retries": 2, "timeout": 300.0}
        if self.http_client is not None:
            kwargs["http_client"] = self.http_client
        return anthropic.Anthropic(**kwargs)

    @staticmethod
    def _to_native(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        out = []
        for msg in messages:
            prov = msg.get("provider") or {}
            if msg["role"] == "assistant" and prov.get("name") == "anthropic" and prov.get("raw"):
                out.append({"role": "assistant", "content": prov["raw"]})
                continue
            blocks = []
            for b in msg["content"]:
                if b["type"] == "text":
                    if b.get("text"):
                        blocks.append({"type": "text", "text": b["text"]})
                elif b["type"] == "tool_use":
                    blocks.append({"type": "tool_use", "id": b["id"], "name": b["name"], "input": b.get("input") or {}})
                elif b["type"] == "tool_result":
                    blocks.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": b["tool_use_id"],
                            "content": b.get("content") or "",
                            "is_error": bool(b.get("is_error")),
                        }
                    )
            if blocks:
                out.append({"role": msg["role"], "content": blocks})
        return out

    @staticmethod
    def _sanitize_raw(content: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """After a server-side refusal fallback, blocks of the declined attempt before the last
        fallback marker must not be echoed back (the marker itself stays in place)."""
        last = max((i for i, b in enumerate(content) if b.get("type") == "fallback"), default=-1)
        if last < 0:
            return content
        dropped = {"thinking", "redacted_thinking", "tool_use", "server_tool_use"}
        return [b for i, b in enumerate(content) if i >= last or b.get("type") not in dropped]

    def stream(self, system, messages, tools):
        import anthropic

        params: Dict[str, Any] = {
            "model": self.model,
            "max_tokens": MAX_OUTPUT_TOKENS,
            "system": [{"type": "text", "text": system}],
            "messages": self._to_native(messages),
            "cache_control": {"type": "ephemeral"},
        }
        if tools:
            params["tools"] = [
                {
                    "name": t["name"],
                    "description": t["description"],
                    "input_schema": t["parameters"],
                    "eager_input_streaming": True,
                }
                for t in tools
            ]
        if self.model.startswith(_EFFORT_PREFIXES):
            params["output_config"] = {"effort": self.effort}
        if self.model.startswith(_FALLBACK_PREFIXES):
            params["betas"] = ["server-side-fallback-2026-07-01"]
            params["fallbacks"] = "default"

        client = self._client()
        for attempt in range(3):
            try:
                with client.beta.messages.stream(**params) as stream:
                    for event in stream:
                        if event.type == "text":
                            yield {"type": "text", "text": event.text}
                        elif event.type == "content_block_start" and getattr(event.content_block, "type", "") == "thinking":
                            yield {"type": "status", "status": "thinking"}
                    final = stream.get_final_message()
                break
            except ValueError:
                # Eager input streaming: the model produced tool-input JSON the SDK could not
                # parse at all. There is no tool_use id to answer, so re-issue the turn.
                if attempt == 2:
                    raise ProviderError("bad_request", "The model produced malformed tool input three times.")
                continue
            except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as exc:
                raise ProviderError("auth", f"Anthropic rejected the API key: {exc.message}", exc.status_code) from exc
            except anthropic.RateLimitError as exc:
                raise ProviderError("rate_limit", f"Anthropic rate limit reached: {exc.message}", 429) from exc
            except (anthropic.BadRequestError, anthropic.NotFoundError, anthropic.UnprocessableEntityError) as exc:
                raise ProviderError("bad_request", f"Anthropic rejected the request: {exc.message}", exc.status_code) from exc
            except anthropic.APIStatusError as exc:
                raise ProviderError("unavailable", f"Anthropic error {exc.status_code}: {exc.message}", exc.status_code) from exc
            except anthropic.APIConnectionError as exc:
                raise ProviderError("network", f"Could not reach Anthropic: {exc}") from exc

        raw = self._sanitize_raw([b.model_dump(mode="json", exclude_none=True) for b in final.content])
        content: List[Dict[str, Any]] = []
        text = "".join(b.get("text", "") for b in raw if b.get("type") == "text")
        if text:
            content.append({"type": "text", "text": text})
        for b in raw:
            if b.get("type") == "tool_use":
                content.append({"type": "tool_use", "id": b["id"], "name": b["name"], "input": b.get("input") or {}})

        usage = final.usage
        yield {
            "type": "message",
            "message": {"role": "assistant", "content": content, "provider": {"name": self.name, "model": final.model, "raw": raw}},
            "stop_reason": final.stop_reason or "end_turn",
            "usage": {
                "input_tokens": getattr(usage, "input_tokens", 0) or 0,
                "output_tokens": getattr(usage, "output_tokens", 0) or 0,
                "cache_read_input_tokens": getattr(usage, "cache_read_input_tokens", 0) or 0,
            },
        }


# =============================================================================
# Shared SSE reader for the REST providers
# =============================================================================

def _sse_data(resp) -> Iterator[str]:
    for raw_line in resp.iter_lines(decode_unicode=False):
        if not raw_line:
            continue
        line = raw_line.decode("utf-8", errors="replace") if isinstance(raw_line, bytes) else raw_line
        if line.startswith("data:"):
            data = line[5:].strip()
            if data:
                yield data


def _post_stream(provider: str, url: str, headers: Dict[str, str], payload: Dict[str, Any]):
    try:
        resp = requests.post(url, headers=headers, json=payload, stream=True, timeout=(10, 300))
    except requests.RequestException as exc:
        raise ProviderError("network", f"Could not reach {provider}: {exc}") from exc
    if resp.status_code != 200:
        body = resp.text
        resp.close()
        raise _http_error(provider, resp.status_code, body)
    return resp


# =============================================================================
# Google Gemini (REST, v1beta)
# =============================================================================

class GeminiProvider(Provider):
    name = "gemini"
    base_url = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(self, api_key: str, model: Optional[str] = None):
        super().__init__(api_key, model or getattr(settings, "ASSISTANT_MODEL", "") or DEFAULT_MODELS["gemini"])

    @staticmethod
    def _to_native(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        native_ids: Dict[str, Optional[str]] = {}
        names: Dict[str, str] = {}
        contents = []
        for msg in messages:
            prov = msg.get("provider") or {}
            for b in msg["content"]:
                if b["type"] == "tool_use":
                    native_ids[b["id"]] = b.get("native_id")
                    names[b["id"]] = b["name"]
            if msg["role"] == "assistant":
                if prov.get("name") == "gemini" and prov.get("raw"):
                    parts = prov["raw"]
                else:
                    parts = []
                    for b in msg["content"]:
                        if b["type"] == "text" and b.get("text"):
                            parts.append({"text": b["text"]})
                        elif b["type"] == "tool_use":
                            parts.append({"functionCall": {"name": b["name"], "args": b.get("input") or {}}})
                if parts:
                    contents.append({"role": "model", "parts": parts})
                continue
            parts = []
            for b in msg["content"]:
                if b["type"] == "text" and b.get("text"):
                    parts.append({"text": b["text"]})
                elif b["type"] == "tool_result":
                    try:
                        value = json.loads(b.get("content") or "{}")
                    except ValueError:
                        value = b.get("content")
                    response = {"error": value} if b.get("is_error") else {"result": value}
                    fr: Dict[str, Any] = {"name": b.get("name") or names.get(b["tool_use_id"], ""), "response": response}
                    if native_ids.get(b["tool_use_id"]):
                        fr["id"] = native_ids[b["tool_use_id"]]
                    parts.append({"functionResponse": fr})
            if parts:
                contents.append({"role": "user", "parts": parts})
        return contents

    def stream(self, system, messages, tools):
        payload: Dict[str, Any] = {
            "contents": self._to_native(messages),
            "systemInstruction": {"parts": [{"text": system}]},
            "generationConfig": {"maxOutputTokens": MAX_OUTPUT_TOKENS},
        }
        if tools:
            payload["tools"] = [
                {
                    "functionDeclarations": [
                        {"name": t["name"], "description": t["description"], "parametersJsonSchema": t["parameters"]}
                        for t in tools
                    ]
                }
            ]
        url = f"{self.base_url}/models/{self.model}:streamGenerateContent?alt=sse"
        headers = {"Content-Type": "application/json", "x-goog-api-key": self.api_key}
        resp = _post_stream("Gemini", url, headers, payload)

        raw_parts: List[Dict[str, Any]] = []
        finish = None
        usage: Dict[str, Any] = {}
        try:
            for data in _sse_data(resp):
                try:
                    chunk = json.loads(data)
                except ValueError:
                    continue
                if "error" in chunk:
                    err = chunk["error"]
                    raise _http_error("Gemini", int(err.get("code") or 500), json.dumps(chunk))
                um = chunk.get("usageMetadata")
                if um:
                    usage = {
                        "input_tokens": um.get("promptTokenCount", 0),
                        "output_tokens": um.get("candidatesTokenCount", 0),
                        "cache_read_input_tokens": um.get("cachedContentTokenCount", 0),
                    }
                feedback = chunk.get("promptFeedback") or {}
                if feedback.get("blockReason"):
                    finish = "refusal"
                for cand in chunk.get("candidates") or []:
                    for part in (cand.get("content") or {}).get("parts") or []:
                        raw_parts.append(part)
                        if part.get("thought"):
                            yield {"type": "status", "status": "thinking"}
                        elif part.get("text"):
                            yield {"type": "text", "text": part["text"]}
                    if cand.get("finishReason"):
                        finish = cand["finishReason"]
        except requests.RequestException as exc:
            raise ProviderError("network", f"Gemini stream interrupted: {exc}") from exc
        finally:
            resp.close()

        content: List[Dict[str, Any]] = []
        text = "".join(p.get("text", "") for p in raw_parts if p.get("text") and not p.get("thought"))
        if text:
            content.append({"type": "text", "text": text})
        for p in raw_parts:
            fc = p.get("functionCall")
            if fc:
                content.append(
                    {
                        "type": "tool_use",
                        "id": f"toolu_{uuid.uuid4().hex[:20]}",
                        "native_id": fc.get("id"),
                        "name": fc.get("name", ""),
                        "input": fc.get("args") or {},
                    }
                )
        if any(b["type"] == "tool_use" for b in content):
            stop = "tool_use"
        elif finish == "MAX_TOKENS":
            stop = "max_tokens"
        elif finish in ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "refusal"):
            stop = "refusal"
        else:
            stop = "end_turn"
        yield {
            "type": "message",
            "message": {"role": "assistant", "content": content, "provider": {"name": self.name, "model": self.model, "raw": raw_parts}},
            "stop_reason": stop,
            "usage": usage,
        }


# =============================================================================
# OpenAI (REST, chat completions)
# =============================================================================

class OpenAIProvider(Provider):
    name = "openai"
    url = "https://api.openai.com/v1/chat/completions"

    def __init__(self, api_key: str, model: Optional[str] = None):
        super().__init__(api_key, model or getattr(settings, "OPENAI_MODEL", "") or DEFAULT_MODELS["openai"])

    @staticmethod
    def _to_native(system: str, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = [{"role": "system", "content": system}]
        for msg in messages:
            if msg["role"] == "assistant":
                entry: Dict[str, Any] = {"role": "assistant", "content": _texts(msg["content"]) or None}
                calls = [
                    {"id": b["id"], "type": "function", "function": {"name": b["name"], "arguments": json.dumps(b.get("input") or {})}}
                    for b in msg["content"]
                    if b["type"] == "tool_use"
                ]
                if calls:
                    entry["tool_calls"] = calls
                out.append(entry)
                continue
            for b in msg["content"]:
                if b["type"] == "tool_result":
                    out.append({"role": "tool", "tool_call_id": b["tool_use_id"], "content": b.get("content") or ""})
            text = _texts(msg["content"])
            if text:
                out.append({"role": "user", "content": text})
        return out

    def stream(self, system, messages, tools):
        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": self._to_native(system, messages),
            "stream": True,
            "stream_options": {"include_usage": True},
            "max_completion_tokens": MAX_OUTPUT_TOKENS,
        }
        if tools:
            payload["tools"] = [
                {"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["parameters"]}}
                for t in tools
            ]
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        resp = _post_stream("OpenAI", self.url, headers, payload)

        text_parts: List[str] = []
        calls: Dict[int, Dict[str, str]] = {}
        finish = None
        usage: Dict[str, Any] = {}
        try:
            for data in _sse_data(resp):
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except ValueError:
                    continue
                if chunk.get("error"):
                    raise _http_error("OpenAI", 500, json.dumps(chunk))
                if chunk.get("usage"):
                    u = chunk["usage"]
                    usage = {"input_tokens": u.get("prompt_tokens", 0), "output_tokens": u.get("completion_tokens", 0)}
                for choice in chunk.get("choices") or []:
                    delta = choice.get("delta") or {}
                    if delta.get("content"):
                        text_parts.append(delta["content"])
                        yield {"type": "text", "text": delta["content"]}
                    for tc in delta.get("tool_calls") or []:
                        slot = calls.setdefault(tc.get("index", 0), {"id": "", "name": "", "arguments": ""})
                        if tc.get("id"):
                            slot["id"] = tc["id"]
                        fn = tc.get("function") or {}
                        if fn.get("name"):
                            slot["name"] += fn["name"]
                        if fn.get("arguments"):
                            slot["arguments"] += fn["arguments"]
                    if choice.get("finish_reason"):
                        finish = choice["finish_reason"]
        except requests.RequestException as exc:
            raise ProviderError("network", f"OpenAI stream interrupted: {exc}") from exc
        finally:
            resp.close()

        content: List[Dict[str, Any]] = []
        if text_parts:
            content.append({"type": "text", "text": "".join(text_parts)})
        bad_json = []
        for _, slot in sorted(calls.items()):
            try:
                args = _parse_json_object(slot["arguments"])
            except ValueError:
                args = {"__unparseable__": slot["arguments"][:2000]}
                bad_json.append(slot["name"])
            content.append({"type": "tool_use", "id": slot["id"] or f"call_{uuid.uuid4().hex[:20]}", "name": slot["name"], "input": args})
        if calls:
            stop = "max_tokens" if finish == "length" else "tool_use"
        elif finish == "length":
            stop = "max_tokens"
        elif finish == "content_filter":
            stop = "refusal"
        else:
            stop = "end_turn"
        yield {
            "type": "message",
            "message": {"role": "assistant", "content": content, "provider": {"name": self.name, "model": self.model}},
            "stop_reason": stop,
            "usage": usage,
        }


# =============================================================================
# Offline demo provider (no API key; for local UI testing only)
# =============================================================================

class DemoProvider(Provider):
    """Deterministic stand-in: looks the active log up once, then reports what it found.

    It exercises the real harness (tool call -> tool result -> answer) so the UI can be
    tried without a key. It never pretends to understand the question.
    """

    name = "demo"

    def stream(self, system, messages, tools):
        last = messages[-1] if messages else {"content": []}
        results = [b for b in last.get("content", []) if b.get("type") == "tool_result"]
        tool_names = {t["name"] for t in tools}
        if results:
            r = results[0]
            try:
                data = json.loads(r.get("content") or "{}")
            except ValueError:
                data = {}
            if r.get("is_error"):
                text = f"The lookup failed: {data.get('error', r.get('content'))}"
            else:
                facts = [f"- **{k.replace('_', ' ')}**: {v}" for k, v in data.items() if isinstance(v, (int, float, str)) and v is not None]
                text = "Demo mode (no LLM connected). Here is what the log overview returned:\n\n" + "\n".join(facts[:12])
            content = [{"type": "text", "text": text}]
            stop = "end_turn"
        elif "get_log_overview" in tool_names:
            content = [
                {"type": "text", "text": "Demo mode: looking up the selected event log. "},
                {"type": "tool_use", "id": f"toolu_demo_{uuid.uuid4().hex[:12]}", "name": "get_log_overview", "input": {}},
            ]
            stop = "tool_use"
        else:
            content = [{"type": "text", "text": "Demo mode is active. Add an API key to chat with a real model."}]
            stop = "end_turn"
        for b in content:
            if b["type"] == "text":
                yield {"type": "text", "text": b["text"]}
        yield {
            "type": "message",
            "message": {"role": "assistant", "content": content, "provider": {"name": self.name, "model": "demo"}},
            "stop_reason": stop,
            "usage": {},
        }


# =============================================================================
# Factory and key validation
# =============================================================================

PROVIDERS = {"anthropic": AnthropicProvider, "gemini": GeminiProvider, "openai": OpenAIProvider}


def detect_provider(api_key: str) -> Optional[str]:
    if api_key.startswith("sk-ant-"):
        return "anthropic"
    if api_key.startswith(("AIza", "AQ.")):  # classic and newer Google API key formats
        return "gemini"
    if api_key.startswith("sk-"):
        return "openai"
    return None


def get_provider(name: Optional[str], api_key: Optional[str], model: Optional[str] = None) -> Provider:
    """Resolve a provider from the user's choice and key, falling back to server-configured keys."""
    name = (name or "").strip().lower()
    key = (api_key or "").strip()
    if name in ("demo", "mock"):
        return DemoProvider("")
    if not name and key:
        name = detect_provider(key) or ""
    server_keys = {
        "anthropic": getattr(settings, "ANTHROPIC_API_KEY", ""),
        "gemini": getattr(settings, "GEMINI_API_KEY", ""),
        "openai": getattr(settings, "OPENAI_API_KEY", ""),
    }
    if not name:
        name = next((n for n in ("anthropic", "gemini", "openai") if server_keys[n]), "")
    if name not in PROVIDERS:
        raise ProviderError("auth", "No LLM provider is configured. Add an API key in the assistant settings.")
    key = key or server_keys[name]
    if not key:
        raise ProviderError("auth", f"No API key is configured for {name}.")
    return PROVIDERS[name](key, model)


def validate_provider_key(provider: str, api_key: str) -> Dict[str, Any]:
    """Cheap authenticated probe (model listing) to check a key without running inference."""
    key = (api_key or "").strip()
    name = (provider or "").strip().lower() or detect_provider(key) or ""
    if not key:
        return {"valid": False, "provider": name or "unknown", "error": "API key cannot be empty."}
    if name in ("demo", "mock"):
        return {"valid": True, "provider": "demo", "message": "Demo mode needs no key."}
    probes = {
        "gemini": ("https://generativelanguage.googleapis.com/v1beta/models", {"x-goog-api-key": key}),
        "openai": ("https://api.openai.com/v1/models", {"Authorization": f"Bearer {key}"}),
        "anthropic": ("https://api.anthropic.com/v1/models", {"x-api-key": key, "anthropic-version": "2023-06-01"}),
    }
    if name not in probes:
        return {"valid": False, "provider": name, "error": f"Unsupported provider '{name}'. Use anthropic, gemini or openai."}
    url, headers = probes[name]
    try:
        resp = requests.get(url, headers=headers, timeout=10)
    except requests.RequestException as exc:
        return {"valid": False, "provider": name, "error": f"Could not reach {name}: {exc}"}
    if resp.status_code == 200:
        return {"valid": True, "provider": name, "message": "API key verified."}
    err = _http_error(name, resp.status_code, resp.text)
    return {"valid": False, "provider": name, "error": str(err)}
