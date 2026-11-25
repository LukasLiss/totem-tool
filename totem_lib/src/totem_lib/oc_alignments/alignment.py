"""Optimal object-centric alignments (Liss, *Object-Centric Alignments*, ch. 4-5).

The method of the thesis builds a *synchronous product net* out of

1. the de-jure OCPN with its variable arcs unfolded for the number of objects
   per type of the execution (Def. 5.1),
2. the *process execution net* -- one place per object and position in its
   trace, one transition per event (Def. 5.3), and
3. synchronous transitions pairing an event with an equally labelled model
   transition that uses the same objects (Def. 5.4, the nu-net requirement
   of Def. 5.5),

and searches its state space for a cheapest binding sequence from the initial
to the final marking (Def. 5.6) with Dijkstra's algorithm. Moves cost
(Def. 4.5)

* ``0`` for a synchronous move,
* the number of objects for a log move or a visible model move,
* ``epsilon`` for a silent model move.

This module explores exactly that state space, but lazily and without
materialising the product net (Section 6.1 of the thesis does the same):

* a state is the marking of the de-jure part (``(place, object) -> count``)
  plus, per object, its position in its trace -- which *is* the marking of
  the process execution net;
* log moves fire an event whose objects are all at that event in their
  traces; model moves fire a binding of a model transition (variable arcs
  bind any set of objects of their type, which is what the unfolding of
  Def. 5.1 enumerates); synchronous moves fire both at once with the event's
  objects as the binding.

Costs are ``(deviation cost, number of silent moves)`` pairs, i.e. epsilon is
infinitesimal: a silent move never outweighs a deviation. The search is A*
on the deviation cost with an admissible, consistent heuristic (events that
can never be synchronous must become log moves), so the returned deviation
cost is optimal, exactly as with Dijkstra. Among equally cheap states the
search goes deepest into the log first and only then prefers fewer silent
moves -- ranking silent moves first would force it to enumerate every
interleaving of concurrent objects before it may take a single tau step.

The resulting binding sequence becomes the alignment (Def. 5.8, 5.9): one move
per binding, and an edge between two moves whenever an object is used by both
and by no move in between.
"""

from __future__ import annotations

import heapq
import itertools
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from .execution import ProcessExecution, ProjectionReport, project_execution
from .net import AlignmentNet, NetTransition, net_from_ocpn_dict

SYNC_MOVE = "sync"
LOG_MOVE = "log"
MODEL_MOVE = "model"

OPTIMAL = "optimal"
#: A valid alignment found by the fallback search; not guaranteed optimal.
APPROXIMATE = "approximate"
NO_ALIGNMENT = "no_alignment"
STATE_LIMIT = "state_limit"
TIMEOUT = "timeout"
EMPTY_EXECUTION = "empty_execution"

#: Default cap on the number of distinct search states (bounds memory).
DEFAULT_MAX_STATES = 200_000
DEFAULT_TIMEOUT_S = 60.0
#: Above this many bindings of one transition in one state, variable arcs are
#: no longer expanded to every subset (see ``OCAlignmentResult.exact``).
MAX_BINDINGS_PER_TRANSITION = 4_096
#: Hard cap on the bindings of one transition in one state.
MAX_ENUMERATED_BINDINGS = 20_000


class AlignmentCancelled(Exception):
    """Raised when ``should_cancel`` returns True during the search."""


@dataclass(frozen=True)
class AlignmentMove:
    """One move of an object-centric alignment (Def. 4.1)."""

    kind: str
    #: Index of the log event in the execution (``None`` for model moves).
    event_index: Optional[int]
    event_id: Optional[str]
    log_activity: Optional[str]
    timestamp_unix: Optional[float]
    transition_id: Optional[str]
    #: Activity of the model transition, ``None`` when silent or for log moves.
    model_activity: Optional[str]
    silent: bool
    #: Sorted ``(object type, object id)`` pairs used by the move.
    objects: Tuple[Tuple[str, str], ...]
    cost: int

    def objects_by_type(self) -> Dict[str, List[str]]:
        grouped: Dict[str, List[str]] = defaultdict(list)
        for object_type, obj in self.objects:
            grouped[object_type].append(obj)
        return dict(grouped)

    def to_dict(self, index: int) -> dict:
        has_log = self.kind in (SYNC_MOVE, LOG_MOVE)
        has_model = self.kind in (SYNC_MOVE, MODEL_MOVE)
        by_type = self.objects_by_type()
        return {
            "index": index,
            "kind": self.kind,
            "silent": self.silent,
            "cost": self.cost,
            "event_index": self.event_index,
            "event_id": self.event_id,
            "timestamp_unix": self.timestamp_unix,
            "log_activity": self.log_activity,
            "log_objects": by_type if has_log else {},
            "transition_id": self.transition_id,
            "model_activity": self.model_activity,
            "model_objects": by_type if has_model else {},
        }


