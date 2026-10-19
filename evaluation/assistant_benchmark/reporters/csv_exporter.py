import csv
import os
from typing import Any, Dict, List


def export_results_to_csv(run_records: List[Dict[str, Any]], output_path: str) -> None:
    """Export detailed benchmark records to a CSV file."""
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    fieldnames = [
        "task_id",
        "category",
        "model",
        "prompt",
        "harness",
        "correct",
        "score",
        "latency_s",
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "expected_tools",
        "invoked_tools",
        "judge_score",
        "judge_verdict",
        "error",
    ]

    with open(output_path, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in run_records:
            writer.writerow({
                "task_id": r.get("task_id", ""),
                "category": r.get("category", ""),
                "model": r.get("model", ""),
                "prompt": r.get("prompt", ""),
                "harness": r.get("harness", ""),
                "correct": "1" if r.get("correct") else "0",
                "score": round(float(r.get("score", 0.0)), 2),
                "latency_s": round(float(r.get("latency_seconds", 0.0)), 2),
                "prompt_tokens": r.get("tokens_prompt", 0),
                "completion_tokens": r.get("tokens_completion", 0),
                "total_tokens": r.get("tokens_total", 0),
                "expected_tools": ";".join(r.get("expected_tools", [])),
                "invoked_tools": ";".join(r.get("invoked_tools", [])),
                "judge_score": r.get("judge_score", ""),
                "judge_verdict": r.get("judge_verdict", ""),
                "error": r.get("error", "") or "",
            })
