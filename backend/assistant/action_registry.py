"""
Pending actions: data changes the assistant proposed and the user must approve.

A record is bound to the user who received the proposal and to the
conversation it came from. Status moves pending -> executing -> executed /
failed, or pending -> cancelled; ``claim`` makes the pending -> executing step
atomic so a double click or a replay cannot run a change twice.
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any, Dict, Optional

from django.core.cache import cache

CACHE_PREFIX = "assistant_action:"
DEFAULT_TTL = 30 * 60

_lock = threading.Lock()


def _key(action_id: str) -> str:
    return f"{CACHE_PREFIX}{action_id}"


def register_action(
    *,
    user_id: int,
    conversation_id: Optional[str],
    tool_name: str,
    arguments: Dict[str, Any],
    description: str,
    tool_context: Dict[str, Any],
    ttl: int = DEFAULT_TTL,
) -> str:
    action_id = f"act_{uuid.uuid4().hex}"
    now = time.time()
    record = {
        "id": action_id,
        "user_id": user_id,
        "conversation_id": conversation_id,
        "tool_name": tool_name,
        "arguments": arguments,
        "description": description,
        "tool_context": tool_context,
        "status": "pending",
        "created_at": now,
        "expires_at": now + ttl,
    }
    cache.set(_key(action_id), record, timeout=ttl)
    return action_id


def get_action(action_id: str) -> Optional[Dict[str, Any]]:
    if not isinstance(action_id, str) or not action_id:
        return None
    record = cache.get(_key(action_id))
    return record if isinstance(record, dict) else None


def _store(record: Dict[str, Any]) -> None:
    remaining = int(record.get("expires_at", time.time()) - time.time())
    cache.set(_key(record["id"]), record, timeout=max(remaining, 60))


def claim(action_id: str, user_id: int, new_status: str) -> Dict[str, Any]:
    """Atomically move a pending action owned by ``user_id`` to ``new_status``.

    Returns ``{"ok": True, "record": ...}`` or ``{"ok": False, "reason": ..., "record": ...}``
    with reason one of not_found, forbidden, not_pending.
    """
    with _lock:
        record = get_action(action_id)
        if record is None:
            return {"ok": False, "reason": "not_found", "record": None}
        if record.get("user_id") != user_id:
            return {"ok": False, "reason": "forbidden", "record": None}
        if record.get("status") != "pending":
            return {"ok": False, "reason": "not_pending", "record": record}
        record["status"] = new_status
        _store(record)
        return {"ok": True, "record": record}


def finish(record: Dict[str, Any], status: str, result: Any) -> None:
    with _lock:
        record["status"] = status
        record["result"] = result
        _store(record)
