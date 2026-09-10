"""
Generic wide-playout search driver shared by the OCPN and OCCN engines.

Depth-first enumeration of all firing/binding sequences that end in a
complete state, bounded by per-activity occurrence budgets. In
'variants' mode two sound reductions prune the search without losing
variants:

 - Trace normal form: a step is rejected when it is independent of a
   directly preceding suffix of the path that contains a strictly larger
   letter — the equivalent sequence firing the step earlier is explored
   instead. This keeps exactly the lexicographically minimal
   interleaving of every trace (the local condition is prefix-closed).
 - Fresh-object symmetry (applied inside the engines via `used_objects`):
   objects of the same type that have not participated in any step yet
   are interchangeable, so only the canonical prefix of them may be
   picked.

Completed executions are then reduced to canonical variant keys
(canon.py), which also merges executions that the two prunings cannot
distinguish locally (e.g. symmetric roles established within one event).
"""

import sys
import time
from typing import Callable, Dict, List, Set

from .canon import canonicalize_execution
from .types import (
    PlayoutConfig,
    PlayoutEngine,
    PlayoutEvent,
    PlayoutProgress,
    PlayoutResult,
    PlayoutStep,
)


class SearchStopped(Exception):
    def __init__(self, reason: str) -> None:  # reason: 'timeout' | 'stateCap'
        super().__init__(reason)
        self.reason = reason


def run_playout(engine: PlayoutEngine, config: PlayoutConfig) -> PlayoutResult:
    start = time.monotonic()
    deadline = start + config.timeout_s
    raw = config.mode == "raw"

    budget_left: Dict[str, int] = {}

    def initial_budget(key: str) -> int:
        return config.activity_limits.get(key, config.default_activity_limit)

    def budget_for(key: str) -> int:
        left = budget_left.get(key)
        if left is None:
            left = initial_budget(key)
            budget_left[key] = left
        return left

    path_letters: List[str] = []
    path_objects: List[Set[str]] = []
    path_events: List[PlayoutEvent] = []
    used_count: Dict[str, int] = {}
    used_objects: Set[str] = set()

    seen: Set[str] = set()
    result = PlayoutResult(warnings=list(engine.warnings))

    last_progress = start

    def check_limits() -> None:
        nonlocal last_progress
        if (result.states_explored & 0xFF) != 0:
            return
        now = time.monotonic()
        if now > deadline:
            raise SearchStopped("timeout")
        if config.on_progress is not None and now - last_progress >= 0.25:
            last_progress = now
            config.on_progress(
                PlayoutProgress(
                    states_explored=result.states_explored,
                    completed_runs=result.completed_runs,
                    variant_count=result.variant_count,
                    elapsed_s=now - start,
                )
            )

    def violates_normal_form(step: PlayoutStep) -> bool:
        """
        Trace-normal-form check: reject the step if some directly preceding
        suffix of pairwise-independent events contains a larger letter.
        """
        for j in range(len(path_letters) - 1, -1, -1):
            independent = True
            for obj in step.object_ids:
                if obj in path_objects[j]:
                    independent = False
                    break
            if not independent:
                return False
            if path_letters[j] > step.letter:
                return True
        return False

    def record_completion() -> None:
        result.completed_runs += 1
        if raw:
            return
        canonical = canonicalize_execution(path_events)
        if canonical.approximate:
            result.approximate_dedup = True
        if canonical.key in seen:
            return
        seen.add(canonical.key)
        result.variant_count += 1
        if len(result.variants) < config.max_stored_variants:
            result.variants.append(canonical.variant)

    def apply_step(step: PlayoutStep) -> Callable[[], None]:
        budget_left[step.budget_key] = budget_for(step.budget_key) - 1
        undo_state = step.apply()
        path_letters.append(step.letter)
        path_objects.append(set(step.object_ids))
        path_events.append(step.event)
        for obj in step.object_ids:
            used_count[obj] = used_count.get(obj, 0) + 1
            used_objects.add(obj)

        def undo() -> None:
            for obj in step.object_ids:
                c = used_count[obj] - 1
                used_count[obj] = c
                if c == 0:
                    used_objects.discard(obj)
            path_events.pop()
            path_objects.pop()
            path_letters.pop()
            undo_state()
            budget_left[step.budget_key] = budget_for(step.budget_key) + 1

        return undo

    def visit() -> None:
        result.states_explored += 1
        if result.states_explored > config.max_states:
            raise SearchStopped("stateCap")
        check_limits()

        if engine.is_complete():
            record_completion()

        steps = engine.enabled_steps(used_objects, raw)
        for step in steps:
            if budget_for(step.budget_key) <= 0:
                continue
            if violates_normal_form(step):
                continue

            undo = apply_step(step)
            visit()
            undo()

    # Raw mode: memoized completion counting on (state, remaining budgets),
    # mirroring totem_lib's playout. Only non-initial budget entries go into
    # the key so untouched and touched-then-restored budgets compare equal.
    raw_memo: Dict[str, int] = {}

    def budgets_key() -> str:
        return ",".join(
            f"{key}={left}"
            for key, left in sorted(
                (entry for entry in budget_left.items() if entry[1] != initial_budget(entry[0])),
                key=lambda entry: entry[0],
            )
        )

    def visit_raw() -> int:
        memo_key = f"{engine.state_key()} {budgets_key()}"
        cached = raw_memo.get(memo_key)
        if cached is not None:
            return cached

        result.states_explored += 1
        if result.states_explored > config.max_states:
            raise SearchStopped("stateCap")
        check_limits()

        completions = 1 if engine.is_complete() else 0
        steps = engine.enabled_steps(used_objects, True)
        for step in steps:
            if budget_for(step.budget_key) <= 0:
                continue
            undo = apply_step(step)
            completions += visit_raw()
            undo()
        raw_memo[memo_key] = completions
        return completions

    # The DFS recursion depth is bounded by the total occurrence budget, so
    # raise the interpreter recursion limit accordingly. The limit is only
    # ever raised, never restored: lowering it afterwards could pull the
    # limit out from under a concurrent playout in another thread.
    total_budget = sum(initial_budget(key) for key in engine.budget_keys)
    needed_recursion_limit = min(100_000, 3 * total_budget + 10_000)
    if sys.getrecursionlimit() < needed_recursion_limit:
        sys.setrecursionlimit(needed_recursion_limit)
    try:
        if raw:
            result.completed_runs = visit_raw()
        else:
            visit()
    except SearchStopped as err:
        result.exhaustive = False
        if err.reason == "timeout":
            result.timed_out = True
        else:
            result.state_cap_hit = True

    if not raw and result.variant_count > len(result.variants):
        result.warnings.append(
            f"Only the first {len(result.variants)} of {result.variant_count} variants were stored."
        )
    result.elapsed_s = time.monotonic() - start
    return result
