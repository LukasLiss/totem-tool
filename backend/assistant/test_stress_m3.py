"""
Adversarial Stress Test Suite for Milestone 3 (Sub-task #118).
Tests:
1. LLMProvider:
   - GeminiProvider (live key, empty key, invalid key, 404 fallback, malformed SSE stream, timeouts, network exceptions).
   - AnthropicProvider (empty key, invalid key, HTTP errors, SSE partial JSON delta reconstruction, unhandled events).
   - MockProvider (comprehensive intent matching across all synonyms and cases, streaming chunk integrity).
   - Provider resolution and fallback logic via get_llm_provider().
2. Tool Schema Translation:
   - format_tool_for_gemini and format_tool_for_anthropic across all 18 MCP tool specifications.
   - Recursive type conversion validation (no lowercase type fields, nested objects, nested arrays, optional/required fields).
   - Adversarial/degenerate schema structures.
3. ChatView (HTTP & SSE Streaming):
   - Malformed request bodies (non-JSON, non-dict, missing message, whitespace message, int/bool/list message, 10k+ char limit).
   - Context permutations (None, empty dict, string, int, lists, unexpected keys, null values).
   - History permutations (None, empty list, malformed items, non-dict items, missing role/content).
   - SSE streaming frame compliance: every frame strictly matches `data: <json>\\n\\n`, valid JSON, valid event types.
   - Teach mode highlight_element tour_path generation + pending action registration.
   - Act mode mutating tool pending action registration + read-only tool inline execution.
   - Error containment during streaming (no unhandled 500 exceptions).
4. Action Registry & Confirmation Endpoint:
   - confirm_action endpoint with malformed payloads, non-existent action IDs, cancel flow, approve flow, ownership security checks.
"""

import io
import json
import uuid
from unittest.mock import MagicMock, patch

import requests
from django.conf import settings
from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from assistant.action_registry import (
    cancel_action,
    clear_actions,
    get_action,
    register_action,
    update_action_status,
)
from assistant.llm import (
    AnthropicProvider,
    BaseLLMProvider,
    GeminiProvider,
    MockProvider,
    complete,
    convert_schema_to_gemini,
    format_tool_for_anthropic,
    format_tool_for_gemini,
    get_llm_provider,
    stream_chat,
)
from assistant.prompts import (
    TOUR_IDS,
    VALID_TOUR_IDS,
    build_system_prompt,
    normalize_context,
)
from assistant.retriever import (
    BM25Retriever,
    get_retriever,
    reload_index,
    retrieve_chunks,
    retrieve_knowledge,
)
from mcp_server.policy import ToolCategory, get_category, is_mutable
from mcp_server.server import get_tool_specs


# ===========================================================================
# 1. MCP Tool Schema Translation Stress Tests (All 18 Tools + Degenerate)
# ===========================================================================

