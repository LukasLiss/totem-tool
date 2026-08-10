"""Result contracts for OCCN replay fitness."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, Optional, Tuple


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

    def __post_init__(self) -> None:
        if not isinstance(self.unit_id, str) or not self.unit_id:
            raise ValueError("unit_id must be a non-empty string")
        if not isinstance(self.status, OCCNReplayStatus):
            raise TypeError("status must be an OCCNReplayStatus")
        if self.event_count < 0:
            raise ValueError("event_count must be non-negative")
        if self.explored_state_count < 0:
            raise ValueError("explored_state_count must be non-negative")
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
            "failure_event_index": self.failure_event_index,
            "failure_event_id": self.failure_event_id,
            "limit_reason": self.limit_reason,
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
