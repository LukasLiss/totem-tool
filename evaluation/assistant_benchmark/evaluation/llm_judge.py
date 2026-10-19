import json
import logging
import re
from typing import Any, Dict, Optional
from ..datasets.tasks import BenchmarkTask
from ..harnesses.base import HarnessResult

logger = logging.getLogger(__name__)

JUDGE_SYSTEM_PROMPT = """You are an impartial scientific judge evaluating an AI Process Mining Assistant.
Evaluate the model's answer against the verified ground truth using the following 5-point rubric:

1. ACCURACY (1-5): Is the answer mathematically and factually consistent with the ground truth?
   - For bottleneck questions: verify that the model names the true bottleneck transition and that no other activity pairs are stated to have a bigger bottleneck.
   - For lifespan questions: verify that the top-ranked object types are accurately identified without false claims.
2. COMPLETENESS (1-5): Does the response fully address every aspect of the question?
3. HALLUCINATION (1-5): 5 = completely grounded in facts/data; 1 = heavily hallucinated numbers or fake activities.
4. TOOL_GROUNDING (1-5): Did the model properly ground its claims using tools or verified data?

Respond ONLY with a valid JSON object matching this schema:
{
  "accuracy": <1-5>,
  "completeness": <1-5>,
  "hallucination": <1-5>,
  "tool_grounding": <1-5>,
  "overall_score": <1.0 - 5.0>,
  "verdict": "pass" | "fail",
  "rationale": "<brief explanation>"
}
"""


class LLMJudge:
    """Evaluates qualitative and complex reasoning answers using an LLM or deterministic fallback."""

    def __init__(self, judge_provider: Optional[Any] = None):
        self.judge_provider = judge_provider

    def evaluate(self, result: HarnessResult, task: BenchmarkTask, exact_eval: Dict[str, Any]) -> Dict[str, Any]:
        """Judge the result using either an external LLM or a deterministic rule-based fallback."""
        if not self.judge_provider:
            return self._heuristic_fallback(result, task, exact_eval)

        user_content = (
            f"TASK PROMPT: {task.prompt}\n\n"
            f"GROUND TRUTH: {json.dumps(task.ground_truth, indent=2)}\n\n"
            f"MODEL RESPONSE: {result.response_text}\n\n"
            f"TOOL CALLS MADE: {json.dumps(result.tool_calls, indent=2)}\n\n"
            f"DETERMINISTIC EVALUATION: {json.dumps(exact_eval, indent=2)}\n"
        )

        try:
            eval_res = self.judge_provider.complete(
                system_prompt=JUDGE_SYSTEM_PROMPT,
                user_message=user_content,
            )
            text = eval_res.get("text", "") or ""
            # Strip markdown code fence if present
            cleaned_text = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.MULTILINE)
            cleaned_text = re.sub(r"\s*```$", "", cleaned_text.strip(), flags=re.MULTILINE)

            if "{" in cleaned_text and "}" in cleaned_text:
                json_str = cleaned_text[cleaned_text.find("{"):cleaned_text.rfind("}") + 1]
                parsed = json.loads(json_str)
                if isinstance(parsed, dict) and "overall_score" in parsed:
                    return parsed
        except Exception as exc:
            logger.warning(f"LLM judge failed to parse response, using heuristic fallback: {exc}")

        return self._heuristic_fallback(result, task, exact_eval)

    def _heuristic_fallback(self, result: HarnessResult, task: BenchmarkTask, exact_eval: Dict[str, Any]) -> Dict[str, Any]:
        """Deterministic heuristic judge score when no LLM API key is present."""
        exact_score = float(exact_eval.get("score", 0.0))
        is_correct = exact_eval.get("correct", False)

        accuracy = 5 if is_correct else (3 if exact_score > 0.5 else 1)
        completeness = 4 if len(result.response_text) > 40 else 2
        hallucination = 5 if (result.harness_type == "mcp" and is_correct) else (2 if not is_correct and len(result.response_text) > 50 else 3)
        tool_grounding = 5 if result.tool_calls else (1 if task.expected_tools else 4)

        overall = round((accuracy + completeness + hallucination + tool_grounding) / 4.0, 2)
        return {
            "accuracy": accuracy,
            "completeness": completeness,
            "hallucination": hallucination,
            "tool_grounding": tool_grounding,
            "overall_score": overall,
            "verdict": "pass" if overall >= 3.5 else "fail",
            "rationale": "Calibrated score based on deterministic ground-truth verification.",
        }
