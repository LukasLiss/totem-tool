"""
Server-side conversation state for the assistant.

A conversation holds the full canonical transcript (including tool calls,
tool results and provider-native reasoning) so every turn continues where the
last one stopped. It is keyed by user and conversation id in the Django cache.

The transcript is append-only. When it grows past ``MAX_TRANSCRIPT_CHARS`` it
is condensed into a plain-text recap that starts a fresh transcript (no earlier
reasoning blocks are replayed after that), instead of editing old messages.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from django.core.cache import cache

CACHE_PREFIX = "assistant_conv:"
LOCK_PREFIX = "assistant_conv_lock:"
CANCEL_PREFIX = "assistant_conv_cancel:"
TTL_SECONDS = 24 * 3600
LOCK_SECONDS = 15 * 60
MAX_TRANSCRIPT_CHARS = 400_000  # fallback when a provider reports no token usage
# Condense once the last request sent this many input tokens (cached or not): every
# turn re-sends the whole transcript, so cost and latency grow with it. Matches the
# trigger Anthropic's server-side compaction uses by default.
COMPACT_AT_INPUT_TOKENS = 150_000
RECAP_CHARS = 24_000

_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def new_conversation_id() -> str:
    return f"conv_{uuid.uuid4().hex}"


def valid_conversation_id(value: Any) -> bool:
    return isinstance(value, str) and bool(_ID_RE.match(value))


@dataclass
class Conversation:
    id: str
    user_id: int
    mode: str
    messages: List[Dict[str, Any]] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    last_input_tokens: int = 0  # input tokens of the latest model request, as reported by the provider

    def _key(self) -> str:
        return f"{CACHE_PREFIX}{self.user_id}:{self.id}"


def load(user_id: int, conversation_id: str) -> Optional[Conversation]:
    data = cache.get(f"{CACHE_PREFIX}{user_id}:{conversation_id}")
    if not isinstance(data, dict):
        return None
    return Conversation(**data)


def load_or_create(user_id: int, conversation_id: Optional[str], mode: str) -> Conversation:
    if conversation_id and valid_conversation_id(conversation_id):
        conv = load(user_id, conversation_id)
        if conv is not None and conv.mode == mode:
            return conv
        if conv is None:
            return Conversation(id=conversation_id, user_id=user_id, mode=mode)
    return Conversation(id=new_conversation_id(), user_id=user_id, mode=mode)


def save(conv: Conversation) -> None:
    cache.set(conv._key(), conv.__dict__.copy(), timeout=TTL_SECONDS)


def delete(user_id: int, conversation_id: str) -> None:
    cache.delete(f"{CACHE_PREFIX}{user_id}:{conversation_id}")


def add_note(user_id: int, conversation_id: Optional[str], note: str) -> None:
    """Queue a system note (e.g. an approval outcome) for the model's next turn."""
    if not conversation_id:
        return
    conv = load(user_id, conversation_id)
    if conv is None:
        return
    conv.notes.append(note)
    save(conv)


def acquire_turn(user_id: int, conversation_id: str, wait_seconds: float = 0.0) -> bool:
    """Only one turn may run per conversation at a time.

    ``wait_seconds`` lets a new message wait for a turn that was just stopped:
    the stopped turn notices its cancel flag at the next event or tool and
    releases the lock within moments.
    """
    key = f"{LOCK_PREFIX}{user_id}:{conversation_id}"
    deadline = time.monotonic() + wait_seconds
    while True:
        if cache.add(key, 1, timeout=LOCK_SECONDS):
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.25)


def release_turn(user_id: int, conversation_id: str) -> None:
    cache.delete(f"{LOCK_PREFIX}{user_id}:{conversation_id}")


def request_cancel(user_id: int, conversation_id: str) -> None:
    """Ask the running turn of this conversation to stop.

    Needed because a closed browser connection does not reliably stop the
    server side: under ASGI (Django 4.2) the turn would keep calling the model
    until it finished on its own.
    """
    cache.set(f"{CANCEL_PREFIX}{user_id}:{conversation_id}", 1, timeout=LOCK_SECONDS)


def cancel_requested(user_id: int, conversation_id: str) -> bool:
    return bool(cache.get(f"{CANCEL_PREFIX}{user_id}:{conversation_id}"))


def clear_cancel(user_id: int, conversation_id: str) -> None:
    cache.delete(f"{CANCEL_PREFIX}{user_id}:{conversation_id}")


def transcript_size(messages: List[Dict[str, Any]]) -> int:
    return len(json.dumps(messages, default=str))


def needs_compaction(conv: "Conversation") -> bool:
    return conv.last_input_tokens > COMPACT_AT_INPUT_TOKENS or transcript_size(conv.messages) > MAX_TRANSCRIPT_CHARS


def recap(messages: List[Dict[str, Any]], limit: int = RECAP_CHARS) -> str:
    """Plain-text recap of a transcript: user/assistant text and one line per tool call."""
    lines: List[str] = []
    for msg in messages:
        for block in msg.get("content", []):
            kind = block.get("type")
            if kind == "text" and block.get("text"):
                text = block["text"]
                if msg["role"] == "user":
                    text = re.sub(r"<ui_context>.*?</ui_context>\s*", "", text, flags=re.S)
                text = text.strip()
                if len(text) > 1500:  # one long message must not crowd out the rest
                    text = text[:1500] + " …"
                lines.append(f"{msg['role'].upper()}: {text}")
            elif kind == "tool_use":
                lines.append(f"(assistant called {block.get('name')} {json.dumps(block.get('input'), default=str)[:200]})")
            elif kind == "tool_result":
                status = "error" if block.get("is_error") else "result"
                lines.append(f"({block.get('name') or 'tool'} {status}: {(block.get('content') or '')[:300]})")
    text = "\n".join(lines)
    if len(text) > limit:
        text = "…" + text[-limit:]
    return text
