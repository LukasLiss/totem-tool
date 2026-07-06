"""
Context-based precision for object-centric causal nets (OCCNs).

The precision notion generalizes the escaping-edges precision for
object-centric Petri nets by Adams and van der Aalst (ICPM 2021) to
object-centric causal nets (Liss et al., CAiSE 2025).

For every event, its *context* (the activity prefixes of all objects the
event causally depends on, grouped by object type) links log and model
behavior: the activities observed in the log for a context are compared
with the activities the OCCN enables in any state that is reachable by
replaying the context. The share of model behavior that is also log
behavior, averaged over all replayable events, is the precision.

See `docs/OCCN_PRECISION.md` for the formal definitions and the algorithm.
"""

import json
from collections import Counter, defaultdict
from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, FrozenSet, Iterable, List, Optional, Set, Tuple, Union

from ..ocel import ObjectCentricEventLog
from .occn import OCCausalNet, OCCausalNetState
from .semantics import OCCausalNetSemantics

# Canonical, hashable context representation:
# ((object_type, ((prefix_tuple, multiplicity), ...)), ...) sorted.
ContextKey = Tuple[Tuple[str, Tuple[Tuple[Tuple[str, ...], int], ...]], ...]

GRANULARITY_ACTIVITY = "activity"
GRANULARITY_PROFILE = "profile"


@dataclass(frozen=True)
class OCCNContextDetail:
    """
    Diagnostics for one context (an equivalence class of events that share
    the same causal history).

    The elements of `enabled_log`, `enabled_model` and `escaping` are
    activities (granularity "activity") or tuples
    `(activity, ((object_type, count), ...))` (granularity "profile").
    `escaping` is the model behavior never observed in the log for this
    context, i.e., the escaping edges. `contribution` is the precision term
    each event of this context adds to the average; it is `None` for
    non-replayable contexts, which are excluded from the metric.
    """

    context: ContextKey
    event_ids: Tuple[str, ...]
    enabled_log: FrozenSet
    enabled_model: FrozenSet
    escaping: FrozenSet
    replayable: bool
    contribution: Optional[float]


@dataclass(frozen=True)
class OCCNPrecisionResult:
    """
    Result of the OCCN precision computation.

    `precision` is the average, over all replayable events, of the share of
    enabled model behavior that is also observed in the log for the event's
    context. `num_skipped_events` counts events whose context enables no
    model behavior (non-replayable events, as in Adams & van der Aalst);
    they are excluded from the average. If no event is replayable,
    `precision` is 0.0 by convention.
    """

    precision: float
    granularity: str
    num_events: int
    num_replayable_events: int
    num_skipped_events: int
    num_contexts: int
    num_state_capped_replays: int
    context_details: List[OCCNContextDetail] = field(repr=False)


class _ReplayCapped(Exception):
    """Raised internally when a replay exceeds the max_states cap."""


@dataclass(frozen=True)
class _Event:
    index: int
    event_id: str
    activity: str
    objects: Tuple[str, ...]  # typed objects only, deterministic order


