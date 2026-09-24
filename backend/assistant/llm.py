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


def format_tool_for_openai(tool_spec: Dict[str, Any]) -> Dict[str, Any]:
    """Format tool specification for OpenAI chat completions functions/tools."""
    return {
        "type": "function",
        "function": {
            "name": tool_spec["name"],
            "description": tool_spec.get("description", ""),
            "parameters": tool_spec.get("parameters", {"type": "object", "properties": {}}),
        },
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
        self.model = model or getattr(settings, "ASSISTANT_MODEL", "gemini-3.8-flash") or "gemini-3.8-flash"
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
                "error_type": "key_error",
            }

        # Security Note: Google Gemini Generative Language REST API accepts authentication
        # via the 'x-goog-api-key' HTTP header or '?key=' query parameter.
        # We supply 'x-goog-api-key' in HTTP headers to safeguard user BYOK keys, and request-URL
        # logging must remain strictly disabled so keys are never exposed in access or proxy logs.
        url = f"{self.base_url}/models/{self.model}:generateContent?key={self.api_key}"
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": self.api_key,
        }
        payload = self._build_payload(system_prompt, user_message, tools, history)

        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
            resp.encoding = "utf-8"
            if resp.status_code != 200:
                # Attempt fallback model if 404 or unsupported
                if resp.status_code == 404 and self.model != "gemini-1.5-flash":
                    logger.info("Gemini model '%s' returned 404; falling back to gemini-1.5-flash", self.model)
                    fallback_provider = GeminiProvider(api_key=self.api_key, model="gemini-1.5-flash")
                    return fallback_provider.complete(system_prompt, user_message, tools, history)
                if resp.status_code == 429:
                    logger.warning("Gemini API error 429 quota exhausted; falling back to MockProvider.")
                    return MockProvider().complete(system_prompt, user_message, tools, history)
                logger.error("Gemini API error %d: %s", resp.status_code, resp.text)
                return {
                    "text": f"Error communicating with Gemini API ({resp.status_code}): {resp.text}",
                    "tool_calls": [],
                    "usage": {},
                    "error_type": "key_error" if resp.status_code in (400, 401, 403) else None,
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

        # Security Note: pass 'x-goog-api-key' in request headers; request URL logging is suppressed.
        url = f"{self.base_url}/models/{self.model}:streamGenerateContent?alt=sse&key={self.api_key}"
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": self.api_key,
        }
        payload = self._build_payload(system_prompt, user_message, tools, history)

        try:
            resp = requests.post(url, json=payload, headers=headers, stream=True, timeout=self.timeout)
            resp.encoding = "utf-8"
            if resp.status_code != 200:
                if resp.status_code == 404 and self.model != "gemini-1.5-flash":
                    logger.info("Gemini stream model '%s' returned 404; falling back to gemini-1.5-flash", self.model)
                    fallback_provider = GeminiProvider(api_key=self.api_key, model="gemini-1.5-flash")
                    yield from fallback_provider.stream_chat(system_prompt, user_message, tools, history)
                    return
                if resp.status_code == 429:
                    logger.warning("Gemini stream 429 quota exhausted; falling back to MockProvider.")
                    yield from MockProvider().stream_chat(system_prompt, user_message, tools, history)
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
        model: Optional[str] = None,
        timeout: int = 30,
    ):
        self.api_key = api_key if api_key is not None else getattr(settings, "ANTHROPIC_API_KEY", "")
        self.model = model or getattr(settings, "ANTHROPIC_MODEL", "claude-sonnet-5") or "claude-sonnet-5"
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
                "error_type": "key_error",
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
                    "error_type": "key_error" if resp.status_code in (401, 403) else None,
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


