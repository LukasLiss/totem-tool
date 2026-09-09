"""
Comprehensive unit and integration test suite for Assistant Knowledge RAG (BM25),
Dynamic Prompt Builder, Multi-Provider LLM Streaming Wrapper, Action Registry,
ChatView SSE Streaming, and Action Confirmation Endpoint.
"""

import json
import uuid
from unittest.mock import MagicMock, patch

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
    OpenAIProvider,
    complete,
    convert_schema_to_gemini,
    format_tool_for_anthropic,
    format_tool_for_gemini,
    format_tool_for_openai,
    get_llm_provider,
    stream_chat,
    validate_provider_key,
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
    slugify_heading,
    tokenize,
)
from mcp_server.policy import ToolCategory, get_category, is_mutable
from mcp_server.server import get_tool_specs


# ===========================================================================
# 1. BM25 Knowledge Retriever Unit Tests
# ===========================================================================

class BM25RetrieverTests(TestCase):
    def setUp(self):
        self.sample_markdown = """# System Overview
TOTEM is an Object-Centric Process Mining tool.

## Process Graphs
### Object-Centric Directly-Follows Graphs (OC-DFG)
OC-DFG discovers directly follows relations between activities across multiple object types.
Use dfg_threshold and act_threshold to filter noisy edges.

### Object-Centric C-Nets (OCCN)
OCCN discovers causal nets with explicit input and output synchronization sets.

## Variants Explorer
Trace variants can be extracted using leading_1hop, leading_bfs, or connected methods.
Graph isomorphism checking is performed using wl+vf2 algorithm.
"""
        self.retriever = BM25Retriever(k1=1.5, b=0.75)
        self.retriever.index_markdown(self.sample_markdown)

    def test_tokenize_clean_words(self):
        text = "Discover OC-DFG models in TOTEM 2.0 with leading_1hop!"
        tokens = tokenize(text)
        self.assertIn("discover", tokens)
        self.assertIn("oc-dfg", tokens)
        self.assertIn("totem", tokens)
        self.assertIn("leading_1hop", tokens)

        tokens_no_stop = tokenize(text, remove_stopwords=True)
        self.assertNotIn("with", tokens_no_stop)
        self.assertIn("discover", tokens_no_stop)

    def test_slugify_heading(self):
        heading = "Object-Centric Directly-Follows Graphs (OC-DFG)!"
        slug = slugify_heading(heading)
        self.assertEqual(slug, "object-centric-directly-follows-graphs-oc-dfg")

    def test_index_markdown_empty(self):
        empty_retriever = BM25Retriever()
        empty_retriever.index_markdown("")
        self.assertEqual(len(empty_retriever.chunks), 0)
        self.assertEqual(empty_retriever.search("process"), [])

    def test_index_markdown_sections(self):
        self.assertTrue(len(self.retriever.chunks) >= 3)
        titles = [c["title"] for c in self.retriever.chunks]
        self.assertIn("Object-Centric Directly-Follows Graphs (OC-DFG)", titles)
        self.assertIn("Object-Centric C-Nets (OCCN)", titles)
        self.assertIn("Variants Explorer", titles)

        for chunk in self.retriever.chunks:
            self.assertIn("anchor", chunk)
            self.assertIn("section", chunk)
            self.assertIn("tokens", chunk)
            self.assertIn("title_tokens", chunk)

    def test_search_exact_match_scores_highest(self):
        results = self.retriever.search("OC-DFG", top_k=2)
        self.assertTrue(len(results) > 0)
        top_chunk, score = results[0]
        self.assertEqual(top_chunk["title"], "Object-Centric Directly-Follows Graphs (OC-DFG)")
        self.assertTrue(score > 0)

    def test_search_rare_word_idf_weighting(self):
        results = self.retriever.search("isomorphism wl+vf2", top_k=1)
        self.assertTrue(len(results) > 0)
        self.assertEqual(results[0][0]["title"], "Variants Explorer")

    def test_search_term_frequency_saturation(self):
        # A document with repeated terms should score higher than 1 occurrence,
        # but with diminishing returns bounded by k1.
        text_a = "# Doc A\nprocess process process process process"
        text_b = "# Doc B\nprocess mining"
        retriever = BM25Retriever(k1=1.5, b=0.75)
        retriever.index_markdown(f"{text_a}\n\n{text_b}")
        res = retriever.search("process", top_k=2)
        self.assertEqual(len(res), 2)
        # Doc A has higher score due to higher TF
        self.assertGreater(res[0][1], res[1][1])

    def test_search_length_normalization(self):
        # Shorter document with the query term should receive less length penalty
        short_doc = "# Short\nC-Nets are formal models."
        long_doc = "# Long\n" + "irrelevant words " * 50 + "C-Nets are formal models."
        retriever = BM25Retriever(k1=1.5, b=0.75)
        retriever.index_markdown(f"{short_doc}\n\n{long_doc}")
        res = retriever.search("C-Nets", top_k=2)
        self.assertEqual(res[0][0]["title"], "Short")

    def test_search_empty_and_whitespace_query(self):
        self.assertEqual(self.retriever.search(""), [])
        self.assertEqual(self.retriever.search("   "), [])

    def test_search_unknown_words_returns_empty(self):
        self.assertEqual(self.retriever.search("xyzzyqwerty12345"), [])

    def test_search_top_k_bounds(self):
        results = self.retriever.search("process", top_k=1)
        self.assertEqual(len(results), 1)

    def test_search_min_score_thresholding(self):
        results = self.retriever.search("process", top_k=5, min_score=9999.0)
        self.assertEqual(len(results), 0)

    def test_retrieve_knowledge_formatted_strings(self):
        chunks = retrieve_knowledge("OCCN", top_k=2)
        self.assertIsInstance(chunks, list)
        if chunks:
            self.assertIsInstance(chunks[0], str)
            self.assertIn("OCCN", chunks[0])

    def test_retrieve_chunks_metadata_fields(self):
        chunks = retrieve_chunks("Variants Explorer", top_k=1)
        self.assertIsInstance(chunks, list)
        if chunks:
            c = chunks[0]
            self.assertIn("title", c)
            self.assertIn("section", c)
            self.assertIn("anchor", c)
            self.assertIn("content", c)
            self.assertIn("score", c)

    def test_reload_index_custom_corpus(self):
        custom_md = "# Custom Section\nCustom content for unit testing."
        reloaded = reload_index(markdown_content=custom_md)
        self.assertEqual(len(reloaded.chunks), 1)
        results = reloaded.search("Custom content")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0][0]["title"], "Custom Section")
        # Reset back to default help.md
        reload_index()