@dataclass
class OCAlignmentResult:
    """Outcome of :func:`compute_oc_alignment`."""

    status: str
    execution: ProcessExecution
    projection: ProjectionReport = field(default_factory=ProjectionReport)
    cost: Optional[int] = None
    moves: List[AlignmentMove] = field(default_factory=list)
    edges: List[Tuple[int, int]] = field(default_factory=list)
    states_explored: int = 0
    states_queued: int = 0
    elapsed_ms: float = 0.0
    message: str = ""
    #: Activities of the execution no transition of the model is labelled with.
    unknown_activities: Tuple[str, ...] = ()
    #: Concrete reasons why no alignment exists (see :func:`diagnose_no_alignment`).
    diagnostics: Tuple[str, ...] = ()
    #: False when variable arcs had too many objects to try every subset in
    #: model moves; the alignment is valid but its cost only an upper bound.
    exact: bool = True
    #: Transitions whose model-move bindings were restricted (``exact=False``).
    restricted_transitions: Tuple[str, ...] = ()
    #: Admissible lower bound of the optimal cost (see ``_Search._heuristic``).
    lower_bound: Optional[int] = None

    @property
    def found(self) -> bool:
        return self.status in (OPTIMAL, APPROXIMATE)

    def move_counts(self) -> Dict[str, int]:
        counts = Counter()
        for move in self.moves:
            if move.kind == MODEL_MOVE and move.silent:
                counts["silent"] += 1
            else:
                counts[move.kind] += 1
        return {k: counts.get(k, 0) for k in (SYNC_MOVE, LOG_MOVE, MODEL_MOVE, "silent")}

    def deviations_by_activity(self) -> List[dict]:
        per: Dict[str, Counter] = defaultdict(Counter)
        for move in self.moves:
            if move.kind == LOG_MOVE:
                per[move.log_activity or ""]["log"] += 1
            elif move.kind == MODEL_MOVE and not move.silent:
                per[move.model_activity or ""]["model"] += 1
            elif move.kind == SYNC_MOVE:
                per[move.log_activity or ""]["sync"] += 1
        rows = [
            {
                "activity": activity,
                "sync": counts.get("sync", 0),
                "log": counts.get("log", 0),
                "model": counts.get("model", 0),
            }
            for activity, counts in per.items()
        ]
        rows.sort(key=lambda r: (-(r["log"] + r["model"]), r["activity"]))
        return rows

    def deviations_by_object(self) -> List[dict]:
        per: Dict[Tuple[str, str], Counter] = defaultdict(Counter)
        for move in self.moves:
            if move.kind == MODEL_MOVE and move.silent:
                continue
            for pair in move.objects:
                per[pair][move.kind] += 1
        rows = [
            {
                "object_type": ot,
                "object_id": obj,
                "sync": c.get(SYNC_MOVE, 0),
                "log": c.get(LOG_MOVE, 0),
                "model": c.get(MODEL_MOVE, 0),
            }
            for (ot, obj), c in per.items()
        ]
        rows.sort(key=lambda r: (-(r["log"] + r["model"]), r["object_type"], r["object_id"]))
        return rows

    def to_dict(self) -> dict:
        counts = self.move_counts()
        event_count = len(self.execution.events)
        return {
            "status": self.status,
            "message": self.message,
            "cost": self.cost,
            "exact": self.exact,
            "lower_bound": self.lower_bound,
            "restricted_transitions": list(self.restricted_transitions),
            "moves": [move.to_dict(i) for i, move in enumerate(self.moves)],
            "edges": [list(edge) for edge in self.edges],
            "move_counts": counts,
            "synchronous_event_ratio": (
                counts[SYNC_MOVE] / event_count if self.found and event_count else None
            ),
            "deviations_by_activity": self.deviations_by_activity(),
            "deviations_by_object": self.deviations_by_object(),
            "unknown_activities": list(self.unknown_activities),
            "diagnostics": list(self.diagnostics),
            "states_explored": self.states_explored,
            "states_queued": self.states_queued,
            "elapsed_ms": round(self.elapsed_ms, 1),
            "execution": self.execution.to_dict(),
            "projection": self.projection.to_dict(),
        }


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


