"""
Multi-provider LLM streaming wrapper supporting Gemini, Anthropic, and Mock providers.
"""

import abc
import json
import logging
import re
import uuid
from typing import Any, Dict, Generator, List, Optional

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


def convert_schema_to_gemini(schema: Any) -> Any:
    """Recursively convert JSON Schema data types to Gemini uppercase types."""
    if not isinstance(schema, dict):
        return schema

    converted: Dict[str, Any] = {}
    for k, v in schema.items():
        if k == "type" and isinstance(v, str):
            converted[k] = v.upper()
        elif k == "properties" and isinstance(v, dict):
            converted[k] = {prop: convert_schema_to_gemini(pval) for prop, pval in v.items()}
        elif k == "items" and isinstance(v, dict):
            converted[k] = convert_schema_to_gemini(v)
        else:
            converted[k] = v
    return converted


def format_tool_for_gemini(tool_spec: Dict[str, Any]) -> Dict[str, Any]:
    """Format tool specification for Gemini functionDeclarations."""
    params = tool_spec.get("parameters", {"type": "object", "properties": {}})
    return {
        "name": tool_spec["name"],
        "description": tool_spec.get("description", ""),
        "parameters": convert_schema_to_gemini(params),
    }


def format_tool_for_anthropic(tool_spec: Dict[str, Any]) -> Dict[str, Any]:
    """Format tool specification for Anthropic input_schema."""
    return {
        "name": tool_spec["name"],
        "description": tool_spec.get("description", ""),
        "input_schema": tool_spec.get("parameters", {"type": "object", "properties": {}}),
    }


