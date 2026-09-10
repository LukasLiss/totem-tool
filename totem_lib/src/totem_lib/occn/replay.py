"""Metric-neutral OCCN replay state transitions."""

from __future__ import annotations

from collections import Counter
from typing import Any, Iterable, Tuple

from .occn import OCCausalNet, OCCausalNetState
from .replay_units import OCCNReplayEvent
from .semantics import OCCausalNetSemantics

StateValue = Any
StateObligation = Tuple[StateValue, StateValue, StateValue, int]
StateSignature = Tuple[Tuple[StateValue, Tuple[StateObligation, ...]], ...]


def _value_sort_key(value: StateValue) -> Tuple[str, str, str]:
    value_type = type(value)
    return (value_type.__module__, value_type.__qualname__, repr(value))


def state_signature(state: OCCausalNetState) -> StateSignature:
    """Return an immutable signature containing every pending obligation."""
    if not isinstance(state, OCCausalNetState):
        raise TypeError("state must be an OCCausalNetState")

    activities = []
    for activity, obligations in state.items():
        entries = tuple(
            sorted(
                (
                    (predecessor, object_id, object_type, count)
                    for (
                        predecessor,
                        object_id,
                        object_type,
                    ), count in obligations.items()
                    if count > 0
                ),
                key=lambda entry: (
                    _value_sort_key(entry[0]),
                    _value_sort_key(entry[1]),
                    _value_sort_key(entry[2]),
                    entry[3],
                ),
            )
        )
        if entries:
            activities.append((activity, entries))

    return tuple(sorted(activities, key=lambda entry: _value_sort_key(entry[0])))


def deduplicate_states(
    states: Iterable[OCCausalNetState],
) -> Tuple[OCCausalNetState, ...]:
    """Keep one state for each exact obligation multiset."""
    distinct = {}
    for state in states:
        signature = state_signature(state)
        distinct.setdefault(signature, state)
    return tuple(distinct[signature] for signature in sorted(distinct, key=repr))


def start_object_successors(
    occn: OCCausalNet,
    state: OCCausalNetState,
    object_id: str,
    object_type: str,
) -> Tuple[OCCausalNetState, ...]:
    """Start one object and return every exact successor state."""
    start_activity = f"START_{object_type}"
    if start_activity not in occn.activities:
        return ()

    bindings = OCCausalNetSemantics.enabled_bindings_start_activity(
        occn,
        start_activity,
        object_type,
        {object_id},
    )
    return deduplicate_states(
        OCCausalNetSemantics.bind_activity(binding, state) for binding in bindings
    )


def visible_event_successors(
    occn: OCCausalNet,
    state: OCCausalNetState,
    event: OCCNReplayEvent,
) -> Tuple[OCCausalNetState, ...]:
    """Replay one visible event with exactly its observed objects."""
    if event.activity not in occn.activities:
        return ()
    if event.activity.startswith(("START_", "END_")):
        return ()
    if not event.object_ids:
        return ()

    obligations = state.get(event.activity, Counter())
    relevant_obligations = Counter(
        {
            obligation: count
            for obligation, count in obligations.items()
            if obligation[1] in event.object_ids and count > 0
        }
    )
    restricted_state = OCCausalNetState({event.activity: relevant_obligations})
    bindings = OCCausalNetSemantics.enabled_bindings_for_objects(
        occn,
        event.activity,
        restricted_state,
        set(event.object_ids),
    )
    return deduplicate_states(
        OCCausalNetSemantics.bind_activity(binding, state) for binding in bindings
    )


def end_object_successors(
    occn: OCCausalNet,
    state: OCCausalNetState,
    object_id: str,
    object_type: str,
) -> Tuple[OCCausalNetState, ...]:
    """End one object and return every exact successor state."""
    end_activity = f"END_{object_type}"
    if end_activity not in occn.activities:
        return ()

    bindings = OCCausalNetSemantics.enabled_bindings_for_objects(
        occn,
        end_activity,
        state,
        {object_id},
    )
    return deduplicate_states(
        OCCausalNetSemantics.bind_activity(binding, state) for binding in bindings
    )