class _Search:
    """State-space exploration of the synchronous product (see module doc)."""

    def __init__(self, net: AlignmentNet, execution: ProcessExecution):
        self.net = net
        self.execution = execution
        type_by_object = execution.object_types_by_object
        self.objects: List[str] = sorted(type_by_object)
        self.object_type: List[str] = [type_by_object[o] for o in self.objects]
        index = {obj: i for i, obj in enumerate(self.objects)}
        self.objects_of_type: Dict[str, Tuple[int, ...]] = defaultdict(tuple)
        grouped: Dict[str, List[int]] = defaultdict(list)
        for i, ot in enumerate(self.object_type):
            grouped[ot].append(i)
        self.objects_of_type.update({ot: tuple(v) for ot, v in grouped.items()})

        # Log part: per event its objects (indices) and, per object, the
        # position this event has in the object's trace.
        self.events = execution.events
        traces: Dict[int, List[int]] = defaultdict(list)
        self.event_objects: List[Tuple[int, ...]] = []
        for e_index, event in enumerate(self.events):
            objs = tuple(sorted(index[obj] for _, obj in event.objects))
            self.event_objects.append(objs)
            for o in objs:
                traces[o].append(e_index)
        self.trace_length = tuple(len(traces[o]) for o in range(len(self.objects)))
        self.event_position: List[Dict[int, int]] = [dict() for _ in self.events]
        for o, indices in traces.items():
            for position, e_index in enumerate(indices):
                self.event_position[e_index][o] = position
        self.trace_events: Dict[int, List[int]] = dict(traces)

        # Event -> model transitions it may be synchronous with (structurally).
        self.sync_candidates: List[Tuple[int, ...]] = []
        for e_index, event in enumerate(self.events):
            candidates = []
            for t_index in net.transitions_by_label.get(event.activity, ()):
                if self._sync_compatible(net.transitions[t_index], e_index):
                    candidates.append(t_index)
            self.sync_candidates.append(tuple(candidates))
        self.unsyncable = [i for i, c in enumerate(self.sync_candidates) if not c]

        # Object groups per (activity, object type) as observed in the log:
        # the candidate subsets for variable arcs when enumerating every
        # subset is infeasible (see `_model_bindings`).
        self.log_groups: Dict[Tuple[str, str], set] = defaultdict(set)
        for e_index, event in enumerate(self.events):
            grouped: Dict[str, List[int]] = defaultdict(list)
            for o in self.event_objects[e_index]:
                grouped[self.object_type[o]].append(o)
            for ot, objs in grouped.items():
                self.log_groups[(event.activity, ot)].add(tuple(sorted(objs)))
        #: Set when a restricted binding family was used (result may be suboptimal).
        self.restricted_transitions: set = set()

        # Initial / final marking of the de-jure part.
        initial: Counter = Counter()
        final: Counter = Counter()
        for o, ot in enumerate(self.object_type):
            for p in net.initial_places.get(ot, ()):
                initial[(p, o)] += 1
            for p in net.final_places.get(ot, ()):
                final[(p, o)] += 1
        self._n_objects = max(1, len(self.objects))
        self.initial_marking = self._freeze(initial)
        self.final_marking = self._freeze(final)
        self.initial_positions = tuple(0 for _ in self.objects)
        self.final_positions = self.trace_length
        self._build_object_bounds()

    # -- per-object lower bound -----------------------------------------

    def _build_object_bounds(self) -> None:
        """Exact flattened alignment costs per object, used as A* heuristic.

        Projected onto one object, an object-centric alignment is a classical
        alignment of the object's trace with the sub-net of its type: the
        object's tokens only move through places of its type, and a move costs
        one per object it involves. The sum over the objects of their optimal
        remaining flattened costs therefore never overestimates (and is
        consistent). Each object's table maps ``(its places, trace position)``
        to that remaining cost; a missing entry means the object can no longer
        reach its final places, so the state is a dead end.

        Types whose sub-net has too many reachable markings, and objects whose
        product space is too large, contribute nothing (``None`` table).
        """
        self.object_bounds: List[Optional[Dict[Tuple[Tuple[int, ...], int], int]]] = []
        per_type = {}
        cache: Dict[Tuple[str, Tuple[str, ...]], Optional[dict]] = {}
        for o, ot in enumerate(self.object_type):
            if ot not in per_type:
                per_type[ot] = self._type_net_graph(ot)
            graph = per_type[ot]
            activities = tuple(self.events[e].activity for e in self.trace_events.get(o, ()))
            key = (ot, activities)
            if key not in cache:
                cache[key] = None if graph is None else self._backward_costs(graph, activities)
            self.object_bounds.append(cache[key])

    _MAX_TYPE_MARKINGS = 2_000
    _MAX_OBJECT_STATES = 200_000

    def _type_net_graph(self, ot: str):
        """Reachable markings of the type-``ot`` sub-net for a single object."""
        transitions = [
            (tuple(t.inputs.get(ot, ())), tuple(t.outputs.get(ot, ())), t.label)
            for t in self.net.transitions
            if ot in t.object_types
        ]
        initial = tuple(sorted(self.net.initial_places.get(ot, ())))
        final = tuple(sorted(self.net.final_places.get(ot, ())))
        seen = {initial}
        frontier = [initial]
        reverse: Dict[Tuple[int, ...], List[Tuple[Tuple[int, ...], Optional[str]]]] = defaultdict(list)
        while frontier:
            marking = frontier.pop()
            counts = Counter(marking)
            for ins, outs, label in transitions:
                if any(counts[p] < 1 for p in ins):
                    continue
                nxt = counts.copy()
                nxt.subtract(ins)
                nxt.update(outs)
                successor = tuple(sorted(p for p, c in nxt.items() for _ in range(c) if c > 0))
                reverse[successor].append((marking, label))
                if successor not in seen:
                    if len(seen) >= self._MAX_TYPE_MARKINGS:
                        return None
                    seen.add(successor)
                    frontier.append(successor)
        return final, reverse

    def _backward_costs(self, graph, activities: Tuple[str, ...]):
        final, reverse = graph
        length = len(activities)
        if len(reverse) * (length + 1) > self._MAX_OBJECT_STATES:
            return None
        dist: Dict[Tuple[Tuple[int, ...], int], int] = {(final, length): 0}
        heap = [(0, final, length)]
        while heap:
            d, marking, i = heapq.heappop(heap)
            if dist.get((marking, i), d + 1) < d:
                continue

            def relax(node, cost):
                if cost < dist.get(node, cost + 1):
                    dist[node] = cost
                    heapq.heappush(heap, (cost, node[0], node[1]))

            if i > 0:
                relax((marking, i - 1), d + 1)  # log move
            for previous, label in reverse.get(marking, ()):
                relax((previous, i), d + (0 if label is None else 1))  # model move
                if i > 0 and label is not None and label == activities[i - 1]:
                    relax((previous, i - 1), d)  # synchronous move
        return dist

    # -- helpers ---------------------------------------------------------

    def _freeze(self, marking: Mapping[Tuple[int, int], int]) -> Tuple[int, ...]:
        """Compact hashable marking: one int ``place * n + object`` per token."""
        n = self._n_objects
        return tuple(
            sorted(p * n + o for (p, o), c in marking.items() for _ in range(c) if c > 0)
        )

    def _thaw(self, frozen: Tuple[int, ...]) -> Dict[Tuple[int, int], int]:
        n = self._n_objects
        marking: Dict[Tuple[int, int], int] = {}
        for code in frozen:
            key = divmod(code, n)
            marking[key] = marking.get(key, 0) + 1
        return marking

    def _sync_compatible(self, t: NetTransition, e_index: int) -> bool:
        event = self.events[e_index]
        counts = Counter(ot for ot, _ in event.objects)
        tpl = set(t.object_types)
        if not set(counts) <= tpl:
            return False
        for ot in t.regular_types:
            if counts.get(ot, 0) != 1:
                return False
        return True

    def _heuristic(self, marking_t: Tuple[int, ...], positions: Tuple[int, ...]) -> Optional[int]:
        """Admissible remaining cost, ``None`` when the goal is unreachable.

        The maximum of (a) the objects of remaining events that can never be
        synchronous and (b) the sum of the per-object flattened costs.
        """
        unsyncable = 0
        for e_index in self.unsyncable:
            objs = self.event_objects[e_index]
            o = objs[0]
            if positions[o] <= self.event_position[e_index][o]:
                unsyncable += len(objs)
        places: Dict[int, List[int]] = defaultdict(list)
        n = self._n_objects
        for code in marking_t:
            p, o = divmod(code, n)
            places[o].append(p)
        flattened = 0
        for o, table in enumerate(self.object_bounds):
            if table is None:
                continue
            cost = table.get((tuple(places.get(o, ())), positions[o]))
            if cost is None:
                return None
            flattened += cost
        return max(unsyncable, flattened)

    def _log_enabled(self, positions: Tuple[int, ...], e_index: int) -> bool:
        return all(positions[o] == self.event_position[e_index][o] for o in self.event_objects[e_index])

    def _enabled_events(self, positions: Tuple[int, ...]) -> List[int]:
        candidates = set()
        for o, pos in enumerate(positions):
            if pos < self.trace_length[o]:
                candidates.add(self.trace_events[o][pos])
        return sorted(e for e in candidates if self._log_enabled(positions, e))

    @staticmethod
    def _binding_enabled(marking: Mapping, t: NetTransition, binding: Mapping[str, Tuple[int, ...]]) -> bool:
        for ot, places in t.inputs.items():
            for o in binding.get(ot, ()):
                for p in places:
                    if marking.get((p, o), 0) < 1:
                        return False
        return True

    @staticmethod
    def _fire(marking: Mapping, t: NetTransition, binding: Mapping[str, Tuple[int, ...]]):
        nxt = dict(marking)
        for ot, places in t.inputs.items():
            for o in binding.get(ot, ()):
                for p in places:
                    c = nxt[(p, o)] - 1
                    if c:
                        nxt[(p, o)] = c
                    else:
                        del nxt[(p, o)]
        for ot, places in t.outputs.items():
            for o in binding.get(ot, ()):
                for p in places:
                    nxt[(p, o)] = nxt.get((p, o), 0) + 1
        return nxt

    def _model_bindings(self, marking: Mapping, t: NetTransition):
        """Every enabled binding of ``t`` (Def. 3.6 with unfolded variable arcs)."""
        options_per_type = []
        types = t.object_types
        for ot in types:
            places = t.inputs.get(ot, ())
            objs = self.objects_of_type.get(ot, ())
            if places:
                candidates = tuple(
                    o for o in objs if all(marking.get((p, o), 0) >= 1 for p in places)
                )
            else:
                candidates = objs
            if ot in t.variable_types:
                options = candidates  # expanded to subsets below, once bounded
            else:
                if not candidates:
                    return
                options = candidates
            options_per_type.append((ot in t.variable_types, options))
        # Bound the enumeration before materialising anything: a variable arc
        # over k candidate objects offers 2^k subsets.
        total = 1
        for variable, options in options_per_type:
            total *= (1 << len(options)) if variable else len(options)
            if total > MAX_BINDINGS_PER_TRANSITION:
                break
        if total <= MAX_BINDINGS_PER_TRANSITION:
            options_per_type = [
                [
                    combo
                    for size in range(len(options) + 1)
                    for combo in itertools.combinations(options, size)
                ]
                if variable
                else [(o,) for o in options]
                for variable, options in options_per_type
            ]
        else:
            # Too many subsets to enumerate: offer the empty set, every single
            # object, all candidates at once, and the groups of this type the
            # log records for the transition's activity. Model moves stay
            # valid, but the alignment is no longer guaranteed to be optimal.
            self.restricted_transitions.add(t.label or t.id)
            restricted = []
            for (variable, options), ot in zip(options_per_type, types):
                if not variable:
                    restricted.append([(o,) for o in options])
                    continue
                allowed = set(options)
                family = {(), tuple(options)}
                family.update((o,) for o in options)
                for group in self.log_groups.get((t.label, ot), ()):
                    subset = tuple(o for o in group if o in allowed)
                    if subset:
                        family.add(subset)
                restricted.append(sorted(family, key=lambda c: (len(c), c)))
            options_per_type = restricted
        produced = 0
        for combo in itertools.product(*options_per_type):
            if not any(combo):
                continue  # a binding must use at least one object
            produced += 1
            if produced > MAX_ENUMERATED_BINDINGS:
                raise _BindingExplosion(t.label or t.id)
            if produced % 512 == 0:
                self._check_limits()
            yield dict(zip(types, combo))

    # -- main loop -------------------------------------------------------

    def run(
        self,
        *,
        max_states: int,
        timeout_s: Optional[float],
        should_cancel: Optional[Callable[[], bool]],
        progress: Optional[Callable[[Optional[float], str], None]],
        greedy: bool = False,
    ):
        """Search a cheapest path; ``greedy`` trades optimality for speed.

        The greedy (best-first) mode ranks states by ``cost + h - log
        progress``: a synchronous move pays off immediately, a log move is
        neutral and a model move has to enable later synchronous moves to pay
        off. It reaches *an* alignment quickly when the exact search would
        have to enumerate too many interleavings of concurrent objects.
        """
        self._greedy = greedy
        started = time.monotonic()
        start = (self.initial_marking, self.initial_positions)
        goal = (self.final_marking, self.final_positions)
        counter = itertools.count()
        best: Dict[tuple, Tuple[int, int]] = {start: (0, 0)}
        parent: Dict[tuple, Tuple[tuple, tuple]] = {}
        h0 = self._heuristic(self.initial_marking, self.initial_positions)
        if h0 is None:
            return None, None, 0, 1, NO_ALIGNMENT
        self.lower_bound = h0
        # Heap order: estimated deviation cost, then progress through the
        # log (deepest first among equally cheap states), then silent moves.
        heap = [(h0, 0, 0, 0, next(counter), start)]
        closed = set()
        explored = 0
        deadline = (
            started + timeout_s if timeout_s is not None and timeout_s > 0 else None
        )

        def check_limits():
            if should_cancel is not None and should_cancel():
                raise AlignmentCancelled()
            if deadline is not None and time.monotonic() > deadline:
                raise _SearchStopped(TIMEOUT)

        self._check_limits = check_limits

        try:
            return self._loop(
                heap, best, parent, closed, goal, counter, max_states, check_limits, progress
            )
        except _SearchStopped as stop:
            return None, None, stop.explored or len(closed), len(best), stop.status

    def _loop(self, heap, best, parent, closed, goal, counter, max_states, check_limits, progress):
        explored = 0
        dead: set = set()
        while heap:
            f_dev, neg_progress, g_silent, g_dev, _, state = heapq.heappop(heap)
            if state in closed:
                continue
            if best.get(state, (None,)) != (g_dev, g_silent):
                continue
            closed.add(state)
            if state == goal:
                return self._path(parent, state), (g_dev, g_silent), explored, len(best), None
            explored += 1
            check_limits()
            if progress is not None and explored % 2048 == 0:
                progress(None, f"Searching alignment: {explored:,} states explored, {len(best):,} reached")

            marking_t, positions = state
            marking = self._thaw(marking_t)

            def push(next_marking, next_positions, step_dev, step_silent, move):
                key = (
                    next_marking if isinstance(next_marking, tuple) else self._freeze(next_marking),
                    next_positions,
                )
                if key in closed or key in dead:
                    return
                cost = (g_dev + step_dev, g_silent + step_silent)
                known = best.get(key)
                if known is not None and known <= cost:
                    return
                h = self._heuristic(key[0], next_positions)
                if h is None:
                    dead.add(key)  # some object can no longer reach its final places
                    return
                if known is None and len(best) >= max_states:
                    raise _SearchStopped(STATE_LIMIT, explored)
                best[key] = cost
                parent[key] = (state, move)
                progress_key = -sum(next_positions)
                priority = cost[0] + h
                if self._greedy:
                    priority += progress_key
                heapq.heappush(heap, (priority, progress_key, cost[1], cost[0], next(counter), key))

            # Log and synchronous moves for every enabled event.
            for e_index in self._enabled_events(positions):
                objs = self.event_objects[e_index]
                next_positions = list(positions)
                for o in objs:
                    next_positions[o] += 1
                next_positions = tuple(next_positions)
                push(marking_t, next_positions, len(objs), 0, (LOG_MOVE, e_index, None, None))
                for t_index in self.sync_candidates[e_index]:
                    t = self.net.transitions[t_index]
                    binding: Dict[str, Tuple[int, ...]] = defaultdict(tuple)
                    grouped: Dict[str, List[int]] = defaultdict(list)
                    for o in objs:
                        grouped[self.object_type[o]].append(o)
                    binding.update({ot: tuple(v) for ot, v in grouped.items()})
                    if not self._binding_enabled(marking, t, binding):
                        continue
                    push(
                        self._fire(marking, t, binding),
                        next_positions,
                        0,
                        0,
                        (SYNC_MOVE, e_index, t_index, None),
                    )

            # Model moves.
            for t in self.net.transitions:
                for binding in self._model_bindings(marking, t):
                    used = sum(len(v) for v in binding.values())
                    frozen_binding = tuple(sorted((ot, tuple(v)) for ot, v in binding.items() if v))
                    if t.silent:
                        push(self._fire(marking, t, binding), positions, 0, 1, (MODEL_MOVE, None, t.index, frozen_binding))
                    else:
                        push(self._fire(marking, t, binding), positions, used, 0, (MODEL_MOVE, None, t.index, frozen_binding))


        return None, None, explored, len(best), NO_ALIGNMENT

    @staticmethod
    def _path(parent, state) -> List[tuple]:
        moves = []
        while state in parent:
            state, move = parent[state]
            moves.append(move)
        moves.reverse()
        return moves

    def to_moves(self, path: Sequence[tuple]) -> List[AlignmentMove]:
        moves: List[AlignmentMove] = []
        for kind, e_index, t_index, binding in path:
            transition = self.net.transitions[t_index] if t_index is not None else None
            if kind == MODEL_MOVE:
                objects = tuple(
                    sorted((ot, self.objects[o]) for ot, objs in binding for o in objs)
                )
                event = None
            else:
                event = self.events[e_index]
                objects = event.objects
            silent = transition is not None and transition.silent
            if kind == SYNC_MOVE:
                cost = 0
            elif silent:
                cost = 0
            else:
                cost = len(objects)
            moves.append(
                AlignmentMove(
                    kind=kind,
                    event_index=e_index,
                    event_id=event.event_id if event else None,
                    log_activity=event.activity if event else None,
                    timestamp_unix=event.timestamp_unix if event else None,
                    transition_id=transition.id if transition else None,
                    model_activity=transition.label if transition else None,
                    silent=silent,
                    objects=objects,
                    cost=cost,
                )
            )
        return moves


