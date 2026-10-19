import time
from typing import Any, Dict, Optional
from ..datasets.tasks import BenchmarkTask
from ..prompts.base import BasePromptBuilder
from .base import BaseHarness, HarnessResult


class UngroundedHarness(BaseHarness):
    """
    Zero-Tool baseline harness.
    Sends prompt directly to the LLM without giving access to tools.
    Measures baseline knowledge and parametric hallucination rate.
    """

    name: str = "ungrounded"

    def execute(
        self,
        task: BenchmarkTask,
        prompt_builder: BasePromptBuilder,
        llm_provider: Any,
        context: Optional[Dict[str, Any]] = None,
    ) -> HarnessResult:
        ctx = context.copy() if isinstance(context, dict) else {}
        system_prompt = prompt_builder.build(task.prompt, context=ctx, mode=task.mode)

        t0 = time.perf_counter()
        try:
            res = llm_provider.complete(
                system_prompt=system_prompt,
                user_message=task.prompt,
                tools=None,
                history=[],
            )
            t1 = time.perf_counter()

            usage = res.get("usage", {})
            return HarnessResult(
                task_id=task.id,
                model_name=getattr(llm_provider, "model", "unknown"),
                prompt_strategy=prompt_builder.name,
                harness_type=self.name,
                response_text=res.get("text", "") or "",
                tool_calls=[],
                tool_results=[],
                tokens_prompt=usage.get("prompt_tokens", 0),
                tokens_completion=usage.get("completion_tokens", 0),
                tokens_total=usage.get("total_tokens", 0),
                latency_seconds=t1 - t0,
                turns=1,
            )
        except Exception as exc:
            t1 = time.perf_counter()
            return HarnessResult(
                task_id=task.id,
                model_name=getattr(llm_provider, "model", "unknown"),
                prompt_strategy=prompt_builder.name,
                harness_type=self.name,
                response_text="",
                error=str(exc),
                latency_seconds=t1 - t0,
                turns=1,
            )
