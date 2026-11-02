"""Flattened token-based replay on Object-Centric Petri Nets ("OCPN flattened replay").

The object-centric Petri net is split into one ordinary Petri net per object
type and every object of the log is replayed as its own case on the net of
its type — classical token-based replay (van der Aalst, *Process Mining: Data
Science in Action*, Section 8.2) applied to the flattened logs. The results
are reported back on the places of the combined object-centric model, so the
deviations of all object types can be inspected in one picture.

Projection of the OCPN onto an object type ``ot``
    * places: the places whose object type is ``ot``;
    * arcs: the arcs that connect such a place with a transition;
    * transitions: the transitions with at least one such arc — every other
      transition (and every place / arc of another type) is ignored;
    * initial places: the places of type ``ot`` flagged ``initial``; when the
      model flags none, the places of type ``ot`` without an incoming arc;
    * final places: the places of type ``ot`` without an outgoing arc of type
      ``ot``; when that set is empty (e.g. the sink lies on a cycle), the
      places of type ``ot`` flagged ``final``.

Variable arcs consume / produce exactly one token in the projection: after
flattening, every object is a separate case, so a variable arc behaves like a
normal arc for a single object.

Replay of one object (the activities of its events ordered by timestamp, ties
broken by event id — the same flattening the OCPN discovery uses)
    1. One token is produced in every initial place (``p``).
    2. For every activity, the (unique) visible transition with that label is
       fired: if an input place lacks a token, a *backward search* over silent
       transitions is attempted first (see :func:`_silent_search`); tokens
       that are still missing afterwards are created artificially and counted
       as missing (``m``). Firing consumes one token per input arc (``c``) and
       produces one per output arc (``p``).
       Activities without a transition in the projected net are skipped and
       reported separately (``unmapped_activities``); they do not change the
       token counts.
    3. At the end the same silent-transition search tries to mark the final
       places, then one token is consumed from every final place (missing
       tokens are again counted). All tokens left behind are remaining
       (``r``).

Fitness of an object type (all objects together, as in the book):
``0.5 * (1 - m / c) + 0.5 * (1 - r / p)``. The overall fitness is the
unweighted average over the object types that have at least one object.

Labels of visible transitions must be unique: with duplicate labels the
choice of the transition to fire would itself require a search, which this
replay does not implement. :class:`DuplicateTransitionLabelError` is raised
instead.
"""

from __future__ import annotations

from collections import Counter, deque
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from ..progress import as_progress

#: Upper bound on the markings the silent-transition search explores per
#: blocked step. Hitting it means "no silent path found" (tokens are then
#: counted as missing) and is reported in the result.
DEFAULT_MAX_SILENT_SEARCH_STATES = 2_000

_FINAL = "__final__"


class DuplicateTransitionLabelError(ValueError):
    """The OCPN has several visible transitions with the same label."""

    def __init__(self, labels: Sequence[str]):
        self.labels = list(labels)
        quoted = ", ".join(f'"{label}"' for label in self.labels)
        super().__init__(
            "OCPN flattened replay requires unique labels for non-silent "
            f"transitions, but these labels occur on several transitions: {quoted}. "
            "Rename the transitions (or make them silent) so that every "
            "activity label is used by at most one transition."
        )


class InvalidOCPNError(ValueError):
    """The OCPN model dictionary is malformed."""


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------


@dataclass
class PlaceReplayStats:
    place_id: str
    object_type: str
    produced: int = 0
    consumed: int = 0
    missing: int = 0
    remaining: int = 0

    @property
    def deviation(self) -> float:
        """Share of the tokens through this place that were missing or remained.

        Every token in a place was either produced or artificially added
        (missing) and is either consumed or remaining, so
        ``produced + missing == consumed + remaining``. The ratio is 0 for a
        place without problems and 1 if no token flowed through it correctly.
        """
        flow = self.produced + self.missing
        if flow == 0:
            return 0.0
        return min(1.0, (self.missing + self.remaining) / flow)

    def to_dict(self) -> dict:
        return {
            "place_id": self.place_id,
            "object_type": self.object_type,
            "produced": self.produced,
            "consumed": self.consumed,
            "missing": self.missing,
            "remaining": self.remaining,
            "deviation": self.deviation,
        }