class _SearchStopped(Exception):
    def __init__(self, status: str, explored: int = 0):
        super().__init__(status)
        self.status = status
        self.explored = explored


class _BindingExplosion(Exception):
    def __init__(self, transition: str):
        super().__init__(transition)
        self.transition = transition


def alignment_edges(moves: Sequence[AlignmentMove], include_silent: bool = True) -> List[Tuple[int, int]]:
    """Edges of the alignment graph (Def. 5.9).

    Two moves are connected when they share an object that no move in
    between uses. With ``include_silent=False`` silent model moves are
    skipped and the edges bridge over them.
    """
    last: Dict[str, int] = {}
    edges = set()
    for index, move in enumerate(moves):
        if not include_silent and move.silent and move.kind == MODEL_MOVE:
            continue
        for _, obj in move.objects:
            previous = last.get(obj)
            if previous is not None:
                edges.add((previous, index))
            last[obj] = index
    return sorted(edges)


def _place_names(net: AlignmentNet, places: Iterable[int]) -> str:
    names = sorted({net.place_ids[p] for p in places})
    return ", ".join(names) if names else "none"


def diagnose_no_alignment(net: AlignmentNet, execution: ProcessExecution) -> List[str]:
    """Explain why the model cannot reach its final marking with these objects.

    Checks, per object type of the execution, whether a single object of the
    type can get from the initial to the final places of its type at all,
    using only transitions that can fire with the object types the
    execution has (a regular arc needs exactly one object of its type, so a
    transition with a regular arc of a type the execution lacks never
    fires). The remaining case -- every object could finish on its own, but
    not together -- is reported generically.
    """
    counts = Counter(execution.object_types_by_object.values())
    reasons: List[str] = []
    blocked: Dict[int, List[str]] = {}
    for t in net.transitions:
        missing = [ot for ot in t.regular_types if counts.get(ot, 0) == 0]
        if missing:
            blocked[t.index] = missing

    def label(t: NetTransition) -> str:
        return f'"{t.label}"' if t.label is not None else f"silent transition {t.id}"

    for ot in sorted(counts):
        initial = tuple(sorted(net.initial_places.get(ot, ())))
        final = tuple(sorted(net.final_places.get(ot, ())))
        if not initial:
            reasons.append(f'Object type "{ot}" has no initial place in the model.')
            continue
        if not final:
            reasons.append(f'Object type "{ot}" has no final place in the model.')
            continue
        transitions = [t for t in net.transitions if ot in t.object_types]
        # Single-object reachability over the type's places, with and without
        # the transitions that need object types the execution lacks.
        def reachable(usable):
            seen, frontier = {initial}, [initial]
            while frontier and len(seen) < 5_000:
                marking = frontier.pop()
                have = Counter(marking)
                for t in usable:
                    ins = t.inputs.get(ot, ())
                    if any(have[p] < 1 for p in ins):
                        continue
                    nxt = have.copy()
                    nxt.subtract(ins)
                    nxt.update(t.outputs.get(ot, ()))
                    m = tuple(sorted(p for p, c in nxt.items() for _ in range(c) if c > 0))
                    if m not in seen:
                        seen.add(m)
                        frontier.append(m)
            return seen

        everything = reachable(transitions)
        if final not in everything:
            dead_ends = sorted(m for m in everything if m != initial and all(
                any(Counter(m)[p] < 1 for p in t.inputs.get(ot, ())) or not t.inputs.get(ot)
                for t in transitions
            ))
            hint = ""
            if dead_ends:
                hint = " An object gets stuck in " + "; ".join(
                    "{" + _place_names(net, m) + "}" for m in dead_ends[:3]
                ) + "."
            reasons.append(
                f'A "{ot}" object can never get from its initial place(s) '
                f"{{{_place_names(net, initial)}}} to its final place(s) "
                f"{{{_place_names(net, final)}}} in the model, whatever happens.{hint} "
                "Check the arcs and the initial/final flags of this object type."
            )
            continue
        usable = [t for t in transitions if t.index not in blocked]
        if final not in reachable(usable):
            needed = sorted(
                {f"{label(t)} (needs {', '.join(repr(m) for m in blocked[t.index])})"
                 for t in transitions if t.index in blocked}
            )
            reasons.append(
                f'"{ot}" objects can only finish through transitions that need object '
                f"types this execution does not have: {'; '.join(needed)}. Add these "
                "object types to the business object types, or use a model without them."
            )
    unused = sorted(set(net.object_types) - set(counts))
    if not reasons:
        reasons.append(
            "Every object could reach its final places on its own, but not together: "
            "transitions shared between object types (or regular arcs that bind exactly "
            "one object per firing) cannot fire in a combination that brings all "
            "objects of this execution to their final places."
        )
    if unused:
        reasons.append(
            "Object types of the model without objects in this execution: "
            + ", ".join(unused) + "."
        )
    return reasons


