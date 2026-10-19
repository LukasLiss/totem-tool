#!/usr/bin/env python
"""
Automated CLI Runner for the TOTeM AI Assistant Benchmark.
Evaluates model x prompt x harness combinations against 20 ground-truth OCPM tasks.
"""

import argparse
import os
import sys
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

# Setup sys.path for backend and assistant imports
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(CURRENT_DIR, "..", ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")

if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "totem_backend.settings")
try:
    import django
    django.setup()
except Exception:
    pass

from assistant.llm import (
    AnthropicProvider,
    GeminiProvider,
    MockProvider,
    OpenAIProvider,
)
from evaluation.assistant_benchmark.datasets.tasks import BENCHMARK_TASKS, BenchmarkTask
from evaluation.assistant_benchmark.evaluation.exact_scorer import evaluate_task_result
from evaluation.assistant_benchmark.evaluation.llm_judge import LLMJudge
from evaluation.assistant_benchmark.evaluation.metrics import aggregate_experiment_metrics
from evaluation.assistant_benchmark.harnesses import get_harness
from evaluation.assistant_benchmark.prompts import get_prompt_builder
from evaluation.assistant_benchmark.reporters.csv_exporter import export_results_to_csv
from evaluation.assistant_benchmark.reporters.latex_generator import (
    generate_latex_accuracy_table,
    generate_latex_efficiency_table,
)


def get_llm_provider(model_name: str, api_key: Optional[str] = None) -> Any:
    """Instantiate provider by model identifier with API key resolution."""
    model_lower = model_name.lower()
    if model_lower == "mock":
        return MockProvider()

    key = api_key
    if "gemini" in model_lower:
        key = key or os.environ.get("GEMINI_API_KEY")
        return GeminiProvider(api_key=key, model=model_name)
    if "claude" in model_lower or "anthropic" in model_lower:
        key = key or os.environ.get("ANTHROPIC_API_KEY")
        return AnthropicProvider(api_key=key, model=model_name)
    if "gpt" in model_lower or "o3" in model_lower or "openai" in model_lower:
        key = key or os.environ.get("OPENAI_API_KEY")
        return OpenAIProvider(api_key=key, model=model_name)

    # Default to Gemini if unknown
    key = key or os.environ.get("GEMINI_API_KEY")
    return GeminiProvider(api_key=key, model=model_name)


def _execute_with_retry(harness: Any, task: BenchmarkTask, prompt_builder: Any, provider: Any, max_retries: int = 3) -> Any:
    """Execute harness with exponential backoff on transient network / rate-limit failures."""
    last_err = None
    for attempt in range(max_retries):
        try:
            return harness.execute(task, prompt_builder, provider)
        except Exception as exc:
            last_err = exc
            if attempt < max_retries - 1:
                wait_s = 2 ** attempt
                print(f"[RETRY {attempt+1}/{max_retries} in {wait_s}s]...", end=" ", flush=True)
                time.sleep(wait_s)
            else:
                raise last_err