class OpenAIProvider(BaseLLMProvider):
    """
    Direct REST SSE & JSON provider for OpenAI Chat Completions API.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout: int = 45,
    ):
        self.api_key = api_key if api_key is not None else getattr(settings, "OPENAI_API_KEY", "")
        self.model = model or getattr(settings, "OPENAI_MODEL", "gpt-5.6-luna") or "gpt-5.6-luna"
        self.timeout = timeout
        self.base_url = "https://api.openai.com/v1/chat/completions"

    def _build_payload(
        self,
        system_prompt: str,
        user_message: str,
        tools: Optional[List[Dict[str, Any]]] = None,
        history: Optional[List[Dict[str, Any]]] = None,
        stream: bool = False,
    ) -> Dict[str, Any]:
        messages: List[Dict[str, Any]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

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
            "messages": messages,
            "temperature": 0.2,
            "stream": stream,
        }

        if tools:
            payload["tools"] = [format_tool_for_openai(t) for t in tools]

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
                "text": "OpenAI API key is missing. Please configure your API key.",
                "tool_calls": [],
                "usage": {},
                "error_type": "key_error",
            }

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = self._build_payload(system_prompt, user_message, tools, history, stream=False)

        try:
            resp = requests.post(self.base_url, headers=headers, json=payload, timeout=self.timeout)
            resp.encoding = "utf-8"
            if resp.status_code in (401, 403):
                return {
                    "text": f"OpenAI API key error ({resp.status_code}): Invalid key or quota exceeded.",
                    "tool_calls": [],
                    "usage": {},
                    "error_type": "key_error",
                }
            if resp.status_code != 200:
                return {
                    "text": f"OpenAI error ({resp.status_code}): {resp.text}",
                    "tool_calls": [],
                    "usage": {},
                }

            data = resp.json()
            choices = data.get("choices", [])
            text = ""
            tool_calls = []

            if choices:
                msg = choices[0].get("message", {})
                text = repair_mojibake(msg.get("content", "") or "")
                for tc in msg.get("tool_calls", []):
                    fn = tc.get("function", {})
                    fn_name = fn.get("name", "")
                    raw_args = fn.get("arguments", "{}")
                    try:
                        parsed_args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                    except json.JSONDecodeError:
                        parsed_args = {}
                    tool_calls.append({
                        "id": tc.get("id", str(uuid.uuid4())),
                        "name": fn_name,
                        "arguments": parsed_args,
                    })

            usage = data.get("usage", {})
            return {
                "text": text,
                "tool_calls": tool_calls,
                "usage": {
                    "prompt_tokens": usage.get("prompt_tokens", 0),
                    "completion_tokens": usage.get("completion_tokens", 0),
                    "total_tokens": usage.get("total_tokens", 0),
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
            yield {"type": "key_error", "provider": "openai", "message": "OpenAI API key is missing. Please configure your API key."}
            yield {"type": "done", "usage": {}}
            return

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = self._build_payload(system_prompt, user_message, tools, history, stream=True)

        try:
            resp = requests.post(self.base_url, headers=headers, json=payload, stream=True, timeout=self.timeout)
            resp.encoding = "utf-8"
            if resp.status_code in (401, 403):
                yield {"type": "key_error", "provider": "openai", "message": f"OpenAI API key error ({resp.status_code}): Invalid key or quota exceeded."}
                yield {"type": "done", "usage": {}}
                return
            if resp.status_code != 200:
                yield {"type": "error", "message": f"OpenAI stream error ({resp.status_code}): {resp.text}"}
                yield {"type": "done", "usage": {}}
                return

            accumulated_tools: Dict[int, Dict[str, Any]] = {}

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
                    chunk = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                choices = chunk.get("choices", [])
                if not choices:
                    continue

                choice = choices[0]
                delta = choice.get("delta", {})

                # Text delta
                text_chunk = delta.get("content")
                if text_chunk:
                    yield {"type": "text", "content": repair_mojibake(text_chunk)}

                # Tool calls delta
                tc_deltas = delta.get("tool_calls", [])
                for tcd in tc_deltas:
                    idx = tcd.get("index", 0)
                    if idx not in accumulated_tools:
                        accumulated_tools[idx] = {
                            "id": tcd.get("id", str(uuid.uuid4())),
                            "name": tcd.get("function", {}).get("name", ""),
                            "arguments": "",
                        }
                    else:
                        if tcd.get("id"):
                            accumulated_tools[idx]["id"] = tcd["id"]
                        if tcd.get("function", {}).get("name"):
                            accumulated_tools[idx]["name"] += tcd["function"]["name"]
                    if tcd.get("function", {}).get("arguments"):
                        accumulated_tools[idx]["arguments"] += tcd["function"]["arguments"]

                if choice.get("finish_reason") in ("tool_calls", "stop") and accumulated_tools:
                    for _, tc_info in sorted(accumulated_tools.items()):
                        try:
                            parsed_args = json.loads(tc_info["arguments"]) if tc_info["arguments"] else {}
                        except json.JSONDecodeError:
                            parsed_args = {}
                        yield {
                            "type": "tool_call",
                            "id": tc_info["id"],
                            "name": tc_info["name"],
                            "arguments": parsed_args,
                        }
                    accumulated_tools.clear()

            if accumulated_tools:
                for _, tc_info in sorted(accumulated_tools.items()):
                    try:
                        parsed_args = json.loads(tc_info["arguments"]) if tc_info["arguments"] else {}
                    except json.JSONDecodeError:
                        parsed_args = {}
                    yield {
                        "type": "tool_call",
                        "id": tc_info["id"],
                        "name": tc_info["name"],
                        "arguments": parsed_args,
                    }

            yield {"type": "done", "usage": {}}

        except Exception as exc:
            logger.exception("OpenAI stream exception: %s", exc)
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
        is_teach = "TEACH MODE ACTIVE" in (system_prompt or "")

        if is_teach:
            # 1. Procedural walkthrough: Create Dashboard (6-step tour sequence)
            if ("create" in msg_lower and "dashboard" in msg_lower) or ("guide" in msg_lower and "dashboard" in msg_lower):
                tool_calls.append({
                    "id": "mock-tc-high-dash",
                    "name": "highlight_element",
                    "arguments": {
                        "steps": [
                            {"tour_id": "nav-dashboard", "label": "Click Dashboards in the sidebar to open the dashboard dropdown menu"},
                            {"tour_id": "dashboard-add-btn", "label": "Click Add Dashboard in the dropdown to open the creation dialog"},
                            {"tour_id": "dashboard-name-input", "label": "Enter a name for your new dashboard in the dialog"},
                            {"tour_id": "dashboard-save-btn", "label": "Click Save changes to create the dashboard and open it"},
                            {"tour_id": "dashboard-add-card", "label": "Click the edit button in the top right to open the component catalog"},
                            {"tour_id": "dashboard-grid", "label": "Drag and drop process mining components from the side panel onto the grid to add components as you wish"},
                        ]
                    },
                })
                text = "I will guide you through creating a new dashboard step by step. Follow each highlighted step on your screen."

            # 2. Select / switch project or event log
            elif "select" in msg_lower or "switch" in msg_lower or ("log" in msg_lower and "where" in msg_lower):
                tool_calls.append({
                    "id": "mock-tc-high-proj",
                    "name": "highlight_element",
                    "arguments": {
                        "steps": [
                            {"tour_id": "project-switcher", "label": "Switch or select active event log database in the top left"},
                            {"tour_id": "nav-overview", "label": "View process metrics for selected log in Overview"},
                        ]
                    },
                })
                text = "Here is where you can select or switch your active project and event log in the top left."

            # 3. Conformance Checking
            elif "conformance" in msg_lower:
                if any(w in msg_lower for w in ["what is", "explain", "how does", "why"]):
                    text = (
                        "### Conformance Checking in TOTeM\n\n"
                        "Conformance checking compares an observed object-centric event log against a normative process model.\n\n"
                        "- **Model Alignments**: Maps recorded events to transitions in the model.\n"
                        "- **Deviations**: Identifies unexpected, skipped, or out-of-order executions.\n"
                        "- **Fitness Metric**: Quantifies the mathematical fraction of observed behavior permitted by the model."
                    )
                else:
                    tool_calls.append({
                        "id": "mock-tc-high-conf",
                        "name": "highlight_element",
                        "arguments": {
                            "steps": [
                                {"tour_id": "nav-conformance", "label": "Click Conformance in the sidebar"},
                                {"tour_id": "nav-analysis", "label": "Review model alignments and deviations in Analysis"},
                            ]
                        },
                    })
                    text = "Here is where to run and inspect conformance checking in the interface."

            # 4. Upload event logs
            elif "upload" in msg_lower:
                tool_calls.append({
                    "id": "mock-tc-high-upload",
                    "name": "highlight_element",
                    "arguments": {
                        "steps": [
                            {"tour_id": "upload-button", "label": "Click Upload in the sidebar to add new event log files"},
                            {"tour_id": "nav-overview", "label": "Inspect imported events in Overview"},
                        ]
                    },
                })
                text = "Click the Upload button in the sidebar to import new OCEL 2.0 or standard event logs."

            # 5. Discover process model
            elif "discover" in msg_lower or "process model" in msg_lower:
                tool_calls.append({
                    "id": "mock-tc-high-disc",
                    "name": "highlight_element",
                    "arguments": {
                        "steps": [
                            {"tour_id": "nav-analysis", "label": "Navigate to Analysis in the sidebar"},
                            {"tour_id": "nav-overview", "label": "Inspect global process graph and models"},
                        ]
                    },
                })
                text = "Here is how to discover and visualize process models from your event log."

            # 6. Conceptual: OCPM
            elif "ocpm" in msg_lower or "object-centric" in msg_lower:
                text = (
                    "### Object-Centric Process Mining (OCPM)\n\n"
                    "Traditional process mining flattens data to a single case identifier, which introduces convergence and divergence distortions. "
                    "**OCPM** models multiple interacting object types (like Orders, Items, Deliveries, and Invoices) simultaneously in their natural state, "
                    "enabling realistic end-to-end multi-entity analysis."
                )

            # 7. Conceptual: Variants
            elif "variant" in msg_lower:
                text = (
                    "### Process Variants\n\n"
                    "A process variant represents a distinct sequence of activities executed from case start to completion. "
                    "Analyzing trace frequency distributions reveals the most common standard operating paths versus rare deviations and anomalies."
                )

            # 8. Generic / tour request
            elif "tour" in msg_lower or "highlight" in msg_lower:
                tool_calls.append({
                    "id": "mock-tc-high-generic",
                    "name": "highlight_element",
                    "arguments": {
                        "tour_id": "nav-overview",
                        "label": "Click here to inspect overall process metrics.",
                    },
                })
                text = "Highlighting the Overview section for you."

            else:
                text = f"As your Teach Mode guide, I am ready to help you navigate and master TOTeM. You asked: '{user_message}'."

        else:
            # ACT MODE ACTIVE
            if "create" in msg_lower and "dashboard" in msg_lower:
                tool_calls.append({
                    "id": "mock-tc-dash",
                    "name": "create_dashboard",
                    "arguments": {
                        "name": "Process Overview Dashboard",
                        "layout": [
                            {"component_name": "LogStatisticsComponent", "x": 0, "y": 0, "w": 12, "h": 2},
                            {"component_name": "VariantsComponent", "x": 0, "y": 2, "w": 6, "h": 6},
                            {"component_name": "OCDottedChartComponent", "x": 6, "y": 2, "w": 6, "h": 6},
                            {"component_name": "NewOCDFGComponent", "x": 0, "y": 8, "w": 6, "h": 6},
                            {"component_name": "OCCNComponent", "x": 6, "y": 8, "w": 6, "h": 6},
                        ],
                    },
                })
                text = "Creating a new process overview dashboard with 5 essential process mining components."

            elif "variant" in msg_lower:
                tool_calls.append({
                    "id": "mock-tc-var",
                    "name": "find_variants",
                    "arguments": {"extraction": "leading_1hop", "top_k": 5},
                })
                text = "Extracting top process variants from the active event log."

            elif "dotted chart" in msg_lower or "throughput" in msg_lower:
                tool_calls.append({
                    "id": "mock-tc-view",
                    "name": "set_view_mode",
                    "arguments": {"mode": "analysis", "component": "dottedChart"},
                })
                tool_calls.append({
                    "id": "mock-tc-chart",
                    "name": "get_oc_dotted_chart",
                    "arguments": {},
                })
                text = "Opening the OC Dotted Chart analysis view to inspect time-series event throughput."

            elif "occn" in msg_lower or "causal" in msg_lower:
                tool_calls.append({
                    "id": "mock-tc-occn",
                    "name": "discover_occn",
                    "arguments": {},
                })
                text = "Discovering the Object-Centric Causal Net (OCCN) for this log."

            elif "stat" in msg_lower or "metric" in msg_lower or "event" in msg_lower or "how many" in msg_lower or "bottleneck" in msg_lower or "duration" in msg_lower or "object type" in msg_lower:
                tool_calls.append({
                    "id": "mock-tc-stat",
                    "name": "get_statistics",
                    "arguments": {},
                })
                text = "Querying live metrics, activity frequencies, and case statistics for the active log."

            elif "navigate" in msg_lower:
                tool_calls.append({
                    "id": "mock-tc-nav",
                    "name": "navigate",
                    "arguments": {"route": "/dashboard"},
                })
                text = "Navigating to dashboard."

            else:
                text = f"Executing Act Mode command: '{user_message}'. The process mining copilot is active."

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
            words = text.split(" ")
            for i, word in enumerate(words):
                chunk = word if i == 0 else " " + word
                yield {"type": "text", "content": chunk}

        yield {"type": "done", "usage": res.get("usage", {})}


def get_llm_provider(
    provider_name: Optional[str] = None,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
) -> BaseLLMProvider:
    """Resolve active LLM provider based on explicit choice, supplied key, or settings."""
    p_name = (provider_name or "").strip().lower()
    key = (api_key or "").strip()

    if p_name == "mock":
        return MockProvider()

    # Auto-detect provider if missing but key supplied
    if not p_name and key:
        if key.startswith("AIza"):
            p_name = "gemini"
        elif key.startswith("sk-ant-"):
            p_name = "anthropic"
        elif key.startswith("sk-"):
            p_name = "openai"

    if p_name == "gemini":
        resolved_key = key or getattr(settings, "GEMINI_API_KEY", "")
        return GeminiProvider(api_key=resolved_key, model=model)
    elif p_name == "openai":
        resolved_key = key or getattr(settings, "OPENAI_API_KEY", "")
        return OpenAIProvider(api_key=resolved_key, model=model)
    elif p_name == "anthropic":
        resolved_key = key or getattr(settings, "ANTHROPIC_API_KEY", "")
        return AnthropicProvider(api_key=resolved_key, model=model)
    elif p_name and p_name not in ("gemini", "openai", "anthropic"):
        return MockProvider()

    # Fallback to configured settings in environment
    if getattr(settings, "GEMINI_API_KEY", ""):
        return GeminiProvider(api_key=settings.GEMINI_API_KEY, model=model)
    elif getattr(settings, "OPENAI_API_KEY", ""):
        return OpenAIProvider(api_key=settings.OPENAI_API_KEY, model=model)
    elif getattr(settings, "ANTHROPIC_API_KEY", ""):
        return AnthropicProvider(api_key=settings.ANTHROPIC_API_KEY, model=model)

    return MockProvider()


def validate_provider_key(provider: str, api_key: str) -> Dict[str, Any]:
    """
    Lightweight probe to test whether a given API key is valid for a provider.
    Returns {'valid': bool, 'provider': str, 'message': str, 'error': Optional[str]}
    """
    clean_provider = (provider or "").strip().lower()
    clean_key = (api_key or "").strip()

    if not clean_key:
        return {
            "valid": False,
            "provider": clean_provider or "unknown",
            "error": "API key cannot be empty.",
        }

    # Auto-detect provider if missing
    if not clean_provider:
        if clean_key.startswith("AIza"):
            clean_provider = "gemini"
        elif clean_key.startswith("sk-ant-"):
            clean_provider = "anthropic"
        elif clean_key.startswith("sk-"):
            clean_provider = "openai"
        else:
            clean_provider = "gemini"

    if clean_provider == "mock":
        return {
            "valid": True,
            "provider": "mock",
            "message": "Offline Mock provider verified.",
        }

    try:
        if clean_provider == "gemini":
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={clean_key}"
            resp = requests.get(url, timeout=10)
            if resp.status_code == 200:
                return {
                    "valid": True,
                    "provider": "gemini",
                    "message": "Google Gemini API key verified successfully.",
                }
            err_msg = "Invalid Google Gemini API key or quota exceeded."
            try:
                data = resp.json()
                if "error" in data and "message" in data["error"]:
                    err_msg = data["error"]["message"]
            except Exception:
                pass
            return {"valid": False, "provider": "gemini", "error": err_msg}

        elif clean_provider == "openai":
            url = "https://api.openai.com/v1/models"
            resp = requests.get(url, headers={"Authorization": f"Bearer {clean_key}"}, timeout=10)
            if resp.status_code == 200:
                return {
                    "valid": True,
                    "provider": "openai",
                    "message": "OpenAI API key verified successfully.",
                }
            err_msg = "Invalid OpenAI API key."
            try:
                data = resp.json()
                if "error" in data and "message" in data["error"]:
                    err_msg = data["error"]["message"]
            except Exception:
                pass
            return {"valid": False, "provider": "openai", "error": err_msg}

        elif clean_provider == "anthropic":
            # Use the lightweight /v1/models list endpoint — no inference, instant auth check
            url = "https://api.anthropic.com/v1/models"
            headers = {
                "x-api-key": clean_key,
                "anthropic-version": "2023-06-01",
            }
            resp = requests.get(url, headers=headers, timeout=8)
            if resp.status_code == 200:
                return {
                    "valid": True,
                    "provider": "anthropic",
                    "message": "Anthropic Claude API key verified successfully.",
                }
            err_msg = "Invalid Anthropic API key."
            try:
                data = resp.json()
                err_detail = data.get("error", {})
                if isinstance(err_detail, dict) and err_detail.get("message"):
                    err_msg = err_detail["message"]
                elif isinstance(err_detail, str):
                    err_msg = err_detail
            except Exception:
                pass
            return {"valid": False, "provider": "anthropic", "error": err_msg}

        else:
            return {
                "valid": False,
                "provider": clean_provider,
                "error": f"Unsupported provider: '{clean_provider}'. Supported: gemini, openai, anthropic.",
            }

    except Exception as exc:
        return {
            "valid": False,
            "provider": clean_provider,
            "error": f"Network/Connection error validating API key: {str(exc)}",
        }


def complete(
    system_prompt: str,
    user_message: str,
    tools: Optional[List[Dict[str, Any]]] = None,
    history: Optional[List[Dict[str, Any]]] = None,
    provider_name: Optional[str] = None,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Execute complete using configured or selected LLM provider."""
    provider = get_llm_provider(provider_name=provider_name, api_key=api_key)
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
    api_key: Optional[str] = None,
) -> Generator[Dict[str, Any], None, None]:
    """Stream chat using configured or selected LLM provider."""
    provider = get_llm_provider(provider_name=provider_name, api_key=api_key)
    yield from provider.stream_chat(
        system_prompt=system_prompt,
        user_message=user_message,
        tools=tools,
        history=history,
    )

