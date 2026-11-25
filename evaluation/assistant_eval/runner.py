"""
Run the assistant evaluation against real models.

    backend/.venv/bin/python -m evaluation.assistant_eval.runner \
        --models claude-haiku-5-5 --tasks descriptive --repeat 1 --budget-usd 1

The API key is read from an environment variable (default ANTHROPIC_API_KEY)
and is never written anywhere. Each task runs in a fresh workspace inside a
sandboxed test database (see django_env.py). Results go to
evaluation/assistant_eval/results/<timestamp>/.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from . import django_env
from .scorers import score_turn

RESULTS_DIR = Path(__file__).resolve().parent / "results"

# USD per million tokens: input, output, cache read, cache write (5-minute TTL = 1.25 x input).
# Estimates for budgeting only; check current pricing before relying on them.
PRICES: Dict[str, Dict[str, float]] = {
    "claude-opus-5-5": {"in": 4.0, "out": 20.0, "cache_read": 0.20, "cache_write": 5.0},
    "claude-sonnet-5-5": {"in": 2.0, "out": 10.0, "cache_read": 0.10, "cache_write": 2.5},
    "claude-haiku-5-5": {"in": 0.10, "out": 0.50, "cache_read": 0.01, "cache_write": 0.125},
}
FALLBACK_PRICE = {"in": 5.0, "out": 25.0, "cache_read": 0.5, "cache_write": 6.25}


def cost_usd(model: str, usage: Dict[str, int]) -> float:
    p = PRICES.get(model, FALLBACK_PRICE)
    return (
        usage.get("input_tokens", 0) * p["in"]
        + usage.get("output_tokens", 0) * p["out"]
        + usage.get("cache_read_input_tokens", 0) * p["cache_read"]
        + usage.get("cache_creation_input_tokens", 0) * p["cache_write"]
    ) / 1_000_000


class CountingProvider:
    """Wraps a provider to count model calls per turn."""

    def __init__(self, inner):
        self.inner = inner
        self.name = inner.name
        self.model = inner.model
        self.calls = 0

    def stream(self, system, messages, tools):
        self.calls += 1
        return self.inner.stream(system, messages, tools)


# SQLite allows one writer: two threads upgrading read locks to write locks fail at once
# with "database is locked" (Django 4.2 has no IMMEDIATE transactions). The only writes
# during a run are workspace setup and approvals, so they are serialised here; reads
# run concurrently under WAL.
_db_write_lock = threading.Lock()

# --- fault injection: one global hook, keyed per user so threads don't interfere ----
_faults: Dict[int, str] = {}
_faults_lock = threading.Lock()
_hook_installed = False


def _install_fault_hook() -> None:
    global _hook_installed
    if _hook_installed:
        return
    import assistant.harness as harness

    real_call_tool = harness.call_tool

    def call_tool_with_faults(name, args, ctx):
        with _faults_lock:
            failing = _faults.get(getattr(ctx.user, "id", None))
        if failing == name:
            raise RuntimeError(f"Injected failure in {name} (evaluation)")
        return real_call_tool(name, args, ctx)

    harness.call_tool = call_tool_with_faults
    _hook_installed = True


# --- one task run ----------------------------------------------------------------

def _record_turn(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    tools: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []
    rec: Dict[str, Any] = {"text": "", "pending": [], "client_actions": [], "notices": [], "errors": [], "usage": {}}
    for e in events:
        t = e["type"]
        if t == "text":
            rec["text"] += e["text"]
        elif t == "tool_start":
            tools[e["id"]] = {"name": e["name"], "kind": e.get("kind"), "ok": None, "error": None, "summary": e.get("summary")}
            order.append(e["id"])
        elif t == "tool_end" and e["id"] in tools:
            tools[e["id"]].update(ok=e["ok"], error=e.get("error"), duration_ms=e.get("duration_ms"))
        elif t == "pending_action":
            rec["pending"].append({k: e[k] for k in ("id", "name", "description", "arguments")})
        elif t == "client_action":
            rec["client_actions"].append({"name": e["name"], "arguments": e["arguments"]})
        elif t == "notice":
            rec["notices"].append(e["text"])
        elif t == "error":
            rec["errors"].append(f"{e.get('code')}: {e.get('message')}")
        elif t == "done":
            rec["usage"] = e.get("usage") or {}
    rec["tools"] = [tools[i] for i in order]
    return rec


def run_task(task, model: str, repeat: int, make_provider: Callable[[str], Any], truth: Any) -> Dict[str, Any]:
    from django.db import connection
    from rest_framework.test import APIClient

    from assistant import conversation as conv_store
    from assistant.harness import run_turn
    from assistant.prompts import resolve_ui_context

    from .fixtures import make_workspace

    started = time.monotonic()
    result: Dict[str, Any] = {"task": task.id, "category": task.category, "model": model, "repeat": repeat, "turns": []}
    try:
        with _db_write_lock:
            ws = make_workspace(task.logs)
        client = APIClient()
        client.force_authenticate(ws.user)
        ui = resolve_ui_context(ws.user, {"active_file_id": ws.log_ids.get(task.log) if task.log else None, "view_mode": task.view})
        provider = CountingProvider(make_provider(model))
        conversation_id: Optional[str] = None
        for turn in task.turns:
            provider.calls = 0
            with _faults_lock:
                if turn.fail_tool:
                    _faults[ws.user.id] = turn.fail_tool
                else:
                    _faults.pop(ws.user.id, None)
            t0 = time.monotonic()
            events: List[Dict[str, Any]] = []
            for ev in run_turn(user=ws.user, conversation_id=conversation_id, mode=task.mode, text=turn.prompt, ui_context=ui, provider=provider):
                events.append(ev)
                if ev["type"] == "conversation":
                    conversation_id = ev["conversation_id"]
                if turn.stop_after_first_tool and ev["type"] == "tool_start":
                    conv_store.request_cancel(ws.user.id, conversation_id)
            rec = _record_turn(events)
            rec["latency_s"] = round(time.monotonic() - t0, 2)
            rec["model_calls"] = provider.calls
            rec["cost_usd"] = round(cost_usd(model, rec["usage"]), 5)
            conv = conv_store.load(ws.user.id, conversation_id) if conversation_id else None
            rec["tool_text"] = "\n".join(
                b.get("content") or "" for m in (conv.messages if conv else []) for b in m["content"] if b.get("type") == "tool_result"
            )
            rec["transcript_valid"] = _transcript_valid(conv.messages if conv else [])
            rec["score"] = score_turn(rec, turn.checks, truth, defaults=turn.defaults)
            if turn.decide and rec["pending"]:
                rec["decisions"] = []
                with _db_write_lock:
                    if turn.before_decision:
                        turn.before_decision(ws, rec["pending"])
                    for p in rec["pending"]:
                        r = client.post("/api/assistant/confirm/", {"pending_action_id": p["id"], "approved": turn.decide == "approve"}, format="json")
                        rec["decisions"].append({"action": p["name"], "http": r.status_code, "status": (r.json() or {}).get("status")})
            rec["prompt"] = turn.prompt
            result["turns"].append(rec)
    except Exception as exc:
        result["crash"] = f"{type(exc).__name__}: {exc}"
        result["traceback"] = traceback.format_exc()
    finally:
        with _faults_lock:
            if "ws" in locals():
                _faults.pop(ws.user.id, None)
        connection.close()
    result["passed"] = bool(result["turns"]) and "crash" not in result and all(
        t["score"]["passed"] and t["transcript_valid"] for t in result["turns"]
    )
    result["cost_usd"] = round(sum(t["cost_usd"] for t in result["turns"]), 5)
    result["latency_s"] = round(time.monotonic() - started, 2)
    return result


def _transcript_valid(messages: List[Dict[str, Any]]) -> bool:
    """Every tool_use is answered by a tool_result in the next message."""
    for i, msg in enumerate(messages):
        uses = {b["id"] for b in msg["content"] if b["type"] == "tool_use"}
        if uses:
            if i + 1 >= len(messages):
                return False
            answered = {b["tool_use_id"] for b in messages[i + 1]["content"] if b["type"] == "tool_result"}
            if uses - answered:
                return False
    return True


# --- whole run -----------------------------------------------------------------------

def run(
    *,
    tasks: List[Any],
    models: List[str],
    repeat: int,
    make_provider: Callable[[str], Any],
    budget_usd: float,
    concurrency: int,
    out_dir: Path,
    sandbox: Optional[Path] = None,
    log: Callable[[str], None] = print,
) -> List[Dict[str, Any]]:
    sandbox = sandbox or Path(tempfile.mkdtemp(prefix="assistant-eval-"))
    django_env.setup(sandbox)
    from . import fixtures, ground_truth

    paths = fixtures.prepare_media(django_env.media_root())
    truth = ground_truth.compute(paths)
    _install_fault_hook()

    out_dir.mkdir(parents=True, exist_ok=True)
    jobs = [(t, m, r) for m in models for r in range(1, repeat + 1) for t in tasks]
    spent = 0.0
    lock = threading.Lock()
    results: List[Dict[str, Any]] = []
    stream = (out_dir / "results.jsonl").open("w", encoding="utf-8")

    def job(task, model, rep):
        nonlocal spent
        with lock:
            if spent >= budget_usd:
                return {"task": task.id, "category": task.category, "model": model, "repeat": rep, "skipped": "budget", "passed": False, "turns": [], "cost_usd": 0}
        res = run_task(task, model, rep, make_provider, truth)
        with lock:
            spent += res["cost_usd"]
        return res

    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
        futures = [pool.submit(job, *j) for j in jobs]
        for i, fut in enumerate(as_completed(futures), 1):
            res = fut.result()
            results.append(res)
            stream.write(json.dumps(res, default=str) + "\n")
            stream.flush()
            mark = "SKIP" if res.get("skipped") else ("PASS" if res["passed"] else "FAIL")
            log(f"[{i}/{len(jobs)}] {mark} {res['model']} {res['task']} r{res['repeat']} ${res['cost_usd']:.4f} (spent ${spent:.2f})")
    stream.close()

    from .report import write_report

    write_report(results, out_dir, truth_note=f"sandbox={sandbox}")
    return results


def _parse_args(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--provider", default="anthropic")
    ap.add_argument("--models", default="claude-opus-5-5")
    ap.add_argument("--tasks", default="", help="comma-separated task ids/categories (substring match); default all")
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--budget-usd", type=float, required=True, help="stop starting new tasks once this much is spent")
    ap.add_argument("--effort", default=None, help="Claude effort override: low|medium|high|xhigh|max")
    ap.add_argument("--key-env", default="ANTHROPIC_API_KEY", help="environment variable holding the API key")
    ap.add_argument("--out", default=None)
    return ap.parse_args(argv)


def main(argv=None) -> int:
    args = _parse_args(argv)
    key = os.environ.get(args.key_env, "")
    if not key:
        raise SystemExit(f"Set {args.key_env} to the API key (it is never written to disk).")
    from .tasks import select

    tasks = select(args.tasks)
    if not tasks:
        raise SystemExit("No tasks match --tasks.")

    def make_provider(model: str):
        from assistant.providers import get_provider

        p = get_provider(args.provider, key, model=model)
        if args.effort and hasattr(p, "effort"):
            p.effort = args.effort
        return p

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = Path(args.out) if args.out else RESULTS_DIR / stamp
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    print(f"{len(tasks)} tasks x {len(models)} model(s) x {args.repeat} repeat(s); budget ${args.budget_usd}; results -> {out}")
    results = run(tasks=tasks, models=models, repeat=args.repeat, make_provider=make_provider,
                  budget_usd=args.budget_usd, concurrency=args.concurrency, out_dir=out)
    passed = sum(1 for r in results if r["passed"])
    print(f"\n{passed}/{len(results)} passed. Report: {out / 'summary.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
