import json
import os
import sys
import time
from typing import Any, Dict, List, Optional
from ..datasets.tasks import BenchmarkTask
from ..prompts.base import BasePromptBuilder
from .base import BaseHarness, HarnessResult

# Ensure backend is on PYTHONPATH
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BACKEND_DIR = os.path.join(ROOT_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "totem_backend.settings")
try:
    import django
    django.setup()
    from api.models import EventLog, Project
    from django.contrib.auth.models import User
    from mcp_server.server import call_tool, get_tool_specs
except Exception as _setup_err:
    pass


class MCPHarness(BaseHarness):
    """
    Grounded Process Mining MCP Server execution harness.
    Runs an agentic loop dispatching tool calls to DuckDB analytics,
    totem_lib mining algorithms, and DashboardService.
    """

    name: str = "mcp"

    def __init__(self, max_turns: int = 5):
        self.max_turns = max_turns

    def _ensure_active_file(self, task: BenchmarkTask, user: Any) -> Optional[int]:
        """Find or create EventLog record for the target dataset."""
        try:
            target_sub = "container" if "container" in task.target_log.lower() or "logistic" in task.target_log.lower() else "order"
            log = EventLog.objects.filter(file__icontains=target_sub).first()
            if log:
                return log.id

            # Fallback to any log matching filename
            base_name = os.path.basename(task.log_path)
            log = EventLog.objects.filter(file__icontains=base_name).first()
            if log:
                return log.id

            # Fallback to any existing log
            first_log = EventLog.objects.first()
            if first_log:
                return first_log.id

            # Self-healing auto-seeder if database is unseeded
            if os.path.exists(task.log_path):
                project, _ = Project.objects.get_or_create(
                    name="benchmarks",
                    defaults={"display_name": "Benchmark Evaluation"}
                )
                if user and hasattr(project, "users"):
                    project.users.add(user)

                seeded_log = EventLog.objects.create(
                    project=project,
                    file=task.log_path,
                )
                return seeded_log.id
        except Exception:
            pass
        return None

    def execute(
        self,
        task: BenchmarkTask,
        prompt_builder: BasePromptBuilder,
        llm_provider: Any,
        context: Optional[Dict[str, Any]] = None,
    ) -> HarnessResult:
        ctx = context.copy() if isinstance(context, dict) else {}
        ctx["mode"] = task.mode

        try:
            user = User.objects.filter(username="Guest").first() or User.objects.first()
            if not user:
                user = User.objects.create_user(username="Guest")
        except Exception:
            user = None

        file_id = ctx.get("active_file_id") or self._ensure_active_file(task, user)
        ctx["active_file_id"] = file_id
        ctx["active_file_name"] = os.path.basename(task.log_path)
        ctx["__confirmed__"] = True  # Auto-confirm mutating actions in benchmark mode

        system_prompt = prompt_builder.build(task.prompt, context=ctx, mode=task.mode)

        try:
            tool_specs = get_tool_specs()
        except Exception:
            tool_specs = []

        t0 = time.perf_counter()
        turn_count = 0
        all_tool_calls: List[Dict[str, Any]] = []
        all_tool_results: List[Dict[str, Any]] = []
        history: List[Dict[str, Any]] = []
        total_prompt_tokens = 0
        total_completion_tokens = 0
        final_response_text = ""

        current_user_message = task.prompt

        try:
            while turn_count < self.max_turns:
                turn_count += 1
                res = llm_provider.complete(
                    system_prompt=system_prompt,
                    user_message=current_user_message,
                    tools=tool_specs,
                    history=history,
                )

                usage = res.get("usage", {})
                total_prompt_tokens += usage.get("prompt_tokens", 0)
                total_completion_tokens += usage.get("completion_tokens", 0)

                text = res.get("text", "") or ""
                tool_calls = res.get("tool_calls", []) or []

                if text:
                    final_response_text = text

                if not tool_calls:
                    # Model provided text without further tool calls -> loop completed
                    break

                # Record turn in history
                history.append({"role": "user", "content": current_user_message})
                history.append({
                    "role": "model",
                    "content": text or f"[Invoking tools: {', '.join(tc.get('name', '') for tc in tool_calls)}]"
                })

                # Execute all generated tool calls
                tool_output_parts = []
                for tc in tool_calls:
                    tc_name = tc.get("name", "")
                    tc_args = tc.get("arguments", {})
                    all_tool_calls.append(tc)

                    # Ensure file_id is passed if tool expects one
                    if "file_id" not in tc_args and file_id is not None:
                        tc_args["file_id"] = file_id

                    try:
                        tool_out = call_tool(tc_name, tc_args, user=user, context=ctx)
                        # Truncate overly massive outputs for prompt window
                        tool_out_str = json.dumps(tool_out) if not isinstance(tool_out, str) else tool_out
                        if len(tool_out_str) > 3000:
                            tool_out_summary = tool_out_str[:3000] + "... [truncated]"
                        else:
                            tool_out_summary = tool_out_str
                        all_tool_results.append({"name": tc_name, "output": tool_out})
                        tool_output_parts.append(f"Tool '{tc_name}' returned: {tool_out_summary}")
                    except Exception as tool_exc:
                        err_msg = f"Tool '{tc_name}' error: {str(tool_exc)}"
                        all_tool_results.append({"name": tc_name, "error": str(tool_exc)})
                        tool_output_parts.append(err_msg)

                # Feed tool results back as the next prompt turn
                current_user_message = "\n\n".join(tool_output_parts)

            t1 = time.perf_counter()
            return HarnessResult(
                task_id=task.id,
                model_name=getattr(llm_provider, "model", "unknown"),
                prompt_strategy=prompt_builder.name,
                harness_type=self.name,
                response_text=final_response_text,
                tool_calls=all_tool_calls,
                tool_results=all_tool_results,
                tokens_prompt=total_prompt_tokens,
                tokens_completion=total_completion_tokens,
                tokens_total=total_prompt_tokens + total_completion_tokens,
                latency_seconds=t1 - t0,
                turns=turn_count,
                raw_history=history,
            )

        except Exception as exc:
            t1 = time.perf_counter()
            return HarnessResult(
                task_id=task.id,
                model_name=getattr(llm_provider, "model", "unknown"),
                prompt_strategy=prompt_builder.name,
                harness_type=self.name,
                response_text=final_response_text,
                tool_calls=all_tool_calls,
                tool_results=all_tool_results,
                error=str(exc),
                latency_seconds=t1 - t0,
                turns=turn_count,
            )