class BaseLLMProvider(abc.ABC):
    """Abstract base class for LLM streaming and completion providers."""

    @abc.abstractmethod
    def complete(
        self,
        system_prompt: str,
        user_message: str,
        tools: Optional[List[Dict[str, Any]]] = None,
        history: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Execute non-streaming completion."""
        raise NotImplementedError

    @abc.abstractmethod
    def stream_chat(
        self,
        system_prompt: str,
        user_message: str,
        tools: Optional[List[Dict[str, Any]]] = None,
        history: Optional[List[Dict[str, Any]]] = None,
    ) -> Generator[Dict[str, Any], None, None]:
        """Generate streaming SSE-compatible events."""
        raise NotImplementedError


def repair_mojibake(text: str) -> str:
    """Repair Latin-1 / Windows-1252 mojibake where UTF-8 bytes were misdecoded."""
    if not text or not isinstance(text, str):
        return text
    if "ð" in text or "â€" in text or "Ã" in text:
        try:
            return text.encode("latin1").decode("utf-8")
        except Exception:
            pass
    return text


class GeminiProvider(BaseLLMProvider):
    """
    Direct REST SSE & JSON provider for Google Gemini API (v1beta).
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout: int = 45,
    ):
        self.api_key = api_key if api_key is not None else getattr(settings, "GEMINI_API_KEY", "")
        chosen_model = model or getattr(settings, "ASSISTANT_MODEL", "gemini-3.6-flash") or "gemini-3.6-flash"
        if chosen_model in ("gemini-2.5-flash", "gemini-1.5-flash", "gemini-3.5-flash"):
            chosen_model = "gemini-3.6-flash"
        self.model = chosen_model
        self.timeout = timeout
        self.base_url = "https://generativelanguage.googleapis.com/v1beta"

    def _build_payload(
        self,
        system_prompt: str,
        user_message: str,
        tools: Optional[List[Dict[str, Any]]] = None,
        history: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        contents: List[Dict[str, Any]] = []

        if history:
            for item in history:
                if not isinstance(item, dict):
                    continue
                role = "user" if item.get("role") in ("user", "human") else "model"
                content = str(item.get("content", ""))
                if content:
                    contents.append({
                        "role": role,
                        "parts": [{"text": content}]
                    })

        contents.append({
            "role": "user",
            "parts": [{"text": user_message}]
        })

        payload: Dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 4096,
            }
        }

        if system_prompt:
            payload["systemInstruction"] = {
                "parts": [{"text": system_prompt}]
            }

        if tools:
            gemini_tools = [format_tool_for_gemini(t) for t in tools]
            payload["tools"] = [{"functionDeclarations": gemini_tools}]

        return payload

    def complete(
        self,
        system_prompt: str,
        user_message: str,
        tools: Optional[List[Dict[str, Any]]] = None,
        history: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        if not self.api_key:
            return {
                "text": "LLM API key is not configured.",
                "tool_calls": [],
                "usage": {},
            }

        url = f"{self.base_url}/models/{self.model}:generateContent?key={self.api_key}"
        payload = self._build_payload(system_prompt, user_message, tools, history)

        try:
            resp = requests.post(url, json=payload, timeout=self.timeout)
            resp.encoding = "utf-8"
            if resp.status_code != 200:
                # Attempt fallback model if 404 or unsupported
                if resp.status_code == 404 and self.model != "gemini-1.5-flash":
                    fallback_provider = GeminiProvider(api_key=self.api_key, model="gemini-1.5-flash")
                    return fallback_provider.complete(system_prompt, user_message, tools, history)
                logger.error("Gemini API error %d: %s", resp.status_code, resp.text)
                return {
                    "text": f"Error communicating with Gemini API ({resp.status_code}): {resp.text}",
                    "tool_calls": [],
                    "usage": {},
                }

            data = resp.json()
            candidates = data.get("candidates", [])
            text_parts = []
            tool_calls = []

            if candidates:
                content_obj = candidates[0].get("content") or {}
                parts = content_obj.get("parts", []) if isinstance(content_obj, dict) else []
                for part in parts:
                    if isinstance(part, dict):
                        if "text" in part:
                            text_parts.append(repair_mojibake(part["text"]))
                        if "functionCall" in part:
                            fc = part["functionCall"]
                            tool_calls.append({
                                "id": str(uuid.uuid4()),
                                "name": fc.get("name", ""),
                                "arguments": fc.get("args", {}),
                            })

            usage = data.get("usageMetadata", {})
            return {
                "text": "".join(text_parts),
                "tool_calls": tool_calls,
                "usage": {
                    "prompt_tokens": usage.get("promptTokenCount", 0),
                    "completion_tokens": usage.get("candidatesTokenCount", 0),
                    "total_tokens": usage.get("totalTokenCount", 0),
                },
            }
        except Exception as exc:
            logger.exception("Gemini complete exception: %s", exc)
            return {
                "text": f"Error: {str(exc)}",
                "tool_calls": [],
                "usage": {},
            }

    def stream_chat(
        self,
        system_prompt: str,
        user_message: str,
        tools: Optional[List[Dict[str, Any]]] = None,
        history: Optional[List[Dict[str, Any]]] = None,
    ) -> Generator[Dict[str, Any], None, None]:
        if not self.api_key:
            yield {"type": "text", "content": "LLM API key is not configured."}
            yield {"type": "done", "usage": {}}
            return

        url = f"{self.base_url}/models/{self.model}:streamGenerateContent?alt=sse&key={self.api_key}"
        payload = self._build_payload(system_prompt, user_message, tools, history)

        try:
            resp = requests.post(url, json=payload, stream=True, timeout=self.timeout)
            resp.encoding = "utf-8"
            if resp.status_code != 200:
                if resp.status_code == 404 and self.model != "gemini-1.5-flash":
                    fallback_provider = GeminiProvider(api_key=self.api_key, model="gemini-1.5-flash")
                    yield from fallback_provider.stream_chat(system_prompt, user_message, tools, history)
                    return
                err_msg = f"Gemini stream error ({resp.status_code}): {resp.text}"
                yield {"type": "error", "message": err_msg}
                yield {"type": "done", "usage": {}}
                return

            last_usage = {}
            for raw_line in resp.iter_lines():
                if not raw_line:
                    continue
                line = raw_line.decode("utf-8", errors="replace") if isinstance(raw_line, bytes) else raw_line
                if line.startswith("data: "):
                    data_str = line[6:].strip()
                    if not data_str:
                        continue
                    try:
                        chunk = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    if "usageMetadata" in chunk:
                        um = chunk["usageMetadata"]
                        last_usage = {
                            "prompt_tokens": um.get("promptTokenCount", 0),
                            "completion_tokens": um.get("candidatesTokenCount", 0),
                            "total_tokens": um.get("totalTokenCount", 0),
                        }

                    candidates = chunk.get("candidates", [])
                    if not candidates:
                        continue

                    content_obj = candidates[0].get("content") or {}
                    parts = content_obj.get("parts", []) if isinstance(content_obj, dict) else []
                    for part in parts:
                        if isinstance(part, dict):
                            if "text" in part and part["text"]:
                                yield {"type": "text", "content": repair_mojibake(part["text"])}
                            if "functionCall" in part:
                                fc = part["functionCall"]
                                yield {
                                    "type": "tool_call",
                                    "id": str(uuid.uuid4()),
                                    "name": fc.get("name", ""),
                                    "arguments": fc.get("args", {}),
                                }

            yield {"type": "done", "usage": last_usage}

        except Exception as exc:
            logger.exception("Gemini stream exception: %s", exc)
            yield {"type": "error", "message": str(exc)}
            yield {"type": "done", "usage": {}}


class AnthropicProvider(BaseLLMProvider):
    """
    Direct REST SSE & JSON provider for Anthropic Claude Messages API.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = "claude-3-5-sonnet-20241022",
        timeout: int = 30,
    ):
        self.api_key = api_key if api_key is not None else getattr(settings, "ANTHROPIC_API_KEY", "")
        self.model = model
        self.timeout = timeout
        self.base_url = "https://api.anthropic.com/v1/messages"

    def complete(
        self,
        system_prompt: str,
        user_message: str,
        tools: Optional[List[Dict[str, Any]]] = None,
        history: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        if not self.api_key:
            return {
                "text": "LLM API key is not configured.",
                "tool_calls": [],
                "usage": {},
            }

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

        messages: List[Dict[str, Any]] = []
        if history:
            for item in history:
                if not isinstance(item, dict):
                    continue
                role = "assistant" if item.get("role") in ("assistant", "model") else "user"
                content = str(item.get("content", ""))
                if content:
                    messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": user_message})

        payload: Dict[str, Any] = {
            "model": self.model,
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": messages,
        }

        if tools:
            payload["tools"] = [format_tool_for_anthropic(t) for t in tools]

        try:
            resp = requests.post(self.base_url, headers=headers, json=payload, timeout=self.timeout)
            resp.encoding = "utf-8"
            if resp.status_code != 200:
                return {
                    "text": f"Anthropic error ({resp.status_code}): {resp.text}",
                    "tool_calls": [],
                    "usage": {},
                }
            data = resp.json()
            text_parts = []
            tool_calls = []
            for block in data.get("content", []):
                if block.get("type") == "text":
                    text_parts.append(repair_mojibake(block.get("text", "")))
                elif block.get("type") == "tool_use":
                    tool_calls.append({
                        "id": block.get("id", str(uuid.uuid4())),
                        "name": block.get("name", ""),
                        "arguments": block.get("input", {}),
                    })

            usage = data.get("usage", {})
            return {
                "text": "".join(text_parts),
                "tool_calls": tool_calls,
                "usage": {
                    "prompt_tokens": usage.get("input_tokens", 0),
                    "completion_tokens": usage.get("output_tokens", 0),
                    "total_tokens": usage.get("input_tokens", 0) + usage.get("output_tokens", 0),
                },
            }
        except Exception as exc:
            return {"text": f"Error: {str(exc)}", "tool_calls": [], "usage": {}}

    def stream_chat(
        self,
        system_prompt: str,
        user_message: str,
        tools: Optional[List[Dict[str, Any]]] = None,
        history: Optional[List[Dict[str, Any]]] = None,
    ) -> Generator[Dict[str, Any], None, None]:
        if not self.api_key:
            yield {"type": "text", "content": "LLM API key is not configured."}
            yield {"type": "done", "usage": {}}
            return

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

        messages = []
        if history:
            for item in history:
                if not isinstance(item, dict):
                    continue
                role = "assistant" if item.get("role") in ("assistant", "model") else "user"
                content = str(item.get("content", ""))
                if content:
                    messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": user_message})

        payload = {
            "model": self.model,
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": messages,
            "stream": True,
        }
        if tools:
            payload["tools"] = [format_tool_for_anthropic(t) for t in tools]

        try:
            resp = requests.post(self.base_url, headers=headers, json=payload, stream=True, timeout=self.timeout)
            resp.encoding = "utf-8"
            if resp.status_code != 200:
                yield {"type": "error", "message": f"Anthropic stream error: {resp.text}"}
                yield {"type": "done", "usage": {}}
                return

            current_tool_call: Optional[Dict[str, Any]] = None
            json_accum = ""

            for raw_line in resp.iter_lines():
                if not raw_line:
                    continue
                line = raw_line.decode("utf-8", errors="replace") if isinstance(raw_line, bytes) else raw_line
                if not line.startswith("data: "):
                    continue
                data_str = line[6:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    event = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                event_type = event.get("type")
                if event_type == "content_block_start":
                    cb = event.get("content_block", {})
                    if cb.get("type") == "tool_use":
                        current_tool_call = {
                            "id": cb.get("id", str(uuid.uuid4())),
                            "name": cb.get("name", ""),
                        }
                        json_accum = ""
                elif event_type == "content_block_delta":
                    delta = event.get("delta", {})
                    if delta.get("type") == "text_delta":
                        yield {"type": "text", "content": delta.get("text", "")}
                    elif delta.get("type") == "input_json_delta":
                        json_accum += delta.get("partial_json", "")
                elif event_type == "content_block_stop":
                    if current_tool_call:
                        try:
                            parsed_args = json.loads(json_accum) if json_accum else {}
                        except json.JSONDecodeError:
                            parsed_args = {}
                        yield {
                            "type": "tool_call",
                            "id": current_tool_call["id"],
                            "name": current_tool_call["name"],
                            "arguments": parsed_args,
                        }
                        current_tool_call = None
                        json_accum = ""

            yield {"type": "done", "usage": {}}

        except Exception as exc:
            yield {"type": "error", "message": str(exc)}
            yield {"type": "done", "usage": {}}


class MockProvider(BaseLLMProvider):
    """
    Deterministic offline fallback provider for testing and unconfigured keys.
    """

    def complete(
        self,
        system_prompt: str,
        user_message: str,
        tools: Optional[List[Dict[str, Any]]] = None,
        history: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        msg_lower = user_message.lower()
        tool_calls = []

        # Intent detection
        if "stat" in msg_lower or "event" in msg_lower or "how many" in msg_lower:
            tool_calls.append({
                "id": "mock-tc-stat",
                "name": "get_statistics",
                "arguments": {},
            })
            text = "I will check the event log statistics for you."
        elif "variant" in msg_lower:
            tool_calls.append({
                "id": "mock-tc-var",
                "name": "find_variants",
                "arguments": {"extraction": "leading_1hop"},
            })
            text = "Extracting trace variants from the active log."
        elif "create" in msg_lower and "dashboard" in msg_lower:
            tool_calls.append({
                "id": "mock-tc-dash",
                "name": "create_dashboard",
                "arguments": {"name": "Process Overview Dashboard"},
            })
            text = "I can create a new dashboard for you."
        elif "navigate" in msg_lower:
            tool_calls.append({
                "id": "mock-tc-nav",
                "name": "navigate",
                "arguments": {"route": "/dashboard"},
            })
            text = "Navigating to dashboard."
        elif "highlight" in msg_lower or "tour" in msg_lower:
            tool_calls.append({
                "id": "mock-tc-high",
                "name": "highlight_element",
                "arguments": {
                    "tour_id": "nav-overview",
                    "label": "Click here to view overall process metrics.",
                },
            })
            text = "Highlighting the navigation overview item."
        else:
            text = f"Echo: {user_message}"

        return {
            "text": text,
            "tool_calls": tool_calls,
            "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
        }

    def stream_chat(
        self,
        system_prompt: str,
        user_message: str,
        tools: Optional[List[Dict[str, Any]]] = None,
        history: Optional[List[Dict[str, Any]]] = None,
    ) -> Generator[Dict[str, Any], None, None]:
        res = self.complete(system_prompt, user_message, tools, history)

        for tc in res.get("tool_calls", []):
            yield {
                "type": "tool_call",
                "id": tc["id"],
                "name": tc["name"],
                "arguments": tc["arguments"],
            }

        text = res.get("text", "")
        if text:
            # Yield in smaller chunks
            words = text.split(" ")
            for i, word in enumerate(words):
                chunk = word if i == 0 else " " + word
                yield {"type": "text", "content": chunk}

        yield {"type": "done", "usage": res.get("usage", {})}


def get_llm_provider(provider_name: Optional[str] = None) -> BaseLLMProvider:
    """Resolve active LLM provider based on settings or explicit provider choice."""
    gemini_key = getattr(settings, "GEMINI_API_KEY", "")
    anthropic_key = getattr(settings, "ANTHROPIC_API_KEY", "")

    if provider_name == "gemini" or (provider_name is None and gemini_key):
        return GeminiProvider(api_key=gemini_key)
    elif provider_name == "anthropic" or (provider_name is None and anthropic_key):
        return AnthropicProvider(api_key=anthropic_key)
    return MockProvider()


def complete(
    system_prompt: str,
    user_message: str,
    tools: Optional[List[Dict[str, Any]]] = None,
    history: Optional[List[Dict[str, Any]]] = None,
    provider_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Execute complete using configured or selected LLM provider."""
    provider = get_llm_provider(provider_name)
    return provider.complete(
        system_prompt=system_prompt,
        user_message=user_message,
        tools=tools,
        history=history,
    )


def stream_chat(
    system_prompt: str,
    user_message: str,
    tools: Optional[List[Dict[str, Any]]] = None,
    history: Optional[List[Dict[str, Any]]] = None,
    provider_name: Optional[str] = None,
) -> Generator[Dict[str, Any], None, None]:
    """Stream chat using configured or selected LLM provider."""
    provider = get_llm_provider(provider_name)
    yield from provider.stream_chat(
        system_prompt=system_prompt,
        user_message=user_message,
        tools=tools,
        history=history,
    )