def run_benchmark(
    models: List[str],
    prompts: List[str],
    harnesses: List[str],
    task_limit: int = 0,
    categories: List[str] = None,
    output_dir: str = "evaluation/assistant_benchmark/results",
    judge_model: str = None,
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Execute the full factorial benchmark matrix."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = os.path.abspath(output_dir)
    os.makedirs(out_dir, exist_ok=True)

    # Filter tasks
    tasks = BENCHMARK_TASKS
    if categories:
        cat_set = {c.lower() for c in categories}
        tasks = [t for t in tasks if t.category.value in cat_set]
    if task_limit > 0:
        tasks = tasks[:task_limit]

    print("=" * 70)
    print("[START] TOTeM AI Assistant Empirical Evaluation Framework")
    print(f"   Tasks to evaluate:    {len(tasks)}")
    print(f"   Models:               {models}")
    print(f"   Prompt strategies:    {prompts}")
    print(f"   Harnesses:            {harnesses}")
    print(f"   Output directory:     {out_dir}")
    print("=" * 70)

    judge_provider = get_llm_provider(judge_model, api_key=api_key) if judge_model else None
    judge = LLMJudge(judge_provider=judge_provider)

    all_records: List[Dict[str, Any]] = []
    aggregated_runs: List[Dict[str, Any]] = []

    for model_name in models:
        provider = get_llm_provider(model_name, api_key=api_key)

        for prompt_name in prompts:
            prompt_builder = get_prompt_builder(prompt_name)

            for harness_name in harnesses:
                harness = get_harness(harness_name)
                print(f"\n[CONDITION] Model={model_name} | Prompt={prompt_name} | Harness={harness_name}")

                condition_records: List[Dict[str, Any]] = []

                for idx, task in enumerate(tasks, 1):
                    print(f"   [{idx}/{len(tasks)}] Task {task.id} ({task.category.value})...", end=" ", flush=True)

                    try:
                        res = _execute_with_retry(harness, task, prompt_builder, provider)
                        exact_eval = evaluate_task_result(res, task)
                        judge_eval = judge.evaluate(res, task, exact_eval)

                        is_correct = exact_eval.get("correct", False)
                        status_str = "[PASS]" if is_correct else "[FAIL]"
                        score_val = exact_eval.get("score", 0.0)
                        print(f"{status_str} (Score: {score_val:.2f}, Latency: {res.latency_seconds:.2f}s)")

                        record = {
                            "task_id": task.id,
                            "category": task.category.value,
                            "model": model_name,
                            "prompt": prompt_name,
                            "harness": harness_name,
                            "correct": is_correct,
                            "score": score_val,
                            "latency_seconds": res.latency_seconds,
                            "tokens_prompt": res.tokens_prompt,
                            "tokens_completion": res.tokens_completion,
                            "tokens_total": res.tokens_total,
                            "expected_tools": task.expected_tools,
                            "invoked_tools": [tc.get("name") for tc in res.tool_calls],
                            "judge_score": judge_eval.get("overall_score", 0.0),
                            "judge_verdict": judge_eval.get("verdict", ""),
                            "error": res.error,
                        }
                    except Exception as exc:
                        print(f"[ERROR]: {exc}")
                        record = {
                            "task_id": task.id,
                            "category": task.category.value,
                            "model": model_name,
                            "prompt": prompt_name,
                            "harness": harness_name,
                            "correct": False,
                            "score": 0.0,
                            "latency_seconds": 0.0,
                            "tokens_total": 0,
                            "error": str(exc),
                        }

                    condition_records.append(record)
                    all_records.append(record)

                # Aggregate condition results
                metrics = aggregate_experiment_metrics(condition_records)
                metrics["model"] = model_name
                metrics["prompt"] = prompt_name
                metrics["harness"] = harness_name
                aggregated_runs.append(metrics)

                print(f"   -> Summary: Accuracy = {metrics.get('accuracy_pct')}% | Mean Latency = {metrics.get('mean_latency_s')}s | Tool Acc = {metrics.get('tool_accuracy_pct')}%")

    # Export Reports
    csv_path = os.path.join(out_dir, f"results_{timestamp}.csv")
    tex_acc_path = os.path.join(out_dir, f"table_accuracy_{timestamp}.tex")
    tex_eff_path = os.path.join(out_dir, f"table_efficiency_{timestamp}.tex")

    export_results_to_csv(all_records, csv_path)
    generate_latex_accuracy_table(aggregated_runs, tex_acc_path)
    generate_latex_efficiency_table(aggregated_runs, tex_eff_path)

    print("\n" + "=" * 70)
    print("[DONE] Benchmark Run Completed Successfully!")
    print(f"   CSV Raw Data:       {csv_path}")
    print(f"   LaTeX Accuracy:     {tex_acc_path}")
    print(f"   LaTeX Efficiency:   {tex_eff_path}")
    print("=" * 70)

    return {
        "csv_path": csv_path,
        "latex_accuracy": tex_acc_path,
        "latex_efficiency": tex_eff_path,
        "aggregated_runs": aggregated_runs,
    }


def main():
    parser = argparse.ArgumentParser(description="Run TOTeM AI Assistant Benchmark Matrix")
    parser.add_argument("--models", type=str, default="mock", help="Comma-separated model names (e.g. mock,gemini-3.8-flash,gpt-4o)")
    parser.add_argument("--prompts", type=str, default="zero_shot,few_shot_cot,rag_augmented,dynamic_context", help="Comma-separated prompt strategies")
    parser.add_argument("--harnesses", type=str, default="ungrounded,mcp", help="Comma-separated harnesses (ungrounded,mcp)")
    parser.add_argument("--tasks", type=int, default=0, help="Limit number of tasks (0 = all 20)")
    parser.add_argument("--categories", type=str, default="", help="Comma-separated categories to run")
    parser.add_argument("--output-dir", type=str, default="evaluation/assistant_benchmark/results", help="Output directory")
    parser.add_argument("--mock", action="store_true", help="Force MockProvider execution for zero-token local testing")
    parser.add_argument("--judge", type=str, default=None, help="Model for LLM judge (optional)")
    parser.add_argument("--api-key", type=str, default=None, help="API key for model provider (optional, falls back to env vars)")

    args = parser.parse_args()

    models = ["mock"] if args.mock else [m.strip() for m in args.models.split(",") if m.strip()]
    prompts = [p.strip() for p in args.prompts.split(",") if p.strip()]
    harnesses = [h.strip() for h in args.harnesses.split(",") if h.strip()]
    categories = [c.strip() for c in args.categories.split(",") if c.strip()] if args.categories else None

    run_benchmark(
        models=models,
        prompts=prompts,
        harnesses=harnesses,
        task_limit=args.tasks,
        categories=categories,
        output_dir=args.output_dir,
        judge_model=args.judge,
        api_key=args.api_key,
    )


if __name__ == "__main__":
    main()