def occn_precision(
    ocel: ObjectCentricEventLog,
    occn: Union[OCCausalNet, dict, str],
    event_ids: Optional[Iterable[str]] = None,
    granularity: str = GRANULARITY_ACTIVITY,
    max_states: Optional[int] = 1000,
) -> OCCNPrecisionResult:
    """
    Computes the context-based (escaping-edges) precision of an
    object-centric causal net with respect to an object-centric event log.

    For every event, the context (the activity prefixes of all objects the
    event causally depends on, per object type) is derived from the
    event-object graph of the log. The behavior the log shows for a context
    (activities of all events with an equal context) is compared to the
    behavior the model allows for it (activities enabled in any state
    reachable by replaying the context on the OCCN, exploring all binding
    choices). Precision is the average share of allowed model behavior that
    is also observed, over all replayable events. Events whose context
    cannot be replayed are skipped, as in Adams & van der Aalst (ICPM 2021).

    Parameters
    ----------
    ocel : ObjectCentricEventLog
        The object-centric event log. Events are ordered by timestamp;
        ties are broken by the order of the events in the log. Objects
        without a type in the log's objects table are ignored.
    occn : Union[OCCausalNet, dict, str]
        The object-centric causal net. Accepts an `OCCausalNet`, the editor
        JSON format (a dict with a `"markerGroups"` key, see
        `docs/MODEL_EDITORS.md`), a plain marker-groups dict in the
        `OCCausalNet.from_dict` format, a JSON string of either dict
        format, or a path to a JSON file.
    event_ids : Optional[Iterable[str]]
        If given, only these events are considered (both for contexts and
        for the log behavior). Defaults to all events of the log.
    granularity : str
        `"activity"` (default) compares sets of enabled activities, the
        direct generalization of the escaping-edges precision. `"profile"`
        additionally distinguishes the number of objects per object type an
        activity is executed with, so that over-permissive cardinalities
        and object distributions of the OCCN reduce the precision as well.
    max_states : Optional[int]
        Safety cap for the number of (maximal) states tracked during one
        context replay; guarantees termination since exploring all binding
        choices is exponential in the worst case. A capped replay contributes
        no model behavior; its events are skipped only if no other event of
        the same context contributes behavior, otherwise they are averaged
        against the remaining (possibly smaller) enabled model behavior. The
        number of capped replays (counted per unique cached replay) is
        reported in `num_state_capped_replays`; results with a non-zero
        count are approximations. Larger caps explore more model behavior.
        Pass None for the exact, uncapped computation. Default: 1000.

    Returns
    -------
    OCCNPrecisionResult
        The precision together with per-context diagnostics, including the
        escaping behavior (model behavior never observed for a context).
    """
    if granularity not in (GRANULARITY_ACTIVITY, GRANULARITY_PROFILE):
        raise ValueError(
            f"granularity must be '{GRANULARITY_ACTIVITY}' or "
            f"'{GRANULARITY_PROFILE}', got {granularity!r}"
        )
    if max_states is not None and max_states < 1:
        raise ValueError(f"max_states must be >= 1, got {max_states}")

    occn = _occn_from_input(occn)
    obj_type_map = ocel.obj_type_map
    events = _extract_events(ocel, obj_type_map, event_ids)
    num_events = len(events)

    if num_events == 0:
        return OCCNPrecisionResult(
            precision=0.0,
            granularity=granularity,
            num_events=0,
            num_replayable_events=0,
            num_skipped_events=0,
            num_contexts=0,
            num_state_capped_replays=0,
            context_details=[],
        )

    # --- Log side: presets, contexts, enabled log behavior ---
    preset_masks, context_obj_masks = _compute_presets(events)
    obj_index, events_of_object = _index_objects(events)
    bit_to_obj = {bit: obj for obj, bit in obj_index.items()}

    contexts: Dict[ContextKey, List[int]] = defaultdict(list)
    for ev in events:
        key = _context_key(
            ev, preset_masks, context_obj_masks, bit_to_obj, events_of_object,
            events, obj_type_map,
        )
        contexts[key].append(ev.index)

    enabled_log: Dict[ContextKey, FrozenSet] = {}
    for key, member_indices in contexts.items():
        if granularity == GRANULARITY_ACTIVITY:
            enabled_log[key] = frozenset(events[i].activity for i in member_indices)
        else:
            enabled_log[key] = frozenset(
                (events[i].activity, _type_profile(events[i].objects, obj_type_map))
                for i in member_indices
            )

    # --- Model side: replay contexts, collect enabled model behavior ---
    # Replays are cached under a canonical, object-renaming-invariant key,
    # so repeated behavior (e.g., the same variant executed by different
    # objects) is only replayed once.
    replay_cache: Dict[Tuple, Optional[Set[OCCausalNetState]]] = {}
    behavior_cache: Dict[Tuple, Optional[FrozenSet]] = {}
    enabled_cache: Dict[Tuple, FrozenSet] = {}
    num_capped = 0

    enabled_model: Dict[ContextKey, FrozenSet] = {}
    for key, member_indices in contexts.items():
        model_behavior: Set = set()
        for i in member_indices:
            ev = events[i]
            replay_key = _canonical_replay_key(
                ev, preset_masks[i], events, obj_type_map
            )
            if replay_key not in behavior_cache:
                behavior_cache[replay_key] = _replay_behavior(
                    occn,
                    replay_key,
                    granularity,
                    max_states,
                    replay_cache,
                    enabled_cache,
                )
                if behavior_cache[replay_key] is None:
                    num_capped += 1
            behavior = behavior_cache[replay_key]
            if behavior:
                model_behavior |= behavior
        enabled_model[key] = frozenset(model_behavior)

    # --- Combine into the precision metric ---
    total = 0.0
    num_replayable = 0
    details: List[OCCNContextDetail] = []
    for key, member_indices in contexts.items():
        en_l = enabled_log[key]
        en_m = enabled_model[key]
        replayable = len(en_m) > 0
        contribution = None
        if replayable:
            contribution = len(en_l & en_m) / len(en_m)
            total += contribution * len(member_indices)
            num_replayable += len(member_indices)
        details.append(
            OCCNContextDetail(
                context=key,
                event_ids=tuple(events[i].event_id for i in member_indices),
                enabled_log=en_l,
                enabled_model=en_m,
                escaping=frozenset(en_m - en_l),
                replayable=replayable,
                contribution=contribution,
            )
        )

    precision = total / num_replayable if num_replayable > 0 else 0.0
    return OCCNPrecisionResult(
        precision=precision,
        granularity=granularity,
        num_events=num_events,
        num_replayable_events=num_replayable,
        num_skipped_events=num_events - num_replayable,
        num_contexts=len(contexts),
        num_state_capped_replays=num_capped,
        context_details=details,
    )


