"""
Global in-memory session manager.

Maps user_id to the active WebSocket consumer instance so the assistant
brain can push REQUIRES_FRONTEND tool results to the client without
storing state in the database.
"""

import threading


class _SessionRegistry:
    def __init__(self):
        self._lock = threading.Lock()
        self._sessions: dict[int, object] = {}

    def register(self, user_id: int, consumer) -> None:
        with self._lock:
            self._sessions[user_id] = consumer

    def unregister(self, user_id: int) -> None:
        with self._lock:
            self._sessions.pop(user_id, None)

    def get_consumer(self, user_id: int):
        with self._lock:
            return self._sessions.get(user_id)

    def is_online(self, user_id: int) -> bool:
        with self._lock:
            return user_id in self._sessions


session_registry = _SessionRegistry()
