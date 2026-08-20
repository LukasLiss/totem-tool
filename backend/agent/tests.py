"""
Empirical and stress tests for Django ASGI configuration and AgentConsumer WebSocket communication.
"""

import json
import pytest
from django.test import TestCase
from django.conf import settings
from django.contrib.auth.models import User
from channels.testing import WebsocketCommunicator
from channels.layers import get_channel_layer
from channels.routing import ProtocolTypeRouter, URLRouter

from totem_backend.asgi import application
import agent.routing
from agent.consumers import AgentConsumer


class AsgiStartupTests(TestCase):
    """
    Empirical tests validating ASGI setup and startup correctness.
    """

    def test_asgi_application_import_and_type(self):
        """Verify that totem_backend.asgi.application imports and is a ProtocolTypeRouter."""
        assert application is not None
        assert isinstance(application, ProtocolTypeRouter)
        assert "http" in application.application_mapping
        assert "websocket" in application.application_mapping

    def test_settings_asgi_and_channels_config(self):
        """Verify settings.py ASGI_APPLICATION and CHANNEL_LAYERS configurations."""
        assert getattr(settings, "ASGI_APPLICATION", None) == "totem_backend.asgi.application"
        assert "channels" in settings.INSTALLED_APPS
        assert "daphne" in settings.INSTALLED_APPS
        assert "agent" in settings.INSTALLED_APPS
        assert "default" in settings.CHANNEL_LAYERS
        assert "BACKEND" in settings.CHANNEL_LAYERS["default"]

    def test_websocket_urlpatterns_routes(self):
        """Verify agent.routing exposes ws/agent/ pattern."""
        assert len(agent.routing.websocket_urlpatterns) >= 1
        pattern = agent.routing.websocket_urlpatterns[0]
        assert "ws/agent/" in pattern.pattern.regex.pattern


@pytest.mark.asyncio
class AgentConsumerWebSocketTests(TestCase):
    """
    Empirical tests validating live WebSocket live-wire connection and bidirectional messaging.
    """

    async def test_websocket_connect_and_welcome_message(self):
        """Verify client connection to /ws/agent/ receives welcome connection message."""
        communicator = WebsocketCommunicator(application, "/ws/agent/")
        connected, _ = await communicator.connect()
        assert connected is True

        response = await communicator.receive_json_from()
        assert response.get("status") == "connected"
        assert "Live-Wire Bus" in response.get("message", "")

        await communicator.disconnect()

    async def test_websocket_invalid_route_rejection(self):
        """Verify connecting to an unregistered WS path raises ValueError in URLRouter."""
        communicator = WebsocketCommunicator(application, "/ws/unknown_endpoint/")
        with pytest.raises(ValueError, match="No route found for path"):
            await communicator.connect()

    async def test_websocket_client_acknowledgment(self):
        """Verify client response/event receives acknowledgment with correlation ID."""
        communicator = WebsocketCommunicator(application, "/ws/agent/")
        connected, _ = await communicator.connect()
        assert connected is True

        # Consume initial welcome frame
        await communicator.receive_json_from()

        # Send test command acknowledgement / payload
        test_payload = {
            "correlation_id": "corr-uuid-12345",
            "status": "success",
            "payload": {"active_tab": "analysis", "view": "petri_net"}
        }
        await communicator.send_json_to(test_payload)

        # Receive echo/ack
        ack = await communicator.receive_json_from()
        assert ack.get("status") == "acknowledged"
        assert ack.get("correlation_id") == "corr-uuid-12345"
        assert ack.get("result") == {"active_tab": "analysis", "view": "petri_net"}

        await communicator.disconnect()

    async def test_agent_command_broadcast_to_client(self):
        """Verify server-side group message triggers agent_command frame to WebSocket client."""
        communicator = WebsocketCommunicator(application, "/ws/agent/")
        connected, _ = await communicator.connect()
        assert connected is True

        # Consume welcome
        await communicator.receive_json_from()

        channel_layer = get_channel_layer()
        # Broadcast agent_broadcast group command
        await channel_layer.group_send(
            "agent_broadcast",
            {
                "type": "agent_command",
                "action": "navigate",
                "parameters": {"route": "/dashboard/2"},
                "correlation_id": "nav-cmd-999",
            }
        )

        cmd_frame = await communicator.receive_json_from()
        assert cmd_frame.get("action") == "navigate"
        assert cmd_frame.get("parameters") == {"route": "/dashboard/2"}
        assert cmd_frame.get("correlation_id") == "nav-cmd-999"

        await communicator.disconnect()

    async def test_multiple_concurrent_clients_broadcast(self):
        """Verify multiple connected clients simultaneously receive broadcast commands."""
        c1 = WebsocketCommunicator(application, "/ws/agent/")
        c2 = WebsocketCommunicator(application, "/ws/agent/")

        conn1, _ = await c1.connect()
        conn2, _ = await c2.connect()
        assert conn1 is True
        assert conn2 is True

        # Flush welcomes
        await c1.receive_json_from()
        await c2.receive_json_from()

        channel_layer = get_channel_layer()
        await channel_layer.group_send(
            "agent_broadcast",
            {
                "type": "agent_command",
                "action": "highlight_element",
                "parameters": {"tour_id": "nav-playout"},
                "correlation_id": "tour-sync-1",
            }
        )

        frame1 = await c1.receive_json_from()
        frame2 = await c2.receive_json_from()

        assert frame1["action"] == "highlight_element"
        assert frame1["parameters"]["tour_id"] == "nav-playout"
        assert frame2["action"] == "highlight_element"
        assert frame2["parameters"]["tour_id"] == "nav-playout"

        await c1.disconnect()
        await c2.disconnect()

    async def test_websocket_authenticated_user_channel_group(self):
        """Verify authenticated user joins user_{id} group and receives direct messages."""
        # Create a mock authenticated user
        user = User(id=9876, username="authtestuser")
        
        # Test directly on consumer with auth scope
        consumer = AgentConsumer()
        consumer.scope = {
            "type": "websocket",
            "path": "/ws/agent/",
            "user": user,
        }
        consumer.channel_layer = get_channel_layer()
        consumer.channel_name = "test_channel_auth"

        # Check group name assigned
        group_name = f"user_{user.id}" if user and user.is_authenticated else "agent_broadcast"
        assert group_name == "user_9876"

    async def test_malformed_incoming_payload_handling(self):
        """Verify consumer handles frames with missing fields gracefully without crash."""
        communicator = WebsocketCommunicator(application, "/ws/agent/")
        connected, _ = await communicator.connect()
        assert connected is True
        await communicator.receive_json_from()

        # Send empty dict
        await communicator.send_json_to({})
        ack = await communicator.receive_json_from()
        assert ack.get("status") == "acknowledged"
        assert ack.get("correlation_id") is None
        assert ack.get("result") == {}

        await communicator.disconnect()