@dataclass
class ObjectTypeReplayResult:
    object_type: str
    num_objects: int = 0
    num_variants: int = 0
    fitting_objects: int = 0
    produced: int = 0
    consumed: int = 0
    missing: int = 0
    remaining: int = 0
    #: Activity -> number of events skipped because the projected net has no
    #: transition with that label.
    unmapped_activities: Dict[str, int] = field(default_factory=dict)
    #: How often the silent-transition search stopped at its state bound.
    silent_search_limit_hits: int = 0
    warnings: List[str] = field(default_factory=list)

    @property
    def fitness(self) -> Optional[float]:
        if self.num_objects == 0:
            return None
        return _fitness(self.produced, self.consumed, self.missing, self.remaining)

    def to_dict(self) -> dict:
        return {
            "object_type": self.object_type,
            "fitness": self.fitness,
            "num_objects": self.num_objects,
            "num_variants": self.num_variants,
            "fitting_objects": self.fitting_objects,
            "produced": self.produced,
            "consumed": self.consumed,
            "missing": self.missing,
            "remaining": self.remaining,
            "unmapped_activities": dict(
                sorted(self.unmapped_activities.items(), key=lambda kv: (-kv[1], kv[0]))
            ),
            "silent_search_limit_hits": self.silent_search_limit_hits,
            "warnings": list(self.warnings),
        }


@dataclass
class FlattenedReplayResult:
    object_types: List[ObjectTypeReplayResult]
    places: Dict[str, PlaceReplayStats]
    #: Object types of the log that the model does not contain (not replayed).
    log_object_types_not_in_model: List[str] = field(default_factory=list)

    @property
    def average_fitness(self) -> Optional[float]:
        values = [r.fitness for r in self.object_types if r.fitness is not None]
        if not values:
            return None
        return sum(values) / len(values)

    def to_dict(self) -> dict:
        return {
            "average_fitness": self.average_fitness,
            "object_types": [r.to_dict() for r in self.object_types],
            "places": [stats.to_dict() for stats in self.places.values()],
            "log_object_types_not_in_model": list(self.log_object_types_not_in_model),
        }


def _fitness(produced: int, consumed: int, missing: int, remaining: int) -> float:
    missing_term = 1.0 - missing / consumed if consumed > 0 else 1.0
    remaining_term = 1.0 - remaining / produced if produced > 0 else 1.0
    return 0.5 * missing_term + 0.5 * remaining_term


# ---------------------------------------------------------------------------
# Projection of the OCPN onto one object type
# ---------------------------------------------------------------------------


def _is_silent(transition: Mapping) -> bool:
    label = transition.get("label")
    return bool(transition.get("silent")) or label is None or str(label).strip() == ""


def check_unique_labels(model: Mapping) -> None:
    """Raise :class:`DuplicateTransitionLabelError` for duplicate visible labels."""
    seen: Counter = Counter()
    for transition in model.get("transitions") or []:
        if not _is_silent(transition):
            seen[str(transition["label"])] += 1
    duplicates = sorted(label for label, count in seen.items() if count > 1)
    if duplicates:
        raise DuplicateTransitionLabelError(duplicates)


@dataclass
class _TypeNet:
    object_type: str
    places: List[str]
    pre: Dict[str, Counter]  # transition -> input places (place -> arc count)
    post: Dict[str, Counter]  # transition -> output places
    transition_by_label: Dict[str, str]
    silent: List[str]
    silent_producers: Dict[str, List[str]]  # place -> silent transitions producing into it
    initial: List[str]
    final: List[str]
    warnings: List[str]


