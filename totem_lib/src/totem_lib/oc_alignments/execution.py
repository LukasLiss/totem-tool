"""Process executions that are aligned against an object-centric Petri net.

A process execution (Def. 3.2 of the thesis) is a set of events together with
the objects they refer to; the partial order between the events follows from
each object's trace. Two ways of obtaining one from a DuckDB-backed log are
supported:

* **stored** -- the execution ids the Variants Explorer "burned" into an
  ``events`` column (see ``docs/RESOURCE_AWARE_VARIANTS.md``). Every event
  carrying the selected id belongs to the execution together with all of its
  objects.
* **area** -- a connected-component extraction restricted to a set of
  *business object types* and *business activities* (typically a process
  area). Business objects are connected when they share an event of a
  business activity; every connected component is one execution. Only the
  considered activities and object types are part of the execution: events
  of other activities and objects of other types are left out.

Object types the de-jure model does not know can never be aligned (a model
move must use exactly the objects of the log part), so
:func:`project_execution` removes them and reports what was dropped.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple

#: Execution sources understood by the DuckDB helpers below.
STORED_EXECUTION_SOURCE = "stored"
AREA_EXECUTION_SOURCE = "area"
EXECUTION_SOURCES = (STORED_EXECUTION_SOURCE, AREA_EXECUTION_SOURCE)


class ExecutionNotFoundError(LookupError):
    """The requested process execution does not exist (or has no events)."""


@dataclass(frozen=True)
class ExecutionEvent:
    """One event of a process execution."""

    event_id: str
    activity: str
    timestamp_unix: float
    #: Sorted ``(object type, object id)`` pairs.
    objects: Tuple[Tuple[str, str], ...]

    @property
    def object_ids(self) -> Tuple[str, ...]:
        return tuple(obj for _, obj in self.objects)

    @property
    def object_types(self) -> Tuple[str, ...]:
        return tuple(sorted({ot for ot, _ in self.objects}))

    def objects_by_type(self) -> Dict[str, List[str]]:
        grouped: Dict[str, List[str]] = defaultdict(list)
        for object_type, obj in self.objects:
            grouped[object_type].append(obj)
        return dict(grouped)


def make_event(
    event_id: str,
    activity: str,
    timestamp_unix: float,
    objects_by_type: Mapping[str, Iterable[str]],
) -> ExecutionEvent:
    """Convenience constructor: ``objects_by_type`` maps type -> object ids."""
    pairs = sorted(
        {(str(ot), str(obj)) for ot, objs in objects_by_type.items() for obj in objs}
    )
    return ExecutionEvent(str(event_id), str(activity), float(timestamp_unix), tuple(pairs))


@dataclass(frozen=True)
class ProcessExecution:
    """An ordered set of events; the partial order comes from object traces."""

    execution_id: str
    events: Tuple[ExecutionEvent, ...]

    def __post_init__(self) -> None:
        ordered = tuple(sorted(self.events, key=lambda e: (e.timestamp_unix, e.event_id)))
        object.__setattr__(self, "events", ordered)
        seen: Dict[str, str] = {}
        for event in ordered:
            for object_type, obj in event.objects:
                known = seen.setdefault(obj, object_type)
                if known != object_type:
                    raise ValueError(f"object {obj!r} occurs with types {known!r} and {object_type!r}")

    @property
    def object_types_by_object(self) -> Dict[str, str]:
        return {obj: ot for event in self.events for ot, obj in event.objects}

    @property
    def objects_by_type(self) -> Dict[str, List[str]]:
        grouped: Dict[str, Set[str]] = defaultdict(set)
        for obj, object_type in self.object_types_by_object.items():
            grouped[object_type].add(obj)
        return {ot: sorted(objs) for ot, objs in sorted(grouped.items())}

    def traces(self) -> Dict[str, List[int]]:
        """``object -> indices of its events`` in temporal order (``pi_trace``)."""
        out: Dict[str, List[int]] = defaultdict(list)
        for index, event in enumerate(self.events):
            for _, obj in event.objects:
                out[obj].append(index)
        return dict(out)

    def directly_follows(self) -> List[Tuple[int, int]]:
        """Edges ``D_X`` of the process-execution graph (event index pairs)."""
        edges = set()
        for indices in self.traces().values():
            edges.update(zip(indices, indices[1:]))
        return sorted(edges)

    def summary(self) -> dict:
        objects_by_type = self.objects_by_type
        return {
            "id": self.execution_id,
            "event_count": len(self.events),
            "object_count": sum(len(v) for v in objects_by_type.values()),
            "object_type_counts": {ot: len(v) for ot, v in objects_by_type.items()},
            "activity_count": len({e.activity for e in self.events}),
            "start_unix": self.events[0].timestamp_unix if self.events else None,
            "end_unix": self.events[-1].timestamp_unix if self.events else None,
        }

    def to_dict(self) -> dict:
        return {
            **self.summary(),
            "objects_by_type": self.objects_by_type,
            "events": [
                {
                    "event_id": e.event_id,
                    "activity": e.activity,
                    "timestamp_unix": e.timestamp_unix,
                    "objects_by_type": e.objects_by_type(),
                }
                for e in self.events
            ],
            "edges": [list(edge) for edge in self.directly_follows()],
        }


@dataclass(frozen=True)
class ProjectionReport:
    """What :func:`project_execution` removed from an execution."""

    #: Object types of the execution the model does not contain.
    ignored_object_types: Tuple[str, ...] = ()
    #: ``object type -> number of objects`` that were removed.
    ignored_object_counts: Mapping[str, int] = field(default_factory=dict)
    #: Events left without any object after the removal (dropped entirely).
    dropped_event_ids: Tuple[str, ...] = ()

    @property
    def changed(self) -> bool:
        return bool(self.ignored_object_types)

    def to_dict(self) -> dict:
        return {
            "ignored_object_types": list(self.ignored_object_types),
            "ignored_object_counts": dict(self.ignored_object_counts),
            "ignored_object_count": sum(self.ignored_object_counts.values()),
            "dropped_event_ids": list(self.dropped_event_ids),
            "dropped_event_count": len(self.dropped_event_ids),
        }


def project_execution(
    execution: ProcessExecution, object_types: Iterable[str]
) -> Tuple[ProcessExecution, ProjectionReport]:
    """Keep only objects of ``object_types``; drop events left without objects."""
    kept = frozenset(object_types)
    ignored_objects: Dict[str, Set[str]] = defaultdict(set)
    dropped: List[str] = []
    events: List[ExecutionEvent] = []
    for event in execution.events:
        remaining = tuple(pair for pair in event.objects if pair[0] in kept)
        for object_type, obj in event.objects:
            if object_type not in kept:
                ignored_objects[object_type].add(obj)
        if not remaining:
            dropped.append(event.event_id)
            continue
        if len(remaining) == len(event.objects):
            events.append(event)
        else:
            events.append(
                ExecutionEvent(event.event_id, event.activity, event.timestamp_unix, remaining)
            )
    report = ProjectionReport(
        ignored_object_types=tuple(sorted(ignored_objects)),
        ignored_object_counts={ot: len(objs) for ot, objs in sorted(ignored_objects.items())},
        dropped_event_ids=tuple(dropped),
    )
    return ProcessExecution(execution.execution_id, tuple(events)), report


# ---------------------------------------------------------------------------
# DuckDB helpers
# ---------------------------------------------------------------------------


def _quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _events_from_rows(rows) -> Tuple[ExecutionEvent, ...]:
    """Rows of ``(event_id, activity, timestamp_unix, obj_id, obj_type)``."""
    events: Dict[str, dict] = {}
    for event_id, activity, timestamp, obj_id, obj_type in rows:
        entry = events.get(event_id)
        if entry is None:
            entry = {"activity": activity, "ts": timestamp, "objects": set()}
            events[event_id] = entry
        if obj_id is not None and obj_type is not None:
            entry["objects"].add((str(obj_type), str(obj_id)))
    return tuple(
        ExecutionEvent(
            str(event_id),
            str(entry["activity"]),
            float(entry["ts"] or 0.0),
            tuple(sorted(entry["objects"])),
        )
        for event_id, entry in events.items()
        if entry["objects"]
    )


def _require_column(conn, column: str) -> None:
    from ..ocel.event_columns import EventColumnError, list_event_columns

    if column not in list_event_columns(conn):
        raise EventColumnError(f"Column {column!r} does not exist on the events table.")


def _normalise_area(
    business_object_types: Optional[Iterable[str]],
    business_activities: Optional[Iterable[str]],
) -> Tuple[List[str], Optional[List[str]]]:
    types = sorted({t for t in (business_object_types or ()) if t})
    if not types:
        raise ValueError("At least one business object type is required.")
    activities = None
    if business_activities is not None:
        activities = sorted({a for a in business_activities if a})
        if not activities:
            activities = None  # empty selection = every activity
    return types, activities


def _area_cases(conn, types: Sequence[str], activities: Optional[Sequence[str]]) -> Dict[str, Set[str]]:
    from ..variants.extraction import extract_resource_aware

    return extract_resource_aware(conn, types, activities)


_SUMMARY_COLUMNS = ("event_count", "object_count", "activity_count", "start_unix", "end_unix")


def _summaries_from_rows(summary_rows, type_rows) -> List[dict]:
    type_counts: Dict[str, Dict[str, int]] = defaultdict(dict)
    for case_id, object_type, count in type_rows:
        type_counts[str(case_id)][str(object_type)] = int(count)
    out = []
    for row in summary_rows:
        case_id = str(row[0])
        item = {"id": case_id}
        item.update(dict(zip(_SUMMARY_COLUMNS, row[1:])))
        item["object_type_counts"] = dict(sorted(type_counts.get(case_id, {}).items()))
        out.append(item)
    out.sort(key=lambda item: (item["start_unix"] if item["start_unix"] is not None else 0, item["id"]))
    return out


def list_stored_executions(conn, column: str) -> List[dict]:
    """Summaries of every execution id stored in ``events.<column>``."""
    _require_column(conn, column)
    col = f"CAST(e.{_quote(column)} AS VARCHAR)"
    where = f"{col} IS NOT NULL AND {col} <> ''"
    summary_rows = conn.execute(
        f"""
        SELECT {col} AS case_id,
               COUNT(DISTINCT e.event_id),
               COUNT(DISTINCT eo.obj_id),
               COUNT(DISTINCT e.activity),
               MIN(e.timestamp_unix),
               MAX(e.timestamp_unix)
        FROM events e
        LEFT JOIN event_object eo ON eo.event_id = e.event_id
        WHERE {where}
        GROUP BY 1
        """
    ).fetchall()
    type_rows = conn.execute(
        f"""
        SELECT {col} AS case_id, o.obj_type, COUNT(DISTINCT o.obj_id)
        FROM events e
        JOIN event_object eo ON eo.event_id = e.event_id
        JOIN objects o ON o.obj_id = eo.obj_id
        WHERE {where}
        GROUP BY 1, 2
        """
    ).fetchall()
    return _summaries_from_rows(summary_rows, type_rows)


def load_stored_execution(conn, column: str, execution_id: str) -> ProcessExecution:
    """The events carrying ``execution_id`` in ``events.<column>``, all objects included."""
    _require_column(conn, column)
    col = f"CAST(e.{_quote(column)} AS VARCHAR)"
    rows = conn.execute(
        f"""
        SELECT e.event_id, e.activity, e.timestamp_unix, eo.obj_id, o.obj_type
        FROM events e
        LEFT JOIN event_object eo ON eo.event_id = e.event_id
        LEFT JOIN objects o ON o.obj_id = eo.obj_id
        WHERE {col} = ?
        ORDER BY e.timestamp_unix, e.event_id
        """,
        [str(execution_id)],
    ).fetchall()
    events = _events_from_rows(rows)
    if not events:
        raise ExecutionNotFoundError(
            f"No events carry the process execution id {execution_id!r} in column {column!r}."
        )
    return ProcessExecution(str(execution_id), events)


_AREA_CASES_TABLE = "oc_alignment_case_objs"


def _with_case_table(conn, cases: Mapping[str, Set[str]]):
    rows = [(cid, oid) for cid, objs in cases.items() for oid in objs]
    conn.execute(f"CREATE OR REPLACE TEMP TABLE {_AREA_CASES_TABLE} (case_id VARCHAR, obj_id VARCHAR)")
    if rows:
        conn.executemany(f"INSERT INTO {_AREA_CASES_TABLE} VALUES (?, ?)", rows)


def list_area_executions(
    conn,
    business_object_types: Iterable[str],
    business_activities: Optional[Iterable[str]] = None,
) -> List[dict]:
    """Summaries of the connected-component executions of a process area."""
    types, activities = _normalise_area(business_object_types, business_activities)
    cases = _area_cases(conn, types, activities)
    if not cases:
        return []
    _with_case_table(conn, cases)
    activity_clause, params = "", []
    if activities is not None:
        activity_clause = f"AND e.activity IN ({', '.join('?' for _ in activities)})"
        params = list(activities)
    try:
        # Only events that are part of the execution count: a considered
        # activity touching one of the component's objects.
        base = f"""
            FROM {_AREA_CASES_TABLE} co
            JOIN event_object eo ON eo.obj_id = co.obj_id
            JOIN events e ON e.event_id = eo.event_id
            JOIN objects o ON o.obj_id = co.obj_id
            WHERE TRUE {activity_clause}
        """
        summary_rows = conn.execute(
            f"""
            SELECT co.case_id,
                   COUNT(DISTINCT e.event_id),
                   COUNT(DISTINCT co.obj_id),
                   COUNT(DISTINCT e.activity),
                   MIN(e.timestamp_unix),
                   MAX(e.timestamp_unix)
            {base}
            GROUP BY co.case_id
            """,
            params,
        ).fetchall()
        type_rows = conn.execute(
            f"SELECT co.case_id, o.obj_type, COUNT(DISTINCT co.obj_id) {base} GROUP BY 1, 2",
            params,
        ).fetchall()
    finally:
        conn.execute(f"DROP TABLE IF EXISTS temp.main.{_AREA_CASES_TABLE}")
    return _summaries_from_rows(summary_rows, type_rows)


def load_area_execution(
    conn,
    business_object_types: Iterable[str],
    business_activities: Optional[Iterable[str]],
    execution_id: str,
) -> ProcessExecution:
    """One connected-component execution of a process area.

    ``execution_id`` is the case id of :func:`list_area_executions` (the
    smallest object id of the component); any object of the component is
    accepted as well.
    """
    types, activities = _normalise_area(business_object_types, business_activities)
    cases = _area_cases(conn, types, activities)
    objects = cases.get(str(execution_id))
    case_id = str(execution_id)
    if objects is None:
        for cid, objs in cases.items():
            if str(execution_id) in objs:
                case_id, objects = cid, objs
                break
    if not objects:
        raise ExecutionNotFoundError(
            f"No process execution {execution_id!r} for the selected object types and activities."
        )
    obj_list = sorted(objects)
    obj_placeholders = ", ".join("?" for _ in obj_list)
    activity_clause, params = "", list(obj_list)
    if activities is not None:
        activity_clause = f"AND e.activity IN ({', '.join('?' for _ in activities)})"
        params.extend(activities)
    rows = conn.execute(
        f"""
        SELECT e.event_id, e.activity, e.timestamp_unix, eo.obj_id, o.obj_type
        FROM event_object eo
        JOIN events e ON e.event_id = eo.event_id
        JOIN objects o ON o.obj_id = eo.obj_id
        WHERE eo.obj_id IN ({obj_placeholders}) {activity_clause}
        ORDER BY e.timestamp_unix, e.event_id
        """,
        params,
    ).fetchall()
    events = _events_from_rows(rows)
    if not events:
        raise ExecutionNotFoundError(
            f"Process execution {execution_id!r} has no events of the selected activities."
        )
    return ProcessExecution(case_id, events)


# ---------------------------------------------------------------------------
# Bulk loading (all executions of a source in one pass)
# ---------------------------------------------------------------------------


def _executions_from_case_rows(rows) -> List[ProcessExecution]:
    """Rows of ``(case_id, event_id, activity, timestamp_unix, obj_id, obj_type)``."""
    grouped: Dict[str, list] = defaultdict(list)
    for case_id, *rest in rows:
        grouped[str(case_id)].append(tuple(rest))
    executions = []
    for case_id, case_rows in grouped.items():
        events = _events_from_rows(case_rows)
        if events:
            executions.append(ProcessExecution(case_id, events))
    executions.sort(key=lambda e: (e.events[0].timestamp_unix, e.execution_id))
    return executions


def load_stored_executions(conn, column: str) -> List[ProcessExecution]:
    """Every execution stored in ``events.<column>`` (ordered by start time)."""
    _require_column(conn, column)
    col = f"CAST(e.{_quote(column)} AS VARCHAR)"
    rows = conn.execute(
        f"""
        SELECT {col}, e.event_id, e.activity, e.timestamp_unix, eo.obj_id, o.obj_type
        FROM events e
        LEFT JOIN event_object eo ON eo.event_id = e.event_id
        LEFT JOIN objects o ON o.obj_id = eo.obj_id
        WHERE {col} IS NOT NULL AND {col} <> ''
        ORDER BY 1, e.timestamp_unix, e.event_id
        """
    ).fetchall()
    return _executions_from_case_rows(rows)


def load_area_executions(
    conn,
    business_object_types: Iterable[str],
    business_activities: Optional[Iterable[str]] = None,
) -> List[ProcessExecution]:
    """Every connected-component execution of a process area (ordered by start time)."""
    types, activities = _normalise_area(business_object_types, business_activities)
    cases = _area_cases(conn, types, activities)
    if not cases:
        return []
    _with_case_table(conn, cases)
    activity_clause, params = "", []
    if activities is not None:
        activity_clause = f"AND e.activity IN ({', '.join('?' for _ in activities)})"
        params = list(activities)
    try:
        rows = conn.execute(
            f"""
            SELECT co.case_id, e.event_id, e.activity, e.timestamp_unix, co.obj_id, o.obj_type
            FROM {_AREA_CASES_TABLE} co
            JOIN event_object eo ON eo.obj_id = co.obj_id
            JOIN events e ON e.event_id = eo.event_id
            JOIN objects o ON o.obj_id = co.obj_id
            WHERE TRUE {activity_clause}
            ORDER BY co.case_id, e.timestamp_unix, e.event_id
            """,
            params,
        ).fetchall()
    finally:
        conn.execute(f"DROP TABLE IF EXISTS temp.main.{_AREA_CASES_TABLE}")
    return _executions_from_case_rows(rows)
