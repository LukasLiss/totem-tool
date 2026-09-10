"""Storage-independent replay-unit contracts for OCCN conformance."""

from __future__ import annotations

import json
import math
from collections import defaultdict
from dataclasses import dataclass
from numbers import Real
from typing import (
    TYPE_CHECKING,
    Any,
    Dict,
    FrozenSet,
    Iterable,
    Mapping,
    Optional,
    Tuple,
    Union,
)

import networkx as nx

if TYPE_CHECKING:
    from ..ocel.ocel import ObjectCentricEventLog
    from ..ocel.ocel_duckdb import OcelDuckDB


CONNECTED_COMPONENTS_REPLAY_STRATEGY = "connected_components"
LEADING_OBJECT_REPLAY_STRATEGY = "leading_object"
STORED_COLUMN_REPLAY_STRATEGY = "stored_column"
REPLAY_UNIT_STRATEGIES = (
    CONNECTED_COMPONENTS_REPLAY_STRATEGY,
    LEADING_OBJECT_REPLAY_STRATEGY,
    STORED_COLUMN_REPLAY_STRATEGY,
)

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


def _normalize_replay_event_rows(
    rows: Iterable[Tuple[Any, Any, Any, Any, Any]],
) -> Tuple[OCCNReplayEvent, ...]:
    events: Dict[str, Dict[str, Any]] = {}

    for event_id, activity, timestamp_unix, object_id, object_type in rows:
        _require_non_empty_string(event_id, "event_id")
        event = events.get(event_id)
        if event is None:
            event = {
                "activity": activity,
                "timestamp_unix": timestamp_unix,
                "objects_by_type": defaultdict(list),
            }
            events[event_id] = event
        elif (
            event["activity"] != activity
            or event["timestamp_unix"] != timestamp_unix
        ):
            raise ValueError(
                f"event {event_id!r} has inconsistent activity or timestamp"
            )

        if object_id is None:
            if object_type is not None:
                raise ValueError(
                    f"event {event_id!r} has an object type without an object id"
                )
            continue
        if object_type is None:
            raise ValueError(
                f"object {object_id!r} referenced by event {event_id!r} "
                "has no object type"
            )

        _require_non_empty_string(object_id, "object_id")
        _require_non_empty_string(object_type, "object_type")
        event["objects_by_type"][object_type].append(object_id)

    replay_events = [
        OCCNReplayEvent(
            event_id=event_id,
            activity=event["activity"],
            timestamp_unix=event["timestamp_unix"],
            objects_by_type=tuple(event["objects_by_type"].items()),
        )
        for event_id, event in events.items()
    ]
    return tuple(
        sorted(
            replay_events,
            key=lambda event: (event.timestamp_unix, event.event_id),
        )
    )


def replay_events_from_ocel(
    ocel: "ObjectCentricEventLog",
) -> Tuple[OCCNReplayEvent, ...]:
    """Normalize a Polars-backed OCEL into canonical replay events."""
    from ..ocel.ocel import ObjectCentricEventLog

    if not isinstance(ocel, ObjectCentricEventLog):
        raise TypeError("ocel must be an ObjectCentricEventLog")

    required_event_columns = {
        "_eventId",
        "_activity",
        "_timestampUnix",
        "_objects",
    }
    missing_event_columns = required_event_columns - set(ocel.events.columns)
    if missing_event_columns:
        raise ValueError(
            "OCEL events are missing required columns: "
            f"{sorted(missing_event_columns)}"
        )

    required_object_columns = {"_objId", "_objType"}
    missing_object_columns = required_object_columns - set(ocel.objects.columns)
    if missing_object_columns:
        raise ValueError(
            "OCEL objects are missing required columns: "
            f"{sorted(missing_object_columns)}"
        )

    object_types: Dict[str, str] = {}
    for object_id, object_type in ocel.objects.select(
        ["_objId", "_objType"]
    ).iter_rows():
        _require_non_empty_string(object_id, "object_id")
        _require_non_empty_string(object_type, "object_type")
        if object_id in object_types:
            raise ValueError(f"duplicate object id in OCEL: {object_id!r}")
        object_types[object_id] = object_type

    rows = []
    seen_event_ids: set[str] = set()
    for event in ocel.events.select(
        ["_eventId", "_activity", "_timestampUnix", "_objects"]
    ).iter_rows(named=True):
        event_id = event["_eventId"]
        _require_non_empty_string(event_id, "event_id")
        if event_id in seen_event_ids:
            raise ValueError(f"duplicate event id in OCEL: {event_id!r}")
        seen_event_ids.add(event_id)

        object_ids = event["_objects"]
        if object_ids is None:
            object_ids = []
        elif isinstance(object_ids, (str, bytes)):
            raise ValueError(
                f"objects for event {event_id!r} must be an iterable "
                "of object ids, not a string"
            )

        try:
            object_ids = list(object_ids)
        except TypeError as exc:
            raise ValueError(
                f"objects for event {event_id!r} must be iterable"
            ) from exc

        if not object_ids:
            rows.append(
                (
                    event_id,
                    event["_activity"],
                    event["_timestampUnix"],
                    None,
                    None,
                )
            )
            continue

        for object_id in object_ids:
            _require_non_empty_string(object_id, "object_id")
            if object_id not in object_types:
                raise ValueError(
                    f"event {event_id!r} references unknown object "
                    f"{object_id!r}"
                )
            rows.append(
                (
                    event_id,
                    event["_activity"],
                    event["_timestampUnix"],
                    object_id,
                    object_types[object_id],
                )
            )

    return _normalize_replay_event_rows(rows)


