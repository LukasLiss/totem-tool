"""LLM provider clients for the AI assistant.

All providers speak the same neutral message format so conversations can be
stored provider-agnostically on the frontend and replayed against any backend:

    {"role": "user", "content": "..."}
    {"role": "assistant", "content": "...", "tool_calls": [
        {"id": "...", "name": "...", "arguments": {...}}
    ]}
    {"role": "tool", "tool_call_id": "...", "name": "...", "content": "..."}

Tools are passed in the MCP-style neutral shape
``{"name", "description", "input_schema"}`` and converted to each provider's
wire format. All providers are called over plain HTTP so the desktop build
does not need any vendor SDKs.
"""

import json
import uuid

import requests

REQUEST_TIMEOUT = (10, 300)  # (connect, read) seconds — local models can be slow


class ProviderError(Exception):
    """Raised when an LLM provider request fails; message is user-facing."""


def _http_post(url, headers, payload):
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=REQUEST_TIMEOUT)
    except requests.exceptions.ConnectionError:
        raise ProviderError(f"Could not connect to {url}. Is the service running/reachable?")
    except requests.exceptions.Timeout:
        raise ProviderError("The AI provider took too long to respond.")
    if response.status_code >= 400:
        detail = response.text[:500]
        try:
            body = response.json()
            detail = (
                body.get("error", {}).get("message")
                or body.get("error")
                or detail
            )
            if not isinstance(detail, str):
                detail = json.dumps(detail)[:500]
        except (ValueError, AttributeError):
            pass
        raise ProviderError(f"AI provider returned HTTP {response.status_code}: {detail}")
    try:
        return response.json()
    except ValueError:
        raise ProviderError("AI provider returned an invalid (non-JSON) response.")


class OllamaProvider:
    """Local models via the Ollama chat API (`/api/chat`)."""

    def __init__(self, model, base_url):
        self.model = model
        self.base_url = (base_url or "http://localhost:11434").rstrip("/")

    def chat(self, system, messages, tools):
        converted = [{"role": "system", "content": system}]
        for msg in messages:
            if msg["role"] == "assistant":
                entry = {"role": "assistant", "content": msg.get("content") or ""}
                if msg.get("tool_calls"):
                    entry["tool_calls"] = [
                        {"function": {"name": call["name"], "arguments": call["arguments"]}}
                        for call in msg["tool_calls"]
                    ]
                converted.append(entry)
            elif msg["role"] == "tool":
                converted.append({"role": "tool", "content": msg.get("content") or ""})
            else:
                converted.append({"role": "user", "content": msg.get("content") or ""})

        payload = {
            "model": self.model,
            "messages": converted,
            "stream": False,
        }
        if tools:
            payload["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": tool["name"],
                        "description": tool["description"],
                        "parameters": tool["input_schema"],
                    },
                }
                for tool in tools
            ]

        data = _http_post(f"{self.base_url}/api/chat", {}, payload)
        message = data.get("message") or {}
        tool_calls = []
        for call in message.get("tool_calls") or []:
            function = call.get("function") or {}
            arguments = function.get("arguments") or {}
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except ValueError:
                    arguments = {}
            tool_calls.append(
                {
                    # Ollama does not return call ids; synthesize stable ones
                    "id": call.get("id") or f"call_{uuid.uuid4().hex[:12]}",
                    "name": function.get("name") or "",
                    "arguments": arguments,
                }
            )
        return {"content": message.get("content") or "", "tool_calls": tool_calls}


