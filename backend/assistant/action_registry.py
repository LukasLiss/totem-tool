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

# In-memory fallback / storage for local test isolation
_memory_store: Dict[str, Dict[str, Any]] = {}


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
    record = {
        "id": aid,
        "user_id": user_id,
        "tool_name": tool_name,
        "arguments": arguments if isinstance(arguments, dict) else {},
        "description": description,
        "status": "pending",
        "created_at": time.time(),
        "context": context if isinstance(context, dict) else {},
    }

    _memory_store[aid] = record
    try:
        cache.set(f"{CACHE_PREFIX}{aid}", record, timeout=ttl)
    except Exception:
        pass

    return aid


def get_action(action_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve an action record by ID."""
    if not action_id:
        return None

    # Check cache first
    try:
        cached = cache.get(f"{CACHE_PREFIX}{action_id}")
        if cached and isinstance(cached, dict):
            return cached
    except Exception:
        pass

    return _memory_store.get(action_id)


def update_action_status(action_id: str, status: str) -> bool:
    """Update status of an action ('pending', 'executed', 'cancelled')."""
    record = get_action(action_id)
    if not record:
        return False

    record["status"] = status
    _memory_store[action_id] = record

    try:
        cache.set(f"{CACHE_PREFIX}{action_id}", record, timeout=DEFAULT_TTL)
    except Exception:
        pass

    return True


def cancel_action(action_id: str, user_id: Optional[int] = None) -> bool:
    """Cancel a pending action, verifying user ownership if user_id is provided."""
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
