"""
Process executions as first-class results.

:func:`~.ocvariants_db.find_variants` extracts process executions ("cases")
only as a step on the way to variants. Two features need the executions
themselves:

* materialising them into the event log as an *execution id* column, so other
  components (for example OCCN conformance) can replay exactly these
  executions later on, and
* skipping the expensive isomorphism grouping when only the executions are of
  interest.

The functions here reuse the extraction techniques of :mod:`.extraction` and
the ``case_objs`` / ``case_events`` temp tables of :mod:`.ocvariants_db`, so a
caller that wants both executions *and* variants can hand the extracted cases
to ``find_variants(..., cases=...)`` and pay for the extraction once.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, FrozenSet, Iterable, List, Mapping, Optional, Sequence, Set

from ..ocel.ocel_duckdb import OcelDuckDB
from . import extraction as _ext
from .ocvariants import Variants
from .ocvariants_db import _CREATE_CASE_EVENTS_SQL, _materialise_case_objs


@dataclass(frozen=True)
class ProcessExecutions:
    """The process executions of a log under one extraction technique."""

    #: Name of the extraction technique (see :data:`.extraction.EXTRACTIONS`).
    extraction: str
    #: ``case_id -> object ids`` -- the objects that define the execution.
    case_objects: Dict[str, Set[str]]
    #: ``case_id -> event ids`` ordered by ``(timestamp, event_id)``. Every
    #: event that references one of the case's objects belongs to the case.
    case_events: Dict[str, List[str]]

    @property
    def execution_count(self) -> int:
        return len(self.case_events)

    @property
    def event_count(self) -> int:
        """Number of distinct events covered by at least one execution."""
        return len({e for events in self.case_events.values() for e in events})


def extract_process_executions(
    ocel_db: OcelDuckDB,
    *,
    extraction: str,
    leading_type: Optional[str] = None,
    business_object_types: Optional[Iterable[str]] = None,
    business_activities: Optional[Iterable[str]] = None,
) -> ProcessExecutions:
    """
    Extract the process executions of ``ocel_db`` with the given technique.

    Parameters mirror :func:`~.ocvariants_db.find_variants`. Cases whose
    objects occur in no event at all are dropped -- an execution without
    events is not an execution.

    Creates the connection-scoped TEMP tables ``case_objs`` and
    ``case_events`` as a side effect (like ``find_variants``), so callers in a
    multi-threaded process must hold ``ocel_db.lock``.
    """
    conn = ocel_db.conn
    cases = _ext.extract_cases(
        conn,
        extraction,
        leading_type=leading_type,
        business_object_types=business_object_types,
        business_activities=business_activities,
    )
    if not cases:
        return ProcessExecutions(extraction, {}, {})

    _materialise_case_objs(conn, cases)
    conn.execute(_CREATE_CASE_EVENTS_SQL)
    rows = conn.execute(
        """
        SELECT ce.case_id, ce.event_id
        FROM case_events ce
        JOIN events e ON e.event_id = ce.event_id
        ORDER BY ce.case_id, e.timestamp_unix, ce.event_id
        """
    ).fetchall()

    case_events: Dict[str, List[str]] = defaultdict(list)
    for case_id, event_id in rows:
        case_events[case_id].append(event_id)

    case_objects = {cid: set(objs) for cid, objs in cases.items() if cid in case_events}
    return ProcessExecutions(extraction, case_objects, dict(case_events))


@dataclass(frozen=True)
class EventPartition:
    """A per-event assignment derived from possibly overlapping executions."""

    #: ``event_id -> case_id`` for every event that lies in exactly one execution.
    assignment: Dict[str, str]
    #: Events that lie in more than one execution and therefore get no id.
    ambiguous_event_ids: FrozenSet[str]


def partition_events(case_events: Mapping[str, Sequence[str]]) -> EventPartition:
    """
    Turn executions into a partition of events.

    Executions of the leading-object techniques may overlap; an event shared
    by two executions cannot carry a single execution id. Such events are
    reported as ambiguous and left unassigned, which keeps the invariant that
    an id identifies exactly one execution.
    """
    owners: Dict[str, Set[str]] = defaultdict(set)
    for case_id, event_ids in case_events.items():
        for event_id in event_ids:
            owners[event_id].add(case_id)

    assignment: Dict[str, str] = {}
    ambiguous: Set[str] = set()
    for event_id, case_ids in owners.items():
        if len(case_ids) == 1:
            assignment[event_id] = next(iter(case_ids))
        else:
            ambiguous.add(event_id)
    return EventPartition(assignment, frozenset(ambiguous))


def variant_ids_by_case(variants: Variants) -> Dict[str, str]:
    """
    ``case_id -> variant id`` for every case grouped into a variant.

    Only variants that track their member cases (``Variant.case_ids``, set by
    :func:`~.ocvariants_db.find_variants`) contribute. Cases that were skipped
    during discovery -- single-event executions have no edges and therefore no
    variant graph -- are absent from the result.
    """
    out: Dict[str, str] = {}
    for variant in variants:
        for case_id in variant.case_ids or ():
            out[case_id] = str(variant.id)
    return out


def variant_assignment(
    partition: EventPartition, variants: Variants
) -> Dict[str, str]:
    """``event_id -> variant id`` for every unambiguously assigned event."""
    by_case = variant_ids_by_case(variants)
    return {
        event_id: by_case[case_id]
        for event_id, case_id in partition.assignment.items()
        if case_id in by_case
    }
