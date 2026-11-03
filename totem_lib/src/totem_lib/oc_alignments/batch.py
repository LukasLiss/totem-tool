"""Object-centric alignments for many process executions at once.

Every execution is aligned on its own with :func:`~.alignment.compute_oc_alignment`
(per-execution state and time limits, approximate fallback included); a total
time budget stops the batch and marks the executions that were not reached as
``"skipped"``. The result keeps one compact row per execution plus aggregates
(how many fit, average cost, deviations per activity) -- not the moves, which
the caller can recompute for a single execution on demand.
"""

from __future__ import annotations

import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Sequence

from .alignment import (
    APPROXIMATE,
    DEFAULT_MAX_STATES,
    LOG_MOVE,
    MODEL_MOVE,
    OPTIMAL,
    SYNC_MOVE,
    AlignmentCancelled,
    compute_oc_alignment,
)
from .execution import ProcessExecution
from .net import AlignmentNet, net_from_ocpn_dict

SKIPPED = "skipped"

#: Per-execution defaults for batches: smaller than for a single alignment.
DEFAULT_BATCH_MAX_STATES = 50_000
DEFAULT_BATCH_TIMEOUT_S = 5.0
#: Stays below the hosted server's request timeout (gunicorn, 300 s).
DEFAULT_BATCH_TOTAL_TIMEOUT_S = 240.0


@dataclass
class OCAlignmentBatchResult:
    rows: List[dict] = field(default_factory=list)
    elapsed_ms: float = 0.0
    stopped_early: bool = False

    def to_dict(self) -> dict:
        statuses = Counter(row["status"] for row in self.rows)
        aligned = [r for r in self.rows if r["status"] in (OPTIMAL, APPROXIMATE)]
        per_activity: Dict[str, Counter] = defaultdict(Counter)
        ignored: Counter = Counter()
        for row in self.rows:
            for activity, counts in row.pop("_per_activity", {}).items():
                per_activity[activity].update(counts)
            for ot in row["ignored_object_types"]:
                ignored[ot] += 1
        deviations = [
            {"activity": a, "sync": c.get("sync", 0), "log": c.get("log", 0), "model": c.get("model", 0),
             "executions": c.get("executions", 0)}
            for a, c in per_activity.items()
        ]
        deviations.sort(key=lambda r: (-(r["log"] + r["model"]), r["activity"]))
        total_events = sum(r["event_count"] for r in aligned)
        total_cost = sum(r["cost"] for r in aligned)
        return {
            "total": len(self.rows),
            "status_counts": dict(statuses),
            "aligned": len(aligned),
            "fitting": sum(1 for r in aligned if r["cost"] == 0),
            "exact": sum(1 for r in aligned if r["exact"]),
            "average_cost": total_cost / len(aligned) if aligned else None,
            "cost_per_event": total_cost / total_events if total_events else None,
            "synchronous_event_ratio": (
                sum(r["move_counts"]["sync"] for r in aligned) / total_events if total_events else None
            ),
            "deviations_by_activity": deviations,
            "ignored_object_types": dict(ignored),
            "stopped_early": self.stopped_early,
            "elapsed_ms": round(self.elapsed_ms, 1),
            "rows": self.rows,
        }


def align_executions(
    model,
    executions: Sequence[ProcessExecution],
    *,
    max_states: int = DEFAULT_BATCH_MAX_STATES,
    timeout_s: Optional[float] = DEFAULT_BATCH_TIMEOUT_S,
    total_timeout_s: Optional[float] = DEFAULT_BATCH_TOTAL_TIMEOUT_S,
    should_cancel: Optional[Callable[[], bool]] = None,
    progress: Optional[Callable[[Optional[float], str], None]] = None,
) -> OCAlignmentBatchResult:
    """Align every execution with ``model`` (see module doc)."""
    net = model if isinstance(model, AlignmentNet) else net_from_ocpn_dict(model)
    started = time.monotonic()
    deadline = started + total_timeout_s if total_timeout_s and total_timeout_s > 0 else None
    result = OCAlignmentBatchResult()
    n = len(executions)
    for index, execution in enumerate(executions):
        summary = execution.summary()
        base = {
            "id": execution.execution_id,
            "event_count": summary["event_count"],
            "object_count": summary["object_count"],
            "object_type_counts": summary["object_type_counts"],
            "start_unix": summary["start_unix"],
        }
        now = time.monotonic()
        if deadline is not None and now >= deadline:
            result.stopped_early = True
            result.rows.append({**base, "status": SKIPPED, "cost": None, "exact": False,
                                "lower_bound": None, "move_counts": None, "ignored_object_types": [],
                                "message": "Not computed: the batch reached its total time limit.",
                                "elapsed_ms": 0.0})
            continue
        if should_cancel is not None and should_cancel():
            raise AlignmentCancelled()
        if progress is not None:
            progress(index / n if n else None, f"Aligning execution {index + 1:,} of {n:,}")
        per_timeout = timeout_s
        if deadline is not None and timeout_s and timeout_s > 0:
            per_timeout = max(0.5, min(timeout_s, deadline - now))
        alignment = compute_oc_alignment(
            net,
            execution,
            max_states=max_states,
            timeout_s=per_timeout,
            should_cancel=should_cancel,
        )
        per_activity: Dict[str, Counter] = defaultdict(Counter)
        for move in alignment.moves:
            if move.kind == MODEL_MOVE and move.silent:
                continue
            activity = move.log_activity if move.kind in (SYNC_MOVE, LOG_MOVE) else move.model_activity
            per_activity[activity or ""][move.kind] += 1
        for counts in per_activity.values():
            if counts.get(LOG_MOVE) or counts.get(MODEL_MOVE):
                counts["executions"] += 1
        found = alignment.found
        result.rows.append({
            **base,
            "status": alignment.status,
            "cost": alignment.cost,
            "exact": alignment.exact if found else False,
            "lower_bound": alignment.lower_bound,
            "move_counts": alignment.move_counts() if found else None,
            "ignored_object_types": list(alignment.projection.ignored_object_types),
            "message": alignment.message,
            "diagnostics": list(alignment.diagnostics),
            "elapsed_ms": round(alignment.elapsed_ms, 1),
            "_per_activity": {a: dict(c) for a, c in per_activity.items()},
        })
    result.elapsed_ms = (time.monotonic() - started) * 1000
    return result