def replay_events_from_duckdb(
    ocel: "OcelDuckDB",
) -> Tuple[OCCNReplayEvent, ...]:
    """Normalize a DuckDB-backed OCEL while retaining objectless events."""
    from ..ocel.ocel_duckdb import OcelDuckDB

    if not isinstance(ocel, OcelDuckDB):
        raise TypeError("ocel must be an OcelDuckDB")

    rows = ocel.conn.execute(
        """
        SELECT
            e.event_id,
            e.activity,
            e.timestamp_unix,
            eo.obj_id,
            o.obj_type
        FROM events e
        LEFT JOIN event_object eo ON eo.event_id = e.event_id
        LEFT JOIN objects o ON o.obj_id = eo.obj_id
        ORDER BY
            e.timestamp_unix,
            e.event_id,
            o.obj_type,
            eo.obj_id
        """
    ).fetchall()
    return _normalize_replay_event_rows(rows)


def extract_occn_replay_events(
    source: Union["ObjectCentricEventLog", "OcelDuckDB"],
) -> Tuple[OCCNReplayEvent, ...]:
    """Normalize a supported OCEL representation into replay events."""
    from ..ocel.ocel import ObjectCentricEventLog
    from ..ocel.ocel_duckdb import OcelDuckDB

    if isinstance(source, ObjectCentricEventLog):
        return replay_events_from_ocel(source)
    if isinstance(source, OcelDuckDB):
        return replay_events_from_duckdb(source)
    raise TypeError(
        "source must be an ObjectCentricEventLog or OcelDuckDB"
    )


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


def build_connected_component_replay_units(
    events: Iterable[OCCNReplayEvent],
) -> Tuple[OCCNReplayUnit, ...]:
    """Group canonical events by connected event-object components."""
    try:
        replay_events = tuple(events)
    except TypeError as exc:
        raise ValueError("events must be an iterable") from exc

    if not all(isinstance(event, OCCNReplayEvent) for event in replay_events):
        raise ValueError("events must contain OCCNReplayEvent values")

    events_by_id = {event.event_id: event for event in replay_events}
    if len(events_by_id) != len(replay_events):
        raise ValueError("event ids must be unique across replay units")
    if not replay_events:
        return ()

    graph = nx.Graph()
    for event in replay_events:
        event_node = ("event", event.event_id)
        graph.add_node(event_node)
        for object_id in event.object_ids:
            graph.add_edge(event_node, ("object", object_id))

    component_events = []
    for component in nx.connected_components(graph):
        ordered_events = tuple(
            sorted(
                (
                    events_by_id[node_id]
                    for node_type, node_id in component
                    if node_type == "event"
                ),
                key=lambda event: (event.timestamp_unix, event.event_id),
            )
        )
        if ordered_events:
            component_events.append(ordered_events)

    component_events.sort(
        key=lambda group: tuple(
            (event.timestamp_unix, event.event_id) for event in group
        )
    )
    return tuple(
        OCCNReplayUnit(
            unit_id=f"{CONNECTED_COMPONENTS_REPLAY_STRATEGY}:{index:06d}",
            strategy=CONNECTED_COMPONENTS_REPLAY_STRATEGY,
            events=events,
        )
        for index, events in enumerate(component_events, start=1)
    )