class AnthropicProvider:
    """Claude models via the Anthropic Messages API."""

    def __init__(self, model, api_key, base_url=None):
        self.model = model
        self.api_key = api_key
        self.base_url = (base_url or "https://api.anthropic.com").rstrip("/")

    def chat(self, system, messages, tools):
        if not self.api_key:
            raise ProviderError("No Anthropic API key configured. Add one in the chat settings.")

        converted = []
        for msg in messages:
            if msg["role"] == "assistant":
                blocks = []
                if msg.get("content"):
                    blocks.append({"type": "text", "text": msg["content"]})
                for call in msg.get("tool_calls") or []:
                    blocks.append(
                        {
                            "type": "tool_use",
                            "id": call["id"],
                            "name": call["name"],
                            "input": call["arguments"],
                        }
                    )
                if blocks:
                    converted.append({"role": "assistant", "content": blocks})
            elif msg["role"] == "tool":
                result_block = {
                    "type": "tool_result",
                    "tool_use_id": msg["tool_call_id"],
                    "content": msg.get("content") or "",
                }
                # Parallel tool results must land in a single user message
                if converted and converted[-1]["role"] == "user" and isinstance(
                    converted[-1]["content"], list
                ):
                    converted[-1]["content"].append(result_block)
                else:
                    converted.append({"role": "user", "content": [result_block]})
            else:
                converted.append(
                    {"role": "user", "content": [{"type": "text", "text": msg.get("content") or ""}]}
                )

        payload = {
            "model": self.model,
            "max_tokens": 8192,
            "system": system,
            "messages": converted,
        }
        if tools:
            payload["tools"] = [
                {
                    "name": tool["name"],
                    "description": tool["description"],
                    "input_schema": tool["input_schema"],
                }
                for tool in tools
            ]

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
        }
        data = _http_post(f"{self.base_url}/v1/messages", headers, payload)

        if data.get("stop_reason") == "refusal":
            return {
                "content": "The request was declined by the model's safety system.",
                "tool_calls": [],
            }

        text_parts = []
        tool_calls = []
        for block in data.get("content") or []:
            if block.get("type") == "text":
                text_parts.append(block.get("text") or "")
            elif block.get("type") == "tool_use":
                tool_calls.append(
                    {
                        "id": block["id"],
                        "name": block["name"],
                        "arguments": block.get("input") or {},
                    }
                )
        return {"content": "".join(text_parts), "tool_calls": tool_calls}


class OpenAIProvider:
    """OpenAI (ChatGPT) models via the Chat Completions API."""

    def __init__(self, model, api_key, base_url=None):
        self.model = model
        self.api_key = api_key
        self.base_url = (base_url or "https://api.openai.com").rstrip("/")

    def chat(self, system, messages, tools):
        if not self.api_key:
            raise ProviderError("No OpenAI API key configured. Add one in the chat settings.")

        converted = [{"role": "system", "content": system}]
        for msg in messages:
            if msg["role"] == "assistant":
                entry = {"role": "assistant", "content": msg.get("content") or None}
                if msg.get("tool_calls"):
                    entry["tool_calls"] = [
                        {
                            "id": call["id"],
                            "type": "function",
                            "function": {
                                "name": call["name"],
                                "arguments": json.dumps(call["arguments"]),
                            },
                        }
                        for call in msg["tool_calls"]
                    ]
                converted.append(entry)
            elif msg["role"] == "tool":
                converted.append(
                    {
                        "role": "tool",
                        "tool_call_id": msg["tool_call_id"],
                        "content": msg.get("content") or "",
                    }
                )
            else:
                converted.append({"role": "user", "content": msg.get("content") or ""})

        payload = {"model": self.model, "messages": converted}
        if tools:
            payload["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": tool["name"],
                        "description": tool["description"],
                        "parameters": tool["input_schema"],
                    },
                }
                for tool in tools
            ]

        headers = {"Authorization": f"Bearer {self.api_key}"}
        data = _http_post(f"{self.base_url}/v1/chat/completions", headers, payload)

        choices = data.get("choices") or []
        if not choices:
            raise ProviderError("OpenAI returned no completion choices.")
        message = choices[0].get("message") or {}
        tool_calls = []
        for call in message.get("tool_calls") or []:
            function = call.get("function") or {}
            try:
                arguments = json.loads(function.get("arguments") or "{}")
            except ValueError:
                arguments = {}
            tool_calls.append(
                {
                    "id": call.get("id") or f"call_{uuid.uuid4().hex[:12]}",
                    "name": function.get("name") or "",
                    "arguments": arguments,
                }
            )
        return {"content": message.get("content") or "", "tool_calls": tool_calls}


DEFAULT_MODELS = {
    "ollama": "llama3.1",
    "anthropic": "claude-opus-4-8",
    "openai": "gpt-4o",
}


def build_provider(provider_name, model, api_key, base_url):
    model = model or DEFAULT_MODELS.get(provider_name, "")
    if provider_name == "ollama":
        return OllamaProvider(model=model, base_url=base_url)
    if provider_name == "anthropic":
        return AnthropicProvider(model=model, api_key=api_key)
    if provider_name == "openai":
        return OpenAIProvider(model=model, api_key=api_key)
    raise ProviderError(f"Unknown AI provider '{provider_name}'. Use ollama, anthropic or openai.")