# ===========================================================================
# 2. Dynamic Prompt Builder Unit Tests
# ===========================================================================

class PromptBuilderTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="prompt-user", password="pass")

    def test_normalize_context(self):
        ctx1 = {"selected_file_id": 42, "current_view": "analysis"}
        norm1 = normalize_context(ctx1)
        self.assertEqual(norm1["active_file_id"], 42)
        self.assertEqual(norm1["view_mode"], "analysis")
        self.assertEqual(norm1["pathname"], "/analysis")

        ctx2 = {"active_file_id": 99, "view_mode": "dashboard", "pathname": "/custom-path"}
        norm2 = normalize_context(ctx2)
        self.assertEqual(norm2["active_file_id"], 99)
        self.assertEqual(norm2["view_mode"], "dashboard")
        self.assertEqual(norm2["pathname"], "/custom-path")

    def test_build_system_prompt_default_context(self):
        prompt = build_system_prompt(self.user, context={})
        self.assertIn("TOTeM Process Mining Assistant", prompt)
        self.assertIn("User: prompt-user", prompt)
        self.assertIn("Active View: overview", prompt)
        self.assertIn("TEACH MODE ACTIVE", prompt)

    def test_build_system_prompt_with_active_file_and_view(self):
        context = {"active_file_id": 12, "view_mode": "analysis", "current_dashboard_id": 5}
        prompt = build_system_prompt(self.user, context=context)
        self.assertIn("Active View: analysis", prompt)
        self.assertIn("Active File ID: 12", prompt)
        self.assertIn("Active Dashboard ID: 5", prompt)

    def test_build_system_prompt_teach_mode_instructions(self):
        prompt = build_system_prompt(self.user, mode="teach")
        self.assertIn("TEACH MODE ACTIVE", prompt)
        self.assertIn("highlight_element", prompt)

    def test_build_system_prompt_act_mode_instructions(self):
        prompt = build_system_prompt(self.user, mode="act")
        self.assertIn("ACT MODE ACTIVE", prompt)
        self.assertIn("autonomous process mining and dashboard co-pilot", prompt)

    def test_build_system_prompt_contains_tour_id_catalog(self):
        prompt = build_system_prompt(self.user)
        for tour_id in VALID_TOUR_IDS:
            self.assertIn(f"`{tour_id}`", prompt)

    def test_build_system_prompt_with_rag_query(self):
        prompt = build_system_prompt(self.user, query="OC-DFG")
        self.assertIn("RELEVANT TOTEM DOCUMENTATION", prompt)

    def test_build_system_prompt_handles_malformed_context(self):
        for invalid_ctx in [None, "string", 123, [1, 2, 3], True]:
            prompt = build_system_prompt(self.user, context=invalid_ctx)
            self.assertIsInstance(prompt, str)
            self.assertIn("TOTeM Process Mining Assistant", prompt)


