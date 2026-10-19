from .base import BasePromptBuilder
from .zero_shot import ZeroShotPromptBuilder
from .few_shot_cot import FewShotCoTPromptBuilder
from .rag_augmented import RAGPromptBuilder
from .dynamic_context import DynamicContextPromptBuilder

PROMPT_BUILDERS = {
    "zero_shot": ZeroShotPromptBuilder,
    "few_shot_cot": FewShotCoTPromptBuilder,
    "rag_augmented": RAGPromptBuilder,
    "dynamic_context": DynamicContextPromptBuilder,
}


def get_prompt_builder(name: str) -> BasePromptBuilder:
    if name not in PROMPT_BUILDERS:
        raise ValueError(f"Unknown prompt builder: {name}. Available: {list(PROMPT_BUILDERS.keys())}")
    return PROMPT_BUILDERS[name]()
