import abc
from typing import Any, Dict, Optional


class BasePromptBuilder(abc.ABC):
    """Abstract base class for system prompt generation strategies."""

    name: str = "base"

    @abc.abstractmethod
    def build(self, task_prompt: str, context: Optional[Dict[str, Any]] = None, mode: str = "act") -> str:
        """Construct system prompt for a given query and environment context."""
        raise NotImplementedError
