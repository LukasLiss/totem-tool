from typing import Any, Dict, Optional
from .base import BasePromptBuilder


class DynamicContextPromptBuilder(BasePromptBuilder):
    """Production TOTeM dual-channel prompt incorporating active UI state, Teach/Act mode, and live log metadata."""

    name: str = "dynamic_context"

    def build(self, task_prompt: str, context: Optional[Dict[str, Any]] = None, mode: str = "act") -> str:
        ctx = context.copy() if isinstance(context, dict) else {}
        ctx["mode"] = mode

        try:
            from assistant.prompts import build_system_prompt
            # Mock or dummy user object
            class DummyUser:
                username = "eval_user"
                is_authenticated = True

            return build_system_prompt(user=DummyUser(), context=ctx, mode=mode, query=task_prompt)
        except Exception:
            # Fallback if django settings are not loaded in pure script mode
            return (
                f"You are the TOTeM Process Mining Assistant in {mode.upper()} MODE.\n"
                f"Active Log: {ctx.get('active_file_name', 'Event Log')}\n"
                f"Active View: {ctx.get('view_mode', 'overview')}\n"
                "In Act Mode: call analytical or mutating tools directly.\n"
                "In Teach Mode: explain concepts or highlight UI elements using highlight_element."
            )
