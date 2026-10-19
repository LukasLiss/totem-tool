import os
from typing import Any, Dict, Optional
from .base import BasePromptBuilder


class RAGPromptBuilder(BasePromptBuilder):
    """Domain-knowledge augmented prompt incorporating authoritative TOTeM documentation."""

    name: str = "rag_augmented"

    def __init__(self):
        try:
            from assistant.retriever import retrieve_knowledge
            self._retrieve = retrieve_knowledge
        except ImportError:
            self._retrieve = None

    def build(self, task_prompt: str, context: Optional[Dict[str, Any]] = None, mode: str = "act") -> str:
        prompt_parts = [
            "You are the TOTeM Process Mining Assistant, equipped with authoritative domain knowledge on Object-Centric Process Mining.",
            "Use the provided reference documentation to answer process mining questions precisely.",
            "",
            "### RELEVANT DOMAIN DOCUMENTATION:",
        ]

        if self._retrieve:
            chunks = self._retrieve(task_prompt, top_k=3)
            for c in chunks:
                prompt_parts.append(c)
                prompt_parts.append("---")
        else:
            # Fallback static domain context
            prompt_parts.append(
                "- Object-Centric Process Mining (OCPM) handles events related to multiple objects of different types.\n"
                "- OC-DFG captures directly-follows relations across multiple object types.\n"
                "- Object-Centric C-Nets (OCCN) discover causal dependencies with input/output synchronization sets.\n"
                "- In event logs, bottleneck delays are calculated between consecutive events sharing the same object instances.\n"
                "- In TOTeM, tools provide exact counts (events, objects, activities) and graph layouts."
            )

        prompt_parts.append("\nAnswer the user request accurately based on this context:")
        return "\n".join(prompt_parts)
