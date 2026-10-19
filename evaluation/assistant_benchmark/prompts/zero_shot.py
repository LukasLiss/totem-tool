from typing import Any, Dict, Optional
from .base import BasePromptBuilder


class ZeroShotPromptBuilder(BasePromptBuilder):
    """Minimal unguided baseline prompt with no domain context or examples."""

    name: str = "zero_shot"

    def build(self, task_prompt: str, context: Optional[Dict[str, Any]] = None, mode: str = "act") -> str:
        return "You are an AI assistant. Answer the user's questions clearly and accurately."
