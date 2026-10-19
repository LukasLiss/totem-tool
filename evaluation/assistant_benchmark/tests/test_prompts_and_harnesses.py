from unittest import TestCase
from evaluation.assistant_benchmark.datasets.tasks import BenchmarkTask, ScorerType, TaskCategory
from evaluation.assistant_benchmark.prompts import get_prompt_builder
from evaluation.assistant_benchmark.harnesses import get_harness
from evaluation.assistant_benchmark.reporters.latex_generator import generate_latex_accuracy_table, generate_latex_efficiency_table
from evaluation.assistant_benchmark.reporters.csv_exporter import export_results_to_csv


class PromptsAndHarnessesTests(TestCase):
    def test_all_prompt_builders(self):
        builders = ["zero_shot", "few_shot_cot", "rag_augmented", "dynamic_context"]
        for b_name in builders:
            builder = get_prompt_builder(b_name)
            prompt = builder.build("How many events?", context={"active_file_name": "log.sqlite"}, mode="act")
            self.assertIsInstance(prompt, str)
            self.assertGreater(len(prompt), 10)

    def test_reporters_generation(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            csv_file = f"{tmpdir}/test.csv"
            tex_acc_file = f"{tmpdir}/acc.tex"
            tex_eff_file = f"{tmpdir}/eff.tex"

            sample_records = [{
                "task_id": "T01",
                "category": "descriptive",
                "model": "mock",
                "prompt": "zero_shot",
                "harness": "mcp",
                "correct": True,
                "score": 1.0,
                "latency_seconds": 0.5,
                "tokens_prompt": 100,
                "tokens_completion": 50,
                "tokens_total": 150,
                "expected_tools": ["get_statistics"],
                "invoked_tools": ["get_statistics"],
                "judge_score": 5.0,
                "judge_verdict": "pass",
                "error": None,
            }]

            export_results_to_csv(sample_records, csv_file)
            self.assertTrue(open(csv_file).read().startswith("task_id,category"))

            sample_aggregated = [{
                "model": "mock",
                "prompt": "zero_shot",
                "harness": "mcp",
                "accuracy_pct": 100.0,
                "mean_latency_s": 0.5,
                "mean_tokens_per_task": 150.0,
                "tool_accuracy_pct": 100.0,
                "category_accuracy": {"descriptive": 100.0},
            }]

            tex_acc = generate_latex_accuracy_table(sample_aggregated, tex_acc_file)
            self.assertIn(r"\begin{table*}", tex_acc)
            self.assertIn(r"\textbf{UI Action}", tex_acc)
            self.assertIn("100.0\\%", tex_acc)

            tex_eff = generate_latex_efficiency_table(sample_aggregated, tex_eff_file)
            self.assertIn(r"\begin{table}", tex_eff)
