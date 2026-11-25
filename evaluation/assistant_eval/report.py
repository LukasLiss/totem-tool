"""Summaries of an evaluation run: per-model and per-category pass rates, pass^k, cost, latency, failures."""

from __future__ import annotations

import json
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List


def summarize(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    ran = [r for r in results if not r.get("skipped")]
    by_model: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in ran:
        by_model[r["model"]].append(r)

    models = {}
    for model, rs in sorted(by_model.items()):
        per_task: Dict[str, List[bool]] = defaultdict(list)
        per_cat: Dict[str, List[bool]] = defaultdict(list)
        fails: Counter = Counter()
        latencies, costs, grounded = [], [], []
        for r in rs:
            per_task[r["task"]].append(r["passed"])
            per_cat[r["category"]].append(r["passed"])
            costs.append(r["cost_usd"])
            latencies.extend(t["latency_s"] for t in r["turns"])
            grounded.extend(t["score"]["grounded_ratio"] for t in r["turns"] if t["score"]["grounded_ratio"] is not None)
            if r.get("crash"):
                fails[f"{r['task']}: crash {r['crash'][:80]}"] += 1
            for t in r["turns"]:
                if not t["transcript_valid"]:
                    fails[f"{r['task']}: invalid transcript"] += 1
                for c in t["score"]["checks"]:
                    if not c["passed"]:
                        fails[f"{r['task']}: {c['check']}"] += 1
        models[model] = {
            "runs": len(rs),
            "pass_rate": sum(r["passed"] for r in rs) / len(rs),
            "pass_all_repeats": sum(all(v) for v in per_task.values()) / len(per_task),
            "by_category": {c: sum(v) / len(v) for c, v in sorted(per_cat.items())},
            "by_task": {t: f"{sum(v)}/{len(v)}" for t, v in sorted(per_task.items())},
            "cost_usd_total": round(sum(costs), 4),
            "cost_usd_per_task": round(statistics.mean(costs), 4) if costs else 0,
            "latency_s_median": round(statistics.median(latencies), 1) if latencies else None,
            "latency_s_p90": round(sorted(latencies)[int(0.9 * (len(latencies) - 1))], 1) if latencies else None,
            "grounded_ratio_mean": round(statistics.mean(grounded), 3) if grounded else None,
            "top_failures": fails.most_common(15),
        }
    return {"runs": len(results), "skipped": len(results) - len(ran), "models": models}


def write_report(results: List[Dict[str, Any]], out_dir: Path, truth_note: str = "") -> Path:
    summary = summarize(results)
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    lines = ["# Assistant evaluation", ""]
    if truth_note:
        lines += [f"_{truth_note}_", ""]
    lines += ["| Model | Runs | Pass | Pass all repeats | Cost total | Cost/task | Latency median / p90 (s) | Numbers grounded |", "|---|---|---|---|---|---|---|---|"]
    for model, m in summary["models"].items():
        grounded = "" if m["grounded_ratio_mean"] is None else f"{m['grounded_ratio_mean']:.0%}"
        lines.append(
            f"| {model} | {m['runs']} | {m['pass_rate']:.0%} | {m['pass_all_repeats']:.0%} | ${m['cost_usd_total']:.2f} | "
            f"${m['cost_usd_per_task']:.3f} | {m['latency_s_median']} / {m['latency_s_p90']} | {grounded} |"
        )
    if summary["skipped"]:
        lines += ["", f"{summary['skipped']} job(s) skipped: budget reached."]
    for model, m in summary["models"].items():
        lines += ["", f"## {model}", "", "| Category | Pass |", "|---|---|"]
        lines += [f"| {c} | {v:.0%} |" for c, v in m["by_category"].items()]
        lines += ["", "| Task | Passed |", "|---|---|"] + [f"| {t} | {v} |" for t, v in m["by_task"].items()]
        if m["top_failures"]:
            lines += ["", "Most frequent failing checks:", ""] + [f"- {f} ×{n}" for f, n in m["top_failures"]]
    path = out_dir / "summary.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path
