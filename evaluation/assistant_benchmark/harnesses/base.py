import abc
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from ..datasets.tasks import BenchmarkTask
from ..prompts.base import BasePromptBuilder


@dataclass
class HarnessResult:
    task_id: str
    model_name: str
    prompt_strategy: str
    harness_type: str
    response_text: str
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    tool_results: List[Dict[str, Any]] = field(default_factory=list)
    tokens_prompt: int = 0
    tokens_completion: int = 0
    tokens_total: int = 0
    latency_seconds: float = 0.0
    turns: int = 1
    error: Optional[str] = None
    raw_history: List[Dict[str, Any]] = field(default_factory=list)


class BaseHarness(abc.ABC):
    """Abstract base class for model execution harnesses."""

    name: str = "base"

    @abc.abstractmethod
    def execute(
        self,
        task: BenchmarkTask,
        prompt_builder: BasePromptBuilder,
        llm_provider: Any,
        context: Optional[Dict[str, Any]] = None,
    ) -> HarnessResult:
        """Run the task through the model and return structured execution result."""
        raise NotImplementedError
