import json
from unittest.mock import patch, MagicMock

from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from mcp_server.policy import ToolCategory, get_category, is_mutable
from mcp_server.server import get_tool_specs


# ---------------------------------------------------------------------------
# ChatView endpoint tests
# ---------------------------------------------------------------------------

class ChatViewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="assistant-user", password="pass")
        self.client.force_authenticate(user=self.user)
        self.url = "/api/assistant/chat/"

    def test_chat_requires_authentication(self):
        anonymous = APIClient()
        response = anonymous.post(self.url, {"message": "hello"}, format="json")
        self.assertIn(response.status_code, (401, 403))

    def test_chat_rejects_missing_message(self):
        response = self.client.post(self.url, {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("error", response.json())

    def test_chat_rejects_non_string_message(self):
        response = self.client.post(self.url, {"message": 123}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    @override_settings(GEMINI_API_KEY="")
    def test_chat_returns_fallback_when_no_api_key(self):
        response = self.client.post(
            self.url, {"message": "hello"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertIn("not configured", data["text"].lower())
        self.assertEqual(data["tool_calls"], [])
        self.assertEqual(data["pending_actions"], [])

    @override_settings(GEMINI_API_KEY="")
    def test_chat_returns_expected_response_shape(self):
        response = self.client.post(
            self.url,
            {"message": "hello", "context": {"current_view": "overview"}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertIn("text", data)
        self.assertIn("tool_calls", data)
        self.assertIn("pending_actions", data)
        self.assertIn("tour_path", data)

    @override_settings(GEMINI_API_KEY="")
    def test_chat_accepts_sse_header(self):
        response = self.client.post(
            self.url,
            {"message": "hello"},
            format="json",
            HTTP_ACCEPT="text/event-stream",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "text/event-stream")

    @patch("assistant.llm.complete")
    @override_settings(GEMINI_API_KEY="test-key")
    def test_chat_passes_context_to_prompt_builder(self, mock_complete):
        mock_complete.return_value = {"text": "hi", "tool_calls": [], "usage": {}}
        context = {"current_view": "dashboard", "selected_file_id": 42}

        self.client.post(
            self.url,
            {"message": "hello", "context": context},
            format="json",
        )

        self.assertTrue(mock_complete.called)
        call_kwargs = mock_complete.call_args
        self.assertIn("system_prompt", call_kwargs.kwargs)
        self.assertIn("user_message", call_kwargs.kwargs)

    @patch("assistant.views.call_tool", return_value={"num_events": 100})
    @patch("assistant.llm.complete")
    @override_settings(GEMINI_API_KEY="test-key")
    def test_chat_executes_read_only_tool_calls(self, mock_complete, mock_call):
        llm_response = {
            "text": "Here are the stats",
            "tool_calls": [
                {"id": "tc-1", "name": "get_statistics", "arguments": {}}
            ],
            "usage": {},
        }
        followup_response = {"text": "You have 100 events.", "tool_calls": [], "usage": {}}
        mock_complete.side_effect = [llm_response, followup_response]

        response = self.client.post(
            self.url, {"message": "how many events?"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["text"], "You have 100 events.")
        self.assertEqual(len(data["tool_calls"]), 1)
        self.assertEqual(data["tool_calls"][0]["name"], "get_statistics")
        mock_call.assert_called_once()

    @patch("assistant.llm.complete")
    @override_settings(GEMINI_API_KEY="test-key")
    def test_chat_surfaces_mutating_tools_as_pending_actions(self, mock_complete):
        llm_response = {
            "text": "I can create that dashboard for you.",
            "tool_calls": [
                {"id": "tc-1", "name": "create_dashboard", "arguments": {"name": "My Dashboard"}}
            ],
            "usage": {},
        }
        mock_complete.return_value = llm_response

        response = self.client.post(
            self.url, {"message": "create a dashboard called My Dashboard"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(len(data["pending_actions"]), 1)
        self.assertEqual(data["pending_actions"][0]["name"], "create_dashboard")
        self.assertEqual(len(data["tool_calls"]), 0)


# ---------------------------------------------------------------------------
# confirm_action endpoint tests
# ---------------------------------------------------------------------------

class ConfirmActionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="confirm-user", password="pass")
        self.client.force_authenticate(user=self.user)
        self.url = "/api/assistant/confirm/"

    def test_confirm_rejects_missing_pending_action_id(self):
        response = self.client.post(self.url, {"approved": True}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_confirm_cancel_returns_cancelled(self):
        response = self.client.post(
            self.url,
            {"pending_action_id": "abc-123", "approved": False},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["status"], "cancelled")

    def test_confirm_approve_returns_executed(self):
        response = self.client.post(
            self.url,
            {"pending_action_id": "abc-123", "approved": True},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["status"], "executed")


# ---------------------------------------------------------------------------
# MCP tool spec generation tests
# ---------------------------------------------------------------------------

class ToolSpecTests(TestCase):
    def test_get_tool_specs_returns_list(self):
        specs = get_tool_specs()
        self.assertIsInstance(specs, list)

    def test_get_tool_specs_contains_expected_read_only_tools(self):
        specs = get_tool_specs()
        names = {s["name"] for s in specs}
        expected = {
            "get_statistics", "get_object_types", "discover_totem",
            "discover_occn", "discover_mlpa", "find_variants",
            "get_oc_dotted_chart", "get_layout", "list_dashboards",
            "list_assets",
        }
        self.assertTrue(expected.issubset(names))

    def test_get_tool_specs_contains_expected_mutating_tools(self):
        specs = get_tool_specs()
        names = {s["name"] for s in specs}
        expected = {
            "create_dashboard", "add_component", "remove_component",
            "update_component", "rename_dashboard",
        }
        self.assertTrue(expected.issubset(names))

    def test_get_tool_specs_contains_expected_frontend_tools(self):
        specs = get_tool_specs()
        names = {s["name"] for s in specs}
        expected = {"navigate", "set_view_mode", "highlight_element"}
        self.assertTrue(expected.issubset(names))

    def test_each_tool_spec_has_required_fields(self):
        specs = get_tool_specs()
        for spec in specs:
            self.assertIn("name", spec)
            self.assertIn("description", spec)
            self.assertIn("parameters", spec)
            self.assertIsInstance(spec["parameters"], dict)


# ---------------------------------------------------------------------------
# Policy categorization tests
# ---------------------------------------------------------------------------

class PolicyTests(TestCase):
    def test_read_only_tools_are_categorized_correctly(self):
        read_only_tools = [
            "get_statistics", "get_object_types", "discover_totem",
            "discover_occn", "discover_mlpa", "find_variants",
            "get_oc_dotted_chart", "get_layout", "list_dashboards",
            "list_assets",
        ]
        for name in read_only_tools:
            self.assertEqual(
                get_category(name), ToolCategory.READ_ONLY,
                f"{name} should be READ_ONLY",
            )

    def test_mutating_tools_are_categorized_correctly(self):
        mutating_tools = [
            "create_dashboard", "add_component", "remove_component",
            "update_component", "rename_dashboard",
        ]
        for name in mutating_tools:
            self.assertEqual(
                get_category(name), ToolCategory.MUTATING,
                f"{name} should be MUTATING",
            )

    def test_frontend_tools_are_categorized_correctly(self):
        frontend_tools = ["navigate", "set_view_mode", "highlight_element"]
        for name in frontend_tools:
            self.assertEqual(
                get_category(name), ToolCategory.REQUIRES_FRONTEND,
                f"{name} should be REQUIRES_FRONTEND",
            )

    def test_is_mutable_returns_true_for_mutating(self):
        self.assertTrue(is_mutable("create_dashboard"))
        self.assertTrue(is_mutable("navigate"))

    def test_is_mutable_returns_false_for_read_only(self):
        self.assertFalse(is_mutable("get_statistics"))
        self.assertFalse(is_mutable("list_dashboards"))

    def test_unknown_tool_raises_value_error(self):
        with self.assertRaises(ValueError):
            get_category("nonexistent_tool")
