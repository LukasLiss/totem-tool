"""
Action Registry for managing pending mutating and frontend actions.
Stores pending actions in Django cache/memory with TTL for user confirmation.
"""

import time
import uuid
from typing import Any, Dict, Optional

from django.core.cache import cache

CACHE_PREFIX = "assistant_action:"
DEFAULT_TTL = 600  # 10 minutes
MAX_MEMORY_ENTRIES = 500

# In-memory fallback / storage for local test isolation with TTL and LRU bounding
_memory_store: Dict[str, Dict[str, Any]] = {}


def _prune_expired(now: Optional[float] = None) -> None:
    """Evict expired entries and cap in-memory fallback store to prevent unbounded growth."""
    current_time = now if now is not None else time.time()
    expired_keys = [
        aid for aid, rec in _memory_store.items()
        if rec.get("expires_at") is not None and rec["expires_at"] <= current_time
    ]
    for aid in expired_keys:
        _memory_store.pop(aid, None)

    if len(_memory_store) > MAX_MEMORY_ENTRIES:
        excess = len(_memory_store) - MAX_MEMORY_ENTRIES
        oldest_keys = sorted(
            _memory_store.keys(),
            key=lambda k: _memory_store[k].get("created_at", 0)
        )[:excess]
        for aid in oldest_keys:
            _memory_store.pop(aid, None)


def register_action(
    user_id: Optional[int],
    tool_name: str,
    arguments: Dict[str, Any],
    description: str = "",
    context: Optional[Dict[str, Any]] = None,
    action_id: Optional[str] = None,
    ttl: int = DEFAULT_TTL,
) -> str:
    """
    Register a pending mutating or frontend action requiring confirmation.
    
    Returns:
        action_id (str): UUID string identifying the pending action.
    """
    aid = action_id or str(uuid.uuid4())
    now = time.time()
    record = {
        "id": aid,
        "user_id": user_id,
        "tool_name": tool_name,
        "arguments": arguments if isinstance(arguments, dict) else {},
        "description": description,
        "status": "pending",
        "created_at": now,
        "expires_at": now + ttl,
        "context": context if isinstance(context, dict) else {},
    }

    _prune_expired(now)
    _memory_store[aid] = record
    try:
        cache.set(f"{CACHE_PREFIX}{aid}", record, timeout=ttl)
    except Exception:
        pass

    return aid


def get_action(action_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve an action record by ID, verifying TTL expiration."""
    if not action_id or not isinstance(action_id, str):
        return None

    now = time.time()

    # Check cache first
    try:
        cached = cache.get(f"{CACHE_PREFIX}{action_id}")
        if cached and isinstance(cached, dict):
            if cached.get("expires_at") is not None and now > cached["expires_at"]:
                cache.delete(f"{CACHE_PREFIX}{action_id}")
            else:
                return cached
    except Exception:
        pass

    record = _memory_store.get(action_id)
    if record and record.get("expires_at") is not None:
        if now > record["expires_at"]:
            _memory_store.pop(action_id, None)
            return None

    return record


def update_action_status(
    action_id: str,
    status: str,
    result: Optional[Any] = None,
) -> bool:
    """Update status of an action ('pending', 'executed', 'cancelled') and optionally cache result."""
    if not action_id or not isinstance(action_id, str):
        return False

    record = get_action(action_id)
    if not record:
        return False

    record["status"] = status
    if result is not None:
        record["result"] = result

    _memory_store[action_id] = record

    # Calculate remaining TTL if possible
    remaining_ttl = DEFAULT_TTL
    if record.get("expires_at") is not None:
        remaining = int(record["expires_at"] - time.time())
        if remaining > 0:
            remaining_ttl = remaining

    try:
        cache.set(f"{CACHE_PREFIX}{action_id}", record, timeout=remaining_ttl)
    except Exception:
        pass

    return True


def cancel_action(action_id: str, user_id: Optional[int] = None) -> bool:
    """Cancel a pending action, verifying user ownership if user_id is provided."""
    if not action_id or not isinstance(action_id, str):
        return False

    record = get_action(action_id)
    if not record:
        return False

    if user_id is not None and record.get("user_id") is not None:
        if record["user_id"] != user_id:
            return False

    return update_action_status(action_id, "cancelled")


def clear_actions() -> None:
    """Clear all pending actions (primarily for testing)."""
    global _memory_store
    _memory_store.clear()
    try:
        cache.clear()
    except Exception:
        pass
