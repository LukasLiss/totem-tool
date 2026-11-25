"""Tests for the assistant agent loop, providers and endpoints."""

import json
import tempfile
from typing import Any, Dict, List
from unittest import mock

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api import views as api_views
from api.models import Dashboard, EventLog, Project
from mcp_server.tests import write_order_log

from . import action_registry, conversation as conv_store
from .harness import MAX_STEPS, run_turn
from .prompts import build_system_prompt, render_ui_context, resolve_ui_context
from .providers import (
    AnthropicProvider,
    GeminiProvider,
    OpenAIProvider,
    Provider,
    ProviderError,
    get_provider,
)

_MEDIA_ROOT = tempfile.mkdtemp(prefix="totem-assistant-harness-")


# -----------------------------------------------------------------------------
# Scripted provider: each step returns a list of canonical blocks
# -----------------------------------------------------------------------------

def tool(name, args=None, id=None):
    return {"type": "tool_use", "id": id or f"toolu_{name}_{len(str(args))}", "name": name, "input": args or {}}


def text(t):
    return {"type": "text", "text": t}


class ScriptedProvider(Provider):
    name = "scripted"

    def __init__(self, steps: List[Any]):
        super().__init__("key", "scripted-model")
        self.steps = list(steps)
        self.calls: List[Dict[str, Any]] = []

    def stream(self, system, messages, tools):
        self.calls.append({"system": system, "messages": json.loads(json.dumps(messages)), "tools": [t["name"] for t in tools]})
        step = self.steps.pop(0)
        if isinstance(step, Exception):
            raise step
        stop = "end_turn"
        if isinstance(step, tuple):
            step, stop = step
        elif any(b["type"] == "tool_use" for b in step):
            stop = "tool_use"
        for b in step:
            if b["type"] == "text":
                yield {"type": "text", "text": b["text"]}
        yield {"type": "message", "message": {"role": "assistant", "content": step, "provider": {"name": "scripted"}}, "stop_reason": stop, "usage": {"input_tokens": 10, "output_tokens": 5}}


