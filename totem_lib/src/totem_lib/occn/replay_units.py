"""Storage-independent replay-unit contracts for OCCN conformance."""

from __future__ import annotations

import math
from dataclasses import dataclass
from numbers import Real
from typing import Any, Dict, FrozenSet, Iterable, Tuple, Union


CONNECTED_COMPONENTS_REPLAY_STRATEGY = "connected_components"

ObjectGroup = Tuple[str, Tuple[str, ...]]
ObjectsByType = Tuple[ObjectGroup, ...]
Timestamp = Union[int, float]


def _require_non_empty_string(value: str, field_name: str) -> None:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{field_name} must be a non-empty string")


def _canonical_objects_by_type(
    groups: Iterable[Tuple[str, Iterable[str]]],
) -> ObjectsByType:
    objects_by_type: Dict[str, set[str]] = {}
    all_object_ids: set[str] = set()

    try:
        entries = list(groups)
    except TypeError as exc:
        raise ValueError(
            "objects_by_type must be an iterable of "
            "(object_type, object_ids) pairs"
        ) from exc

    for entry in entries:
        if not isinstance(entry, (list, tuple)) or len(entry) != 2:
            raise ValueError(
                "objects_by_type entries must be "
                "(object_type, object_ids) pairs"
            )
        object_type, object_ids = entry
        _require_non_empty_string(object_type, "object_type")
        if object_type in objects_by_type:
            raise ValueError(f"duplicate object type: {object_type!r}")
        if isinstance(object_ids, (str, bytes)):
            raise ValueError(
                f"object ids for {object_type!r} must be an iterable "
                "of strings, not a string"
            )

        try:
            identifiers = list(object_ids)
        except TypeError as exc:
            raise ValueError(
                f"object ids for {object_type!r} must be iterable"
            ) from exc

        normalized_ids: set[str] = set()
        for object_id in identifiers:
            _require_non_empty_string(object_id, "object_id")
            if object_id in normalized_ids:
                raise ValueError(
                    f"duplicate object id {object_id!r} for type "
                    f"{object_type!r}"
                )
            if object_id in all_object_ids:
                raise ValueError(
                    f"object id {object_id!r} occurs under multiple types"
                )
            normalized_ids.add(object_id)
            all_object_ids.add(object_id)

        if not normalized_ids:
            raise ValueError(
                f"object type {object_type!r} must contain at least one object"
            )
        objects_by_type[object_type] = normalized_ids

    return tuple(
        (object_type, tuple(sorted(object_ids)))
        for object_type, object_ids in sorted(objects_by_type.items())
    )


@dataclass(frozen=True)
class OCCNReplayEvent:
    """One visible log event in the canonical OCCN replay-unit format."""

    event_id: str
    activity: str
    timestamp_unix: Timestamp
    objects_by_type: ObjectsByType

    def __post_init__(self) -> None:
        _require_non_empty_string(self.event_id, "event_id")
        _require_non_empty_string(self.activity, "activity")
        if (
            isinstance(self.timestamp_unix, bool)
            or not isinstance(self.timestamp_unix, Real)
            or not math.isfinite(float(self.timestamp_unix))
        ):
            raise ValueError("timestamp_unix must be a finite number")

        object.__setattr__(
            self,
            "objects_by_type",
            _canonical_objects_by_type(self.objects_by_type),
        )

    @property
    def object_ids(self) -> FrozenSet[str]:
        """All object identifiers involved in the event."""
        return frozenset(
            object_id
            for _, object_ids in self.objects_by_type
            for object_id in object_ids
        )

    @property
    def object_types(self) -> Tuple[str, ...]:
        """The sorted object types involved in the event."""
        return tuple(object_type for object_type, _ in self.objects_by_type)

    def to_dict(self) -> Dict[str, Any]:
        """Return a deterministic JSON-compatible representation."""
        return {
            "event_id": self.event_id,
            "activity": self.activity,
            "timestamp_unix": self.timestamp_unix,
            "objects_by_type": {
                object_type: list(object_ids)
                for object_type, object_ids in self.objects_by_type
            },
        }


@dataclass(frozen=True)
class OCCNReplayUnit:
    """An ordered, storage-independent event set for OCCN replay."""

    unit_id: str
    strategy: str
    events: Tuple[OCCNReplayEvent, ...]

    def __post_init__(self) -> None:
        _require_non_empty_string(self.unit_id, "unit_id")
        _require_non_empty_string(self.strategy, "strategy")

        try:
            events = tuple(self.events)
        except TypeError as exc:
            raise ValueError("events must be an iterable") from exc
        if not events:
            raise ValueError("a replay unit must contain at least one event")
        if not all(isinstance(event, OCCNReplayEvent) for event in events):
            raise ValueError("events must contain OCCNReplayEvent values")

        event_ids = [event.event_id for event in events]
        if len(event_ids) != len(set(event_ids)):
            raise ValueError("event ids must be unique within a replay unit")

        object.__setattr__(
            self,
            "events",
            tuple(
                sorted(
                    events,
                    key=lambda event: (
                        event.timestamp_unix,
                        event.event_id,
                    ),
                )
            ),
        )

    @property
    def event_ids(self) -> Tuple[str, ...]:
        """The ordered event identifiers."""
        return tuple(event.event_id for event in self.events)

    @property
    def activities(self) -> Tuple[str, ...]:
        """The ordered visible activities."""
        return tuple(event.activity for event in self.events)

    @property
    def timestamps(self) -> Tuple[Timestamp, ...]:
        """The ordered Unix timestamps."""
        return tuple(event.timestamp_unix for event in self.events)

    @property
    def object_ids(self) -> FrozenSet[str]:
        """All objects involved in the replay unit."""
        return frozenset(
            object_id
            for event in self.events
            for object_id in event.object_ids
        )

    @property
    def object_types(self) -> Tuple[str, ...]:
        """All involved object types in deterministic order."""
        return tuple(
            sorted(
                {
                    object_type
                    for event in self.events
                    for object_type in event.object_types
                }
            )
        )

    def to_dict(self) -> Dict[str, Any]:
        """Return a deterministic JSON-compatible representation."""
        return {
            "unit_id": self.unit_id,
            "strategy": self.strategy,
            "event_ids": list(self.event_ids),
            "activities": list(self.activities),
            "timestamps": list(self.timestamps),
            "object_ids": sorted(self.object_ids),
            "object_types": list(self.object_types),
            "events": [event.to_dict() for event in self.events],
        }
