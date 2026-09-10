"""DuckDB-backed discovery of Object-Centric Petri Nets (OCPNs).

Implements the discovery approach of van der Aalst & Berti, "Discovering
Object-Centric Petri Nets" (Fundamenta Informaticae, 2020):

1. For every object type, the log is flattened (each object becomes a
   case). The flattening, ordering, and grouping into trace variants is
   done entirely inside DuckDB via SQL so that only the compact variant
   representation reaches Python — this keeps the approach usable for
   large logs.
2. For every flattened log an accepting Petri net is discovered with the
   from-scratch inductive miner (see ``inductive_miner.py``).
3. The nets are merged: transitions with the same activity label are
   shared, places keep their object type, and silent transitions stay
   local to their object type's net.
4. Variable arcs are identified with the paper's scoring function:
   ``score(act, ot)`` is the fraction of *all* events of activity ``act``
   that refer to exactly one object of type ``ot``; arcs between the
   corresponding transition and places of type ``ot`` are variable when
   the score falls below a threshold (0.98 in the paper).

The result is returned in the repository's OCPN JSON exchange format
(``format: "ocpn", version: 1`` — see docs/MODEL_EDITORS.md), so it can be
rendered and edited by the existing frontend components.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Dict, Iterator, List, Optional, Sequence, Tuple

from ..ocel.ocel_duckdb import OcelDuckDB
from .inductive_miner import discover_petri_net

#: Default threshold for the variable-arc score, taken from the paper.
DEFAULT_VARIABLE_ARC_THRESHOLD = 0.98


# ---------------------------------------------------------------------------
# Timeout watchdog (same hybrid pattern as variants/ocvariants_db.py):
# a timer interrupts in-flight SQL via conn.interrupt() and sets an event
# that the pure-Python inductive miner polls during its recursion.
# ---------------------------------------------------------------------------


@contextmanager
def _timeout_watchdog(
    ocel_db: OcelDuckDB, timeout_s: Optional[float]
) -> Iterator[Optional[threading.Event]]:
    if timeout_s is None or timeout_s <= 0:
        yield None
        return

    cancel_event = threading.Event()

    def _trip() -> None:
        cancel_event.set()
        try:
            ocel_db.conn.interrupt()
        except Exception:
            pass

    timer = threading.Timer(timeout_s, _trip)
    timer.daemon = True
    timer.start()
    try:
        yield cancel_event
    finally:
        timer.cancel()


def _is_interrupted_error(exc: BaseException) -> bool:
    cls = type(exc).__name__.lower()
    return "interrupt" in cls or "interrupt" in str(exc).lower()


# ---------------------------------------------------------------------------
# SQL building blocks
# ---------------------------------------------------------------------------

# Flatten the log for one object type and group the resulting cases into
# trace variants. Every object of the type becomes one case; its trace is
# the sequence of activities of the events it participates in, ordered by
# timestamp (event id as tie-breaker). Events without objects of the type
# are dropped, events with several objects of the type are replicated —
# exactly Definition 4.1 (flattening) of the paper.
_VARIANTS_SQL = """
SELECT trace, COUNT(*) AS n
FROM (
    SELECT list(e.activity ORDER BY e.timestamp_unix, e.event_id) AS trace
    FROM event_object eo
    JOIN events e  ON e.event_id = eo.event_id
    JOIN objects o ON o.obj_id  = eo.obj_id
    WHERE o.obj_type = ?
    GROUP BY eo.obj_id
)
GROUP BY trace
ORDER BY n DESC, trace
"""

# score(act, ot) = |events of act with exactly one object of type ot|
#                  / |all events of act|            (Step 5 of the paper)
# Only (activity, object type) pairs that co-occur at least once are
# returned; other pairs have no arcs in the merged net anyway.
_VARIABLE_ARC_SCORES_SQL = """
WITH per_event_type AS (
    SELECT eo.event_id, o.obj_type, COUNT(*) AS n_objs
    FROM event_object eo
    JOIN objects o ON o.obj_id = eo.obj_id
    GROUP BY eo.event_id, o.obj_type
),
act_totals AS (
    SELECT activity, COUNT(*) AS total FROM events GROUP BY activity
)
SELECT
    e.activity,
    pet.obj_type,
    COUNT(*) FILTER (WHERE pet.n_objs = 1) AS single_object_events,
    MIN(t.total) AS total_events
