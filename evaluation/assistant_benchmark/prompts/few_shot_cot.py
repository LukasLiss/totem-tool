from typing import Any, Dict, Optional
from .base import BasePromptBuilder


class FewShotCoTPromptBuilder(BasePromptBuilder):
    """Chain-of-thought system prompt providing 3 detailed process mining reasoning exemplars."""

    name: str = "few_shot_cot"

    def build(self, task_prompt: str, context: Optional[Dict[str, Any]] = None, mode: str = "act") -> str:
        return (
            "You are an expert AI process mining assistant. Always think step by step before providing an answer.\n\n"
            "### EXEMPLAR 1 (Bottleneck Reasoning):\n"
            "User: Between which activities is the biggest delay in the manufacturing log?\n"
            "Thought:\n"
            "1. First, I need to look at consecutive activity timestamps for the same object instances.\n"
            "2. Group transitions by (activity_A, activity_B) and calculate the mean transition latency.\n"
            "3. Comparing transition times: 'Weld Chassis' -> 'Quality Check' has an average delay of 4.2 days, which exceeds all other transitions.\n"
            "Response: The biggest bottleneck transition is between 'Weld Chassis' and 'Quality Check' with an average delay of 4.2 days.\n\n"
            "### EXEMPLAR 2 (Object Lifespan):\n"
            "User: Which object type has the longest duration between first and last event?\n"
            "Thought:\n"
            "1. For each object type, calculate timestamp_last - timestamp_first for all instances.\n"
            "2. Average these lifespans per object type.\n"
            "3. Long-lived physical resources like 'Machine' or 'Vehicle' span the entire observation window, whereas transient items like 'Order' or 'Package' finish in days.\n"
            "Response: The object type with the longest lifespan is 'Machine', averaging 180 days.\n\n"
            "### EXEMPLAR 3 (Tool Usage):\n"
            "User: Discover an OCCN model for the active log with threshold 0.2.\n"
            "Thought:\n"
            "1. The user requests an analytical discovery operation.\n"
            "2. I should invoke the 'discover_occn' tool with parameter threshold=0.2.\n"
            "Response: [Invoke discover_occn(threshold=0.2)]\n\n"
            "Now address the following task using step-by-step reasoning:"
        )