# --------------------------------------------------------------------------
# Input handling
# --------------------------------------------------------------------------

def _occn_from_input(occn: Union[OCCausalNet, dict, str]) -> OCCausalNet:
    """
    Normalizes the accepted OCCN inputs (OCCausalNet, editor JSON dict,
    marker-groups dict, JSON string, or path to a JSON file) to an
    OCCausalNet instance.
    """
    if isinstance(occn, OCCausalNet):
        return occn
    if isinstance(occn, str):
        candidate = Path(occn)
        try:
            is_file = candidate.is_file()
        except OSError:
            is_file = False
        text = candidate.read_text(encoding="utf-8") if is_file else occn
        try:
            occn = json.loads(text)
        except json.JSONDecodeError as err:
            raise ValueError(
                "occn string is neither a path to a JSON file nor valid JSON"
            ) from err
    if not isinstance(occn, dict):
        raise TypeError(
            "occn must be an OCCausalNet, a dict (editor JSON or marker "
            f"groups), a JSON string, or a file path, got {type(occn)}"
        )
    if "markerGroups" in occn:
        file_format = occn.get("format", "occn")
        if file_format != "occn":
            raise ValueError(
                f"Expected an OCCN JSON file (format 'occn'), got format "
                f"{file_format!r}"
            )
        marker_groups = occn["markerGroups"]
    else:
        marker_groups = occn
    # from_dict may mutate its input, so never hand it the caller's dict
    return OCCausalNet.from_dict(deepcopy(marker_groups))


