"""
The assistant's agent loop.

One user turn runs:

    model step -> tool calls -> tool results -> model step -> ... -> final answer

until the model stops calling tools, a step budget is hit, or the client goes
away. Tools are handled by kind (see ``mcp_server.server``):

* READ     executed now; the result goes back to the model.
* PROPOSE  registered as a pending action the user approves in the UI; the
           model is told it was proposed, not done. The outcome is reported at
           the start of the user's next turn.
* CLIENT   forwarded to the browser (navigation, tours) and acknowledged.

Every assistant ``tool_use`` gets a matching ``tool_result`` in the transcript,
including on errors and cancellation, so the stored conversation is always a
valid request for any provider.

``run_turn`` yields UI events:

    {"type": "conversation", "conversation_id"}
    {"type": "text", "text"}
    {"type": "status", "status": "thinking"}
    {"type": "tool_start", "id", "name", "summary"}
    {"type": "tool_end", "id", "name", "ok", "error"?, "duration_ms"}
    {"type": "pending_action", "id", "name", "description", "arguments"}
    {"type": "client_action", "id", "name", "arguments"}
    {"type": "notice", "text"}
    {"type": "error", "code", "message", "retryable"}
    {"type": "done", "usage", "conversation_id"}
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, Iterator, List, Optional

from mcp_server.server import TOOLS_BY_NAME, ToolContext, ToolError, ToolKind, call_tool, get_tools, validate_arguments

from . import action_registry, conversation as conv_store
from .prompts import TOUR_TARGETS, build_system_prompt, render_ui_context
from .providers import Provider, ProviderError

logger = logging.getLogger(__name__)

MAX_STEPS = 12
MAX_TOOL_RESULT_CHARS = 24_000


def _result_block(tool_use: Dict[str, Any], payload: Any, is_error: bool = False) -> Dict[str, Any]:
    text = payload if isinstance(payload, str) else json.dumps(payload, default=str, ensure_ascii=False)
    if len(text) > MAX_TOOL_RESULT_CHARS:
        text = text[:MAX_TOOL_RESULT_CHARS] + f"\n…[truncated: result was {len(text)} characters; narrow the request]"
    return {
        "type": "tool_result",
        "tool_use_id": tool_use["id"],
        "name": tool_use["name"],
        "content": text,
        "is_error": is_error,
    }


def _check_client_action(name: str, args: Dict[str, Any]) -> None:
    if name == "start_tour":
        unknown = [s["tour_id"] for s in args["steps"] if s["tour_id"] not in TOUR_TARGETS]
        if unknown:
            raise ToolError(
                f"Unknown tour_id(s): {', '.join(unknown)}.",
                code="INVALID_ARGUMENT",
                hint=f"Valid tour_id values: {', '.join(TOUR_TARGETS)}.",
            )
    elif name == "open_view":
        if args["view"] == "dashboard" and args.get("dashboard_id") is None:
            raise ToolError("view 'dashboard' needs a dashboard_id.", code="INVALID_ARGUMENT", hint="Call list_dashboards.")


class Turn:
    """State of one user turn; ``run`` is a generator of UI events."""

    def __init__(self, *, user, conversation: conv_store.Conversation, provider: Provider, ui_context: Dict[str, Any]):
        self.user = user
        self.conv = conversation
        self.provider = provider
        self.ui = ui_context
        self.tool_ctx = ToolContext(
            user=user,
            active_file_id=ui_context.get("active_file_id"),
            project_id=ui_context.get("project_id"),
            dashboard_id=ui_context.get("dashboard_id"),
        )
        self.tools = get_tools(conversation.mode)
        self.tool_names = {t.name for t in self.tools}
        self.system = build_system_prompt(conversation.mode)
        self.usage = {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0}

    # -- transcript helpers -------------------------------------------------

    def _user_message(self, text: str) -> Dict[str, Any]:
        blocks: List[Dict[str, Any]] = []
        if conv_store.transcript_size(self.conv.messages) > conv_store.MAX_TRANSCRIPT_CHARS:
            recap = conv_store.recap(self.conv.messages)
            self.conv.messages = []
            blocks.append({"type": "text", "text": "<earlier_conversation_recap>\n" + recap + "\n</earlier_conversation_recap>"})
        if self.conv.notes:
            notes = "\n".join(f"- {n}" for n in self.conv.notes)
            blocks.append({"type": "text", "text": f"<updates_since_your_last_reply>\n{notes}\n</updates_since_your_last_reply>"})
            self.conv.notes = []
        blocks.append({"type": "text", "text": f"{render_ui_context(self.ui)}\n\n{text}"})
        return {"role": "user", "content": blocks}

    def _close_dangling_tool_uses(self, reason: str) -> None:
        """Give every unanswered tool_use in the last assistant message an error result."""
        if not self.conv.messages or self.conv.messages[-1]["role"] != "assistant":
            return
        pending = [b for b in self.conv.messages[-1]["content"] if b["type"] == "tool_use"]
        if pending:
            self.conv.messages.append(
                {"role": "user", "content": [_result_block(tu, {"error": reason}, is_error=True) for tu in pending]}
            )

    # -- tool execution -----------------------------------------------------

    def _run_tool(self, tu: Dict[str, Any]) -> Iterator[Dict[str, Any]]:
        """Execute one tool call; yields UI events and finally the tool_result block."""
        name = tu["name"]
        tool = TOOLS_BY_NAME.get(name)
        args = tu.get("input") or {}
        if tool is None or name not in self.tool_names:
            yield _result_block(tu, {"error": f"Tool '{name}' is not available in {self.conv.mode} mode."}, is_error=True)
            return
        if "__unparseable__" in args:
            yield _result_block(tu, {"error": "Your tool arguments were not valid JSON. Send them again."}, is_error=True)
            return

        summary = tool.summary(args)
        yield {"type": "tool_start", "id": tu["id"], "name": name, "summary": summary, "kind": tool.kind.value}
        started = time.monotonic()
        try:
            validate_arguments(tool, args)
            if tool.kind is ToolKind.READ:
                result = call_tool(name, args, self.tool_ctx)
                block = _result_block(tu, result)
            elif tool.kind is ToolKind.PROPOSE:
                action_id = action_registry.register_action(
                    user_id=self.user.id,
                    conversation_id=self.conv.id,
                    tool_name=name,
                    arguments=args,
                    description=summary,
                    tool_context={
                        "active_file_id": self.tool_ctx.active_file_id,
                        "project_id": self.tool_ctx.project_id,
                        "dashboard_id": self.tool_ctx.dashboard_id,
                    },
                )
                yield {"type": "pending_action", "id": action_id, "name": name, "description": summary, "arguments": args}
                block = _result_block(
                    tu,
                    {
                        "status": "awaiting_user_approval",
                        "action_id": action_id,
                        "note": "Shown to the user as an approval card. Nothing has changed yet.",
                    },
                )
            else:
                _check_client_action(name, args)
                yield {"type": "client_action", "id": tu["id"], "name": name, "arguments": args}
                block = _result_block(tu, {"status": "done_in_browser"})
        except ToolError as exc:
            block = _result_block(tu, exc.to_dict(), is_error=True)
        except Exception as exc:  # unexpected: keep the loop alive, tell the model
            logger.exception("Assistant tool %s failed", name)
            block = _result_block(tu, {"error": f"Internal error in {name}: {type(exc).__name__}: {exc}"}, is_error=True)

        end = {"type": "tool_end", "id": tu["id"], "name": name, "ok": not block["is_error"], "duration_ms": int((time.monotonic() - started) * 1000)}
        if block["is_error"]:
            try:
                end["error"] = json.loads(block["content"]).get("error")
            except (ValueError, AttributeError):
                end["error"] = block["content"][:300]
        yield end
        yield block

    # -- main loop ----------------------------------------------------------

    def run(self, text: str) -> Iterator[Dict[str, Any]]:
        yield {"type": "conversation", "conversation_id": self.conv.id}
        self._close_dangling_tool_uses("Not executed: the previous turn was interrupted.")
        user_message = self._user_message(text)  # may replace self.conv.messages (recap)
        self.conv.messages.append(user_message)
        tool_specs = [t.spec() for t in self.tools]

        try:
            for step in range(MAX_STEPS):
                final = None
                for ev in self.provider.stream(self.system, self.conv.messages, tool_specs):
                    if ev["type"] == "message":
                        final = ev
                    else:
                        yield ev
                if final is None:
                    raise ProviderError("unavailable", "The model stream ended without a response.")

                msg = final["message"]
                self.conv.messages.append(msg)
                for k in self.usage:
                    self.usage[k] += int((final.get("usage") or {}).get(k, 0) or 0)

                stop = final["stop_reason"]
                tool_uses = [b for b in msg["content"] if b["type"] == "tool_use"]

                if stop == "refusal":
                    self._close_dangling_tool_uses("Not executed: the response was declined.")
                    yield {"type": "notice", "text": "The model declined to continue with this request."}
                    break
                if not tool_uses:
                    if stop == "max_tokens":
                        yield {"type": "notice", "text": "The answer hit the length limit and was cut off."}
                    break
                if stop == "max_tokens":
                    # Tool input may be truncated: never run it.
                    self.conv.messages.append(
                        {
                            "role": "user",
                            "content": [
                                _result_block(tu, {"error": "Output limit reached while writing this call; not executed. Use smaller inputs."}, is_error=True)
                                for tu in tool_uses
                            ],
                        }
                    )
                    continue

                results: List[Dict[str, Any]] = []
                try:
                    for tu in tool_uses:
                        for ev in self._run_tool(tu):
                            if ev.get("type") == "tool_result":
                                results.append(ev)
                            else:
                                yield ev
                finally:
                    # Even if the client disconnects mid-tool, answer every call.
                    answered = {r["tool_use_id"] for r in results}
                    results += [
                        _result_block(tu, {"error": "Not executed: the request was cancelled."}, is_error=True)
                        for tu in tool_uses
                        if tu["id"] not in answered
                    ]
                    self.conv.messages.append({"role": "user", "content": results})
            else:
                yield {"type": "notice", "text": f"Stopped after {MAX_STEPS} steps. Ask me to continue if needed."}
        except ProviderError as exc:
            self._close_dangling_tool_uses("Not executed: the model call failed.")
            yield {"type": "error", "code": exc.kind, "message": str(exc), "retryable": exc.retryable}

        yield {"type": "done", "usage": self.usage, "conversation_id": self.conv.id}


def run_turn(*, user, conversation_id: Optional[str], mode: str, text: str, ui_context: Dict[str, Any], provider: Provider) -> Iterator[Dict[str, Any]]:
    """Run one user turn with conversation locking and persistence."""
    conv = conv_store.load_or_create(user.id, conversation_id, mode)
    if not conv_store.acquire_turn(user.id, conv.id):
        yield {"type": "error", "code": "busy", "message": "A reply is still being generated in this conversation.", "retryable": True}
        yield {"type": "done", "usage": {}, "conversation_id": conv.id}
        return
    try:
        yield from Turn(user=user, conversation=conv, provider=provider, ui_context=ui_context).run(text)
    finally:
        conv_store.save(conv)
        conv_store.release_turn(user.id, conv.id)