# ===========================================================================
# 3. Action Registry Unit Tests
# ===========================================================================

class ActionRegistryTests(TestCase):
    def setUp(self):
        clear_actions()

    def test_register_and_get_action(self):
        action_id = register_action(
            user_id=1,
            tool_name="create_dashboard",
            arguments={"name": "Test Dashboard"},
            description="Create Test Dashboard",
            context={"view_mode": "dashboard"},
        )
        self.assertIsInstance(action_id, str)
        record = get_action(action_id)
        self.assertIsNotNone(record)
        self.assertEqual(record["user_id"], 1)
        self.assertEqual(record["tool_name"], "create_dashboard")
        self.assertEqual(record["status"], "pending")
        self.assertEqual(record["arguments"]["name"], "Test Dashboard")

    def test_update_action_status(self):
        action_id = register_action(user_id=1, tool_name="remove_component", arguments={"component_id": 5})
        self.assertTrue(update_action_status(action_id, "executed"))
        record = get_action(action_id)
        self.assertEqual(record["status"], "executed")

    def test_cancel_action_with_user_check(self):
        action_id = register_action(user_id=10, tool_name="rename_dashboard", arguments={"name": "New"})
        # Cancel with wrong user should fail
        self.assertFalse(cancel_action(action_id, user_id=99))
        record = get_action(action_id)
        self.assertEqual(record["status"], "pending")

        # Cancel with correct user succeeds
        self.assertTrue(cancel_action(action_id, user_id=10))
        record = get_action(action_id)
        self.assertEqual(record["status"], "cancelled")

    def test_get_nonexistent_action(self):
        self.assertIsNone(get_action("non-existent-uuid"))
        self.assertIsNone(get_action(""))


# ===========================================================================
# 4. Multi-Provider LLM Wrapper Tests
# ===========================================================================