def _extract_events(
    ocel: ObjectCentricEventLog,
    obj_type_map: Dict[str, str],
    event_ids: Optional[Iterable[str]],
) -> List[_Event]:
    """
    Extracts the selected events from the OCEL, ordered by timestamp with
    ties broken by log order. Objects without a type are dropped.
    """
    selected = set(event_ids) if event_ids is not None else None
    rows = ocel.events.select(
        ["_eventId", "_activity", "_timestampUnix", "_objects"]
    ).iter_rows(named=True)

    raw = []
    for row_index, row in enumerate(rows):
        if selected is not None and row["_eventId"] not in selected:
            continue
        objects = tuple(
            sorted(o for o in set(row["_objects"] or []) if o in obj_type_map)
        )
        raw.append((row["_timestampUnix"], row_index, row["_eventId"],
                    row["_activity"], objects))

    raw.sort(key=lambda entry: (entry[0], entry[1]))
    return [
        _Event(index=i, event_id=eid, activity=act, objects=objects)
        for i, (_, _, eid, act, objects) in enumerate(raw)
    ]


# --------------------------------------------------------------------------
# Log side: event-object graph, presets and contexts
# --------------------------------------------------------------------------

def _compute_presets(events: List[_Event]) -> Tuple[List[int], List[int]]:
    """
    Computes for each event the event preset (all events it transitively
    depends on via shared objects) and the set of objects appearing in
    the preset or the event itself. Both are encoded as bitmasks: bit j of
    `preset_masks[i]` is set iff event j is in the preset of event i, and
    bit k of `context_obj_masks[i]` is set iff object k (see
    `_index_objects`) appears in the preset of event i or in event i.

    Uses that the preset of an event is the union, over its objects, of the
    preset (plus the event itself) of the last preceding event of each
    object: any earlier event sharing an object is reachable through the
    chain of that object's events.
    """
    obj_bit: Dict[str, int] = {}
    preset_masks: List[int] = []
    context_obj_masks: List[int] = []
    last_event_of_obj: Dict[str, int] = {}

    for i, ev in enumerate(events):
        own_obj_mask = 0
        for o in ev.objects:
            if o not in obj_bit:
                obj_bit[o] = len(obj_bit)
            own_obj_mask |= 1 << obj_bit[o]

        preset = 0
        preset_objs = own_obj_mask
        for o in ev.objects:
            j = last_event_of_obj.get(o)
            if j is not None:
                preset |= preset_masks[j] | (1 << j)
                preset_objs |= context_obj_masks[j]
        preset_masks.append(preset)
        context_obj_masks.append(preset_objs)

        for o in ev.objects:
            last_event_of_obj[o] = i

    return preset_masks, context_obj_masks


def _index_objects(
    events: List[_Event],
) -> Tuple[Dict[str, int], Dict[str, List[int]]]:
    """
    Returns the object-to-bit mapping used by `_compute_presets` (same
    first-appearance order) and, per object, the ordered list of indices of
    the events it appears in.
    """
    obj_index: Dict[str, int] = {}
    events_of_object: Dict[str, List[int]] = defaultdict(list)
    for ev in events:
        for o in ev.objects:
            if o not in obj_index:
                obj_index[o] = len(obj_index)
            events_of_object[o].append(ev.index)
    return obj_index, events_of_object


def _context_key(
    ev: _Event,
    preset_masks: List[int],
    context_obj_masks: List[int],
    bit_to_obj: Dict[int, str],
    events_of_object: Dict[str, List[int]],
    events: List[_Event],
    obj_type_map: Dict[str, str],
) -> ContextKey:
    """
    Builds the canonical context of an event: for every object appearing in
    the event's preset or the event itself, the sequence of activities of
    the preset events it appears in; grouped as a multiset per object type.
    """
    preset_indices = set(_iter_bits(preset_masks[ev.index]))
    prefixes_per_type: Dict[str, Counter] = defaultdict(Counter)

    for bit in _iter_bits(context_obj_masks[ev.index]):
        obj = bit_to_obj[bit]
        prefix = tuple(
            events[j].activity
            for j in events_of_object[obj]
            if j in preset_indices
        )
        prefixes_per_type[obj_type_map[obj]][prefix] += 1

    return tuple(
        sorted(
            (ot, tuple(sorted(counter.items())))
            for ot, counter in prefixes_per_type.items()
        )
    )


