"""
Django Channels WebSocket Consumer for bidirectional agent live-wire communication.
"""

from urllib.parse import parse_qs
import re
import uuid
import logging
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from .registry import session_registry

logger = logging.getLogger(__name__)

_SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class AgentConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket consumer for /ws/agent/
    Manages live bidirectional command bus, channel groups, and client UI state.
    """

    async def connect(self):
        self.user = self.scope.get("user")
        self.groups_joined = []
        if not (self.user and self.user.is_authenticated):
            # The bus can drive a user's UI: never open it to anonymous clients.
            await self.close(code=4401)
            return

        raw_session = self.scope.get("session_id")
        if not raw_session:
            query_params = parse_qs(self.scope.get("query_string", b"").decode("utf-8"))
            raw_session = (query_params.get("session_id") or query_params.get("sessionId") or [None])[0]
        if not raw_session or not _SESSION_RE.match(str(raw_session)):
            raw_session = f"sess_{uuid.uuid4().hex[:12]}"
        self.client_session_id = str(raw_session)
        # Namespace by user so a client cannot join another user's session group
        # by guessing or reusing its session id.
        self.session_id = f"u{self.user.id}_{self.client_session_id}"
        self.scope["session_id"] = self.session_id

        for group in ("agent_broadcast", f"user_{self.user.id}", f"session_{self.session_id}"):
            await self.channel_layer.group_add(group, self.channel_name)
            self.groups_joined.append(group)

        session_registry.register_session(self.session_id, self.channel_name, user_id=self.user.id)

        await self.accept()

        await self.send_json({
            "status": "connected",
            "message": "Connected to Totem Agent Live-Wire Bus",
            "session_id": self.client_session_id,
            "user_id": self.user.id,
            "authenticated": True,
        })

    async def disconnect(self, close_code):
        # Unregister from global session registry
        session_registry.unregister_channel(self.channel_name)

        # Leave all channel groups
        for group in getattr(self, "groups_joined", []):
            try:
                await self.channel_layer.group_discard(group, self.channel_name)
            except Exception as exc:
                logger.debug("Error discarding group %s: %s", group, exc)

    async def receive_json(self, content):
        """
        Handle incoming client command response, UI state report, or client event.
        """
        if not isinstance(content, dict):
            await self.send_json({
                "status": "error",
                "error": "Invalid frame: message must be a JSON object",
            })
            return

        # UI State Report Frame
        if content.get("type") == "ui_state_report":
            # A client may only report state for its own session.
            payload = content.get("payload", {})
            session_registry.set_ui_state(self.session_id, payload if isinstance(payload, dict) else {})
            await self.send_json({
                "status": "acknowledged",
                "type": "ui_state_report",
                "session_id": self.client_session_id,
            })
            return

        # Standard Command Acknowledgment Frame
        correlation_id = content.get("correlation_id")
        status = content.get("status", "success")
        payload = content.get("payload", {})
        error = content.get("error")

        ack_frame = {
            "status": "acknowledged",
            "correlation_id": correlation_id,
            "result": payload,
        }
        if error:
            ack_frame["error"] = error

        await self.send_json(ack_frame)

    async def agent_command(self, event):
        """
        Send live-wire command frame to WebSocket client.
        Supported actions: navigate, set_view_mode, click, create_dashboard,
        get_ui_state, start_tour, highlight_element.
        """
        await self.send_json({
            "action": event.get("action"),
            "parameters": event.get("parameters", {}),
            "correlation_id": event.get("correlation_id", ""),
        })

    async def agent_broadcast(self, event):
        """
        Handle broadcast message event.
        """
        await self.send_json({
            "type": "broadcast",
            "action": event.get("action"),
            "parameters": event.get("parameters", {}),
            "message": event.get("message"),
        })

    async def ui_refresh(self, event):
        """
        Handle UI refresh event trigger.
        """
        await self.send_json({
            "type": "ui_refresh",
            "detail": event.get("detail", {}),
        })
