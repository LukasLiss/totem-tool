"""
End-to-end runner test with a scripted model: real harness, tools, sandbox DB,
ground truth, approvals via the real endpoint, Stop, and fault injection,
without any API call.
"""

import json
import re
import uuid

import pytest

from evaluation.assistant_eval import tasks as task_mod
from evaluation.assistant_eval.runner import run


def _last_user_text(messages):
    for m in reversed(messages):
        if m["role"] == "user":
            texts = [b["text"] for b in m["content"] if b["type"] == "text"]
            if texts:
                return re.sub(r"<[a-z_]+>.*?</[a-z_]+>\s*", "", texts[-1], flags=re.S)
    return ""


class OracleProvider:
    """A deterministic stand-in for a model that uses the tools sensibly.

    ``wrong`` makes it misreport the event count, to prove failures are caught.
    """

    name = "oracle"

    def __init__(self, model):
        self.model = model
        self.wrong = model == "oracle-wrong"

    def _msg(self, content, stop):
        for b in content:
            if b["type"] == "text":
                yield {"type": "text", "text": b["text"]}
        yield {"type": "message", "message": {"role": "assistant", "content": content, "provider": {"name": "oracle"}},
               "stop_reason": stop, "usage": {"input_tokens": 1000, "output_tokens": 100}}

    def _tool(self, name, args=None):
        return [{"type": "tool_use", "id": f"toolu_{uuid.uuid4().hex[:10]}", "name": name, "input": args or {}}]

    def stream(self, system, messages, tools):
        prompt = _last_user_text(messages).lower()
        last = messages[-1]
        results = [b for b in last["content"] if b["type"] == "tool_result"] if last["role"] == "user" else []
        if not results:
            if "dashboard called" in prompt:
                yield from self._msg(self._tool("create_dashboard", {"name": "Bottlenecks", "components": [{"component_name": "LogStatisticsComponent", "x": 0, "y": 0, "w": 12, "h": 2}]}), "tool_use")
            elif "is the bottlenecks dashboard" in prompt:
                yield from self._msg(self._tool("list_dashboards"), "tool_use")
            else:
                yield from self._msg(self._tool("get_log_overview"), "tool_use")
            return
        r = results[0]
        data = json.loads(r["content"]) if r["content"].startswith("{") else {}
        if r["is_error"] and r["name"] == "get_log_overview":
            yield from self._msg(self._tool("query_event_log", {"sql": "SELECT COUNT(*) AS n FROM events"}), "tool_use")
            return
        if r["name"] == "query_event_log":
            n = data["rows"][0][0]
            yield from self._msg([{"type": "text", "text": f"The log has {n:,} events."}], "end_turn")
        elif r["name"] == "create_dashboard":
            yield from self._msg([{"type": "text", "text": "I've proposed the Bottlenecks dashboard; it will be created once you approve the card."}], "end_turn")
        elif r["name"] == "list_dashboards":
            names = [d["name"] for d in data["dashboards"]]
            yield from self._msg([{"type": "text", "text": f"Yes: dashboards are {', '.join(names)}; Bottlenecks has a log statistics header."}], "end_turn")
        else:
            n = data.get("events", 0) + (1 if self.wrong else 0)
            yield from self._msg([{"type": "text", "text": f"The log has {n:,} events."}], "end_turn")


@pytest.fixture(scope="module")
def results(tmp_path_factory):
    picked = [t for t in task_mod.TASKS if t.id in {"D01_events", "R02_tool_failure", "P01_approve_then_check", "Z02_stop_then_follow_up"}]
    assert len(picked) == 4
    out = tmp_path_factory.mktemp("out")
    res = run(tasks=picked, models=["oracle", "oracle-wrong"], repeat=1, make_provider=OracleProvider,
              budget_usd=10, concurrency=2, out_dir=out, sandbox=tmp_path_factory.mktemp("sandbox"), log=lambda m: None)
    return {(r["model"], r["task"]): r for r in res}, out


def test_correct_answers_pass(results):
    by, _ = results
    for task in ("D01_events", "R02_tool_failure", "P01_approve_then_check", "Z02_stop_then_follow_up"):
        r = by[("oracle", task)]
        failed = [c for t in r["turns"] for c in t["score"]["checks"] if not c["passed"]]
        assert r["passed"], (task, r.get("crash"), failed)


def test_wrong_number_fails(results):
    by, _ = results
    r = by[("oracle-wrong", "D01_events")]
    assert not r["passed"]
    assert any(c["check"] == "Number" and not c["passed"] for c in r["turns"][0]["score"]["checks"])


def test_fault_injection_and_recovery(results):
    by, _ = results
    tools = by[("oracle", "R02_tool_failure")]["turns"][0]["tools"]
    assert [t["name"] for t in tools] == ["get_log_overview", "query_event_log"]
    assert tools[0]["ok"] is False and "Injected failure" in tools[0]["error"]


def test_approval_goes_through_the_real_endpoint(results):
    by, _ = results
    first = by[("oracle", "P01_approve_then_check")]["turns"][0]
    assert first["decisions"] == [{"action": "create_dashboard", "http": 200, "status": "executed"}]
    assert "Bottlenecks" in by[("oracle", "P01_approve_then_check")]["turns"][1]["text"]


def test_stop_keeps_transcript_valid(results):
    by, _ = results
    stopped, follow_up = by[("oracle", "Z02_stop_then_follow_up")]["turns"]
    assert "Stopped." in stopped["notices"]
    assert stopped["transcript_valid"] and follow_up["transcript_valid"]


def test_report_files(results):
    _, out = results
    summary = json.loads((out / "summary.json").read_text())
    assert summary["models"]["oracle"]["pass_rate"] == 1.0
    assert summary["models"]["oracle-wrong"]["pass_rate"] < 1.0
    assert (out / "summary.md").read_text().startswith("# Assistant evaluation")
    assert len((out / "results.jsonl").read_text().splitlines()) == 8