def _type_profile(
    objects: Tuple[str, ...], obj_type_map: Dict[str, str]
) -> Tuple[Tuple[str, int], ...]:
    """Canonical (object_type, count) profile of a set of objects."""
    counts: Counter = Counter(obj_type_map[o] for o in objects)
    return tuple(sorted(counts.items()))


# --------------------------------------------------------------------------
# Model side: replay and enabled behavior
# --------------------------------------------------------------------------

def _canonical_replay_key(
    ev: _Event,
    preset_mask: int,
    events: List[_Event],
    obj_type_map: Dict[str, str],
) -> Tuple[Tuple, Tuple, Tuple]:
    """
    Builds a canonical, object-renaming-invariant key for the replay an
    event requires: the preset events with objects renamed to consecutive
    integers (in order of first appearance) plus the types of the event's
    fresh objects. Equal keys imply isomorphic replays, so the enabled
    model behavior can be shared between them.

    Returns the tuple (canonical event sequence, types of the canonical
    preset objects, types of the fresh objects of the event).
    """
    mapping: Dict[str, int] = {}
    types: List[str] = []
    sequence = []
    for j in _iter_bits(preset_mask):
        preset_event = events[j]
        entry = []
        for obj in preset_event.objects:
            index = mapping.get(obj)
            if index is None:
                index = mapping[obj] = len(types)
                types.append(obj_type_map[obj])
            entry.append(index)
        sequence.append((preset_event.activity, tuple(entry)))

    fresh_types = tuple(
        sorted(obj_type_map[obj] for obj in ev.objects if obj not in mapping)
    )
    return tuple(sequence), tuple(types), fresh_types


def _replay_behavior(
    occn: OCCausalNet,
    replay_key: Tuple[Tuple, Tuple, Tuple],
    granularity: str,
    max_states: Optional[int],
    replay_cache: Dict[Tuple, object],
    enabled_cache: Dict[Tuple, FrozenSet],
) -> Optional[FrozenSet]:
    """
    The model behavior enabled after replaying the canonical replay key:
    the preset events are replayed (all binding choices), the event's
    fresh objects are started, and the enabled behavior is collected over
    all reached states. Returns an empty frozenset if the replay is not
    possible and None if it exceeded the max_states cap.
    """
    sequence, preset_types, fresh_types = replay_key

    preset_key = (sequence, preset_types)
    if preset_key not in replay_cache:
        try:
            replay_cache[preset_key] = _replay_preset(
                occn, sequence, preset_types, max_states
            )
        except _ReplayCapped:
            replay_cache[preset_key] = _CAPPED
    states = replay_cache[preset_key]
    if states is _CAPPED:
        return None
    if states is None:
        return frozenset()

    # The event's fresh objects enter the model via their START activity;
    # they continue the canonical numbering of the preset objects.
    fresh_objects = [
        (len(preset_types) + k, object_type)
        for k, object_type in enumerate(fresh_types)
    ]
    try:
        event_states = _apply_starts(occn, states, fresh_objects, max_states)
    except _ReplayCapped:
        return None

    behavior: Set = set()
    for state in event_states:
        behavior |= _enabled_behavior(occn, state, granularity, enabled_cache)
    return frozenset(behavior)


# Sentinel marking a replay that exceeded the max_states cap.
_CAPPED = object()