def assert_valid_transcript(test, messages):
    """Every tool_use is answered by a tool_result in the next message."""
    for i, msg in enumerate(messages):
        uses = [b["id"] for b in msg["content"] if b["type"] == "tool_use"]
        if uses:
            test.assertEqual(messages[i + 1]["role"], "user")
            answered = [b["tool_use_id"] for b in messages[i + 1]["content"] if b["type"] == "tool_result"]
            test.assertEqual(sorted(uses), sorted(answered))


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class HarnessTests(TestCase):
    def setUp(self):
        cache.clear()
        api_views._OCEL_DB_REGISTRY.clear()
        api_views._OCEL_OBJECT_TYPES_REGISTRY.clear()
        self.user = User.objects.create_user("analyst", password="pw")
        self.project = Project.objects.create(name="orders")
        self.project.users.add(self.user)
        filename = f"orders-{self._testMethodName}.duckdb"
        write_order_log(f"{_MEDIA_ROOT}/{filename}")
        self.log = EventLog.objects.create(project=self.project, file=filename)
        self.ui = resolve_ui_context(self.user, {"active_file_id": self.log.id, "view_mode": "overview"})

    def run_turn(self, provider, text_="hi", mode="act", conversation_id=None):
        events = list(run_turn(user=self.user, conversation_id=conversation_id, mode=mode, text=text_, ui_context=self.ui, provider=provider))
        return events, events[0]["conversation_id"]

    def stored(self, conversation_id):
        return conv_store.load(self.user.id, conversation_id).messages

    # --- the loop -------------------------------------------------------------

    def test_read_tool_result_is_fed_back_until_the_model_answers(self):
        p = ScriptedProvider(
            [
                [text("Checking."), tool("get_log_overview", id="t1")],
                [tool("get_directly_follows", {"object_type": "order"}, id="t2")],
                [text("Orders wait up to 2 days before shipping.")],
            ]
        )
        events, cid = self.run_turn(p, "where is the bottleneck?")
        types = [e["type"] for e in events]
        self.assertEqual(types[0], "conversation")
        self.assertEqual(types[-1], "done")
        self.assertEqual([e["name"] for e in events if e["type"] == "tool_end" and e["ok"]], ["get_log_overview", "get_directly_follows"])
        self.assertEqual(len(p.calls), 3)

        # The model saw the actual data in the next step.
        second_request = p.calls[1]["messages"]
        result = second_request[-1]["content"][0]
        self.assertEqual(result["type"], "tool_result")
        self.assertEqual(json.loads(result["content"])["events"], 6)
        third = json.loads(p.calls[2]["messages"][-1]["content"][0]["content"])
        self.assertEqual(third["edges"][0]["from"], "place order")

        # The user turn carries the UI context, the system prompt does not.
        first_user = p.calls[0]["messages"][0]["content"][-1]["text"]
        self.assertIn("<ui_context>", first_user)
        self.assertIn(EventLog.objects.get(id=self.log.id).file.name.split("/")[-1], first_user)
        self.assertNotIn("ui_context", p.calls[0]["system"])
        self.assertEqual(p.calls[0]["system"], p.calls[2]["system"])

        msgs = self.stored(cid)
        self.assertEqual([m["role"] for m in msgs], ["user", "assistant", "user", "assistant", "user", "assistant"])
        assert_valid_transcript(self, msgs)
        self.assertEqual(events[-1]["usage"]["input_tokens"], 30)

    def test_text_from_separate_steps_is_split_into_paragraphs(self):
        p = ScriptedProvider([[text("Checking the log."), tool("list_event_logs", id="l")], [text("Found it.")]])
        events, _ = self.run_turn(p)
        streamed = "".join(e["text"] for e in events if e["type"] == "text")
        self.assertEqual(streamed, "Checking the log.\n\nFound it.")

    def test_conversation_continues_across_turns(self):
        p = ScriptedProvider([[text("first")], [text("second")]])
        _, cid = self.run_turn(p, "one")
        events, cid2 = self.run_turn(p, "two", conversation_id=cid)
        self.assertEqual(cid, cid2)
        roles = [m["role"] for m in p.calls[1]["messages"]]
        self.assertEqual(roles, ["user", "assistant", "user"])

    def test_switching_mode_starts_a_new_conversation(self):
        p = ScriptedProvider([[text("a")], [text("b")]])
        _, cid = self.run_turn(p, "one", mode="act")
        _, cid2 = self.run_turn(p, "two", mode="teach", conversation_id=cid)
        self.assertNotEqual(cid, cid2)
        self.assertEqual(len(p.calls[1]["messages"]), 1)

    def test_tool_errors_go_back_to_the_model(self):
        p = ScriptedProvider(
            [
                [tool("get_activity_stats", {"object_type": "invoice"}, id="a"), tool("get_log_overview", {"bogus": 1}, id="b"), tool("made_up", id="c")],
                [text("Sorry.")],
            ]
        )
        events, cid = self.run_turn(p)
        results = p.calls[1]["messages"][-1]["content"]
        self.assertTrue(all(r["is_error"] for r in results))
        self.assertIn("Object types in this log", results[0]["content"])
        self.assertIn("Invalid", results[1]["content"])
        self.assertIn("not available", results[2]["content"])
        self.assertEqual([e["ok"] for e in events if e["type"] == "tool_end"], [False, False])
        assert_valid_transcript(self, self.stored(cid))

    def test_unexpected_tool_crash_is_contained(self):
        p = ScriptedProvider([[tool("get_log_overview", id="x")], [text("ok")]])
        with mock.patch("mcp_server.server.get_log_overview", side_effect=RuntimeError("boom")):
            # The registry holds a reference to the original function, so patch through it.
            from mcp_server import server

            original = server.TOOLS_BY_NAME["get_log_overview"]
            broken = original.__class__(**{**original.__dict__, "handler": mock.Mock(side_effect=RuntimeError("boom"))})
            with mock.patch.dict(server.TOOLS_BY_NAME, {"get_log_overview": broken}):
                events, _ = self.run_turn(p)
        result = p.calls[1]["messages"][-1]["content"][0]
        self.assertTrue(result["is_error"])
        self.assertIn("boom", result["content"])
        self.assertEqual(events[-1]["type"], "done")

    # --- proposals and approval ------------------------------------------------

    def test_changes_are_proposed_not_executed(self):
        p = ScriptedProvider([[tool("create_dashboard", {"name": "Ops"}, id="c1")], [text("I proposed a dashboard; approve it to create it.")]])
        events, cid = self.run_turn(p)
        pending = [e for e in events if e["type"] == "pending_action"]
        self.assertEqual(len(pending), 1)
        self.assertFalse(Dashboard.objects.filter(name="Ops").exists())
        result = json.loads(p.calls[1]["messages"][-1]["content"][0]["content"])
        self.assertEqual(result["status"], "awaiting_user_approval")
        record = action_registry.get_action(pending[0]["id"])
        self.assertEqual(record["user_id"], self.user.id)
        self.assertEqual(record["conversation_id"], cid)

    def test_teach_mode_cannot_propose_changes(self):
        p = ScriptedProvider([[tool("create_dashboard", {"name": "Ops"}, id="c1")], [text("ok")]])
        events, _ = self.run_turn(p, mode="teach")
        self.assertNotIn("create_dashboard", p.calls[0]["tools"])
        self.assertFalse([e for e in events if e["type"] == "pending_action"])
        self.assertTrue(p.calls[1]["messages"][-1]["content"][0]["is_error"])

    def test_client_actions_are_forwarded_and_tour_ids_checked(self):
        p = ScriptedProvider(
            [
                [tool("open_view", {"view": "analysis", "component": "variants"}, id="v"), tool("start_tour", {"steps": [{"tour_id": "nav-nowhere", "label": "x"}]}, id="t")],
                [tool("start_tour", {"steps": [{"tour_id": "nav-analysis", "label": "Open Analysis"}]}, id="t2")],
                [text("done")],
            ]
        )
        events, _ = self.run_turn(p)
        actions = [e for e in events if e["type"] == "client_action"]
        self.assertEqual([a["name"] for a in actions], ["open_view", "start_tour"])
        bad_tour = p.calls[1]["messages"][-1]["content"][1]
        self.assertTrue(bad_tour["is_error"])
        self.assertIn("nav-analysis", bad_tour["content"])

    # --- failures and limits -------------------------------------------------------

    def test_provider_error_ends_the_turn_cleanly(self):
        p = ScriptedProvider([[tool("get_log_overview", id="t")], ProviderError("rate_limit", "slow down", 429)])
        events, cid = self.run_turn(p)
        err = [e for e in events if e["type"] == "error"][0]
        self.assertEqual(err["code"], "rate_limit")
        self.assertTrue(err["retryable"])
        self.assertEqual(events[-1]["type"], "done")
        assert_valid_transcript(self, self.stored(cid))

    def test_refusal_with_tool_call_does_not_run_it(self):
        p = ScriptedProvider([([tool("get_log_overview", id="r")], "refusal")])
        events, cid = self.run_turn(p)
        self.assertFalse([e for e in events if e["type"] == "tool_start"])
        self.assertTrue([e for e in events if e["type"] == "notice"])
        assert_valid_transcript(self, self.stored(cid))

    def test_truncated_tool_call_is_not_executed(self):
        p = ScriptedProvider([([tool("create_dashboard", {"name": "Ops"}, id="m")], "max_tokens"), [text("ok")]])
        events, _ = self.run_turn(p)
        self.assertFalse([e for e in events if e["type"] == "pending_action"])
        self.assertTrue(p.calls[1]["messages"][-1]["content"][0]["is_error"])

    def test_step_budget(self):
        p = ScriptedProvider([[tool("list_event_logs", id=f"s{i}")] for i in range(MAX_STEPS)])
        events, cid = self.run_turn(p)
        self.assertEqual(len(p.calls), MAX_STEPS)
        self.assertIn("Stopped after", [e for e in events if e["type"] == "notice"][0]["text"])
        assert_valid_transcript(self, self.stored(cid))

    def test_client_disconnect_mid_tool_keeps_transcript_valid_and_unlocks(self):
        p = ScriptedProvider([[tool("get_log_overview", id="a"), tool("list_event_logs", id="b")], [text("next turn")]])
        gen = run_turn(user=self.user, conversation_id=None, mode="act", text="go", ui_context=self.ui, provider=p)
        cid = next(gen)["conversation_id"]
        for ev in gen:
            if ev["type"] == "tool_start":
                break
        gen.close()  # what Django does when the browser goes away
        msgs = self.stored(cid)
        assert_valid_transcript(self, msgs)
        self.assertIn("cancelled", msgs[-1]["content"][0]["content"])
        # Not locked: the next turn runs.
        events, _ = self.run_turn(p, "again", conversation_id=cid)
        self.assertEqual(events[-1]["type"], "done")
        self.assertFalse([e for e in events if e["type"] == "error"])

    def test_concurrent_turns_are_refused(self):
        conv_store.acquire_turn(self.user.id, "conv_locked_conversation")
        with mock.patch("assistant.harness.LOCK_WAIT_SECONDS", 0):
            events = list(run_turn(user=self.user, conversation_id="conv_locked_conversation", mode="act", text="x", ui_context=self.ui, provider=ScriptedProvider([])))
        self.assertEqual(events[0]["code"], "busy")

    def test_a_new_message_waits_for_a_stopped_turn_to_release_the_lock(self):
        import threading

        conv_store.acquire_turn(self.user.id, "conv_stopping_conversation")
        threading.Timer(0.4, conv_store.release_turn, args=(self.user.id, "conv_stopping_conversation")).start()
        self.assertTrue(conv_store.acquire_turn(self.user.id, "conv_stopping_conversation", wait_seconds=5))

    def test_stop_ends_the_turn_mid_stream(self):
        user_id = self.user.id

        class StopsWhileWriting(ScriptedProvider):
            def stream(self, system, messages, tools):
                for ev in super().stream(system, messages, tools):
                    yield ev
                    if ev["type"] == "text":
                        conv_store.request_cancel(user_id, self.cid)  # the user presses Stop

        p = StopsWhileWriting([[text("A long answer"), tool("get_log_overview", id="never")], [text("next")]])
        gen = run_turn(user=self.user, conversation_id=None, mode="act", text="go", ui_context=self.ui, provider=p)
        first = next(gen)
        p.cid = first["conversation_id"]
        events = [first] + list(gen)
        self.assertIn({"type": "notice", "text": "Stopped."}, events)
        self.assertEqual(events[-1]["type"], "done")
        self.assertFalse([e for e in events if e["type"] == "tool_start"])
        assert_valid_transcript(self, self.stored(p.cid))
        # The flag is cleared and the lock released: the next message runs normally.
        events, _ = self.run_turn(p, "again", conversation_id=p.cid)
        self.assertEqual("".join(e["text"] for e in events if e["type"] == "text"), "next")

    def test_stop_between_tools_answers_every_call(self):
        from mcp_server import server

        p = ScriptedProvider([[tool("get_log_overview", id="first"), tool("list_event_logs", id="second")]])
        original = server.TOOLS_BY_NAME["get_log_overview"]
        state = {}

        def press_stop(ctx, args):
            conv_store.request_cancel(self.user.id, state["cid"])
            return {"ok": True}

        stopping = original.__class__(**{**original.__dict__, "handler": press_stop})
        gen = run_turn(user=self.user, conversation_id=None, mode="act", text="go", ui_context=self.ui, provider=p)
        first = next(gen)
        state["cid"] = first["conversation_id"]
        with mock.patch.dict(server.TOOLS_BY_NAME, {"get_log_overview": stopping}):
            events = [first] + list(gen)
        self.assertEqual([e["name"] for e in events if e["type"] == "tool_start"], ["get_log_overview"])
        msgs = self.stored(state["cid"])
        assert_valid_transcript(self, msgs)
        self.assertIn("cancelled", msgs[-1]["content"][1]["content"])
        self.assertEqual(len(p.calls), 1)  # the model was not called again

    def test_long_conversations_are_condensed_not_edited(self):
        p = ScriptedProvider([[text("ok")], [text("still here")]])
        _, cid = self.run_turn(p, "remember the word avocado")
        conv = conv_store.load(self.user.id, cid)
        conv.messages.append({"role": "user", "content": [text("x" * (conv_store.MAX_TRANSCRIPT_CHARS + 10))]})
        conv.messages.append({"role": "assistant", "content": [text("noted")]})
        conv_store.save(conv)
        self.run_turn(p, "what word?", conversation_id=cid)
        sent = p.calls[1]["messages"]
        self.assertEqual(len(sent), 1)
        self.assertIn("avocado", sent[0]["content"][0]["text"])
        self.assertIn("earlier_conversation_recap", sent[0]["content"][0]["text"])


