"""
Thread-safe and Async-safe Session & Channel Registry for Totem Live-Wire Agent Bus.

Tracks active WebSocket connections mapped by session ID and user ID, stores cached
UI states, and provides both async and sync dispatch methods to send commands to targeted
clients, sessions, users, or broadcast to all active connections.
"""

import threading
import time
import uuid
import logging
from typing import Dict, Set, List, Optional, Any
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

logger = logging.getLogger(__name__)


class SessionRegistry:
    """
    In-memory registry managing mapping between users, frontend session IDs,
    and active Django Channels channel names.
    """

    def __init__(self):
        self._lock = threading.RLock()
        self._sessions: Dict[str, Set[str]] = {}
        self._users: Dict[int, Set[str]] = {}
        self._channel_meta: Dict[str, Dict[str, Any]] = {}
        self._ui_states: Dict[str, Dict[str, Any]] = {}

    def register_session(
        self,
        session_id: str,
        channel_name: str,
        user_id: Optional[int] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Register a WebSocket channel name to a session ID and optional user ID.
        """
        with self._lock:
            if session_id not in self._sessions:
                self._sessions[session_id] = set()
            self._sessions[session_id].add(channel_name)

            if user_id is not None:
                if user_id not in self._users:
                    self._users[user_id] = set()
                self._users[user_id].add(channel_name)

            meta = {
                "session_id": session_id,
                "user_id": user_id,
                "connected_at": time.time(),
            }
            if metadata:
                meta.update(metadata)
            self._channel_meta[channel_name] = meta

    def register_channel(
        self,
        channel_name: str,
        user_id: Optional[int] = None,
        session_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Alias for register_session supporting variable argument ordering.
        """
        sess_id = session_id or f"sess_{uuid.uuid4().hex[:12]}"
        self.register_session(sess_id, channel_name, user_id=user_id, metadata=metadata)

    def unregister_session(self, session_id: str, channel_name: str) -> None:
        """
        Remove a specific channel from a session.
        """
        with self._lock:
            if session_id in self._sessions:
                self._sessions[session_id].discard(channel_name)
                if not self._sessions[session_id]:
                    del self._sessions[session_id]
            if channel_name in self._channel_meta:
                meta = self._channel_meta[channel_name]
                user_id = meta.get("user_id")
                if user_id is not None and user_id in self._users:
                    self._users[user_id].discard(channel_name)
                    if not self._users[user_id]:
                        del self._users[user_id]
                del self._channel_meta[channel_name]

    def unregister_channel(self, channel_name: str) -> None:
        """
        Clean up all references to a disconnected channel name.
        """
        with self._lock:
            if channel_name in self._channel_meta:
                meta = self._channel_meta.pop(channel_name)
                session_id = meta.get("session_id")
                user_id = meta.get("user_id")

                if session_id and session_id in self._sessions:
                    self._sessions[session_id].discard(channel_name)
                    if not self._sessions[session_id]:
                        del self._sessions[session_id]

                if user_id is not None and user_id in self._users:
                    self._users[user_id].discard(channel_name)
                    if not self._users[user_id]:
                        del self._users[user_id]
            else:
                # Fallback search if metadata missing
                for sid in list(self._sessions.keys()):
                    self._sessions[sid].discard(channel_name)
                    if not self._sessions[sid]:
                        del self._sessions[sid]
                for uid in list(self._users.keys()):
                    self._users[uid].discard(channel_name)
                    if not self._users[uid]:
                        del self._users[uid]

    def get_channels_for_session(self, session_id: str) -> List[str]:
        """
        Retrieve all active channel names associated with a session ID.
        """
        with self._lock:
            return list(self._sessions.get(session_id, []))

    def get_session_channels(self, session_id: str) -> List[str]:
        """Alias for get_channels_for_session."""
        return self.get_channels_for_session(session_id)

    def get_channels_for_user(self, user_id: int) -> List[str]:
        """
        Retrieve all active channel names associated with a user ID.
        """
        with self._lock:
            return list(self._users.get(user_id, []))

    def get_user_channels(self, user_id: int) -> List[str]:
        """Alias for get_channels_for_user."""
        return self.get_channels_for_user(user_id)

    def get_active_sessions(self) -> List[str]:
        """
        Return a list of all active session IDs with at least one active connection.
        """
        with self._lock:
            return [sid for sid, chs in self._sessions.items() if len(chs) > 0]

    def get_active_users(self) -> List[int]:
        """
        Return a list of all active user IDs with at least one active connection.
        """
        with self._lock:
            return [uid for uid, chs in self._users.items() if len(chs) > 0]

    def set_ui_state(self, session_id: str, state: Dict[str, Any]) -> None:
        """
        Cache the latest reported UI state for a session.
        """
        with self._lock:
            self._ui_states[session_id] = state

    def get_ui_state(self, session_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve cached UI state for a session.
        """
        with self._lock:
            return self._ui_states.get(session_id)

    async def send_command_to_session(
        self,
        session_id: str,
        action: str,
        parameters: Optional[Dict[str, Any]] = None,
        correlation_id: Optional[str] = None,
        channel_layer=None,
    ) -> bool:
        """
        Dispatch a live-wire command to all channels in a specific session group.
        """
        if not session_id:
            return False
        channels = self.get_channels_for_session(session_id)
        if not channels:
            logger.debug("No active channels found for session %s", session_id)
            return False

        layer = channel_layer or get_channel_layer()
        if not layer:
            return False

        corr_id = correlation_id or str(uuid.uuid4())
        await layer.group_send(
            f"session_{session_id}",
            {
                "type": "agent_command",
                "action": action,
                "parameters": parameters or {},
                "correlation_id": corr_id,
            },
        )
        return True

    def send_command_to_session_sync(
        self,
        session_id: str,
        action: str,
        parameters: Optional[Dict[str, Any]] = None,
        correlation_id: Optional[str] = None,
    ) -> bool:
        """
        Synchronous wrapper for send_command_to_session.
        """
        try:
            return async_to_sync(self.send_command_to_session)(
                session_id=session_id,
                action=action,
                parameters=parameters,
                correlation_id=correlation_id,
            )
        except Exception as exc:
            logger.error("Failed to sync dispatch command to session %s: %s", session_id, exc)
            return False

    async def send_command_to_user(
        self,
        user_id: int,
        action: str,
        parameters: Optional[Dict[str, Any]] = None,
        correlation_id: Optional[str] = None,
        channel_layer=None,
    ) -> bool:
        """
        Dispatch a live-wire command to all channels belonging to an authenticated user.
        """
        if user_id is None:
            return False
        channels = self.get_channels_for_user(user_id)
        if not channels:
            logger.debug("No active channels found for user %s", user_id)
            return False

        layer = channel_layer or get_channel_layer()
        if not layer:
            return False

        corr_id = correlation_id or str(uuid.uuid4())
        await layer.group_send(
            f"user_{user_id}",
            {
                "type": "agent_command",
                "action": action,
                "parameters": parameters or {},
                "correlation_id": corr_id,
            },
        )
        return True

    def send_command_to_user_sync(
        self,
        user_id: int,
        action: str,
        parameters: Optional[Dict[str, Any]] = None,
        correlation_id: Optional[str] = None,
    ) -> bool:
        """
        Synchronous wrapper for send_command_to_user.
        """
        try:
            return async_to_sync(self.send_command_to_user)(
                user_id=user_id,
                action=action,
                parameters=parameters,
                correlation_id=correlation_id,
            )
        except Exception as exc:
            logger.error("Failed to sync dispatch command to user %s: %s", user_id, exc)
            return False

    async def broadcast_command(
        self,
        action: str,
        parameters: Optional[Dict[str, Any]] = None,
        correlation_id: Optional[str] = None,
        channel_layer=None,
    ) -> bool:
        """
        Broadcast a command to all connected clients on the agent_broadcast channel group.
        """
        layer = channel_layer or get_channel_layer()
        if not layer:
            return False

        corr_id = correlation_id or str(uuid.uuid4())
        await layer.group_send(
            "agent_broadcast",
            {
                "type": "agent_command",
                "action": action,
                "parameters": parameters or {},
                "correlation_id": corr_id,
            },
        )
        return True

    def broadcast_command_sync(
        self,
        action: str,
        parameters: Optional[Dict[str, Any]] = None,
        correlation_id: Optional[str] = None,
    ) -> bool:
        """
        Synchronous wrapper for broadcast_command.
        """
        try:
            return async_to_sync(self.broadcast_command)(
                action=action,
                parameters=parameters,
                correlation_id=correlation_id,
            )
        except Exception as exc:
            logger.error("Failed to sync broadcast command: %s", exc)
            return False

    def clear(self) -> None:
        """
        Clear all sessions, users, metadata, and cached UI states (used in test teardowns).
        """
        with self._lock:
            self._sessions.clear()
            self._users.clear()
            self._channel_meta.clear()
            self._ui_states.clear()


# Global Singleton instance
session_registry = SessionRegistry()


def get_session_registry() -> SessionRegistry:
    """Return global session registry instance."""
    return session_registry