def compute_oc_alignment(
    model,
    execution: ProcessExecution,
    *,
    max_states: int = DEFAULT_MAX_STATES,
    timeout_s: Optional[float] = DEFAULT_TIMEOUT_S,
    ignore_unknown_object_types: bool = True,
    should_cancel: Optional[Callable[[], bool]] = None,
    progress: Optional[Callable[[Optional[float], str], None]] = None,
    approximate_fallback: bool = True,
) -> OCAlignmentResult:
    """Compute an optimal object-centric alignment of ``execution`` on ``model``.

    Parameters
    ----------
    model:
        The de-jure model: an OCPN JSON dict (``format: "ocpn"``) or an
        already parsed :class:`~.net.AlignmentNet`.
    execution:
        The process execution (see :mod:`.execution`).
    max_states:
        Stop with status ``"state_limit"`` once this many distinct states
        (markings of the synchronous product) were reached; bounds memory.
    timeout_s:
        Stop with status ``"timeout"`` after this many seconds (``None`` or
        ``<= 0`` disables the timeout).
    ignore_unknown_object_types:
        Remove objects whose type the model does not contain before the
        search (reported in ``result.projection``). Without it such an
        execution has no alignment, because a model move must use the same
        objects as the log part.
    should_cancel:
        Polled regularly; returning True raises :class:`AlignmentCancelled`.
    progress:
        Optional ``callback(fraction_or_None, message)``.
    approximate_fallback:
        When the optimal search hits ``max_states`` or ``timeout_s``, run a
        best-first search (fresh state budget, half the time budget, at
        least 5 s) and return its alignment with status ``"approximate"``:
        valid, but its cost is only an upper bound.
    """
    net = model if isinstance(model, AlignmentNet) else net_from_ocpn_dict(model)
    started = time.monotonic()

    projection = ProjectionReport()
    if ignore_unknown_object_types:
        execution, projection = project_execution(execution, net.object_types)

    unknown_activities = tuple(
        sorted({e.activity for e in execution.events} - set(net.transitions_by_label))
    )
    if not execution.events:
        return OCAlignmentResult(
            status=EMPTY_EXECUTION,
            execution=execution,
            projection=projection,
            message=(
                "The process execution has no events with object types of the model, "
                "so there is nothing to align."
            ),
            unknown_activities=unknown_activities,
        )

    if not ignore_unknown_object_types:
        foreign = sorted(set(execution.object_types_by_object.values()) - set(net.object_types))
        if foreign:
            return OCAlignmentResult(
                status=NO_ALIGNMENT,
                execution=execution,
                projection=projection,
                message=(
                    "The process execution uses object types the model does not contain: "
                    + ", ".join(foreign)
                ),
                unknown_activities=unknown_activities,
            )

    search = _Search(net, execution)
    try:
        path, cost, explored, queued, failure = search.run(
            max_states=max_states,
            timeout_s=timeout_s,
            should_cancel=should_cancel,
            progress=progress,
        )
        exact_failure = failure
        fallback_used = False
        if failure in (STATE_LIMIT, TIMEOUT) and approximate_fallback:
            if progress is not None:
                progress(None, "Optimal search hit its limit; searching an approximate alignment")
            budget = max(5.0, 0.5 * timeout_s) if timeout_s is not None and timeout_s > 0 else None
            path, cost, more_explored, more_queued, failure = search.run(
                max_states=max_states,
                timeout_s=budget,
                should_cancel=should_cancel,
                progress=progress,
                greedy=True,
            )
            explored += more_explored
            queued = max(queued, more_queued)
            fallback_used = True
    except _BindingExplosion as exc:
        return OCAlignmentResult(
            status=STATE_LIMIT,
            execution=execution,
            projection=projection,
            elapsed_ms=(time.monotonic() - started) * 1000,
            message=(
                f'Transition "{exc.transition}" offers more than '
                f"{MAX_ENUMERATED_BINDINGS:,} bindings in one state; the "
                "process execution has too many objects for its variable arcs."
            ),
            unknown_activities=unknown_activities,
        )
    elapsed = (time.monotonic() - started) * 1000
    limit_messages = {
        STATE_LIMIT: (
            f"The optimal search reached the limit of {max_states:,} states "
            "before it found the optimal alignment."
        ),
        TIMEOUT: f"The optimal search timed out after {timeout_s} s.",
    }

    if failure is not None:
        messages = {
            **limit_messages,
            NO_ALIGNMENT: (
                "The model cannot reach its final marking with the objects of this process "
                "execution, so no alignment exists. The combination of object types (or the "
                "number of objects per type) is not allowed by the model, or the model "
                "deadlocks for it."
            ),
        }
        message = messages[exact_failure if exact_failure in messages else failure]
        if fallback_used:
            message += " The approximate fallback search did not find an alignment either."
        diagnostics = ()
        if failure == NO_ALIGNMENT or exact_failure == NO_ALIGNMENT:
            diagnostics = tuple(diagnose_no_alignment(net, execution))
        return OCAlignmentResult(
            status=exact_failure if fallback_used else failure,
            diagnostics=diagnostics,
            execution=execution,
            projection=projection,
            exact=not search.restricted_transitions,
            restricted_transitions=tuple(sorted(search.restricted_transitions)),
            states_explored=explored,
            states_queued=queued,
            elapsed_ms=elapsed,
            message=message,
            unknown_activities=unknown_activities,
        )

    moves = search.to_moves(path)
    restricted = tuple(sorted(search.restricted_transitions))
    optimal = cost[0] <= search.lower_bound or (not fallback_used and not restricted)
    notes = []
    if fallback_used and not optimal:
        notes.append(
            limit_messages[exact_failure]
            + " A best-first search found this alignment instead: it is valid, but its "
            f"cost is only an upper bound (the optimum is at least {search.lower_bound})."
        )
    elif restricted and not optimal:
        notes.append(
            "Variable arcs of " + ", ".join(f'"{t}"' for t in restricted)
            + " bind too many objects to try every subset in model moves; only "
            "single objects, all objects at once and the groups seen in the log "
            "were tried. The alignment is valid, but its cost is an upper bound."
        )
    return OCAlignmentResult(
        status=OPTIMAL if optimal else APPROXIMATE,
        execution=execution,
        projection=projection,
        cost=cost[0],
        moves=moves,
        edges=alignment_edges(moves),
        states_explored=explored,
        states_queued=queued,
        elapsed_ms=elapsed,
        unknown_activities=unknown_activities,
        exact=optimal,
        restricted_transitions=() if optimal else restricted,
        lower_bound=search.lower_bound,
        message=" ".join(notes),
    )