def _project(model: Mapping, object_type: str) -> _TypeNet:
    places = [
        str(p["id"]) for p in model.get("places") or [] if p.get("objectType") == object_type
    ]
    place_set = set(places)
    place_flags = {
        str(p["id"]): p for p in model.get("places") or [] if str(p.get("id")) in place_set
    }
    transitions = {str(t["id"]): t for t in model.get("transitions") or []}

    pre: Dict[str, Counter] = {}
    post: Dict[str, Counter] = {}
    has_incoming: set = set()
    has_outgoing: set = set()
    for arc in model.get("arcs") or []:
        source, target = str(arc.get("source")), str(arc.get("target"))
        if source in place_set and target in transitions:
            pre.setdefault(target, Counter())[source] += 1
            has_outgoing.add(source)
        elif target in place_set and source in transitions:
            post.setdefault(source, Counter())[target] += 1
            has_incoming.add(target)

    connected = set(pre) | set(post)
    transition_by_label: Dict[str, str] = {}
    silent: List[str] = []
    for tid in sorted(connected):
        transition = transitions[tid]
        if _is_silent(transition):
            silent.append(tid)
        else:
            transition_by_label[str(transition["label"])] = tid
        pre.setdefault(tid, Counter())
        post.setdefault(tid, Counter())

    silent_producers: Dict[str, List[str]] = {}
    for tid in silent:
        for place in post[tid]:
            silent_producers.setdefault(place, []).append(tid)

    warnings: List[str] = []
    initial = [p for p in places if place_flags[p].get("initial")]
    if not initial:
        initial = [p for p in places if p not in has_incoming]
        if initial:
            warnings.append(
                "No place is marked as initial; places without incoming arcs "
                "are used as start places."
            )
    final = [p for p in places if p not in has_outgoing]
    if not final:
        final = [p for p in places if place_flags[p].get("final")]
        if final:
            warnings.append(
                "Every place has an outgoing arc; the places marked as final "
                "are used as end places."
            )
    if places and not initial:
        warnings.append("The net of this object type has no start place.")
    if places and not final:
        warnings.append("The net of this object type has no end place.")

    return _TypeNet(
        object_type=object_type,
        places=places,
        pre=pre,
        post=post,
        transition_by_label=transition_by_label,
        silent=silent,
        silent_producers=silent_producers,
        initial=initial,
        final=final,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Token-based replay of one trace
# ---------------------------------------------------------------------------


def _marking_key(marking: Counter) -> Tuple[Tuple[str, int], ...]:
    return tuple(sorted((p, n) for p, n in marking.items() if n > 0))


def _satisfies(marking: Mapping[str, int], required: Mapping[str, int]) -> bool:
    return all(marking.get(p, 0) >= n for p, n in required.items())


class _SilentSearch:
    """Backward-guided search for silent transitions that enable a requirement.

    *Backward* step: starting from the places that lack tokens, walk the net
    backwards through silent transitions only (a place's silent producers,
    their input places, their silent producers, ...). Only the silent
    transitions found this way can help, so only they are considered.

    *Forward* step: a breadth-first search over the markings reachable from
    the current marking by firing those (enabled) silent transitions until a
    marking covers the requirement. Breadth-first search returns a shortest
    silent sequence, which keeps the side effects (tokens moved away from
    other places) minimal. The exploration is bounded by ``max_states``.
    """

    def __init__(self, net: _TypeNet, max_states: int):
        self.net = net
        self.max_states = max_states
        self.limit_hits = 0
        self._cache: Dict[tuple, Optional[Tuple[str, ...]]] = {}

    def _relevant(self, lacking: Iterable[str]) -> List[str]:
        relevant: set = set()
        frontier = deque(lacking)
        seen_places = set(frontier)
        while frontier:
            place = frontier.popleft()
            for tid in self.net.silent_producers.get(place, ()):
                if tid in relevant:
                    continue
                relevant.add(tid)
                for source in self.net.pre[tid]:
                    if source not in seen_places:
                        seen_places.add(source)
                        frontier.append(source)
        return sorted(relevant)

    def find(self, marking: Counter, required: Mapping[str, int]) -> Optional[Tuple[str, ...]]:
        lacking = [p for p, n in required.items() if marking.get(p, 0) < n]
        if not lacking or not self.net.silent:
            return None
        start = _marking_key(marking)
        cache_key = (start, tuple(sorted(required.items())))
        if cache_key in self._cache:
            return self._cache[cache_key]

        relevant = self._relevant(lacking)
        result: Optional[Tuple[str, ...]] = None
        if relevant:
            pre, post = self.net.pre, self.net.post
            queue = deque([(dict(start), ())])
            visited = {start}
            hit_limit = False
            while queue and result is None:
                current, path = queue.popleft()
                for tid in relevant:
                    if not _satisfies(current, pre[tid]):
                        continue
                    nxt = dict(current)
                    for p, n in pre[tid].items():
                        nxt[p] -= n
                    for p, n in post[tid].items():
                        nxt[p] = nxt.get(p, 0) + n
                    key = tuple(sorted((p, n) for p, n in nxt.items() if n > 0))
                    if key in visited:
                        continue
                    if _satisfies(nxt, required):
                        result = path + (tid,)
                        break
                    if len(visited) >= self.max_states:
                        hit_limit = True
                        continue
                    visited.add(key)
                    queue.append((nxt, path + (tid,)))
            if result is None and hit_limit:
                self.limit_hits += 1
        self._cache[cache_key] = result
        return result


@dataclass
class _TraceOutcome:
    produced: int
    consumed: int
    missing: int
    remaining: int
    place_produced: Counter
    place_consumed: Counter
    place_missing: Counter
    place_remaining: Counter
    unmapped: Counter


def _replay_trace(net: _TypeNet, search: _SilentSearch, trace: Sequence[str]) -> _TraceOutcome:
    marking: Counter = Counter()
    place_produced: Counter = Counter()
    place_consumed: Counter = Counter()
    place_missing: Counter = Counter()
    unmapped: Counter = Counter()

    def produce(places: Mapping[str, int]) -> None:
        for p, n in places.items():
            marking[p] += n
            place_produced[p] += n

    def consume(places: Mapping[str, int]) -> None:
        for p, n in places.items():
            lacking = n - marking[p]
            if lacking > 0:
                place_missing[p] += lacking
                marking[p] += lacking
            marking[p] -= n
            place_consumed[p] += n

    def enable(required: Mapping[str, int]) -> None:
        if _satisfies(marking, required):
            return
        sequence = search.find(marking, required)
        for tid in sequence or ():
            consume(net.pre[tid])
            produce(net.post[tid])

    produce(Counter(net.initial))
    for activity in trace:
        tid = net.transition_by_label.get(activity)
        if tid is None:
            unmapped[activity] += 1
            continue
        enable(net.pre[tid])
        consume(net.pre[tid])
        produce(net.post[tid])
    final = Counter(net.final)
    enable(final)
    consume(final)

    place_remaining = Counter({p: n for p, n in marking.items() if n > 0})
    return _TraceOutcome(
        produced=sum(place_produced.values()),
        consumed=sum(place_consumed.values()),
        missing=sum(place_missing.values()),
        remaining=sum(place_remaining.values()),
        place_produced=place_produced,
        place_consumed=place_consumed,
        place_missing=place_missing,
        place_remaining=place_remaining,
        unmapped=unmapped,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def model_object_types(model: Mapping) -> List[str]:
    """Object types of the model (declared types first, then types of places)."""
    names: List[str] = []
    for entry in model.get("objectTypes") or []:
        name = entry.get("name") if isinstance(entry, Mapping) else entry
        if isinstance(name, str) and name not in names:
            names.append(name)
    for place in model.get("places") or []:
        name = place.get("objectType")
        if isinstance(name, str) and name not in names:
            names.append(name)
    return names


def _validate_model(model: Mapping) -> None:
    if not isinstance(model, Mapping):
        raise InvalidOCPNError("The OCPN model must be a JSON object.")
    for key in ("places", "transitions", "arcs"):
        if not isinstance(model.get(key), list):
            raise InvalidOCPNError(f'The OCPN model has no "{key}" list.')
    for place in model["places"]:
        if not isinstance(place, Mapping) or "id" not in place:
            raise InvalidOCPNError("Every place needs an id.")
        if not isinstance(place.get("objectType"), str):
            raise InvalidOCPNError(f'Place "{place["id"]}" has no object type.')
    for transition in model["transitions"]:
        if not isinstance(transition, Mapping) or "id" not in transition:
            raise InvalidOCPNError("Every transition needs an id.")
    place_ids = {str(p["id"]) for p in model["places"]}
    transition_ids = {str(t["id"]) for t in model["transitions"]}
    overlap = place_ids & transition_ids
    if overlap:
        raise InvalidOCPNError(
            f"Ids used for both a place and a transition: {', '.join(sorted(overlap))}."
        )


def flattened_token_based_replay(
    model: Mapping,
    variants_by_type: Mapping[str, Mapping[Tuple[str, ...], int]],
    *,
    max_silent_search_states: int = DEFAULT_MAX_SILENT_SEARCH_STATES,
    log_object_types: Optional[Iterable[str]] = None,
    progress=None,
) -> FlattenedReplayResult:
    """Replay flattened traces on the per-object-type projections of ``model``.

    Args:
        model: OCPN in the repository's JSON format (``format: "ocpn"``).
        variants_by_type: object type -> {activity sequence: number of objects}.
            Object types of the model that are missing are treated as having
            no objects.
        max_silent_search_states: bound for the silent-transition search.
        log_object_types: all object types of the log, used only to report
            the ones the model does not cover.
        progress: optional progress callback (see :mod:`totem_lib.progress`).

    Raises:
        DuplicateTransitionLabelError: visible transition labels are not unique.
        InvalidOCPNError: the model is malformed.
    """
    _validate_model(model)
    check_unique_labels(model)
    report = as_progress(progress).report

    object_types = model_object_types(model)
    places: Dict[str, PlaceReplayStats] = {
        str(p["id"]): PlaceReplayStats(place_id=str(p["id"]), object_type=p["objectType"])
        for p in model["places"]
    }
    results: List[ObjectTypeReplayResult] = []

    for index, object_type in enumerate(object_types):
        report(index / max(1, len(object_types)), f"Replaying {object_type}")
        net = _project(model, object_type)
        type_result = ObjectTypeReplayResult(object_type=object_type, warnings=list(net.warnings))
        if not net.places:
            type_result.warnings.append("The model has no places of this object type.")
        search = _SilentSearch(net, max_silent_search_states)
        unmapped: Counter = Counter()
        variants = variants_by_type.get(object_type) or {}
        for trace, count in variants.items():
            if count <= 0:
                continue
            outcome = _replay_trace(net, search, trace)
            type_result.num_objects += count
            type_result.num_variants += 1
            type_result.produced += outcome.produced * count
            type_result.consumed += outcome.consumed * count
            type_result.missing += outcome.missing * count
            type_result.remaining += outcome.remaining * count
            if outcome.missing == 0 and outcome.remaining == 0 and not outcome.unmapped:
                type_result.fitting_objects += count
            for activity, n in outcome.unmapped.items():
                unmapped[activity] += n * count
            for p, n in outcome.place_produced.items():
                places[p].produced += n * count
            for p, n in outcome.place_consumed.items():
                places[p].consumed += n * count
            for p, n in outcome.place_missing.items():
                places[p].missing += n * count
            for p, n in outcome.place_remaining.items():
                places[p].remaining += n * count
        type_result.unmapped_activities = dict(unmapped)
        type_result.silent_search_limit_hits = search.limit_hits
        if search.limit_hits:
            type_result.warnings.append(
                f"The silent-transition search stopped at its bound of "
                f"{max_silent_search_states} markings {search.limit_hits} time(s); "
                "tokens in these situations were counted as missing."
            )
        results.append(type_result)

    report(1.0, "Replay finished")
    not_in_model = sorted(set(log_object_types or ()) - set(object_types))
    return FlattenedReplayResult(
        object_types=results,
        places=places,
        log_object_types_not_in_model=not_in_model,
    )


def flattened_token_based_replay_db(
    model: Mapping,
    ocel_db,
    *,
    max_silent_search_states: int = DEFAULT_MAX_SILENT_SEARCH_STATES,
    progress=None,
) -> FlattenedReplayResult:
    """:func:`flattened_token_based_replay` on an :class:`OcelDuckDB` log.

    The flattened traces per object type are computed in DuckDB and grouped
    into variants, so every distinct activity sequence is replayed once.
    """
    from .ocpn_db import _fetch_object_types, _fetch_variants

    _validate_model(model)
    check_unique_labels(model)
    report = as_progress(progress).report
    report(None, "Flattening the log per object type")
    log_types = _fetch_object_types(ocel_db)
    variants = {
        object_type: _fetch_variants(ocel_db, object_type)
        for object_type in model_object_types(model)
        if object_type in log_types
    }
    return flattened_token_based_replay(
        model,
        variants,
        max_silent_search_states=max_silent_search_states,
        log_object_types=log_types,
        progress=progress,
    )
