"""
Django Channels WebSocket Consumer for bidirectional agent live-wire communication.
"""

import json
from channels.generic.websocket import AsyncJsonWebsocketConsumer


class AgentConsumer(AsyncJsonWebsocketConsumer):
    """
    WebSocket consumer for /ws/agent/
    Manages live bidirectional command bus and client UI state.
    """

    async def connect(self):
        self.user = self.scope.get("user")
        self.group_name = f"user_{self.user.id}" if self.user and self.user.is_authenticated else "agent_broadcast"

        await self.channel_layer.group_add(
            self.group_name,
            self.channel_name
        )
        await self.accept()
        await self.send_json({
            "status": "connected",
            "message": "Connected to Totem Agent Live-Wire Bus"
        })

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            self.group_name,
            self.channel_name
        )

    async def receive_json(self, content):
        """
        Handle incoming client command response or client event.
        """
        correlation_id = content.get("correlation_id")
        status = content.get("status", "success")
        payload = content.get("payload", {})

        # Echo or handle acknowledgment
        await self.send_json({
            "status": "acknowledged",
            "correlation_id": correlation_id,
            "result": payload
        })

    async def agent_command(self, event):
        """
        Send command to WebSocket client (e.g. navigate, highlight_element, set_view_mode).
        """
        await self.send_json({
            "action": event["action"],
            "parameters": event.get("parameters", {}),
            "correlation_id": event.get("correlation_id", "")
        })
