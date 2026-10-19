from typing import Any, Dict, List


def aggregate_experiment_metrics(run_records: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Aggregate per-task evaluation records into publication-grade summary metrics."""
    if not run_records:
        return {}

    total_tasks = len(run_records)
    total_passed = sum(1 for r in run_records if r.get("correct", False))
    total_tokens = sum(r.get("tokens_total", 0) for r in run_records)
    total_latency = sum(r.get("latency_seconds", 0.0) for r in run_records)

    # Category breakdowns
    category_stats: Dict[str, Dict[str, int]] = {}
    for r in run_records:
        cat = r.get("category", "unknown")
        if cat not in category_stats:
            category_stats[cat] = {"total": 0, "passed": 0}
        category_stats[cat]["total"] += 1
        if r.get("correct", False):
            category_stats[cat]["passed"] += 1

    category_accuracy = {
        cat: round(data["passed"] / max(data["total"], 1) * 100.0, 1)
        for cat, data in category_stats.items()
    }

    # Tool invocation metrics
    tool_tasks = [r for r in run_records if r.get("expected_tools")]
    tool_matches = sum(
        1 for r in tool_tasks
        if any(t in r.get("invoked_tools", []) for t in r.get("expected_tools", []))
    )
    tool_accuracy = round(tool_matches / max(len(tool_tasks), 1) * 100.0, 1) if tool_tasks else 100.0

    return {
        "total_tasks": total_tasks,
        "passed_tasks": total_passed,
        "accuracy_pct": round(total_passed / total_tasks * 100.0, 1),
        "mean_latency_s": round(total_latency / total_tasks, 2),
        "total_tokens": total_tokens,
        "mean_tokens_per_task": round(total_tokens / total_tasks, 1),
        "tool_accuracy_pct": tool_accuracy,
        "category_accuracy": category_accuracy,
    }