FROM per_event_type pet
JOIN events e     ON e.event_id = pet.event_id
JOIN act_totals t ON t.activity = e.activity
GROUP BY e.activity, pet.obj_type
"""

_OBJECT_TYPES_SQL = "SELECT DISTINCT obj_type FROM objects ORDER BY obj_type"

_ACTIVITY_FREQUENCIES_SQL = (
    "SELECT activity, COUNT(*) AS n FROM events GROUP BY activity"
)


def _fetch_object_types(ocel_db: OcelDuckDB) -> List[str]:
    return [row[0] for row in ocel_db.conn.execute(_OBJECT_TYPES_SQL).fetchall()]


def _fetch_variants(
    ocel_db: OcelDuckDB, object_type: str
) -> Dict[Tuple[str, ...], int]:
    rows = ocel_db.conn.execute(_VARIANTS_SQL, [object_type]).fetchall()
    return {tuple(trace): int(count) for trace, count in rows}


def _fetch_variable_arc_scores(ocel_db: OcelDuckDB) -> Dict[Tuple[str, str], float]:
    rows = ocel_db.conn.execute(_VARIABLE_ARC_SCORES_SQL).fetchall()
    return {
        (activity, obj_type): (single / total if total else 1.0)
        for activity, obj_type, single, total in rows
    }


def _fetch_activity_frequencies(ocel_db: OcelDuckDB) -> Dict[str, int]:
    rows = ocel_db.conn.execute(_ACTIVITY_FREQUENCIES_SQL).fetchall()
    return {activity: int(count) for activity, count in rows}


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


def discover_ocpn_db(
    ocel_db: OcelDuckDB,
    *,
    object_types: Optional[Sequence[str]] = None,
    timeout_s: Optional[float] = None,
    variable_arc_threshold: float = DEFAULT_VARIABLE_ARC_THRESHOLD,
    name: str = "Discovered OCPN",
) -> dict:
    """Discover an object-centric Petri net from a DuckDB-backed OCEL.

    Parameters
    ----------
    ocel_db:
        The event log as :class:`~totem_lib.ocel.ocel_duckdb.OcelDuckDB`.
    object_types:
        Optional subset of object types to include (a "view" in the
        paper's terminology). Defaults to all types in the log.
    timeout_s:
        Abort with :class:`TimeoutError` when discovery takes longer than
        this many seconds. ``None`` or a non-positive value disables the
        timeout.
    variable_arc_threshold:
        Threshold tau for the variable-arc score. An (activity, object
        type) combination gets variable arcs when fewer than this fraction
        of the activity's events refer to exactly one object of the type.
    name:
        Name stored in the returned model file.

    Returns
    -------
    dict
        The OCPN in the repository's JSON exchange format
        (``{"format": "ocpn", "version": 1, "name", "objectTypes",
        "places", "transitions", "arcs"}``).
    """
    try:
        with _timeout_watchdog(ocel_db, timeout_s) as cancel_event:
            should_cancel = cancel_event.is_set if cancel_event is not None else None

            available_types = _fetch_object_types(ocel_db)
            if object_types is not None:
                selected = [ot for ot in available_types if ot in set(object_types)]
            else:
                selected = available_types

            scores = _fetch_variable_arc_scores(ocel_db)

            per_type_nets = []
            for obj_type in selected:
                if should_cancel is not None and should_cancel():
                    raise TimeoutError("OCPN discovery cancelled (timeout)")
                variants = _fetch_variants(ocel_db, obj_type)
                if not variants:
                    continue  # No object of this type participates in events.
                net = discover_petri_net(variants, should_cancel)
                per_type_nets.append((obj_type, net))

        return _merge_nets_to_model(
            per_type_nets,
            scores=scores,
            variable_arc_threshold=variable_arc_threshold,
            name=name,
        )
    except TimeoutError:
        raise
    except Exception as exc:
        if _is_interrupted_error(exc):
            raise TimeoutError(
                f"OCPN discovery timed out after {timeout_s} seconds"
            ) from exc
        raise


def _merge_nets_to_model(
    per_type_nets,
    *,
    scores: Dict[Tuple[str, str], float],
    variable_arc_threshold: float,
    name: str,
) -> dict:
    """Merge per-object-type accepting Petri nets into one OCPN model file.

    Transitions that carry the same activity label are shared between the
    nets (Step 3 of the paper); places and silent transitions stay unique
    per object type. Arcs to places of type ``ot`` at a transition labeled
    ``act`` become variable when ``score(act, ot) < threshold``.
    """
    places: List[dict] = []
    transitions: List[dict] = []
    arcs: List[dict] = []
    transition_id_by_label: Dict[str, str] = {}
    next_ids = {"p": 0, "t": 0, "a": 0}

    def new_id(kind: str) -> str:
        next_ids[kind] += 1
        return f"{kind}{next_ids[kind]}"

    for obj_type, net in per_type_nets:
        place_ids: Dict[str, str] = {}
        for local_place in net.places:
            pid = new_id("p")
            place_ids[local_place] = pid
            place = {"id": pid, "objectType": obj_type}
            if local_place == net.source:
                place["initial"] = True
            if local_place == net.sink:
                place["final"] = True
            places.append(place)

        transition_ids: Dict[str, str] = {}
        for local_transition, label in net.transitions.items():
            if label is None:
                tid = new_id("t")
                transitions.append({"id": tid, "silent": True})
            elif label in transition_id_by_label:
                tid = transition_id_by_label[label]
            else:
                tid = new_id("t")
                transition_id_by_label[label] = tid
                transitions.append({"id": tid, "label": label})
            transition_ids[local_transition] = tid

        for source, target in sorted(net.arcs):
            if source in place_ids:
                place_local, transition_local = source, target
                mapped = (place_ids[source], transition_ids[target])
            else:
                place_local, transition_local = target, source
                mapped = (transition_ids[source], place_ids[target])
            label = net.transitions[transition_local]
            arc = {"id": new_id("a"), "source": mapped[0], "target": mapped[1]}
            if (
                label is not None
                and scores.get((label, obj_type), 1.0) < variable_arc_threshold
            ):
                arc["variable"] = True
            arcs.append(arc)

    return {
        "format": "ocpn",
        "version": 1,
        "name": name,
        "objectTypes": [{"name": obj_type} for obj_type, _ in per_type_nets],
        "places": places,
        "transitions": transitions,
        "arcs": arcs,
    }
