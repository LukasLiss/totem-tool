"""
Django Channels WebSocket Consumer for bidirectional agent live-wire communication.
"""

from urllib.parse import parse_qs
import uuid
import logging
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from .registry import session_registry

logger = logging.getLogger(__name__)


class AgentConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket consumer for /ws/agent/
    Manages live bidirectional command bus, channel groups, and client UI state.
    """

    async def connect(self):
        self.user = self.scope.get("user")
        self.session_id = self.scope.get("session_id")

        if not self.session_id:
            query_string = self.scope.get("query_string", b"").decode("utf-8")
            query_params = parse_qs(query_string)
            if "session_id" in query_params and query_params["session_id"]:
                self.session_id = query_params["session_id"][0]
            elif "sessionId" in query_params and query_params["sessionId"]:
                self.session_id = query_params["sessionId"][0]
            else:
                self.session_id = f"sess_{uuid.uuid4().hex[:12]}"
            self.scope["session_id"] = self.session_id

        self.groups_joined = []

        # Join agent_broadcast
        await self.channel_layer.group_add("agent_broadcast", self.channel_name)
        self.groups_joined.append("agent_broadcast")

        # Join user group if authenticated
        if self.user and self.user.is_authenticated:
            user_group = f"user_{self.user.id}"
            await self.channel_layer.group_add(user_group, self.channel_name)
            self.groups_joined.append(user_group)

        # Join session group
        if self.session_id:
            session_group = f"session_{self.session_id}"
            await self.channel_layer.group_add(session_group, self.channel_name)
            self.groups_joined.append(session_group)

        # Register channel in session registry
        user_id = self.user.id if (self.user and self.user.is_authenticated) else None
        session_registry.register_session(self.session_id, self.channel_name, user_id=user_id)

        await self.accept()

        await self.send_json({
            "status": "connected",
            "message": "Connected to Totem Agent Live-Wire Bus",
            "session_id": self.session_id,
            "user_id": user_id,
            "authenticated": bool(self.user and self.user.is_authenticated),
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
            session_id = content.get("session_id") or self.session_id
            payload = content.get("payload", {})
            session_registry.set_ui_state(session_id, payload)
            await self.send_json({
                "status": "acknowledged",
                "type": "ui_state_report",
                "session_id": session_id,
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