class _StateFront:
    """
    A set of states pruned to the antichain of maximal states (w.r.t.
    multiset inclusion of the pending obligations).

    Both the enabled behavior and the replayability of a state are
    monotone: a state with more pending obligations enables every binding
    a dominated state enables, and executing the same binding preserves
    the domination. Therefore, dominated states can never contribute
    behavior or replays beyond their dominating states, and dropping them
    is exact. This collapses the combinatorial explosion of obligation
    routing choices that only differ in producing fewer obligations.

    States are stored with a flattened obligation dict, their total
    obligation count and a hash: a state can only be dominated by a state
    with strictly more obligations (equal counts allow only equality), so
    most domination checks reduce to an integer or hash comparison.
    """

    def __init__(self, max_states: Optional[int]):
        # entries are tuples (state, size, flat, hash)
        self._entries: List[Tuple[OCCausalNetState, int, Dict, int]] = []
        self.__max_states = max_states

    @property
    def states(self) -> List[OCCausalNetState]:
        return [entry[0] for entry in self._entries]

    def add(self, state: OCCausalNetState) -> None:
        flat: Dict[Tuple, int] = {}
        size = 0
        for act, counter in state.items():
            for obligation, count in counter.items():
                flat[(act, obligation)] = count
                size += count
        state_hash = hash(frozenset(flat.items()))

        for _, other_size, other_flat, other_hash in self._entries:
            if size < other_size:
                if all(
                    other_flat.get(key, 0) >= count
                    for key, count in flat.items()
                ):
                    return  # dominated by an existing state
            elif size == other_size:
                if state_hash == other_hash and flat == other_flat:
                    return  # duplicate
        self._entries = [
            entry
            for entry in self._entries
            if not (
                entry[1] < size
                and all(flat.get(key, 0) >= count for key, count in entry[2].items())
            )
        ]
        self._entries.append((state, size, flat, state_hash))
        if self.__max_states is not None and len(self._entries) > self.__max_states:
            raise _ReplayCapped()

    def __iter__(self):
        return iter(self.states)

    def __bool__(self):
        return bool(self._entries)


def _replay_preset(
    occn: OCCausalNet,
    sequence: Tuple[Tuple[str, Tuple[int, ...]], ...],
    preset_types: Tuple[str, ...],
    max_states: Optional[int],
) -> Optional[List[OCCausalNetState]]:
    """
    Replays a canonical preset sequence on the OCCN, exploring all binding
    choices. Every object is started (START binding) right before its
    first event: START bindings commute with the bindings of unrelated
    events, so this reaches the same states as starting all objects up
    front, but lets the first event of an object immediately rule out
    START choices that do not enable it. Returns the maximal reachable
    states (see `_StateFront`), or None if the preset cannot be replayed
    at all.
    """
    front = _apply_starts(occn, [OCCausalNetState()], [], max_states)
    started: Set[int] = set()

    for activity, objects in sequence:
        to_start = [
            (obj, preset_types[obj]) for obj in objects if obj not in started
        ]
        if to_start:
            front = _apply_starts(occn, front, to_start, max_states)
            if not front:
                return None
            started.update(obj for obj, _ in to_start)
        front = _apply_event(occn, front, activity, objects, max_states)
        if not front:
            return None
    return front.states


def _iter_bits(mask: int):
    """Yields the positions of the set bits of a mask in increasing order."""
    while mask:
        lowest_bit = mask & -mask
        yield lowest_bit.bit_length() - 1
        mask ^= lowest_bit


def _apply_starts(
    occn: OCCausalNet,
    states: Iterable[OCCausalNetState],
    objects_with_types: Iterable[Tuple[int, str]],
    max_states: Optional[int],
) -> "_StateFront":
    """
    Executes one START binding per object on every state, exploring all
    output binding choices of the START activity. Returns an empty front
    if some object cannot be started (e.g., its type is not part of the
    model).
    """
    front = _StateFront(max_states)
    for state in states:
        front.add(state)
    for obj, object_type in objects_with_types:
        start_activity = f"START_{object_type}"
        if start_activity not in occn.activities:
            return _StateFront(max_states)
        bindings = OCCausalNetSemantics.enabled_bindings_start_activity(
            occn, start_activity, object_type, {obj}
        )
        if not bindings:
            return _StateFront(max_states)
        next_front = _StateFront(max_states)
        for state in front:
            for binding in bindings:
                next_front.add(
                    OCCausalNetSemantics.bind_activity(binding, state)
                )
        front = next_front
    return front


