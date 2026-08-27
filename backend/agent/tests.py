"""
Empirical and integration tests for Django Channels ASGI configuration,
JwtAuthMiddleware, SessionRegistry, and AgentConsumer WebSocket communication.
"""

import json
import uuid
import pytest
from django.test import TestCase
from django.conf import settings
from django.contrib.auth.models import User, AnonymousUser
from rest_framework_simplejwt.tokens import AccessToken
from channels.testing import WebsocketCommunicator
from channels.layers import get_channel_layer
from channels.routing import ProtocolTypeRouter

from totem_backend.asgi import application
import agent.routing
from agent.consumers import AgentConsumer
from agent.jwt_ws_middleware import JwtAuthMiddleware, get_user_from_jwt
from agent.registry import SessionRegistry, session_registry


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


class SessionRegistryUnitTests(TestCase):
    """
    Unit tests for thread-safe SessionRegistry channel tracking and command dispatching.
    """

    def setUp(self):
        self.registry = SessionRegistry()

    def tearDown(self):
        self.registry.clear()
        session_registry.clear()

    def test_register_and_get_channels(self):
        """Verify registering channels for sessions and users."""
        self.registry.register_session("sess_1", "ch_1", user_id=101)
        self.registry.register_session("sess_1", "ch_2", user_id=101)
        self.registry.register_session("sess_2", "ch_3", user_id=102)

        assert set(self.registry.get_channels_for_session("sess_1")) == {"ch_1", "ch_2"}
        assert set(self.registry.get_channels_for_user(101)) == {"ch_1", "ch_2"}
        assert set(self.registry.get_channels_for_session("sess_2")) == {"ch_3"}
        assert set(self.registry.get_channels_for_user(102)) == {"ch_3"}

        assert set(self.registry.get_active_sessions()) == {"sess_1", "sess_2"}
        assert set(self.registry.get_active_users()) == {101, 102}

    def test_unregister_channel(self):
        """Verify unregistering a channel cleans up session and user references."""
        self.registry.register_session("sess_1", "ch_1", user_id=101)
        self.registry.register_session("sess_1", "ch_2", user_id=101)

        self.registry.unregister_channel("ch_1")
        assert self.registry.get_channels_for_session("sess_1") == ["ch_2"]
        assert self.registry.get_channels_for_user(101) == ["ch_2"]

        self.registry.unregister_channel("ch_2")
        assert self.registry.get_channels_for_session("sess_1") == []
        assert self.registry.get_channels_for_user(101) == []
        assert "sess_1" not in self.registry.get_active_sessions()
        assert 101 not in self.registry.get_active_users()

    def test_unregister_session(self):
        """Verify unregister_session method."""
        self.registry.register_session("sess_a", "ch_a", user_id=200)
        self.registry.unregister_session("sess_a", "ch_a")
        assert self.registry.get_channels_for_session("sess_a") == []
        assert self.registry.get_channels_for_user(200) == []

    def test_ui_state_caching(self):
        """Verify caching and retrieving UI state per session."""
        sample_state = {
            "pathname": "/overview",
            "view_mode": "ocdfg",
            "active_file_id": 42,
        }
        self.registry.set_ui_state("sess_123", sample_state)
        retrieved = self.registry.get_ui_state("sess_123")
        assert retrieved == sample_state
        assert self.registry.get_ui_state("non_existent") is None

    def test_send_command_to_session_sync_and_user_sync(self):
        """Verify sync dispatch helper returns False when session/user not active."""
        res_sess = self.registry.send_command_to_session_sync("sess_missing", "navigate", {"route": "/test"})
        assert res_sess is False

        res_user = self.registry.send_command_to_user_sync(9999, "set_view_mode", {"mode": "ocdfg"})
        assert res_user is False

        res_bcast = self.registry.broadcast_command_sync("start_tour", {})
        assert res_bcast is True


@pytest.mark.asyncio
class JwtAuthMiddlewareAsyncTests(TestCase):
    """
    Tests for JwtAuthMiddleware token parsing and user resolution.
    """

    def setUp(self):
        self.user = User.objects.create_user(username="ws_jwt_user", password="password123")
        self.token = str(AccessToken.for_user(self.user))

    def tearDown(self):
        self.user.delete()

    async def test_get_user_from_jwt_valid(self):
        """Verify valid JWT string resolves the correct User model instance."""
        user = await get_user_from_jwt(self.token)
        assert user.is_authenticated is True
        assert user.username == "ws_jwt_user"

    async def test_get_user_from_jwt_invalid(self):
        """Verify invalid token string resolves to AnonymousUser."""
        user = await get_user_from_jwt("invalid.token.string")
        assert isinstance(user, AnonymousUser)
        assert user.is_authenticated is False

    async def test_get_user_from_jwt_empty(self):
        """Verify empty token string resolves to AnonymousUser."""
        user = await get_user_from_jwt("")
        assert isinstance(user, AnonymousUser)
        assert user.is_authenticated is False