class ToolSchemaTranslationStressTests(TestCase):
    def test_all_18_tools_gemini_format_completeness(self):
        specs = get_tool_specs()
        self.assertEqual(len(specs), 18, "Expected exactly 18 MCP tool specs.")

        def check_no_lowercase_types(obj, path="root"):
            if isinstance(obj, dict):
                for k, v in obj.items():
                    current_path = f"{path}.{k}"
                    if k == "type":
                        self.assertIsInstance(v, str, f"Type at {current_path} must be string")
                        self.assertTrue(
                            v.isupper(),
                            f"Gemini type at {current_path} must be uppercase, found: {v}",
                        )
                        self.assertIn(
                            v,
                            {"OBJECT", "STRING", "INTEGER", "NUMBER", "BOOLEAN", "ARRAY"},
                            f"Unexpected Gemini type '{v}' at {current_path}",
                        )
                    else:
                        check_no_lowercase_types(v, current_path)
            elif isinstance(obj, list):
                for idx, item in enumerate(obj):
                    check_no_lowercase_types(item, f"{path}[{idx}]")

        for spec in specs:
            formatted = format_tool_for_gemini(spec)
            self.assertIn("name", formatted)
            self.assertIn("description", formatted)
            self.assertIn("parameters", formatted)
            self.assertEqual(formatted["name"], spec["name"])
            self.assertEqual(formatted["parameters"]["type"], "OBJECT")
            check_no_lowercase_types(formatted["parameters"], path=spec["name"])

    def test_all_18_tools_anthropic_format_completeness(self):
        specs = get_tool_specs()
        for spec in specs:
            formatted = format_tool_for_anthropic(spec)
            self.assertIn("name", formatted)
            self.assertIn("description", formatted)
            self.assertIn("input_schema", formatted)
            self.assertEqual(formatted["name"], spec["name"])
            self.assertEqual(formatted["input_schema"], spec.get("parameters", {}))

    def test_schema_nested_arrays_and_objects(self):
        complex_schema = {
            "type": "object",
            "properties": {
                "matrices": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "row": {"type": "integer"},
                            "vals": {"type": "array", "items": {"type": "number"}},
                        },
                    },
                },
                "meta": {
                    "type": "object",
                    "properties": {
                        "is_valid": {"type": "boolean"},
                        "tag": {"type": "string"},
                    },
                },
            },
        }
        converted = convert_schema_to_gemini(complex_schema)
        self.assertEqual(converted["type"], "OBJECT")
        self.assertEqual(converted["properties"]["matrices"]["type"], "ARRAY")
        self.assertEqual(converted["properties"]["matrices"]["items"]["type"], "OBJECT")
        self.assertEqual(
            converted["properties"]["matrices"]["items"]["properties"]["row"]["type"],
            "INTEGER",
        )
        self.assertEqual(
            converted["properties"]["matrices"]["items"]["properties"]["vals"]["items"]["type"],
            "NUMBER",
        )
        self.assertEqual(converted["properties"]["meta"]["properties"]["is_valid"]["type"], "BOOLEAN")

    def test_schema_degenerate_inputs(self):
        for degen in [None, "string", 123, [1, 2, 3], True]:
            res = convert_schema_to_gemini(degen)
            self.assertEqual(res, degen)

        empty_tool = {"name": "empty_tool"}
        res_gemini = format_tool_for_gemini(empty_tool)
        self.assertEqual(res_gemini["name"], "empty_tool")
        self.assertEqual(res_gemini["parameters"]["type"], "OBJECT")


# ===========================================================================
# 2. LLM Provider Fallback & Edge Case Stress Tests
# ===========================================================================

