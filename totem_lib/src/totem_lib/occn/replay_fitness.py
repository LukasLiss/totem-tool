"""Result contracts for OCCN replay fitness."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable, Dict, Iterable, List, Optional, Set, Tuple

from .occn import OCCausalNet, OCCausalNetState
from .replay import (
    end_object_successors,
    start_object_successors,
    state_signature,
    visible_event_successors,
)
from .replay_units import OCCNReplayUnit


class OCCNReplayStatus(str, Enum):
    """Outcome of replaying one complete OCCN replay unit."""

    FITTING = "fitting"
    NON_FITTING = "non_fitting"
    INCONCLUSIVE = "inconclusive"


@dataclass(frozen=True)
class OCCNReplayUnitResult:
    """Replay outcome and bounded diagnostics for one replay unit."""

    unit_id: str
    status: OCCNReplayStatus
    event_count: int
    explored_state_count: int
    failure_event_index: Optional[int] = None
    failure_event_id: Optional[str] = None
    limit_reason: Optional[str] = None
    object_types: Tuple[str, ...] = ()
    stopping_activity: Optional[str] = None
    stopping_phase: Optional[str] = None
    stopping_reason: Optional[str] = None
    last_replayed_activity: Optional[str] = None

    def __post_init__(self) -> None:
        if not isinstance(self.unit_id, str) or not self.unit_id:
            raise ValueError("unit_id must be a non-empty string")
        if not isinstance(self.status, OCCNReplayStatus):
            raise TypeError("status must be an OCCNReplayStatus")
        if self.event_count < 0:
            raise ValueError("event_count must be non-negative")
        if self.explored_state_count < 0:
            raise ValueError("explored_state_count must be non-negative")
        if isinstance(self.object_types, (str, bytes)):
            raise ValueError("object_types must be an iterable of strings")
        try:
            object_types = tuple(self.object_types)
        except TypeError as exc:
            raise ValueError("object_types must be an iterable of strings") from exc
        if any(
            not isinstance(object_type, str) or not object_type
            for object_type in object_types
        ):
            raise ValueError("object_types must contain non-empty strings")
        if len(object_types) != len(set(object_types)):
            raise ValueError("object_types must not contain duplicates")
        object.__setattr__(self, "object_types", tuple(sorted(object_types)))
        for field_name in (
            "stopping_activity",
            "stopping_phase",
            "stopping_reason",
            "last_replayed_activity",
        ):
            value = getattr(self, field_name)
            if value is not None and (not isinstance(value, str) or not value):
                raise ValueError(f"{field_name} must be a non-empty string or None")
        if self.failure_event_index is not None and not (
            0 <= self.failure_event_index < self.event_count
        ):
            raise ValueError("failure_event_index must identify an event")

    @property
    def replayable(self) -> Optional[bool]:
        """Return the binary result, or ``None`` for a bounded search."""
        if self.status is OCCNReplayStatus.INCONCLUSIVE:
            return None
        return self.status is OCCNReplayStatus.FITTING

    def to_dict(self) -> Dict[str, Any]:
        """Return a backend-friendly JSON-compatible representation."""
        return {
            "unit_id": self.unit_id,
            "status": self.status.value,
            "replayable": self.replayable,
            "event_count": self.event_count,
            "explored_state_count": self.explored_state_count,
            "object_types": list(self.object_types),
            "failure_event_index": self.failure_event_index,
            "failure_event_id": self.failure_event_id,
            "limit_reason": self.limit_reason,
            "stopping_activity": self.stopping_activity,
            "stopping_phase": self.stopping_phase,
            "stopping_reason": self.stopping_reason,
            "last_replayed_activity": self.last_replayed_activity,
        }


@dataclass(frozen=True)
class OCCNReplayFitnessResult:
    """Aggregate OCCN replay fitness and ordered per-unit outcomes."""

    unit_results: Tuple[OCCNReplayUnitResult, ...]

    def __post_init__(self) -> None:
        try:
            results = tuple(self.unit_results)
        except TypeError as exc:
            raise ValueError("unit_results must be an iterable") from exc
        if not all(isinstance(result, OCCNReplayUnitResult) for result in results):
            raise ValueError("unit_results must contain OCCNReplayUnitResult values")
        unit_ids = [result.unit_id for result in results]
        if len(unit_ids) != len(set(unit_ids)):
            raise ValueError("unit result identifiers must be unique")
        object.__setattr__(self, "unit_results", results)

    @property
    def total_units(self) -> int:
        return len(self.unit_results)

    @property
    def fitting_units(self) -> int:
        return self._count(OCCNReplayStatus.FITTING)

    @property
    def non_fitting_units(self) -> int:
        return self._count(OCCNReplayStatus.NON_FITTING)

    @property
    def inconclusive_units(self) -> int:
        return self._count(OCCNReplayStatus.INCONCLUSIVE)

    @property
    def fitness(self) -> Optional[float]:
        conclusive = self.fitting_units + self.non_fitting_units
        if conclusive == 0:
            return None
        return self.fitting_units / conclusive

    @property
    def coverage(self) -> float:
        if self.total_units == 0:
            return 1.0
        return (self.fitting_units + self.non_fitting_units) / self.total_units

    def to_dict(self) -> Dict[str, Any]:
        """Return aggregate and per-unit data ready for an API response."""
        return {
            "fitness": self.fitness,
            "coverage": self.coverage,
            "total_units": self.total_units,
            "fitting_units": self.fitting_units,
            "non_fitting_units": self.non_fitting_units,
            "inconclusive_units": self.inconclusive_units,
            "unit_results": [result.to_dict() for result in self.unit_results],
        }

    def _count(self, status: OCCNReplayStatus) -> int:
        return sum(result.status is status for result in self.unit_results)


class _ReplayStateLimitReached(Exception):
    """Raised when a replay unit reaches its deterministic state limit."""


class _ReplayStateBudget:
    """Count distinct states admitted at each successive replay position."""

    def __init__(self, max_states: Optional[int]) -> None:
        self.max_states = max_states
        self.explored_state_count = 0

    def admit(self, state: OCCausalNetState, seen: Set[Tuple]) -> bool:
        signature = state_signature(state)
        if signature in seen:
            return False
        if self.max_states is not None and self.explored_state_count >= self.max_states:
            raise _ReplayStateLimitReached()
        seen.add(signature)
        self.explored_state_count += 1
        return True


SuccessorFunction = Callable[[OCCausalNetState], Tuple[OCCausalNetState, ...]]


def occn_replay_fitness(
    occn: OCCausalNet,
    replay_units: Iterable[OCCNReplayUnit],
    *,
    max_states: Optional[int] = 1000,
) -> OCCNReplayFitnessResult:
    """Replay complete event sets and calculate their aggregate fitness.

    Replay follows OCCN binding semantics exactly. Every object is introduced
    through its artificial start activity before its first visible event, each
    visible event must bind exactly its observed objects, and all objects must
    reach their artificial end activities. A replay unit is fitting iff at
    least one binding sequence finishes in the empty state.

    ``max_states`` bounds the distinct replay-position/state pairs explored
    per unit. Pass ``None`` for exhaustive binary replay. A bounded search that
    reaches the limit is reported as inconclusive and excluded from fitness;
    coverage reports the conclusive share.
    """
    if not isinstance(occn, OCCausalNet):
        raise TypeError("occn must be an OCCausalNet")
    if max_states is not None and (
        isinstance(max_states, bool)
        or not isinstance(max_states, int)
        or max_states < 1
    ):
        raise ValueError("max_states must be a positive int or None")

    try:
        units = tuple(replay_units)
    except TypeError as exc:
        raise ValueError("replay_units must be an iterable") from exc
    if not all(isinstance(unit, OCCNReplayUnit) for unit in units):
        raise ValueError("replay_units must contain OCCNReplayUnit values")
    unit_ids = [unit.unit_id for unit in units]
    if len(unit_ids) != len(set(unit_ids)):
        raise ValueError("replay unit identifiers must be unique")

    return OCCNReplayFitnessResult(
        unit_results=tuple(_replay_unit(occn, unit, max_states) for unit in units)
    )


def _replay_unit(
    occn: OCCausalNet,
    unit: OCCNReplayUnit,
    max_states: Optional[int],
) -> OCCNReplayUnitResult:
    object_types = _object_types_by_id(unit)
    budget = _ReplayStateBudget(max_states)
    frontier = (OCCausalNetState(),)
    budget.admit(frontier[0], set())
    started_objects: Set[str] = set()
    stopping_activity: Optional[str] = None
    stopping_phase: Optional[str] = None
    last_replayed_activity: Optional[str] = None

    try:
        for event_index, event in enumerate(unit.events):
            new_objects = sorted(
                event.object_ids - started_objects,
                key=lambda object_id: (object_types[object_id], object_id),
            )
            for object_id in new_objects:
                object_type = object_types[object_id]
                stopping_activity = f"START_{object_type}"
                stopping_phase = "object_start"
                frontier, _ = _advance_frontier(
                    frontier,
                    lambda state, object_id=object_id, object_type=object_type: (
                        start_object_successors(
                            occn,
                            state,
                            object_id,
                            object_type,
                        )
                    ),
                    budget,
                )
                if not frontier:
                    return _non_fitting_result(
                        unit,
                        budget,
                        event_index,
                        stopping_activity,
                        stopping_phase,
                        "no_enabled_object_start",
                        last_replayed_activity,
                    )
                started_objects.add(object_id)
                last_replayed_activity = stopping_activity

            stopping_activity = event.activity
            stopping_phase = "visible_event"
            frontier, _ = _advance_frontier(
                frontier,
                lambda state, event=event: visible_event_successors(
                    occn,
                    state,
                    event,
                ),
                budget,
            )
            if not frontier:
                return _non_fitting_result(
                    unit,
                    budget,
                    event_index,
                    stopping_activity,
                    stopping_phase,
                    "no_enabled_event_binding",
                    last_replayed_activity,
                )
            last_replayed_activity = stopping_activity

        ordered_objects = sorted(
            object_types,
            key=lambda object_id: (object_types[object_id], object_id),
        )
        for object_index, object_id in enumerate(ordered_objects):
            object_type = object_types[object_id]
            stopping_activity = f"END_{object_type}"
            stopping_phase = "object_end"
            is_final_end = object_index == len(ordered_objects) - 1
            frontier, found_empty = _advance_frontier(
                frontier,
                lambda state, object_id=object_id, object_type=object_type: (
                    end_object_successors(
                        occn,
                        state,
                        object_id,
                        object_type,
                    )
                ),
                budget,
                stop_on_empty=is_final_end,
            )
            if found_empty:
                return OCCNReplayUnitResult(
                    unit_id=unit.unit_id,
                    status=OCCNReplayStatus.FITTING,
                    event_count=len(unit.events),
                    explored_state_count=budget.explored_state_count,
                    object_types=unit.object_types,
                )
            if not frontier:
                return _non_fitting_result(
                    unit,
                    budget,
                    stopping_activity=stopping_activity,
                    stopping_phase=stopping_phase,
                    stopping_reason="no_enabled_object_end",
                    last_replayed_activity=last_replayed_activity,
                )
            last_replayed_activity = stopping_activity

        status = (
            OCCNReplayStatus.FITTING
            if any(state.is_empty for state in frontier)
            else OCCNReplayStatus.NON_FITTING
        )
        return OCCNReplayUnitResult(
            unit_id=unit.unit_id,
            status=status,
            event_count=len(unit.events),
            explored_state_count=budget.explored_state_count,
            object_types=unit.object_types,
            stopping_activity=(
                stopping_activity
                if status is OCCNReplayStatus.NON_FITTING
                else None
            ),
            stopping_phase=(
                "completion" if status is OCCNReplayStatus.NON_FITTING else None
            ),
            stopping_reason=(
                "remaining_obligations"
                if status is OCCNReplayStatus.NON_FITTING
                else None
            ),
            last_replayed_activity=(
                last_replayed_activity
                if status is OCCNReplayStatus.NON_FITTING
                else None
            ),
        )
    except _ReplayStateLimitReached:
        return OCCNReplayUnitResult(
            unit_id=unit.unit_id,
            status=OCCNReplayStatus.INCONCLUSIVE,
            event_count=len(unit.events),
            explored_state_count=budget.explored_state_count,
            object_types=unit.object_types,
            limit_reason="max_states",
            stopping_activity=stopping_activity,
            stopping_phase=stopping_phase,
            stopping_reason="max_states",
            last_replayed_activity=last_replayed_activity,
        )


def _advance_frontier(
    frontier: Iterable[OCCausalNetState],
    successors: SuccessorFunction,
    budget: _ReplayStateBudget,
    *,
    stop_on_empty: bool = False,
) -> Tuple[Tuple[OCCausalNetState, ...], bool]:
    next_frontier: List[OCCausalNetState] = []
    seen: Set[Tuple] = set()
    for state in frontier:
        for successor in successors(state):
            if not budget.admit(successor, seen):
                continue
            next_frontier.append(successor)
            if stop_on_empty and successor.is_empty:
                return (successor,), True
    return tuple(next_frontier), False


def _object_types_by_id(unit: OCCNReplayUnit) -> Dict[str, str]:
    object_types: Dict[str, str] = {}
    for event in unit.events:
        for object_type, object_ids in event.objects_by_type:
            for object_id in object_ids:
                previous_type = object_types.setdefault(object_id, object_type)
                if previous_type != object_type:
                    raise ValueError(
                        f"object {object_id!r} has inconsistent types in "
                        f"replay unit {unit.unit_id!r}"
                    )
    return object_types


def _non_fitting_result(
    unit: OCCNReplayUnit,
    budget: _ReplayStateBudget,
    failure_event_index: Optional[int] = None,
    stopping_activity: Optional[str] = None,
    stopping_phase: Optional[str] = None,
    stopping_reason: Optional[str] = None,
    last_replayed_activity: Optional[str] = None,
) -> OCCNReplayUnitResult:
    failure_event_id = (
        unit.events[failure_event_index].event_id
        if failure_event_index is not None
        else None
    )
    return OCCNReplayUnitResult(
        unit_id=unit.unit_id,
        status=OCCNReplayStatus.NON_FITTING,
        event_count=len(unit.events),
        explored_state_count=budget.explored_state_count,
        object_types=unit.object_types,
        failure_event_index=failure_event_index,
        failure_event_id=failure_event_id,
        stopping_activity=stopping_activity,
        stopping_phase=stopping_phase,
        stopping_reason=stopping_reason,
        last_replayed_activity=last_replayed_activity,
    )