def build_leading_object_replay_units(
    events: Iterable[OCCNReplayEvent],
    leading_object_type: str,
) -> Tuple[OCCNReplayUnit, ...]:
    """Build one replay unit per object of the selected leading type.

    A unit contains every event that directly references its leading object.
    Events shared by multiple leading objects therefore occur in multiple units.
    """
    _require_non_empty_string(leading_object_type, "leading_object_type")
    try:
        replay_events = tuple(events)
    except TypeError as exc:
        raise ValueError("events must be an iterable") from exc

    if not all(isinstance(event, OCCNReplayEvent) for event in replay_events):
        raise ValueError("events must contain OCCNReplayEvent values")

    event_ids = [event.event_id for event in replay_events]
    if len(event_ids) != len(set(event_ids)):
        raise ValueError("event ids must be unique across replay units")

    events_by_leading_object: Dict[str, list[OCCNReplayEvent]] = defaultdict(list)
    for event in replay_events:
        objects_by_type = dict(event.objects_by_type)
        for object_id in objects_by_type.get(leading_object_type, ()):
            events_by_leading_object[object_id].append(event)

    return tuple(
        OCCNReplayUnit(
            unit_id=f"{LEADING_OBJECT_REPLAY_STRATEGY}:{object_id}",
            strategy=LEADING_OBJECT_REPLAY_STRATEGY,
            events=tuple(events_by_leading_object[object_id]),
        )
        for object_id in sorted(events_by_leading_object)
    )


def project_replay_events(
    events: Iterable[OCCNReplayEvent],
    object_types: Iterable[str],
) -> Tuple[OCCNReplayEvent, ...]:
    """Keep only objects of the given types; drop events left without objects.

    Replay matches events against bindings with *exactly* the observed
    objects, so an object whose type the model does not know makes every
    event it touches non-fitting. Projecting the log onto the model's object
    types lets a model that deliberately leaves out, say, a shared worker
    resource be checked against a log that still records the worker.
    """
    try:
        replay_events = tuple(events)
    except TypeError as exc:
        raise ValueError("events must be an iterable") from exc
    if not all(isinstance(event, OCCNReplayEvent) for event in replay_events):
        raise ValueError("events must contain OCCNReplayEvent values")
    if isinstance(object_types, (str, bytes)):
        raise ValueError("object_types must be an iterable of strings")
    kept_types = frozenset(object_types)
    if not kept_types:
        raise ValueError("object_types must contain at least one object type")

    projected = []
    for event in replay_events:
        groups = tuple(
            (object_type, object_ids)
            for object_type, object_ids in event.objects_by_type
            if object_type in kept_types
        )
        if not groups:
            continue
        if len(groups) == len(event.objects_by_type):
            projected.append(event)
            continue
        projected.append(
            OCCNReplayEvent(
                event_id=event.event_id,
                activity=event.activity,
                timestamp_unix=event.timestamp_unix,
                objects_by_type=groups,
            )
        )
    return tuple(projected)


def build_stored_column_replay_units(
    events: Iterable[OCCNReplayEvent],
    execution_ids: Mapping[str, Optional[str]],
) -> Tuple[OCCNReplayUnit, ...]:
    """Group events by a precomputed execution id.

    ``execution_ids`` maps event ids to the execution id stored for them; an
    event mapped to ``None`` or missing from the mapping belongs to no
    execution and is skipped. Every event therefore occurs in at most one
    unit, and unit ids are ``stored_column:<execution id>``.
    """
    try:
        replay_events = tuple(events)
    except TypeError as exc:
        raise ValueError("events must be an iterable") from exc
    if not all(isinstance(event, OCCNReplayEvent) for event in replay_events):
        raise ValueError("events must contain OCCNReplayEvent values")
    event_ids = [event.event_id for event in replay_events]
    if len(event_ids) != len(set(event_ids)):
        raise ValueError("event ids must be unique across replay units")

    grouped: Dict[str, list[OCCNReplayEvent]] = defaultdict(list)
    for event in replay_events:
        execution_id = execution_ids.get(event.event_id)
        if execution_id is None:
            continue
        if not isinstance(execution_id, str) or not execution_id:
            raise ValueError(
                f"execution id for event {event.event_id!r} must be a non-empty string"
            )
        grouped[execution_id].append(event)

    units = [
        OCCNReplayUnit(
            unit_id=f"{STORED_COLUMN_REPLAY_STRATEGY}:{execution_id}",
            strategy=STORED_COLUMN_REPLAY_STRATEGY,
            events=tuple(unit_events),
        )
        for execution_id, unit_events in grouped.items()
    ]
    units.sort(
        key=lambda unit: (
            tuple((event.timestamp_unix, event.event_id) for event in unit.events),
            unit.unit_id,
        )
    )
    return tuple(units)