class PromptTests(TestCase):
    def test_system_prompt_is_static_per_mode(self):
        self.assertEqual(build_system_prompt("act"), build_system_prompt("act"))
        self.assertIn("Mode: Act", build_system_prompt("act"))
        self.assertIn("Mode: Teach", build_system_prompt("teach"))
        self.assertIn("nav-analysis", build_system_prompt("teach"))

    def test_ui_context_drops_logs_the_user_cannot_see(self):
        owner = User.objects.create_user("owner", password="pw")
        project = Project.objects.create(name="secret")
        project.users.add(owner)
        log = EventLog.objects.create(project=project, file="secret.duckdb")
        stranger = User.objects.create_user("stranger", password="pw")
        ctx = resolve_ui_context(stranger, {"active_file_id": log.id})
        self.assertIsNone(ctx["active_file_id"])
        self.assertIn("none selected", render_ui_context(ctx))
        own = resolve_ui_context(owner, {"active_file_id": str(log.id), "current_dashboard_id": "7"})
        self.assertEqual(own["project_id"], project.id)
        self.assertEqual(own["dashboard_id"], 7)


# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------

def sse_events(response) -> List[Dict[str, Any]]:
    body = b"".join(response.streaming_content).decode()
    return [json.loads(line[6:]) for line in body.split("\n") if line.startswith("data: ")]


class EndpointTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("api", password="pw")
        self.project = Project.objects.create(name="p")
        self.project.users.add(self.user)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def chat(self, provider, **body):
        with mock.patch("assistant.views.get_provider", return_value=provider):
            return self.client.post(
                "/api/assistant/chat/",
                {"message": "hi", "mode": "act", **body},
                format="json",
                HTTP_ACCEPT="text/event-stream",
                HTTP_X_LLM_KEY="sk-ant-secret-key",
                HTTP_X_LLM_PROVIDER="anthropic",
            )

    def test_requires_authentication(self):
        r = APIClient().post("/api/assistant/chat/", {"message": "hi"}, format="json")
        self.assertEqual(r.status_code, 401)
        self.assertEqual(APIClient().post("/api/assistant/validate-key/", {"api_key": "x"}, format="json").status_code, 401)

    def test_input_validation(self):
        for body in [{"message": ""}, {"message": 5}, {"message": "x" * 20001}, {"message": "hi", "conversation_id": "../etc"}]:
            r = self.client.post("/api/assistant/chat/", body, format="json")
            self.assertEqual(r.status_code, 400, body)

    def test_missing_key_is_a_clear_401(self):
        with self.settings(ANTHROPIC_API_KEY="", GEMINI_API_KEY="", OPENAI_API_KEY=""):
            r = self.client.post("/api/assistant/chat/", {"message": "hi"}, format="json")
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.json()["code"], "auth")

    def test_streams_sse_and_never_stores_the_key(self):
        r = self.chat(ScriptedProvider([[text("Hello!")]]))
        self.assertEqual(r["Content-Type"], "text/event-stream")
        events = sse_events(r)
        self.assertEqual(events[1], {"type": "text", "text": "Hello!"})
        self.assertEqual(events[-1]["type"], "done")
        cid = events[-1]["conversation_id"]
        stored = json.dumps(conv_store.load(self.user.id, cid).__dict__)
        self.assertNotIn("secret-key", stored)

    def test_approve_once_then_conflict_and_outcome_reaches_the_model(self):
        p = ScriptedProvider([[tool("create_dashboard", {"name": "Board"}, id="c")], [text("Proposed.")], [text("Done, it exists.")]])
        events = sse_events(self.chat(p))
        action_id = [e for e in events if e["type"] == "pending_action"][0]["id"]
        cid = events[-1]["conversation_id"]
        self.assertNotIn("secret-key", json.dumps(action_registry.get_action(action_id)))

        r = self.client.post("/api/assistant/confirm/", {"pending_action_id": action_id, "approved": True}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "executed")
        dash_id = r.json()["result"]["dashboard_id"]
        self.assertTrue(Dashboard.objects.filter(id=dash_id, name="Board").exists())

        again = self.client.post("/api/assistant/confirm/", {"pending_action_id": action_id, "approved": True}, format="json")
        self.assertEqual(again.status_code, 409)
        self.assertEqual(Dashboard.objects.filter(name="Board").count(), 1)

        sse_events(self.chat(p, conversation_id=cid, message="is it there?"))
        first_block = p.calls[2]["messages"][-1]["content"][0]["text"]
        self.assertIn("updates_since_your_last_reply", first_block)
        self.assertIn(str(dash_id), first_block)

    def test_decline_and_foreign_or_unknown_ids(self):
        p = ScriptedProvider([[tool("delete_dashboard", {"dashboard_id": 1}, id="d")], [text("Proposed.")]])
        action_id = [e for e in sse_events(self.chat(p)) if e["type"] == "pending_action"][0]["id"]

        stranger = APIClient()
        stranger.force_authenticate(User.objects.create_user("stranger", password="pw"))
        r = stranger.post("/api/assistant/confirm/", {"pending_action_id": action_id, "approved": True}, format="json")
        self.assertEqual(r.status_code, 404)

        r = self.client.post("/api/assistant/confirm/", {"pending_action_id": "act_missing", "approved": True}, format="json")
        self.assertEqual(r.status_code, 404)

        r = self.client.post("/api/assistant/confirm/", {"pending_action_id": action_id, "approved": False}, format="json")
        self.assertEqual(r.json()["status"], "cancelled")
        r = self.client.post("/api/assistant/confirm/", {"pending_action_id": action_id, "approved": True}, format="json")
        self.assertEqual(r.status_code, 409)

    def test_failed_change_is_reported(self):
        p = ScriptedProvider([[tool("rename_dashboard", {"dashboard_id": 999, "name": "x"}, id="r")], [text("Proposed.")]])
        action_id = [e for e in sse_events(self.chat(p)) if e["type"] == "pending_action"][0]["id"]
        r = self.client.post("/api/assistant/confirm/", {"pending_action_id": action_id, "approved": True}, format="json")
        self.assertEqual(r.status_code, 422)
        self.assertEqual(r.json()["status"], "failed")

    def test_cancel_endpoint_flags_the_turn(self):
        r = self.client.post("/api/assistant/cancel/", {"conversation_id": "conv_abcdef123456"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(conv_store.cancel_requested(self.user.id, "conv_abcdef123456"))
        other = User.objects.create_user("other", password="pw")
        self.assertFalse(conv_store.cancel_requested(other.id, "conv_abcdef123456"))
        self.assertEqual(self.client.post("/api/assistant/cancel/", {"conversation_id": "../x"}, format="json").status_code, 400)

    def test_reset_forgets_the_conversation(self):
        events = sse_events(self.chat(ScriptedProvider([[text("hi")]])))
        cid = events[-1]["conversation_id"]
        self.client.post("/api/assistant/reset/", {"conversation_id": cid}, format="json")
        self.assertIsNone(conv_store.load(self.user.id, cid))


# -----------------------------------------------------------------------------
# Provider wire formats
# -----------------------------------------------------------------------------

class ProviderFactoryTests(TestCase):
    def test_resolution(self):
        self.assertIsInstance(get_provider("", "sk-ant-abc"), AnthropicProvider)
        self.assertIsInstance(get_provider("", "AIzaXYZ"), GeminiProvider)
        self.assertIsInstance(get_provider("", "AQ.Ab8XYZ"), GeminiProvider)
        self.assertIsInstance(get_provider("openai", "sk-abc"), OpenAIProvider)
        self.assertEqual(get_provider("demo", "").name, "demo")
        with self.settings(ANTHROPIC_API_KEY="", GEMINI_API_KEY="", OPENAI_API_KEY=""):
            with self.assertRaises(ProviderError) as cm:
                get_provider("anthropic", "")
            self.assertEqual(cm.exception.kind, "auth")
            with self.assertRaises(ProviderError):
                get_provider("", "")
        with self.settings(GEMINI_API_KEY="server-key", ANTHROPIC_API_KEY=""):
            self.assertIsInstance(get_provider("", ""), GeminiProvider)

    def test_default_claude_model(self):
        with self.settings(ANTHROPIC_MODEL=""):
            self.assertEqual(get_provider("anthropic", "sk-ant-x").model, "claude-opus-5-5")


def _anthropic_sse(events):
    return "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events).encode()


ANTHROPIC_TOOL_TURN = [
    {"type": "message_start", "message": {"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-5-5", "content": [], "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 120, "output_tokens": 1, "cache_read_input_tokens": 100}}},
    {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": "", "signature": ""}},
    {"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "SIG123"}},
    {"type": "content_block_stop", "index": 0},
    {"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}},
    {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "Let me "}},
    {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "check."}},
    {"type": "content_block_stop", "index": 1},
    {"type": "content_block_start", "index": 2, "content_block": {"type": "tool_use", "id": "toolu_01", "name": "get_log_overview", "input": {}}},
    {"type": "content_block_delta", "index": 2, "delta": {"type": "input_json_delta", "partial_json": "{\"file_"}},
    {"type": "content_block_delta", "index": 2, "delta": {"type": "input_json_delta", "partial_json": "id\": 3}"}},
    {"type": "content_block_stop", "index": 2},
    {"type": "message_delta", "delta": {"stop_reason": "tool_use", "stop_sequence": None}, "usage": {"output_tokens": 40}},
    {"type": "message_stop"},
]

TOOL_SPEC = [{"name": "get_log_overview", "description": "d", "parameters": {"type": "object", "properties": {"file_id": {"type": "integer"}}, "required": [], "additionalProperties": False}}]


class AnthropicProviderTests(TestCase):
    def make(self, handler, model="claude-opus-5-5"):
        import httpx2

        return AnthropicProvider("sk-ant-test", model=model, http_client=httpx2.Client(transport=httpx2.MockTransport(handler)))

    def test_tool_turn_round_trip(self):
        requests_seen = []

        def handler(request):
            requests_seen.append(request)
            return __import__("httpx2").Response(200, headers={"content-type": "text/event-stream"}, content=_anthropic_sse(ANTHROPIC_TOOL_TURN))

        p = self.make(handler)
        out = list(p.stream("SYSTEM", [{"role": "user", "content": [text("hi")]}], TOOL_SPEC))
        self.assertEqual([e["text"] for e in out if e["type"] == "text"], ["Let me ", "check."])
        self.assertIn({"type": "status", "status": "thinking"}, out)
        final = out[-1]
        self.assertEqual(final["stop_reason"], "tool_use")
        self.assertEqual(final["message"]["content"], [text("Let me check."), {"type": "tool_use", "id": "toolu_01", "name": "get_log_overview", "input": {"file_id": 3}}])
        self.assertEqual(final["usage"]["cache_read_input_tokens"], 100)

        body = json.loads(requests_seen[0].content)
        self.assertEqual(body["model"], "claude-opus-5-5")
        self.assertEqual(body["cache_control"], {"type": "ephemeral"})
        self.assertEqual(body["output_config"], {"effort": "medium"})
        self.assertEqual(body["fallbacks"], "default")
        self.assertNotIn("thinking", body)
        self.assertTrue(body["tools"][0]["eager_input_streaming"])
        self.assertEqual(body["tools"][0]["input_schema"]["properties"], {"file_id": {"type": "integer"}})
        self.assertIn("server-side-fallback-2026-07-01", requests_seen[0].headers.get("anthropic-beta", ""))
        auth = requests_seen[0].headers.get("x-api-key") or requests_seen[0].headers.get("authorization", "")
        self.assertIn("sk-ant-test", auth)

        # Next request replays the native content (thinking + signature) unchanged.
        transcript = [
            {"role": "user", "content": [text("hi")]},
            final["message"],
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_01", "name": "get_log_overview", "content": "{}", "is_error": False}]},
        ]
        list(p.stream("SYSTEM", transcript, TOOL_SPEC))
        replay = json.loads(requests_seen[1].content)["messages"]
        self.assertEqual(replay[1]["content"][0], {"type": "thinking", "thinking": "", "signature": "SIG123"})
        self.assertEqual(replay[2]["content"][0], {"type": "tool_result", "tool_use_id": "toolu_01", "content": "{}", "is_error": False})

    def test_models_without_effort_or_fallbacks(self):
        seen = []

        def handler(request):
            seen.append(json.loads(request.content))
            return __import__("httpx2").Response(200, headers={"content-type": "text/event-stream"}, content=_anthropic_sse(ANTHROPIC_TOOL_TURN))

        list(self.make(handler, model="claude-haiku-4-5").stream("S", [{"role": "user", "content": [text("hi")]}], []))
        self.assertNotIn("output_config", seen[0])
        self.assertNotIn("fallbacks", seen[0])
        self.assertNotIn("tools", seen[0])

    def test_errors_are_typed(self):
        import httpx2

        for status_code, kind in [(401, "auth"), (429, "rate_limit"), (400, "bad_request")]:
            def handler(request, status_code=status_code):
                return httpx2.Response(status_code, json={"type": "error", "error": {"type": "x", "message": "nope"}}, headers={"x-should-retry": "false"})

            with self.assertRaises(ProviderError) as cm:
                list(self.make(handler).stream("S", [{"role": "user", "content": [text("hi")]}], []))
            self.assertEqual(cm.exception.kind, kind)

    def test_declined_attempt_before_fallback_is_not_replayed(self):
        raw = [
            {"type": "thinking", "thinking": "", "signature": "a"},
            {"type": "text", "text": "partial"},
            {"type": "fallback", "from": {"model": "x"}, "to": {"model": "y"}},
            {"type": "thinking", "thinking": "", "signature": "b"},
            {"type": "text", "text": "answer"},
        ]
        kept = AnthropicProvider._sanitize_raw(raw)
        self.assertEqual([b["type"] for b in kept], ["text", "fallback", "thinking", "text"])


class _FakeResponse:
    def __init__(self, lines, status_code=200, body=""):
        self.lines = lines
        self.status_code = status_code
        self.text = body

    def iter_lines(self, decode_unicode=False):
        return iter(self.lines)

    def close(self):
        pass


class GeminiProviderTests(TestCase):
    def test_function_call_round_trip_keeps_thought_signatures(self):
        chunk = {
            "candidates": [
                {
                    "content": {"role": "model", "parts": [{"text": "Looking."}, {"functionCall": {"name": "get_log_overview", "args": {"file_id": 3}}, "thoughtSignature": "SIG"}]},
                    "finishReason": "STOP",
                }
            ],
            "usageMetadata": {"promptTokenCount": 50, "candidatesTokenCount": 7},
        }
        with mock.patch("assistant.providers.requests.post", return_value=_FakeResponse([b"data: " + json.dumps(chunk).encode()])) as post:
            p = GeminiProvider("AIza-test", model="gemini-test")
            out = list(p.stream("SYS", [{"role": "user", "content": [text("hi")]}], TOOL_SPEC))
        url = post.call_args.args[0]
        self.assertNotIn("AIza-test", url)
        self.assertEqual(post.call_args.kwargs["headers"]["x-goog-api-key"], "AIza-test")
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["tools"][0]["functionDeclarations"][0]["parametersJsonSchema"], TOOL_SPEC[0]["parameters"])
        final = out[-1]
        self.assertEqual(final["stop_reason"], "tool_use")
        tu = final["message"]["content"][1]
        self.assertEqual((tu["name"], tu["input"]), ("get_log_overview", {"file_id": 3}))

        transcript = [
            {"role": "user", "content": [text("hi")]},
            final["message"],
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tu["id"], "name": "get_log_overview", "content": "{\"events\": 6}", "is_error": False}]},
        ]
        native = GeminiProvider._to_native(transcript)
        self.assertEqual(native[1]["parts"][1]["thoughtSignature"], "SIG")
        self.assertEqual(native[2]["parts"][0]["functionResponse"], {"name": "get_log_overview", "response": {"result": {"events": 6}}})

    def test_quota_error_is_rate_limit_not_a_fake_answer(self):
        with mock.patch("assistant.providers.requests.post", return_value=_FakeResponse([], 429, '{"error": {"message": "quota"}}')):
            with self.assertRaises(ProviderError) as cm:
                list(GeminiProvider("AIza-test").stream("S", [{"role": "user", "content": [text("hi")]}], []))
        self.assertEqual(cm.exception.kind, "rate_limit")

    def test_invalid_key_is_auth(self):
        body = json.dumps({"error": {"code": 400, "message": "API key not valid", "status": "INVALID_ARGUMENT", "details": [{"reason": "API_KEY_INVALID"}]}})
        with mock.patch("assistant.providers.requests.post", return_value=_FakeResponse([], 400, body)):
            with self.assertRaises(ProviderError) as cm:
                list(GeminiProvider("AIza-bad").stream("S", [{"role": "user", "content": [text("hi")]}], []))
        self.assertEqual(cm.exception.kind, "auth")


class OpenAIProviderTests(TestCase):
    def test_streamed_tool_call_is_assembled(self):
        chunks = [
            {"choices": [{"delta": {"content": "Checking"}}]},
            {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_1", "function": {"name": "get_log_overview", "arguments": "{\"file"}}]}}]},
            {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": "_id\": 3}"}}]}, "finish_reason": "tool_calls"}]},
            {"choices": [], "usage": {"prompt_tokens": 9, "completion_tokens": 4}},
        ]
        lines = [b"data: " + json.dumps(c).encode() for c in chunks] + [b"data: [DONE]"]
        with mock.patch("assistant.providers.requests.post", return_value=_FakeResponse(lines)) as post:
            out = list(OpenAIProvider("sk-test", model="gpt-test").stream("SYS", [{"role": "user", "content": [text("hi")]}], TOOL_SPEC))
        payload = post.call_args.kwargs["json"]
        self.assertNotIn("temperature", payload)
        self.assertEqual(payload["messages"][0], {"role": "system", "content": "SYS"})
        final = out[-1]
        self.assertEqual(final["stop_reason"], "tool_use")
        self.assertEqual(final["message"]["content"][1], {"type": "tool_use", "id": "call_1", "name": "get_log_overview", "input": {"file_id": 3}})
        self.assertEqual(final["usage"], {"input_tokens": 9, "output_tokens": 4})

        native = OpenAIProvider._to_native(
            "SYS",
            [
                {"role": "user", "content": [text("hi")]},
                final["message"],
                {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "call_1", "name": "get_log_overview", "content": "{}", "is_error": False}]},
            ],
        )
        self.assertEqual(native[2]["tool_calls"][0]["function"], {"name": "get_log_overview", "arguments": "{\"file_id\": 3}"})
        self.assertEqual(native[3], {"role": "tool", "tool_call_id": "call_1", "content": "{}"})

    def test_bad_tool_json_is_flagged_for_the_harness(self):
        chunks = [{"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "c", "function": {"name": "get_log_overview", "arguments": "{oops"}}]}, "finish_reason": "tool_calls"}]}]
        with mock.patch("assistant.providers.requests.post", return_value=_FakeResponse([b"data: " + json.dumps(c).encode() for c in chunks])):
            out = list(OpenAIProvider("sk-test").stream("S", [{"role": "user", "content": [text("hi")]}], TOOL_SPEC))
        self.assertIn("__unparseable__", out[-1]["message"]["content"][0]["input"])


class AsgiStreamingTests(TestCase):
    """Under ASGI the SSE stream must be delivered event by event, not buffered."""

    def test_events_are_yielded_one_at_a_time_and_generator_closed(self):
        import asyncio

        from .views import _async_iter

        produced, closed = [], []

        def gen():
            try:
                for i in range(3):
                    produced.append(i)
                    yield f"e{i}".encode()
            finally:
                closed.append(True)

        async def consume_first():
            it = _async_iter(gen())
            first = await it.__anext__()
            seen_when_first = list(produced)
            await it.aclose()  # client went away
            return first, seen_when_first

        first, seen = asyncio.run(consume_first())
        self.assertEqual(first, b"e0")
        self.assertEqual(seen, [0])  # nothing was read ahead
        self.assertEqual(closed, [True])
