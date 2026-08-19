"""
WebSocket consumer for the AI assistant agent bridge.

Protocol:
  Client -> Server: {"type": "command", "command": "navigate", "args": {...}}
  Server -> Client: {"type": "result", "command": "navigate", "args": {...}, "result": {...}}
  Server -> Client: {"type": "notice", "message": "..."}  (errors, heartbeats, etc.)
"""

import json

from channels.generic.websocket import AsyncWebsocketConsumer

from .registry import session_registry


class AgentConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = self.scope.get("user")
        if self.user is None or self.user.is_anonymous:
            await self.close(code=4001)
            return

        self.user_id = self.user.pk
        session_registry.register(self.user_id, self)
        await self.accept()
        await self.send_json({
            "type": "notice",
            "message": "connected",
        })

    async def disconnect(self, code):
        if hasattr(self, "user_id"):
            session_registry.unregister(self.user_id)

    async def receive_json(self, content, **kwargs):
        msg_type = content.get("type")

        if msg_type == "command":
            command = content.get("command", "")
            args = content.get("args", {})
            await self._handle_command(command, args)
        else:
            await self.send_json({
                "type": "notice",
                "message": f"Unknown message type: {msg_type}",
            })

    async def _handle_command(self, command: str, args: dict):
        """Dispatch a command and send the result back."""
        # Commands are handled client-side via the handler registry.
        # The server just forwards them; the consumer acknowledges receipt.
        await self.send_json({
            "type": "result",
            "command": command,
            "args": args,
            "result": {"status": "dispatched"},
        })

    async def push_command(self, command: str, args: dict):
        """Send a command from the server (assistant brain) to the client."""
        await self.send_json({
            "type": "command",
            "command": command,
            "args": args,
        })