def stored_execution_ids_from_duckdb(
    ocel: "OcelDuckDB", column: str
) -> Dict[str, str]:
    """Read ``event_id -> execution id`` from an events column of a DuckDB log."""
    from ..ocel.event_columns import EventColumnError, list_event_columns

    if column not in list_event_columns(ocel.conn):
        raise EventColumnError(
            f"Column {column!r} does not exist on the events table."
        )
    quoted = '"' + column.replace('"', '""') + '"'
    rows = ocel.conn.execute(
        f"SELECT event_id, {quoted} FROM events WHERE {quoted} IS NOT NULL"
    ).fetchall()
    return {event_id: str(value) for event_id, value in rows if str(value) != ""}


def stored_execution_ids_from_ocel(
    ocel: "ObjectCentricEventLog", column: str
) -> Dict[str, str]:
    """Read ``event_id -> execution id`` from the JSON event attributes."""
    if "_attributes" not in ocel.events.columns:
        raise ValueError(f"Column {column!r} does not exist on the events table.")
    execution_ids: Dict[str, str] = {}
    seen = False
    for event_id, attributes_json in ocel.events.select(
        ["_eventId", "_attributes"]
    ).iter_rows():
        if not attributes_json:
            continue
        try:
            attributes = json.loads(attributes_json)
        except json.JSONDecodeError:
            continue
        if column in attributes:
            seen = True
            value = attributes[column]
            if value is not None and str(value) != "":
                execution_ids[event_id] = str(value)
    if not seen:
        raise ValueError(f"Column {column!r} does not exist on the events table.")
    return execution_ids


def stored_execution_ids(
    source: Union["ObjectCentricEventLog", "OcelDuckDB"], column: str
) -> Dict[str, str]:
    """Dispatch :func:`stored_execution_ids_from_*` on the source type."""
    from ..ocel.ocel import ObjectCentricEventLog
    from ..ocel.ocel_duckdb import OcelDuckDB

    if isinstance(source, OcelDuckDB):
        return stored_execution_ids_from_duckdb(source, column)
    if isinstance(source, ObjectCentricEventLog):
        return stored_execution_ids_from_ocel(source, column)
    raise TypeError("source must be an ObjectCentricEventLog or OcelDuckDB")


def extract_occn_replay_units(
    source: Union["ObjectCentricEventLog", "OcelDuckDB"],
    strategy: str = CONNECTED_COMPONENTS_REPLAY_STRATEGY,
    leading_object_type: str | None = None,
    execution_column: str | None = None,
    object_types: Iterable[str] | None = None,
) -> Tuple[OCCNReplayUnit, ...]:
    """Extract deterministic replay units using the selected strategy.

    ``object_types`` optionally projects every event onto the given object
    types first (see :func:`project_replay_events`); it applies to every
    strategy. ``execution_column`` names the events column holding
    precomputed execution ids and is required by -- and only valid for -- the
    stored-column strategy.
    """
    if strategy not in REPLAY_UNIT_STRATEGIES:
        raise ValueError(f"unsupported OCCN replay unit strategy: {strategy!r}")
    if leading_object_type is not None and strategy != LEADING_OBJECT_REPLAY_STRATEGY:
        raise ValueError(
            "leading_object_type is only supported by the leading-object "
            "replay strategy"
        )
    if execution_column is not None and strategy != STORED_COLUMN_REPLAY_STRATEGY:
        raise ValueError(
            "execution_column is only supported by the stored-column replay strategy"
        )

    events = extract_occn_replay_events(source)
    if object_types is not None:
        events = project_replay_events(events, object_types)

    if strategy == CONNECTED_COMPONENTS_REPLAY_STRATEGY:
        return build_connected_component_replay_units(events)
    if strategy == LEADING_OBJECT_REPLAY_STRATEGY:
        if leading_object_type is None:
            raise ValueError(
                "leading_object_type is required by the leading-object "
                "replay strategy"
            )
        return build_leading_object_replay_units(events, leading_object_type)
    if execution_column is None:
        raise ValueError(
            "execution_column is required by the stored-column replay strategy"
        )
    return build_stored_column_replay_units(
        events, stored_execution_ids(source, execution_column)
    )