class LLMProviderTests(TestCase):
    def test_convert_schema_to_gemini(self):
        schema = {
            "type": "object",
            "properties": {
                "file_id": {"type": "integer", "description": "ID"},
                "threshold": {"type": "number"},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["file_id"],
        }
        gemini_schema = convert_schema_to_gemini(schema)
        self.assertEqual(gemini_schema["type"], "OBJECT")
        self.assertEqual(gemini_schema["properties"]["file_id"]["type"], "INTEGER")
        self.assertEqual(gemini_schema["properties"]["threshold"]["type"], "NUMBER")
        self.assertEqual(gemini_schema["properties"]["tags"]["type"], "ARRAY")
        self.assertEqual(gemini_schema["properties"]["tags"]["items"]["type"], "STRING")

    def test_format_tool_for_anthropic(self):
        tool_spec = {
            "name": "test_tool",
            "description": "A tool description",
            "parameters": {"type": "object", "properties": {"a": {"type": "string"}}},
        }
        anthropic_tool = format_tool_for_anthropic(tool_spec)
        self.assertEqual(anthropic_tool["name"], "test_tool")
        self.assertIn("input_schema", anthropic_tool)
        self.assertEqual(anthropic_tool["input_schema"], tool_spec["parameters"])

    def test_mock_provider_complete_intents(self):
        provider = MockProvider()

        # Stats intent
        res_stat = provider.complete("system", "show me statistics of event log")
        self.assertEqual(len(res_stat["tool_calls"]), 1)
        self.assertEqual(res_stat["tool_calls"][0]["name"], "get_statistics")

        # Variant intent
        res_var = provider.complete("system", "find variants in the trace")
        self.assertEqual(len(res_var["tool_calls"]), 1)
        self.assertEqual(res_var["tool_calls"][0]["name"], "find_variants")

        # Dashboard intent
        res_dash = provider.complete("system", "create a dashboard for me")
        self.assertEqual(len(res_dash["tool_calls"]), 1)
        self.assertEqual(res_dash["tool_calls"][0]["name"], "create_dashboard")

        # Generic echo
        res_echo = provider.complete("system", "hello world")
        self.assertEqual(res_echo["tool_calls"], [])
        self.assertIn("hello world", res_echo["text"])

    def test_mock_provider_stream_chat(self):
        provider = MockProvider()
        events = list(provider.stream_chat("system", "show me statistics"))
        types = [e["type"] for e in events]
        self.assertIn("tool_call", types)
        self.assertIn("text", types)
        self.assertIn("done", types)

    @override_settings(GEMINI_API_KEY="", ANTHROPIC_API_KEY="")
    def test_get_llm_provider_selection_mock_default(self):
        provider = get_llm_provider()
        self.assertIsInstance(provider, MockProvider)

    @override_settings(GEMINI_API_KEY="test-gemini-key", ANTHROPIC_API_KEY="")
    def test_get_llm_provider_selection_gemini(self):
        provider = get_llm_provider()
        self.assertIsInstance(provider, GeminiProvider)

    @override_settings(GEMINI_API_KEY="", ANTHROPIC_API_KEY="test-anthropic-key")
    def test_get_llm_provider_selection_anthropic(self):
        provider = get_llm_provider()
        self.assertIsInstance(provider, AnthropicProvider)

    @patch("requests.post")
    def test_gemini_provider_complete_mock(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"text": "Hello from Gemini"},
                            {
                                "functionCall": {
                                    "name": "get_statistics",
                                    "args": {"file_id": 1},
                                }
                            },
                        ]
                    }
                }
            ],
            "usageMetadata": {
                "promptTokenCount": 15,
                "candidatesTokenCount": 20,
                "totalTokenCount": 35,
            },
        }
        mock_post.return_value = mock_resp

        provider = GeminiProvider(api_key="fake-gemini-key")
        result = provider.complete("system", "show stats", tools=get_tool_specs())
        self.assertEqual(result["text"], "Hello from Gemini")
        self.assertEqual(len(result["tool_calls"]), 1)
        self.assertEqual(result["tool_calls"][0]["name"], "get_statistics")
        self.assertEqual(result["usage"]["total_tokens"], 35)

    @patch("requests.post")
    def test_gemini_provider_stream_mock(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        sse_chunk1 = json.dumps({
            "candidates": [{"content": {"parts": [{"text": "Token 1 "}]}}]
        })
        sse_chunk2 = json.dumps({
            "candidates": [{"content": {"parts": [{"text": "Token 2"}]}}],
            "usageMetadata": {"totalTokenCount": 50},
        })
        mock_resp.iter_lines.return_value = [
            f"data: {sse_chunk1}".encode("utf-8"),
            f"data: {sse_chunk2}".encode("utf-8"),
        ]
        mock_post.return_value = mock_resp

        provider = GeminiProvider(api_key="fake-gemini-key")
        events = list(provider.stream_chat("system", "hello"))
        texts = [e["content"] for e in events if e["type"] == "text"]
        self.assertEqual("".join(texts), "Token 1 Token 2")
        self.assertEqual(events[-1]["type"], "done")
        self.assertEqual(events[-1]["usage"]["total_tokens"], 50)

    @patch("requests.post")
    def test_anthropic_provider_complete_mock(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "content": [
                {"type": "text", "text": "Hello from Claude"},
                {
                    "type": "tool_use",
                    "id": "claude-tool-1",
                    "name": "get_statistics",
                    "input": {"file_id": 2},
                },
            ],
            "usage": {"input_tokens": 10, "output_tokens": 15},
        }
        mock_post.return_value = mock_resp

        provider = AnthropicProvider(api_key="fake-anthropic-key")
        result = provider.complete("system", "show stats", tools=get_tool_specs())
        self.assertEqual(result["text"], "Hello from Claude")
        self.assertEqual(len(result["tool_calls"]), 1)
        self.assertEqual(result["tool_calls"][0]["name"], "get_statistics")
        self.assertEqual(result["usage"]["total_tokens"], 25)

    @patch("requests.post")
    def test_anthropic_provider_stream_mock(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        sse_lines = [
            'data: {"type": "content_block_start", "content_block": {"type": "text", "text": ""}}',
            'data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Claude "}}',
            'data: {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Streaming"}}',
            'data: {"type": "content_block_stop"}',
            'data: [DONE]',
        ]
        mock_resp.iter_lines.return_value = [l.encode("utf-8") for l in sse_lines]
        mock_post.return_value = mock_resp

        provider = AnthropicProvider(api_key="fake-anthropic-key")
        events = list(provider.stream_chat("system", "hello"))
        texts = [e["content"] for e in events if e["type"] == "text"]
        self.assertEqual("".join(texts), "Claude Streaming")
        self.assertEqual(events[-1]["type"], "done")



# ===========================================================================
# 5. ChatView Integration Tests
# ===========================================================================

class ChatViewIntegrationTests(TestCase):
    def setUp(self):
        clear_actions()
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

    def test_chat_rejects_overlong_message(self):
        long_message = "x" * 10001
        response = self.client.post(self.url, {"message": long_message}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("10,000", response.json()["error"])

    def test_chat_rejects_non_dict_payload(self):
        for payload in [[], [1, 2], "string_payload", 123, True]:
            response = self.client.post(self.url, payload, format="json")
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_chat_handles_non_dict_context(self):
        for invalid_ctx in ["string_context", 123, [1, 2], True]:
            response = self.client.post(
                self.url,
                {"message": "hello", "context": invalid_ctx},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)

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

    def test_chat_accepts_sse_header(self):
        response = self.client.post(
            self.url,
            {"message": "hello"},
            format="json",
            HTTP_ACCEPT="text/event-stream",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response["Content-Type"].startswith("text/event-stream"))

    @patch("assistant.views.complete")
    def test_chat_passes_context_to_prompt_builder(self, mock_complete):
        mock_complete.return_value = {"text": "hi", "tool_calls": [], "usage": {}}
        context = {"current_view": "dashboard", "selected_file_id": 42}

        self.client.post(
            self.url,
            {"message": "hello", "context": context},
            format="json",
        )

        self.assertTrue(mock_complete.called)
        call_kwargs = mock_complete.call_args.kwargs
        self.assertIn("system_prompt", call_kwargs)
        self.assertIn("user_message", call_kwargs)
        self.assertIn("Active View: dashboard", call_kwargs["system_prompt"])
        self.assertIn("Active File ID: 42", call_kwargs["system_prompt"])

    @patch("assistant.views.call_tool", return_value={"num_events": 100})
    @patch("assistant.views.complete")
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

    @patch("assistant.views.complete")
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
        # Action should be recorded in registry
        action_id = data["pending_actions"][0]["id"]
        self.assertIsNotNone(get_action(action_id))

    @patch("assistant.views.stream_chat")
    def test_chat_teach_mode_highlight_tool_generates_tour_event(self, mock_stream):
        mock_stream.return_value = [
            {
                "type": "tool_call",
                "id": "tc-high",
                "name": "highlight_element",
                "arguments": {"tour_id": "nav-overview", "label": "Start here"},
            },
            {"type": "text", "content": "Let me show you the overview."},
            {"type": "done", "usage": {}},
        ]

        response = self.client.post(
            self.url,
            {"message": "show me overview", "mode": "teach"},
            format="json",
            HTTP_ACCEPT="text/event-stream",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        content = b"".join(response.streaming_content).decode("utf-8")
        self.assertIn("tour_path", content)
        self.assertIn("nav-overview", content)
        self.assertIn("pending_action", content)

    @patch("assistant.views.complete")
    def test_chat_handles_unknown_tool_non_streaming(self, mock_complete):
        llm_response = {
            "text": "Attempted tool call",
            "tool_calls": [
                {"id": "tc-hallucinated", "name": "hallucinated_unknown_tool", "arguments": {}}
            ],
            "usage": {},
        }
        mock_complete.return_value = llm_response

        response = self.client.post(
            self.url, {"message": "run unknown tool"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(len(data["tool_calls"]), 1)
        self.assertIn("error", data["tool_calls"][0]["result"])
        self.assertIn("Unknown tool", data["tool_calls"][0]["result"]["error"])

    @patch("assistant.views.stream_chat")
    def test_chat_handles_unknown_tool_streaming(self, mock_stream):
        mock_stream.return_value = [
            {"type": "tool_call", "id": "tc-hallucinated", "name": "hallucinated_stream_tool", "arguments": {}},
            {"type": "text", "content": "streaming text"},
            {"type": "done", "usage": {}},
        ]

        response = self.client.post(
            self.url,
            {"message": "run unknown tool streaming"},
            format="json",
            HTTP_ACCEPT="text/event-stream",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        content = b"".join(response.streaming_content).decode("utf-8")
        self.assertIn("Unknown tool: hallucinated_stream_tool", content)
        self.assertIn("streaming text", content)


# ===========================================================================
# 6. Action Confirmation Endpoint Tests
# ===========================================================================

class ConfirmActionTests(TestCase):
    def setUp(self):
        clear_actions()
        self.client = APIClient()
        self.user = User.objects.create_user(username="confirm-user", password="pass")
        self.client.force_authenticate(user=self.user)
        self.url = "/api/assistant/confirm/"

    def test_confirm_requires_authentication(self):
        anonymous = APIClient()
        response = anonymous.post(self.url, {"pending_action_id": "abc-123", "approved": True}, format="json")
        self.assertIn(response.status_code, (401, 403))

    def test_confirm_rejects_non_dict_payload(self):
        for payload in [[], [1, 2], "invalid", 123, True]:
            response = self.client.post(self.url, payload, format="json")
            self.assertEqual(
                response.status_code, status.HTTP_400_BAD_REQUEST,
                f"Expected 400 for payload {payload!r}",
            )

    def test_confirm_rejects_missing_pending_action_id(self):
        response = self.client.post(self.url, {"approved": True}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_confirm_supports_action_id_alias(self):
        response = self.client.post(
            self.url,
            {"action_id": "abc-123", "approved": True},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["status"], "executed")

    def test_confirm_cancel_registered_action(self):
        action_id = register_action(
            user_id=self.user.id,
            tool_name="create_dashboard",
            arguments={"name": "Cancel Me"},
        )
        response = self.client.post(
            self.url,
            {"pending_action_id": action_id, "approved": False},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["status"], "cancelled")
        record = get_action(action_id)
        self.assertEqual(record["status"], "cancelled")

    def test_confirm_approve_registered_action(self):
        action_id = register_action(
            user_id=self.user.id,
            tool_name="create_dashboard",
            arguments={"name": "Approved Dashboard"},
        )
        response = self.client.post(
            self.url,
            {"pending_action_id": action_id, "approved": True},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data["status"], "executed")
        self.assertEqual(data["pending_action_id"], action_id)
        self.assertIn("result", data)
        record = get_action(action_id)
        self.assertEqual(record["status"], "executed")

    def test_confirm_rejects_unauthorized_user(self):
        other_user = User.objects.create_user(username="other-user", password="pass")
        action_id = register_action(
            user_id=other_user.id,
            tool_name="rename_dashboard",
            arguments={"name": "Stolen"},
        )
        # Attempt to confirm by self.user
        response = self.client.post(
            self.url,
            {"pending_action_id": action_id, "approved": True},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("Unauthorized", response.json()["error"])


# ===========================================================================
# 7. MCP Tool Spec & Policy Tests
# ===========================================================================

class ToolSpecAndPolicyTests(TestCase):
    def test_get_tool_specs_returns_list_with_all_18_tools(self):
        specs = get_tool_specs()
        self.assertEqual(len(specs), 18)
        names = {s["name"] for s in specs}
        expected = {
            "get_statistics", "get_object_types", "discover_totem",
            "discover_occn", "discover_mlpa", "find_variants",
            "get_oc_dotted_chart", "get_layout", "list_dashboards",
            "list_assets", "create_dashboard", "add_component",
            "remove_component", "update_component", "rename_dashboard",
            "navigate", "set_view_mode", "highlight_element",
        }
        self.assertEqual(names, expected)

    def test_policy_classification_accuracy(self):
        read_only_tools = [
            "get_statistics", "get_object_types", "discover_totem",
            "discover_occn", "discover_mlpa", "find_variants",
            "get_oc_dotted_chart", "get_layout", "list_dashboards", "list_assets",
        ]
        for name in read_only_tools:
            self.assertEqual(get_category(name), ToolCategory.READ_ONLY)
            self.assertFalse(is_mutable(name))

        mutating_tools = [
            "create_dashboard", "add_component", "remove_component",
            "update_component", "rename_dashboard",
        ]
        for name in mutating_tools:
            self.assertEqual(get_category(name), ToolCategory.MUTATING)
            self.assertTrue(is_mutable(name))

        frontend_tools = ["navigate", "set_view_mode", "highlight_element"]
        for name in frontend_tools:
            self.assertEqual(get_category(name), ToolCategory.REQUIRES_FRONTEND)
            self.assertTrue(is_mutable(name))


# ===========================================================================
# 8. M3 Challenger Resilience & Regression Tests
# ===========================================================================

class M3ResilienceRegressionTests(TestCase):
    """
    Regression tests for edge cases identified during Milestone 3 Challenger review:
      1. Action registry resilience with non-string keys (avoid unhashable type TypeError).
      2. confirm_action endpoint validation for non-string / empty action IDs and boolean string parsing.
      3. Dynamic prompt builder and ChatView safety on non-string mode values.
      4. BM25Retriever safety on negative/zero top_k and non-string/empty queries.
      5. GeminiProvider safety when candidates contain null content (finishReason: SAFETY).
    """

    def setUp(self):
        clear_actions()
        self.client = APIClient()
        self.user = User.objects.create_user(username="resilience-user", password="pass")
        self.client.force_authenticate(user=self.user)

    # 1. Action registry resilience
    def test_action_registry_non_string_keys(self):
        for invalid_key in [[1, 2], {"id": "123"}, 123, None, True, ("tuple", "key")]:
            self.assertIsNone(get_action(invalid_key))
            self.assertFalse(update_action_status(invalid_key, "executed"))
            self.assertFalse(cancel_action(invalid_key, user_id=self.user.id))

    # 2. confirm_action validation and boolean string coercion
    def test_confirm_action_malformed_pending_action_id(self):
        for invalid_id in [[1, 2], {"a": "b"}, 123, "", "   "]:
            response = self.client.post(
                "/api/assistant/confirm/",
                {"pending_action_id": invalid_id, "approved": True},
                format="json",
            )
            self.assertEqual(
                response.status_code,
                status.HTTP_400_BAD_REQUEST,
                f"Expected 400 for invalid pending_action_id: {invalid_id!r}",
            )
            self.assertIn("Invalid or missing pending_action_id", response.json().get("error", ""))

    def test_confirm_action_string_boolean_parsing(self):
        # Test string "false", "0", "no" -> cancels action
        for falsey_str in ["false", "FALSE", "0", "no"]:
            aid = register_action(
                user_id=self.user.id,
                tool_name="create_dashboard",
                arguments={"name": "Cancel Test"},
            )
            response = self.client.post(
                "/api/assistant/confirm/",
                {"pending_action_id": aid, "approved": falsey_str},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(response.json()["status"], "cancelled")
            record = get_action(aid)
            self.assertEqual(record["status"], "cancelled")

        # Test string "true", "1", "yes" -> executes action
        for truthy_str in ["true", "TRUE", "1", "yes"]:
            aid = register_action(
                user_id=self.user.id,
                tool_name="create_dashboard",
                arguments={"name": "Approve Test"},
            )
            response = self.client.post(
                "/api/assistant/confirm/",
                {"pending_action_id": aid, "approved": truthy_str},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(response.json()["status"], "executed")
            record = get_action(aid)
            self.assertEqual(record["status"], "executed")

    # 3. Dynamic prompt builder & ChatView non-string mode
    def test_prompt_builder_non_string_mode(self):
        for invalid_mode in [123, True, False, 45.6, ["teach"]]:
            prompt = build_system_prompt(self.user, mode=invalid_mode)
            self.assertIsInstance(prompt, str)
            self.assertIn("TOTeM Process Mining Assistant", prompt)

        prompt_ctx = build_system_prompt(self.user, context={"mode": 123})
        self.assertIsInstance(prompt_ctx, str)

        norm = normalize_context({"mode": 999})
        self.assertEqual(norm["mode"], "999")

    def test_chat_view_handles_non_string_mode(self):
        for mode_val in [123, True, 45.6]:
            response = self.client.post(
                "/api/assistant/chat/",
                {"message": "help me with overview", "mode": mode_val},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_200_OK)

            response_ctx = self.client.post(
                "/api/assistant/chat/",
                {"message": "help me with overview", "context": {"mode": mode_val}},
                format="json",
            )
            self.assertEqual(response_ctx.status_code, status.HTTP_200_OK)

    # 4. BM25Retriever negative top_k and invalid queries
    def test_bm25_retriever_negative_top_k_and_invalid_queries(self):
        retriever = BM25Retriever()
        retriever.index_markdown("# Sample\nProcess mining content for retrieval testing.")

        # Negative and zero top_k
        self.assertEqual(retriever.search("process", top_k=-10), [])
        self.assertEqual(retriever.search("process", top_k=-1), [])
        self.assertEqual(retriever.search("process", top_k=0), [])

        # Non-string queries
        for invalid_query in [None, 123, True, [1, 2], {"a": "b"}, "   ", "\t\n"]:
            self.assertEqual(retriever.search(invalid_query, top_k=3), [])

    # 5. GeminiProvider SAFETY block with null content
    @patch("requests.post")
    def test_gemini_provider_safety_block_content_null_complete(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "candidates": [
                {
                    "finishReason": "SAFETY",
                    "content": None,
                }
            ],
            "usageMetadata": {
                "promptTokenCount": 10,
                "candidatesTokenCount": 0,
                "totalTokenCount": 10,
            },
        }
        mock_post.return_value = mock_resp

        provider = GeminiProvider(api_key="fake-gemini-key")
        result = provider.complete("system", "unsafe prompt")
        self.assertEqual(result["text"], "")
        self.assertEqual(result["tool_calls"], [])
        self.assertEqual(result["usage"]["total_tokens"], 10)

    @patch("requests.post")
    def test_gemini_provider_safety_block_content_null_stream(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        sse_chunk = json.dumps({
            "candidates": [
                {
                    "finishReason": "SAFETY",
                    "content": None,
                }
            ],
            "usageMetadata": {"totalTokenCount": 12},
        })
        mock_resp.iter_lines.return_value = [
            f"data: {sse_chunk}".encode("utf-8"),
        ]
        mock_post.return_value = mock_resp

        provider = GeminiProvider(api_key="fake-gemini-key")
        events = list(provider.stream_chat("system", "unsafe prompt"))
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "done")
        self.assertEqual(events[0]["usage"]["total_tokens"], 12)


# ===========================================================================
# 8. OpenAIProvider and Key Validation Endpoint Tests
# ===========================================================================

class OpenAIProviderTests(TestCase):
    def test_format_tool_for_openai(self):
        tool_spec = {
            "name": "get_stats",
            "description": "Get statistics",
            "parameters": {
                "type": "object",
                "properties": {"file_id": {"type": "integer"}},
                "required": ["file_id"],
            },
        }
        res = format_tool_for_openai(tool_spec)
        self.assertEqual(res["type"], "function")
        self.assertEqual(res["function"]["name"], "get_stats")
        self.assertEqual(res["function"]["description"], "Get statistics")
        self.assertIn("file_id", res["function"]["parameters"]["properties"])

    def test_missing_api_key_complete(self):
        provider = OpenAIProvider(api_key="")
        res = provider.complete("system", "hello")
        self.assertEqual(res.get("error_type"), "key_error")
        self.assertIn("missing", res.get("text", "").lower())

    def test_missing_api_key_stream(self):
        provider = OpenAIProvider(api_key="")
        events = list(provider.stream_chat("system", "hello"))
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["type"], "key_error")
        self.assertEqual(events[0]["provider"], "openai")

    @patch("requests.post")
    def test_openai_provider_complete_success(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [
                {
                    "message": {
                        "content": "Hello from OpenAI!",
                        "tool_calls": [
                            {
                                "id": "call_123",
                                "function": {
                                    "name": "get_statistics",
                                    "arguments": json.dumps({"file_id": 1}),
                                },
                            }
                        ],
                    }
                }
            ],
            "usage": {"prompt_tokens": 15, "completion_tokens": 8, "total_tokens": 23},
        }
        mock_post.return_value = mock_resp

        provider = OpenAIProvider(api_key="sk-test-key")
        res = provider.complete("system prompt", "user query")
        self.assertEqual(res["text"], "Hello from OpenAI!")
        self.assertEqual(len(res["tool_calls"]), 1)
        self.assertEqual(res["tool_calls"][0]["name"], "get_statistics")
        self.assertEqual(res["tool_calls"][0]["arguments"], {"file_id": 1})
        self.assertEqual(res["usage"]["total_tokens"], 23)

    @patch("requests.post")
    def test_openai_provider_stream_success(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        chunk1 = json.dumps({
            "choices": [{"delta": {"content": "Chunk 1"}}]
        })
        chunk2 = json.dumps({
            "choices": [
                {
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call_abc",
                                "function": {"name": "navigate", "arguments": '{"route": "/view"}'},
                            }
                        ]
                    },
                    "finish_reason": "tool_calls",
                }
            ]
        })
        mock_resp.iter_lines.return_value = [
            f"data: {chunk1}".encode("utf-8"),
            f"data: {chunk2}".encode("utf-8"),
            b"data: [DONE]",
        ]
        mock_post.return_value = mock_resp

        provider = OpenAIProvider(api_key="sk-test-key")
        events = list(provider.stream_chat("system prompt", "user query"))
        types = [e["type"] for e in events]
        self.assertIn("text", types)
        self.assertIn("tool_call", types)
        self.assertIn("done", types)


class ValidateApiKeyEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="val_user", password="password")
        self.client.force_authenticate(user=self.user)
        self.url = "/api/assistant/validate-key/"

    def test_empty_request_body_fails(self):
        res = self.client.post(self.url, {}, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_empty_key_fails(self):
        res = self.client.post(self.url, {"provider": "gemini", "api_key": ""}, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(res.data.get("valid"))

    @patch("requests.get")
    def test_gemini_key_validation_success(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_get.return_value = mock_resp

        res = self.client.post(self.url, {"provider": "gemini", "api_key": "AIzaSy_fake"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data.get("valid"))
        self.assertEqual(res.data.get("provider"), "gemini")

    @patch("requests.get")
    def test_openai_key_validation_success(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_get.return_value = mock_resp

        res = self.client.post(self.url, {"provider": "openai", "api_key": "sk-proj-test"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data.get("valid"))
        self.assertEqual(res.data.get("provider"), "openai")

    @patch("requests.get")
    def test_anthropic_key_validation_success(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_get.return_value = mock_resp

        res = self.client.post(self.url, {"provider": "anthropic", "api_key": "sk-ant-test"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data.get("valid"))
        self.assertEqual(res.data.get("provider"), "anthropic")