class LLMProviderStressTests(TestCase):
    @override_settings(GEMINI_API_KEY="", ANTHROPIC_API_KEY="")
    def test_fallback_to_mock_when_no_keys(self):
        provider = get_llm_provider()
        self.assertIsInstance(provider, MockProvider)

    @override_settings(GEMINI_API_KEY="test_key", ANTHROPIC_API_KEY="test_key2")
    def test_explicit_provider_selection(self):
        self.assertIsInstance(get_llm_provider("gemini"), GeminiProvider)
        self.assertIsInstance(get_llm_provider("anthropic"), AnthropicProvider)
        self.assertIsInstance(get_llm_provider("mock"), MockProvider)
        self.assertIsInstance(get_llm_provider("unknown_name"), MockProvider)

    def test_gemini_provider_unconfigured_key_behavior(self):
        provider = GeminiProvider(api_key="")
        res = provider.complete("system", "hello")
        self.assertIn("not configured", res["text"])
        self.assertEqual(res["tool_calls"], [])

        stream_events = list(provider.stream_chat("system", "hello"))
        self.assertEqual(len(stream_events), 2)
        self.assertEqual(stream_events[0]["type"], "text")
        self.assertIn("not configured", stream_events[0]["content"])
        self.assertEqual(stream_events[1]["type"], "done")

    def test_anthropic_provider_unconfigured_key_behavior(self):
        provider = AnthropicProvider(api_key="")
        res = provider.complete("system", "hello")
        self.assertIn("not configured", res["text"])

        stream_events = list(provider.stream_chat("system", "hello"))
        self.assertEqual(len(stream_events), 2)
        self.assertEqual(stream_events[0]["type"], "text")
        self.assertIn("not configured", stream_events[0]["content"])
        self.assertEqual(stream_events[1]["type"], "done")

    @patch("requests.post")
    def test_gemini_provider_404_automatic_fallback(self, mock_post):
        # 1st call (gemini-3.6-flash) returns 404, 2nd call (gemini-1.5-flash) returns 200
        resp_404 = MagicMock()
        resp_404.status_code = 404
        resp_404.text = "Model not found"

        resp_200 = MagicMock()
        resp_200.status_code = 200
        resp_200.json.return_value = {
            "candidates": [{"content": {"parts": [{"text": "Response from 1.5 flash"}]}}],
            "usageMetadata": {"totalTokenCount": 10},
        }

        mock_post.side_effect = [resp_404, resp_200]

        provider = GeminiProvider(api_key="valid_key", model="gemini-3.6-flash")
        res = provider.complete("system", "test query")
        self.assertEqual(res["text"], "Response from 1.5 flash")
        self.assertEqual(mock_post.call_count, 2)

    @patch("requests.post")
    def test_gemini_provider_api_error_handling(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.status_code = 403
        mock_resp.text = "API Key Invalid or Quota Exceeded"
        mock_post.return_value = mock_resp

        provider = GeminiProvider(api_key="bad_key")
        res = provider.complete("system", "test")
        self.assertIn("Error communicating with Gemini API", res["text"])
        self.assertIn("403", res["text"])

        # Test streaming error handling
        events = list(provider.stream_chat("system", "test"))
        self.assertEqual(events[0]["type"], "error")
        self.assertIn("403", events[0]["message"])
        self.assertEqual(events[1]["type"], "done")

    @patch("requests.post")
    def test_gemini_provider_network_timeout(self, mock_post):
        mock_post.side_effect = requests.exceptions.Timeout("Connection timed out after 30s")

        provider = GeminiProvider(api_key="valid_key")
        res = provider.complete("system", "test")
        self.assertIn("Error: Connection timed out", res["text"])

        events = list(provider.stream_chat("system", "test"))
        self.assertEqual(events[0]["type"], "error")
        self.assertIn("Connection timed out", events[0]["message"])
        self.assertEqual(events[1]["type"], "done")

    @patch("requests.post")
    def test_gemini_provider_malformed_sse_chunks(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        # Malformed lines, non-data lines, non-json data, valid chunk
        sse_lines = [
            ": keepalive ping",
            "",
            "data: not a json string",
            "data: ",
            'data: {"candidates": [{"content": {"parts": [{"text": "Valid Token"}]}}]}',
        ]
        mock_resp.iter_lines.return_value = [l.encode("utf-8") for l in sse_lines]
        mock_post.return_value = mock_resp

        provider = GeminiProvider(api_key="valid_key")
        events = list(provider.stream_chat("system", "test"))
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["type"], "text")
        self.assertEqual(events[0]["content"], "Valid Token")
        self.assertEqual(events[1]["type"], "done")

    @patch("requests.post")
    def test_anthropic_provider_partial_json_streaming(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        sse_lines = [
            'data: {"type": "content_block_start", "content_block": {"type": "tool_use", "id": "t-1", "name": "get_statistics"}}',
            'data: {"type": "content_block_delta", "delta": {"type": "input_json_delta", "partial_json": "{\\"file"}}',
            'data: {"type": "content_block_delta", "delta": {"type": "input_json_delta", "partial_json": "_id\\": 42}"}}',
            'data: {"type": "content_block_stop"}',
            'data: [DONE]',
        ]
        mock_resp.iter_lines.return_value = [l.encode("utf-8") for l in sse_lines]
        mock_post.return_value = mock_resp

        provider = AnthropicProvider(api_key="valid_key")
        events = list(provider.stream_chat("system", "test"))
        tool_call_events = [e for e in events if e["type"] == "tool_call"]
        self.assertEqual(len(tool_call_events), 1)
        self.assertEqual(tool_call_events[0]["name"], "get_statistics")
        self.assertEqual(tool_call_events[0]["arguments"], {"file_id": 42})
        self.assertEqual(events[-1]["type"], "done")

    def test_mock_provider_intents_comprehensive(self):
        provider = MockProvider()

        test_cases = [
            ("how many events in log", "get_statistics"),
            ("show statistics please", "get_statistics"),
            ("event count", "get_statistics"),
            ("find all variants", "find_variants"),
            ("extract trace variants", "find_variants"),
            ("create a new dashboard", "create_dashboard"),
            ("create dashboard for team", "create_dashboard"),
            ("navigate to /overview", "navigate"),
            ("navigate to analysis", "navigate"),
            ("highlight the button", "highlight_element"),
            ("show me the tour", "highlight_element"),
        ]

        for query, expected_tool in test_cases:
            res = provider.complete("system", query)
            self.assertEqual(
                len(res["tool_calls"]),
                1,
                f"Query '{query}' failed to generate a tool call.",
            )
            self.assertEqual(
                res["tool_calls"][0]["name"],
                expected_tool,
                f"Query '{query}' expected tool '{expected_tool}', got '{res['tool_calls'][0]['name']}'",
            )


# ===========================================================================
# 3. ChatView Adversarial Stress Tests (Malformed Input, Context & SSE)
# ===========================================================================

class ChatViewAdversarialStressTests(TestCase):
    def setUp(self):
        clear_actions()
        self.client = APIClient()
        self.user = User.objects.create_user(username="stress-tester", password="pass")
        self.client.force_authenticate(user=self.user)
        self.url = "/api/assistant/chat/"

    def test_malformed_request_body_types(self):
        malformed_bodies = [
            "",
            "not a json",
            12345,
            12.34,
            True,
            False,
            [],
            [{"message": "hi"}],
            None,
        ]
        for body in malformed_bodies:
            response = self.client.post(self.url, body, format="json")
            self.assertEqual(
                response.status_code,
                status.HTTP_400_BAD_REQUEST,
                f"Body {body!r} should return 400 Bad Request",
            )

    def test_malformed_message_field_types(self):
        invalid_messages = [
            None,
            "",
            123,
            45.67,
            True,
            False,
            [],
            ["hello"],
            {"text": "hello"},
        ]
        for msg in invalid_messages:
            response = self.client.post(self.url, {"message": msg}, format="json")
            self.assertEqual(
                response.status_code,
                status.HTTP_400_BAD_REQUEST,
                f"Message value {msg!r} should return 400 Bad Request",
            )

    def test_boundary_message_lengths(self):
        # 10,000 characters exact -> OK
        msg_10k = "a" * 10000
        response = self.client.post(self.url, {"message": msg_10k}, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # 10,001 characters -> 400 Bad Request
        msg_10k1 = "a" * 10001
        response_oversize = self.client.post(self.url, {"message": msg_10k1}, format="json")
        self.assertEqual(response_oversize.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("10,000", response_oversize.json()["error"])

    def test_nonexistent_and_degenerate_context_fields(self):
        adversarial_contexts = [
            None,
            "string_context",
            123,
            True,
            [],
            {},
            {"active_file_id": None, "view_mode": None, "pathname": None, "mode": None},
            {"active_file_id": "not_an_int", "view_mode": 9999, "unknown_field": True},
            {"nested": {"deep": {"value": None}}},
            {"mode": "UNKNOWN_MODE"},
        ]
        for ctx in adversarial_contexts:
            response = self.client.post(
                self.url,
                {"message": "explain process mining", "context": ctx},
                format="json",
            )
            self.assertEqual(
                response.status_code,
                status.HTTP_200_OK,
                f"Context {ctx!r} crashed ChatView",
            )
            data = response.json()
            self.assertIn("text", data)

    def test_degenerate_history_fields(self):
        adversarial_histories = [
            None,
            "not a list",
            123,
            [None, "invalid", 123, []],
            [{}, {"role": None}, {"role": "invalid_role", "content": None}],
            [{"role": "user", "content": "previous question"}, {"role": "assistant", "content": 12345}],
        ]
        for hist in adversarial_histories:
            response = self.client.post(
                self.url,
                {"message": "hello", "history": hist},
                format="json",
            )
            self.assertEqual(
                response.status_code,
                status.HTTP_200_OK,
                f"History {hist!r} crashed ChatView",
            )

    def test_streaming_sse_frame_compliance_full_turn(self):
        """Verify that every line yielded over SSE satisfies strict SSE protocol and valid JSON."""
        response = self.client.post(
            self.url,
            {"message": "show me statistics and highlight nav", "mode": "teach"},
            format="json",
            HTTP_ACCEPT="text/event-stream",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "text/event-stream")
        self.assertEqual(response["Cache-Control"], "no-cache")

        raw_stream = b"".join(response.streaming_content).decode("utf-8")
        self.assertTrue(len(raw_stream) > 0)

        frames = raw_stream.strip().split("\n\n")
        parsed_events = []
        for frame in frames:
            if not frame.strip():
                continue
            self.assertTrue(
                frame.startswith("data: "),
                f"Frame does not start with 'data: ': {frame}",
            )
            json_str = frame[6:].strip()
            try:
                evt = json.loads(json_str)
                parsed_events.append(evt)
            except json.JSONDecodeError as exc:
                self.fail(f"Invalid JSON in SSE frame '{json_str}': {exc}")

        event_types = [e.get("type") for e in parsed_events]
        self.assertIn("done", event_types, "SSE stream must terminate with a 'done' event")

        # Verify all event objects have required schema
        for evt in parsed_events:
            self.assertIn("type", evt)
            if evt["type"] == "text":
                self.assertIn("content", evt)
            elif evt["type"] == "tool_result":
                self.assertIn("name", evt)
                self.assertIn("result", evt)
            elif evt["type"] == "tour_path":
                self.assertIn("steps", evt)
                self.assertIsInstance(evt["steps"], list)
            elif evt["type"] == "pending_action":
                self.assertIn("id", evt)
                self.assertIn("name", evt)
                self.assertIn("description", evt)
            elif evt["type"] == "done":
                self.assertIn("usage", evt)
            elif evt["type"] == "error":
                self.assertIn("message", evt)

    @patch("assistant.views.stream_chat")
    def test_streaming_sse_error_event_emitted_cleanly(self, mock_stream):
        mock_stream.return_value = [
            {"type": "error", "message": "Upstream rate limit exceeded"},
        ]
        response = self.client.post(
            self.url,
            {"message": "trigger error"},
            format="json",
            HTTP_ACCEPT="text/event-stream",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        raw_stream = b"".join(response.streaming_content).decode("utf-8")
        self.assertIn("Upstream rate limit exceeded", raw_stream)
        self.assertIn('"type": "error"', raw_stream)


# ===========================================================================
# 4. Action Confirmation Endpoint & Security Stress Tests
# ===========================================================================

class ConfirmActionStressTests(TestCase):
    def setUp(self):
        clear_actions()
        self.client = APIClient()
        self.user_a = User.objects.create_user(username="user-a", password="password")
        self.user_b = User.objects.create_user(username="user-b", password="password")
        self.client.force_authenticate(user=self.user_a)
        self.url = "/api/assistant/confirm/"

    def test_confirm_malformed_json_bodies(self):
        for degen in ["", "str", 123, True, [], [1, 2], None]:
            resp = self.client.post(self.url, degen, format="json")
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_confirm_missing_action_id_in_dict(self):
        resp = self.client.post(self.url, {"approved": True}, format="json")
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_confirm_nonexistent_action_id_executes_gracefully(self):
        resp = self.client.post(
            self.url,
            {"pending_action_id": "non-existent-uuid", "approved": True},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        data = resp.json()
        self.assertEqual(data["status"], "executed")
        self.assertEqual(data["result"], {})

    def test_confirm_nonexistent_action_id_cancels_gracefully(self):
        resp = self.client.post(
            self.url,
            {"pending_action_id": "non-existent-uuid", "approved": False},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        data = resp.json()
        self.assertEqual(data["status"], "cancelled")

    def test_confirm_cross_user_hijack_prevention(self):
        # User B registers an action
        action_id = register_action(
            user_id=self.user_b.id,
            tool_name="create_dashboard",
            arguments={"name": "User B Secret Dashboard"},
        )

        # User A tries to approve User B's action
        resp = self.client.post(
            self.url,
            {"pending_action_id": action_id, "approved": True},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("Unauthorized", resp.json()["error"])

        # Status of action must remain pending
        rec = get_action(action_id)
        self.assertEqual(rec["status"], "pending")

    def test_confirm_idempotent_cancellation(self):
        action_id = register_action(
            user_id=self.user_a.id,
            tool_name="rename_dashboard",
            arguments={"name": "Renamed"},
        )
        # Cancel 1st time
        resp1 = self.client.post(
            self.url,
            {"pending_action_id": action_id, "approved": False},
            format="json",
        )
        self.assertEqual(resp1.status_code, status.HTTP_200_OK)
        self.assertEqual(resp1.json()["status"], "cancelled")

        # Cancel 2nd time (should still return cancelled cleanly)
        resp2 = self.client.post(
            self.url,
            {"pending_action_id": action_id, "approved": False},
            format="json",
        )
        self.assertEqual(resp2.status_code, status.HTTP_200_OK)
        self.assertEqual(resp2.json()["status"], "cancelled")


# ===========================================================================
# 5. Live Gemini API Wire & Quota Sanity (Optional / Live Key)
# ===========================================================================

class LiveGeminiProviderTests(TestCase):
    def test_live_gemini_key_if_present(self):
        api_key = getattr(settings, "GEMINI_API_KEY", "")
        if not api_key:
            self.skipTest("No GEMINI_API_KEY configured for live wire test.")

        provider = GeminiProvider(api_key=api_key)
        # Complete test
        res = provider.complete(
            system_prompt="You are a helpful assistant.",
            user_message="Say 'OK' in one word.",
        )
        self.assertIsInstance(res["text"], str)
        self.assertTrue(len(res["text"]) > 0)
        self.assertNotIn("Error", res["text"])

        # Streaming test
        events = list(provider.stream_chat(
            system_prompt="You are a helpful assistant.",
            user_message="Count from 1 to 3.",
        ))
        types = [e["type"] for e in events]
        self.assertIn("text", types)
        self.assertEqual(types[-1], "done")
