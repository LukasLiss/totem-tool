from unittest import TestCase
from evaluation.assistant_benchmark.datasets.tasks import BenchmarkTask, ScorerType, TaskCategory
from evaluation.assistant_benchmark.harnesses.base import HarnessResult
from evaluation.assistant_benchmark.evaluation.exact_scorer import (
    evaluate_task_result,
    extract_numbers,
    score_exact_entities,
    score_numerical,
    score_set_membership,
    score_tool_call,
)


class ExactScorerTests(TestCase):
    def test_extract_numbers(self):
        text = "The log has 35,413 events and takes approx 453.5 days (or 39127457.67 seconds)."
        nums = extract_numbers(text)
        self.assertIn(35413.0, nums)
        self.assertIn(453.5, nums)
        self.assertIn(39127457.67, nums)

    def test_score_bottleneck_entities(self):
        task = BenchmarkTask(
            id="test_bottleneck",
            category=TaskCategory.BOTTLENECK,
            prompt="Between which activities is the bottleneck?",
            target_log="ContainerLogistics",
            log_path="dummy.sqlite",
            scorer_type=ScorerType.EXACT_ENTITIES,
            ground_truth={
                "entity_pairs": [["OrderEmptyContainers", "Depart"]],
            },
            description="Test bottleneck",
        )
        res_pass = HarnessResult(
            task_id="test_bottleneck",
            model_name="mock",
            prompt_strategy="zero_shot",
            harness_type="mcp",
            response_text="The biggest bottleneck is between OrderEmptyContainers and Depart with large delay.",
        )
        eval_pass = score_exact_entities(res_pass, task)
        self.assertTrue(eval_pass["correct"])
        self.assertEqual(eval_pass["score"], 1.0)

        res_fail = HarnessResult(
            task_id="test_bottleneck",
            model_name="mock",
            prompt_strategy="zero_shot",
            harness_type="mcp",
            response_text="The bottleneck is between PlaceinStock and RegisterCustomerOrder.",
        )
        eval_fail = score_exact_entities(res_fail, task)
        self.assertFalse(eval_fail["correct"])
        self.assertEqual(eval_fail["score"], 0.0)

    def test_score_numerical_tolerance(self):
        task = BenchmarkTask(
            id="test_num",
            category=TaskCategory.DESCRIPTIVE,
            prompt="Total events?",
            target_log="ContainerLogistics",
            log_path="dummy.sqlite",
            scorer_type=ScorerType.NUMERICAL,
            ground_truth={"value": 35413, "tolerance_pct": 1.0},
            description="Test numerical",
        )
        res_exact = HarnessResult(
            task_id="test_num", model_name="mock", prompt_strategy="zero_shot", harness_type="mcp",
            response_text="There are exactly 35413 events recorded.",
        )
        self.assertTrue(score_numerical(res_exact, task)["correct"])

        res_close = HarnessResult(
            task_id="test_num", model_name="mock", prompt_strategy="zero_shot", harness_type="mcp",
            response_text="Estimated around 35500 events.",
        )
        self.assertTrue(score_numerical(res_close, task)["correct"])

        res_wrong = HarnessResult(
            task_id="test_num", model_name="mock", prompt_strategy="zero_shot", harness_type="mcp",
            response_text="There are 50000 events.",
        )
        self.assertFalse(score_numerical(res_wrong, task)["correct"])

    def test_score_tool_call(self):
        task = BenchmarkTask(
            id="test_tool",
            category=TaskCategory.DISCOVERY,
            prompt="Discover occn",
            target_log="ContainerLogistics",
            log_path="dummy.sqlite",
            scorer_type=ScorerType.TOOL_CALL,
            ground_truth={"tool_name": "discover_occn"},
            description="Test tool call",
        )
        res_pass = HarnessResult(
            task_id="test_tool", model_name="mock", prompt_strategy="zero_shot", harness_type="mcp",
            response_text="Model discovered.",
            tool_calls=[{"name": "discover_occn", "arguments": {"threshold": 0.1}}],
        )
        self.assertTrue(score_tool_call(res_pass, task)["correct"])

        res_fail = HarnessResult(
            task_id="test_tool", model_name="mock", prompt_strategy="zero_shot", harness_type="mcp",
            response_text="Model discovered.",
            tool_calls=[{"name": "get_statistics", "arguments": {}}],
        )
        self.assertFalse(score_tool_call(res_fail, task)["correct"])

    def test_bottleneck_disallowed_competitor_defense(self):
        task = BenchmarkTask(
            id="test_bottleneck_competitor",
            category=TaskCategory.BOTTLENECK,
            prompt="Between which activities is the bottleneck?",
            target_log="ContainerLogistics",
            log_path="dummy.sqlite",
            scorer_type=ScorerType.EXACT_ENTITIES,
            ground_truth={
                "entity_pairs": [["OrderEmptyContainers", "Depart"]],
                "disallowed_competitors": [["RegisterCustomerOrder", "SendInvoice"]],
            },
            description="Test competitor defense",
        )
        # Result mentions the correct pair BUT also claims the disallowed competitor
        res_with_competitor = HarnessResult(
            task_id="test_bottleneck_competitor",
            model_name="mock",
            prompt_strategy="zero_shot",
            harness_type="mcp",
            response_text="The bottleneck is between OrderEmptyContainers and Depart, but RegisterCustomerOrder and SendInvoice has a longer delay.",
        )
        eval_res = score_exact_entities(res_with_competitor, task)
        self.assertFalse(eval_res["correct"])
        self.assertEqual(eval_res["score"], 0.0)
        self.assertIn("Disallowed competitor", eval_res["reason"])

    def test_set_membership_disallowed_entities(self):
        task = BenchmarkTask(
            id="test_set_disallowed",
            category=TaskCategory.LIFESPAN,
            prompt="Top 2 longest lived?",
            target_log="ContainerLogistics",
            log_path="dummy.sqlite",
            scorer_type=ScorerType.SET_MEMBERSHIP,
            ground_truth={
                "required_entities": ["Forklift", "Truck"],
                "disallowed_entities": ["HandlingUnit"],
            },
            description="Test disallowed entity check",
        )
        res_with_disallowed = HarnessResult(
            task_id="test_set_disallowed",
            model_name="mock",
            prompt_strategy="zero_shot",
            harness_type="mcp",
            response_text="The top object types are Forklift, Truck, and HandlingUnit.",
        )
        eval_res = evaluate_task_result(res_with_disallowed, task)
        self.assertFalse(eval_res["correct"])
        self.assertEqual(eval_res["score"], 0.0)
        self.assertIn("Disallowed entities found", eval_res["reason"])