def _apply_event(
    occn: OCCausalNet,
    states: Iterable[OCCausalNetState],
    activity: str,
    objects: Tuple[int, ...],
    max_states: Optional[int],
) -> "_StateFront":
    """
    Executes one observed event on every state, exploring all bindings of
    the event's activity that involve exactly the event's objects.
    """
    next_front = _StateFront(max_states)
    if activity not in occn.activities or activity.startswith("START_"):
        return next_front
    event_objects = frozenset(objects)

    binding_cache: Dict[FrozenSet, Tuple] = {}
    for state in states:
        # Bindings only depend on the obligations toward the activity that
        # involve the event's objects; cache them across states.
        # .get avoids materializing empty defaultdict entries in the state.
        obligations = state.get(activity)
        restricted_obligations = Counter(
            {
                obligation: count
                for obligation, count in (obligations or {}).items()
                if obligation[1] in event_objects
            }
        )
        cache_key = frozenset(restricted_obligations.keys())
        if cache_key in binding_cache:
            bindings = binding_cache[cache_key]
        else:
            restricted_state = OCCausalNetState(
                {activity: restricted_obligations}
            )
            bindings = OCCausalNetSemantics.enabled_bindings_for_objects(
                occn, activity, restricted_state, event_objects
            )
            binding_cache[cache_key] = bindings
        for binding in bindings:
            next_front.add(OCCausalNetSemantics.bind_activity(binding, state))
    return next_front


def _enabled_behavior(
    occn: OCCausalNet,
    state: OCCausalNetState,
    granularity: str,
    enabled_cache: Dict[Tuple, FrozenSet],
) -> FrozenSet:
    """
    The visible behavior the OCCN enables in a state: the set of enabled
    activities (granularity "activity") or of (activity, object-type count
    profile) pairs of all enabled bindings (granularity "profile").
    Artificial START and END activities are excluded; they carry no
    observable behavior.
    """
    behavior: Set = set()
    for act in occn.activities:
        if act.startswith("START_") or act.startswith("END_"):
            continue
        obligations = state.get(act)
        if not obligations:
            continue
        cache_key = (act, frozenset(obligations.keys()))
        if cache_key not in enabled_cache:
            enabled_cache[cache_key] = _enabled_behavior_for_activity(
                occn, act, obligations, granularity
            )
        behavior |= enabled_cache[cache_key]
    return frozenset(behavior)


def _enabled_behavior_for_activity(
    occn: OCCausalNet,
    act: str,
    obligations: Counter,
    granularity: str,
) -> FrozenSet:
    """
    The enabled behavior a single activity contributes given the
    obligations toward it. An activity is enabled iff a complete binding
    (input and output marker group) exists for it.
    """
    activity_state = OCCausalNetState({act: Counter(obligations)})
    # Cheap necessary condition before enumerating bindings.
    if not OCCausalNetSemantics.is_enabled(occn, act, activity_state):
        return frozenset()
    bindings = OCCausalNetSemantics.enabled_bindings(occn, act, activity_state)
    if not bindings:
        return frozenset()
    if granularity == GRANULARITY_ACTIVITY:
        return frozenset({act})
    profiles = set()
    for binding in bindings:
        _, consumed, _ = binding
        # An object may be consumed from several predecessors at once;
        # count distinct objects per type, like the log-side profile does.
        objects_per_type: Dict[str, Set[str]] = defaultdict(set)
        for _, type_object_pairs in consumed:
            for object_type, objects in type_object_pairs:
                objects_per_type[object_type].update(objects)
        profile = tuple(
            sorted((ot, len(objs)) for ot, objs in objects_per_type.items())
        )
        profiles.add((act, profile))
    return frozenset(profiles)