@pytest.mark.asyncio
class AgentConsumerWebSocketTests(TestCase):
    """
    Empirical tests validating live WebSocket live-wire connection and bidirectional messaging.
    """

    def setUp(self):
        session_registry.clear()
        self.user = User.objects.create_user(username="agent_tester", password="password123")
        self.token = str(AccessToken.for_user(self.user))

    def tearDown(self):
        self.user.delete()
        session_registry.clear()

    async def test_websocket_connect_anonymous_welcome_message(self):
        """Verify anonymous client connection receives welcome connection message."""
        communicator = WebsocketCommunicator(application, "/ws/agent/?session_id=sess_anon_1")
        connected, _ = await communicator.connect()
        assert connected is True

        response = await communicator.receive_json_from()
        assert response.get("status") == "connected"
        assert "Live-Wire Bus" in response.get("message", "")
        assert response.get("session_id") == "sess_anon_1"
        assert response.get("authenticated") is False
        assert response.get("user_id") is None

        # Verify session registered in SessionRegistry
        assert "sess_anon_1" in session_registry.get_active_sessions()

        await communicator.disconnect()
        # Verify unregister on disconnect
        assert "sess_anon_1" not in session_registry.get_active_sessions()

    async def test_websocket_connect_authenticated_jwt_query_token(self):
        """Verify client connection with ?token= resolves authenticated user and user_id."""
        url = f"/ws/agent/?token={self.token}&session_id=sess_auth_jwt"
        communicator = WebsocketCommunicator(application, url)
        connected, _ = await communicator.connect()
        assert connected is True

        response = await communicator.receive_json_from()
        assert response.get("status") == "connected"
        assert response.get("authenticated") is True
        assert response.get("user_id") == self.user.id
        assert response.get("session_id") == "sess_auth_jwt"

        assert self.user.id in session_registry.get_active_users()
        assert "sess_auth_jwt" in session_registry.get_active_sessions()

        await communicator.disconnect()
        assert self.user.id not in session_registry.get_active_users()

    async def test_websocket_connect_authenticated_access_token_param(self):
        """Verify client connection with ?access_token= resolves authenticated user."""
        url = f"/ws/agent/?access_token={self.token}&sessionId=sess_auth_acc"
        communicator = WebsocketCommunicator(application, url)
        connected, _ = await communicator.connect()
        assert connected is True

        response = await communicator.receive_json_from()
        assert response.get("status") == "connected"
        assert response.get("authenticated") is True
        assert response.get("user_id") == self.user.id
        assert response.get("session_id") == "sess_auth_acc"

        await communicator.disconnect()

    async def test_websocket_connect_authenticated_bearer_header(self):
        """Verify client connection with Authorization: Bearer <token> header."""
        headers = [(b"authorization", f"Bearer {self.token}".encode("utf-8")), (b"x-session-id", b"sess_hdr_1")]
        communicator = WebsocketCommunicator(application, "/ws/agent/", headers=headers)
        connected, _ = await communicator.connect()
        assert connected is True

        response = await communicator.receive_json_from()
        assert response.get("status") == "connected"
        assert response.get("authenticated") is True
        assert response.get("user_id") == self.user.id
        assert response.get("session_id") == "sess_hdr_1"

        await communicator.disconnect()

    async def test_websocket_invalid_route_rejection(self):
        """Verify connecting to an unregistered WS path raises ValueError in URLRouter."""
        communicator = WebsocketCommunicator(application, "/ws/unknown_endpoint/")
        with pytest.raises(ValueError, match="No route found for path"):
            await communicator.connect()

    async def test_websocket_client_acknowledgment_roundtrip(self):
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
            "payload": {"active_tab": "analysis", "view": "petri_net"},
        }
        await communicator.send_json_to(test_payload)

        # Receive echo/ack
        ack = await communicator.receive_json_from()
        assert ack.get("status") == "acknowledged"
        assert ack.get("correlation_id") == "corr-uuid-12345"
        assert ack.get("result") == {"active_tab": "analysis", "view": "petri_net"}

        await communicator.disconnect()

    async def test_websocket_client_acknowledgment_with_error(self):
        """Verify client error response is acknowledged and retains error field."""
        communicator = WebsocketCommunicator(application, "/ws/agent/")
        connected, _ = await communicator.connect()
        assert connected is True
        await communicator.receive_json_from()

        err_payload = {
            "correlation_id": "corr-err-99",
            "status": "error",
            "error": "Element not found",
            "payload": {},
        }
        await communicator.send_json_to(err_payload)

        ack = await communicator.receive_json_from()
        assert ack.get("status") == "acknowledged"
        assert ack.get("correlation_id") == "corr-err-99"
        assert ack.get("error") == "Element not found"

        await communicator.disconnect()

    async def test_websocket_client_ui_state_report(self):
        """Verify client sending ui_state_report updates SessionRegistry state."""
        communicator = WebsocketCommunicator(application, "/ws/agent/?session_id=sess_state_test")
        connected, _ = await communicator.connect()
        assert connected is True
        await communicator.receive_json_from()

        state_payload = {
            "type": "ui_state_report",
            "session_id": "sess_state_test",
            "payload": {
                "pathname": "/overview",
                "view_mode": "analysis",
                "active_file_id": 10,
            },
        }
        await communicator.send_json_to(state_payload)

        ack = await communicator.receive_json_from()
        assert ack.get("status") == "acknowledged"
        assert ack.get("type") == "ui_state_report"
        assert ack.get("session_id") == "sess_state_test"

        cached = session_registry.get_ui_state("sess_state_test")
        assert cached == {
            "pathname": "/overview",
            "view_mode": "analysis",
            "active_file_id": 10,
        }

        await communicator.disconnect()

    async def test_all_seven_action_types_serialization(self):
        """Verify serialization and dispatch of all 7 live-wire command actions."""
        communicator = WebsocketCommunicator(application, "/ws/agent/")
        connected, _ = await communicator.connect()
        assert connected is True
        await communicator.receive_json_from()

        channel_layer = get_channel_layer()

        actions = [
            ("navigate", {"route": "/overview", "replace": True}),
            ("set_view_mode", {"mode": "ocdfg", "component": "variants"}),
            ("click", {"selector": "button.submit-btn", "tour_id": "nav-overview"}),
            ("create_dashboard", {"name": "Test Dashboard", "dashboard_id": 5}),
            ("get_ui_state", {}),
            ("start_tour", {"steps": [{"tour_id": "nav-analysis", "label": "Analysis"}]}),
            ("highlight_element", {"tour_id": "nav-analysis", "label": "Check analysis"}),
        ]

        for action, params in actions:
            corr_id = f"corr-{action}-{uuid.uuid4().hex[:6]}"
            await channel_layer.group_send(
                "agent_broadcast",
                {
                    "type": "agent_command",
                    "action": action,
                    "parameters": params,
                    "correlation_id": corr_id,
                },
            )

            frame = await communicator.receive_json_from()
            assert frame.get("action") == action
            assert frame.get("parameters") == params
            assert frame.get("correlation_id") == corr_id

        await communicator.disconnect()

    async def test_direct_session_command_dispatch(self):
        """Verify session_registry.send_command_to_session delivers command to target session."""
        c1 = WebsocketCommunicator(application, "/ws/agent/?session_id=sess_target")
        c2 = WebsocketCommunicator(application, "/ws/agent/?session_id=sess_other")

        await c1.connect()
        await c2.connect()
        await c1.receive_json_from()
        await c2.receive_json_from()

        # Send command specifically to sess_target
        success = await session_registry.send_command_to_session(
            "sess_target",
            "navigate",
            {"route": "/variantsview"},
            correlation_id="sess-corr-1",
        )
        assert success is True

        frame1 = await c1.receive_json_from()
        assert frame1["action"] == "navigate"
        assert frame1["parameters"]["route"] == "/variantsview"
        assert frame1["correlation_id"] == "sess-corr-1"

        # c2 should not receive anything
        assert await c2.receive_nothing() is True

        await c1.disconnect()
        await c2.disconnect()

    async def test_direct_user_command_dispatch(self):
        """Verify session_registry.send_command_to_user delivers command to authenticated user."""
        url = f"/ws/agent/?token={self.token}&session_id=sess_user_tgt"
        c_user = WebsocketCommunicator(application, url)
        c_anon = WebsocketCommunicator(application, "/ws/agent/?session_id=sess_anon_other")

        await c_user.connect()
        await c_anon.connect()
        await c_user.receive_json_from()
        await c_anon.receive_json_from()

        # Send command to self.user.id
        success = await session_registry.send_command_to_user(
            self.user.id,
            "set_view_mode",
            {"type": "analysis", "component": "ocdfg"},
            correlation_id="user-corr-1",
        )
        assert success is True

        frame = await c_user.receive_json_from()
        assert frame["action"] == "set_view_mode"
        assert frame["parameters"]["component"] == "ocdfg"

        assert await c_anon.receive_nothing() is True

        await c_user.disconnect()
        await c_anon.disconnect()

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

        # Broadcast via session_registry
        await session_registry.broadcast_command(
            "highlight_element",
            {"tour_id": "nav-playout"},
            correlation_id="tour-sync-1",
        )

        frame1 = await c1.receive_json_from()
        frame2 = await c2.receive_json_from()

        assert frame1["action"] == "highlight_element"
        assert frame1["parameters"]["tour_id"] == "nav-playout"
        assert frame2["action"] == "highlight_element"
        assert frame2["parameters"]["tour_id"] == "nav-playout"

        await c1.disconnect()
        await c2.disconnect()

    async def test_malformed_incoming_payload_handling(self):
        """Verify consumer handles non-dict or malformed frames gracefully without crash."""
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
