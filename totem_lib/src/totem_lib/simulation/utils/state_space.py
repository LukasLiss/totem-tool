"""Stochastic state space for the advanced object-centric simulation.

The advanced simulation *replays the object-type composition of connected
components* and *generates the activities and participants* on top of them. It
solves P(activity, participants | EOG_so_far, object_pool)
The object pool is given, and the state space generates which activity fires next
and which of the present objects take part, until an ``END`` marker (absorbing Markov chain).

The object pool replays the connected component's **relational skeleton**: arrivals
are clustered by the isomorphism-invariant structure of the object graph, and the
representative skeleton is cloned (fresh ids, same relations) at spawn. Participant
selection is relation-aware, so an event stays within one interaction cluster (the
Items it picks belong to the Order it involves).

Two learned models drive it:

- ``StatefulActivityVMM`` — ``P(activity | S)`` where the state S abstracts the
  execution graph so far. A linear backoff chain from the graph-native level down
  to the flat suffix resolves sparsity: an isomorphism-invariant WL signature of
  the recent prefix subgraph (``("G", ...)``) -> the object-lifecycle level (per
  ``(type, last activity)`` histogram + remaining-object counts) -> the bare
  activity suffix, shortened to the empty context. A support threshold picks the
  richest level with enough evidence. StateConfig selects how much of S is used;
  the ablation helpers M0-M3 switch the graph signature off to isolate the
  object-lifecycle features (M0 reduces to the bare-suffix ``ControlFlowVMM``).
- ``ParticipationSignatureModel`` — ``P(participant signature | activity)``, the
  joint count of participants per pre-event object group, so multi-object
  dependencies are preserved and only pool-realizable signatures are drawn.

``ExecutionGenerator`` weaves both into a connected event graph, one event at a
time, so the playout can drive generation lazily and  in the future can feed runtime
state back through ``runtime_context``; ``run`` drives it to completion. Two
invariants hold by construction: connectivity (every non-start event shares an
object with the case so far) and coverage (every pool object ends up in at least
one event). The EOG structure re-emerges from object sharing, so linear generation
still yields a partial-order graph.
"""

from collections import Counter, defaultdict, namedtuple

import networkx as nx

from totem_lib.variants.state_space_executions import extract_state_space_executions

# Sentinels for the Variable-order Markov Model(VMM)
START = "__START__"
END = "__END__"

# Longest prefix (in activities) the VMM conditions on before backing off.
# k -> inf collapses toward whole-variant replay for rare long cases
DEFAULT_MAX_ORDER = 4


class ControlFlowVMM:
    """Variable-order Markov model over linearized activity sequences.

    Holds n-gram counts ``{context: Counter{next_activity: n}}`` for every
    context length from 0 up to ``max_order``. Queries resolve the longest
    observed suffix of the current context, backing off one (oldest) activity at
    a time
    """

    def __init__(self, counts, max_order):
        self._counts = counts
        self.max_order = max_order

    @classmethod
    def build(cls, activity_sequences, max_order=DEFAULT_MAX_ORDER):
        """Build the VMM from linearized activity sequences.

        Args:
            activity_sequences: Iterable of activity lists (one per case).
            max_order: Longest activity prefix to condition on.

        Returns:
            A ``ControlFlowVMM``.
        """
        counts = defaultdict(Counter)
        for sequence in activity_sequences:
            full = [START, *sequence, END]
            # Target is never START, so start at position 1.
            for i in range(1, len(full)):
                target = full[i]
                max_ctx = min(max_order, i)
                for length in range(0, max_ctx + 1):
                    context = tuple(full[i - length : i])
                    counts[context][target] += 1
        return cls(dict(counts), max_order)

    @staticmethod
    def _filter(counts, allowed):
        """Restrict a next-activity counter to ``allowed`` activities (END kept)."""
        if allowed is None:
            return dict(counts)
        return {a: n for a, n in counts.items() if a == END or a in allowed}

    def _backoff_counts(self, context, allowed):
        """Longest observed suffix of ``context`` with allowed continuations."""
        suffix = tuple(context[-self.max_order :]) if self.max_order else ()
        while True:
            counts = self._counts.get(suffix)
            if counts:
                filtered = self._filter(counts, allowed)
                if filtered:
                    return filtered
            if not suffix:
                return None
            suffix = suffix[1:]  # drop the oldest activity

    def next_distribution(self, context, allowed=None):
        """Probability distribution over the next activity (plus ``END``).

        Args:
            context: The recent activity prefix (may include the ``START``
                sentinel and be longer than ``max_order``; it is trimmed).
            allowed: Optional set of allowed activities for object-type gating.
                ``END`` is always allowed.

        Returns:
            ``{activity_or_END: probability}``. Falls back to ``{END: 1.0}`` when
            no allowed continuation exists.
        """
        filtered = self._backoff_counts(context, allowed)
        if not filtered:
            return {END: 1.0}
        total = sum(filtered.values())
        return {activity: n / total for activity, n in filtered.items()}

    def sample_next(self, context, allowed, rng):
        """Sample the next activity from ``next_distribution`` using ``rng``."""
        distribution = self.next_distribution(context, allowed)
        activities = list(distribution)
        weights = [distribution[a] for a in activities]
        return rng.choices(activities, weights=weights, k=1)[0]


class ObjectParticipationModel:
    """Per-activity object participation, conditioned on available types.

    For each activity and each object type available in the case, holds the
    distribution of how many objects of that type take part in an occurrence of
    the activity. ``mandatory_types`` are the types present in *every* observed
    occurrence — used for gating — and ``activity_types`` are all types ever
    seen with the activity.
    """

    def __init__(self, count_distribution, mandatory_types, activity_types):
        self.count_distribution = count_distribution
        self.mandatory_types = mandatory_types
        self.activity_types = activity_types

    @classmethod
    def build(cls, executions):
        """Learn the participation model from process executions.

        Args:
            executions: The ``StateSpaceExecution`` records from
                ``extract_state_space_executions``.

        Returns:
            An ``ObjectParticipationModel``.
        """
        # activity -> type -> Counter{count_in_event}; only counted for types
        # available in the same execution, so count 0 means "available, unused".
        counts = defaultdict(lambda: defaultdict(Counter))
        occurrences = Counter()
        present = defaultdict(Counter)
        types_seen = defaultdict(set)

        for execution in executions:
            type_of = execution.object_types
            available = {t for t in type_of.values() if t is not None}
            for activity, object_ids in execution.events:
                occurrences[activity] += 1
                per_type = Counter(
                    type_of[o] for o in object_ids if type_of.get(o) is not None
                )
                for obj_type in available:
                    count = per_type.get(obj_type, 0)
                    counts[activity][obj_type][count] += 1
                    if count >= 1:
                        present[activity][obj_type] += 1
                        types_seen[activity].add(obj_type)

        count_distribution = {}
        mandatory_types = {}
        activity_types = {}
        for activity, total in occurrences.items():
            count_distribution[activity] = {
                obj_type: {
                    count: freq / sum(histogram.values())
                    for count, freq in histogram.items()
                }
                for obj_type, histogram in counts[activity].items()
            }
            mandatory_types[activity] = frozenset(
                obj_type for obj_type, n in present[activity].items() if n == total
            )
            activity_types[activity] = frozenset(types_seen[activity])

        return cls(count_distribution, mandatory_types, activity_types)

    def sample_count(self, activity, obj_type, rng):
        """Sample the number of ``obj_type`` objects taking part in ``activity``."""
        distribution = self.count_distribution.get(activity, {}).get(obj_type)
        if not distribution:
            return 0
        counts = list(distribution)
        weights = [distribution[c] for c in counts]
        return rng.choices(counts, weights=weights, k=1)[0]


class StateConfig:
    """Which features the object-centric activity state ``S`` conditions on.

    ``S`` combines the recent activity suffix with a compact summary of the object
    pool. ``object_level`` selects the richest active-object context
    (``"histogram"`` = per ``(type, last_activity)`` counts (M3), ``"type_counts"``
    = per-type counts of active objects (M2), ``"none"`` = no active-object context).
    ``use_remaining`` adds bucketed counts of not-yet-used objects per type (a
    progress signal; only sound under conditional simulation with a given pool).
    ``suffix_length`` is the activity horizon k. Remaining counts are bucketed as
    ``0, 1, ..., remaining_cap`` (cap meaning "cap or more"). A projection is used at
    query time only if it has at least ``min_support`` observations, else the model
    backs off (guards single-observation probability-1 states). The M0-M3 helpers
    name the ablation levels.
    """

    def __init__(
        self,
        suffix_length=DEFAULT_MAX_ORDER,
        object_level="histogram",
        use_remaining=True,
        remaining_cap=3,
        min_support=3,
        use_graph_signature=True,
        graph_windows=(4, 3, 2),
    ):
        if object_level not in ("histogram", "type_counts", "none"):
            raise ValueError(f"unknown object_level: {object_level!r}")
        self.suffix_length = suffix_length
        self.object_level = object_level
        self.use_remaining = use_remaining
        self.remaining_cap = remaining_cap
        self.min_support = min_support
        # Richest backoff level(s): an isomorphism-invariant signature of the
        # recent prefix subgraph (one per window size, largest first) — the
        # graph-native conditioning that sits above the object-lifecycle and
        # suffix levels.
        self.use_graph_signature = use_graph_signature
        self.graph_windows = graph_windows

    # The M0-M3 helpers are the object-feature ablation and switch the
    # graph-signature level OFF (unless overridden), so they isolate the effect
    # of the object-lifecycle features against the bare suffix.

    @classmethod
    def m0(cls, **kw):
        """Ablation M0: activity suffix only (the flat VMM)."""
        kw.setdefault("use_graph_signature", False)
        return cls(object_level="none", use_remaining=False, **kw)

    @classmethod
    def m1(cls, **kw):
        """Ablation M1: suffix + remaining-object counts."""
        kw.setdefault("use_graph_signature", False)
        return cls(object_level="none", use_remaining=True, **kw)

    @classmethod
    def m2(cls, **kw):
        """Ablation M2: suffix + active-object type counts + remaining."""
        kw.setdefault("use_graph_signature", False)
        return cls(object_level="type_counts", use_remaining=True, **kw)

    @classmethod
    def m3(cls, **kw):
        """Ablation M3: suffix + (type, last_activity) histogram + remaining."""
        kw.setdefault("use_graph_signature", False)
        return cls(object_level="histogram", use_remaining=True, **kw)


def _bucket(n, cap):
    """Clamp a count into ``0, 1, ..., cap`` (cap meaning "cap or more")."""
    return n if n < cap else cap


_ActivityState = namedtuple(
    "_ActivityState", ["graph_sigs", "suffix", "hist_items", "type_items", "rem_items"]
)


def _wl_hash_window(window_events, object_types):
    """Isomorphism-invariant WL hash of one prefix window subgraph.

    Each event is a node labelled by its activity *and* its object-type multiset
    (so a single-object and a two-object occurrence of the same activity differ,
    which pure directly-follows edges miss when an object appears in one event
    only). Edges connect an object's consecutive events within the window,
    labelled by object type. Labels use activity + type only, never object ids,
    so the hash is invariant to object identity — the same recent *structure*
    hashes the same across executions and across a fresh simulated pool.
    """
    if not window_events:
        return ""
    graph = nx.DiGraph()
    for idx, (activity, objs) in enumerate(window_events):
        type_counts = Counter(object_types.get(o) or "?" for o in objs)
        label = (
            activity
            + "|"
            + ",".join(f"{t}:{c}" for t, c in sorted(type_counts.items()))
        )
        graph.add_node(idx, label=label)
    obj_last = {}
    for idx, (_activity, objs) in enumerate(window_events):
        for oid in objs:
            otype = object_types.get(oid) or "?"
            if oid in obj_last:
                graph.add_edge(obj_last[oid], idx, otype=otype)
            obj_last[oid] = idx
    return nx.weisfeiler_lehman_graph_hash(graph, node_attr="label", edge_attr="otype")


def _prefix_graph_signatures(events, object_types, windows):
    """WL hashes of the recent prefix subgraph, one per window size (largest
    first). ``events`` is ``[(activity, object_ids), ...]`` of the prefix so far.
    """
    return tuple(
        _wl_hash_window(events[-w:] if w else events, object_types) for w in windows
    )


def _summarize_state(
    context, last_act, object_types, total_by_type, present_types, config, events
):
    """Build the compact ``_ActivityState`` from the current generation state.

    Shared by training and generation so their projection keys always match.
    ``last_act`` maps each *used* object to its last activity; unused objects are
    implicit (they show up only in the remaining counts). ``events`` is the
    prefix so far, used for the graph-signature level.
    """
    used_by_type = Counter(object_types[o] for o in last_act)
    hist = Counter((object_types[o], last_act[o]) for o in last_act)
    type_counts = Counter(object_types[o] for o in last_act)
    rem = {
        t: _bucket(total_by_type[t] - used_by_type.get(t, 0), config.remaining_cap)
        for t in present_types
    }
    suffix = tuple(context[-config.suffix_length :])
    graph_sigs = (
        _prefix_graph_signatures(events, object_types, config.graph_windows)
        if config.use_graph_signature
        else ()
    )
    return _ActivityState(
        graph_sigs,
        suffix,
        tuple(sorted(hist.items())),
        tuple(sorted(type_counts.items())),
        tuple(sorted(rem.items())),
    )


def _activity_projections(state, config):
    """Ordered backoff projections of ``state`` (richest first) as count keys.

    The chain: recent-subgraph signature(s) first (the graph-native level), then
    the object-lifecycle level (histogram -> type counts) with remaining counts,
    then the bare activity suffix shortened down to the empty context.
    """
    keys = []
    if config.use_graph_signature:
        seen = set()
        for sig in state.graph_sigs:  # largest window first
            if sig and sig not in seen:
                keys.append(("G", sig))
                seen.add(sig)
    rem = state.rem_items if config.use_remaining else ()
    if config.object_level == "histogram":
        keys.append(("H", state.suffix, state.hist_items, rem))
    if config.object_level in ("histogram", "type_counts"):
        keys.append(("T", state.suffix, state.type_items, rem))
    if config.use_remaining:
        keys.append(("R", state.suffix, rem))
    suffix = state.suffix
    for length in range(len(suffix), -1, -1):
        keys.append(("S", suffix[len(suffix) - length :]))
    return keys


def _execution_activity_examples(execution, config):
    """``(state, target_activity)`` training pairs for one execution.

    One pair per event (target = its activity) plus a final ``END`` pair once all
    events are observed.
    """
    object_types = execution.object_types
    total_by_type = Counter(t for t in object_types.values() if t is not None)
    present_types = set(total_by_type)
    context = [START]
    last_act = {}
    prefix_events = []
    examples = []
    for activity, object_ids in execution.events:
        examples.append(
            (
                _summarize_state(
                    context,
                    last_act,
                    object_types,
                    total_by_type,
                    present_types,
                    config,
                    prefix_events,
                ),
                activity,
            )
        )
        for oid in object_ids:
            if object_types.get(oid) is not None:
                last_act[oid] = activity
        context.append(activity)
        prefix_events.append((activity, object_ids))
    examples.append(
        (
            _summarize_state(
                context,
                last_act,
                object_types,
                total_by_type,
                present_types,
                config,
                prefix_events,
            ),
            END,
        )
    )
    return examples


class StatefulActivityVMM:
    """Variable-order Markov model over the object-centric activity state ``S``.

    Generalizes ``ControlFlowVMM`` from a bare activity suffix to the full
    ``_ActivityState`` (suffix + object-pool summary). Holds counts
    ``{projection_key: Counter{activity_or_END: n}}`` at every backoff level and
    resolves the richest projection meeting ``min_support`` at query time.
    """

    def __init__(self, counts, config):
        self._counts = counts
        self.config = config

    @classmethod
    def build(cls, executions, config):
        counts = defaultdict(Counter)
        for execution in executions:
            for state, target in _execution_activity_examples(execution, config):
                for key in _activity_projections(state, config):
                    counts[key][target] += 1
        return cls(dict(counts), config)

    def next_distribution(self, state, allowed=None):
        """Distribution over the next activity (plus ``END``) for ``state``."""
        for key in _activity_projections(state, self.config):
            counts = self._counts.get(key)
            if not counts or sum(counts.values()) < self.config.min_support:
                continue
            filtered = {
                a: n
                for a, n in counts.items()
                if a == END or allowed is None or a in allowed
            }
            if filtered:
                total = sum(filtered.values())
                return {a: n / total for a, n in filtered.items()}
        return {END: 1.0}

    def sample_next(self, state, allowed, rng):
        distribution = self.next_distribution(state, allowed)
        activities = list(distribution)
        weights = [distribution[a] for a in activities]
        return rng.choices(activities, weights=weights, k=1)[0]


class ParticipationSignatureModel:
    """Joint participant-count signatures per activity.

    For each activity, counts the observed *participant signature* — how many
    objects took part per pre-event object group ``(type, last_activity)``. Keeping
    the whole signature (rather than independent per-object/per-type decisions)
    preserves multi-object dependencies (e.g. "1 Order + 2-4 Items + 1 Package") and
    cannot produce invalid mixes. Conditioned on the activity only (a deliberately
    coarse context so signatures recur).
    """

    def __init__(self, counts):
        self._counts = counts

    @classmethod
    def build(cls, executions):
        counts = defaultdict(Counter)
        for execution in executions:
            object_types = execution.object_types
            last_act = {}
            for activity, object_ids in execution.events:
                signature = Counter()
                for oid in object_ids:
                    obj_type = object_types.get(oid)
                    if obj_type is None:
                        continue
                    signature[(obj_type, last_act.get(oid, START))] += 1
                if signature:
                    counts[activity][tuple(sorted(signature.items()))] += 1
                for oid in object_ids:
                    if object_types.get(oid) is not None:
                        last_act[oid] = activity
        return cls({a: dict(c) for a, c in counts.items()})

    @staticmethod
    def _realizable(signature, available_groups, require_active):
        """Whether ``signature`` can be drawn from the currently available groups.

        ``available_groups`` maps ``(type, last_activity)`` to the number of pool
        objects currently in that group. ``require_active`` (non-start events)
        requires the signature to include an already-active object so the event
        stays connected to the case.
        """
        if require_active and not any(group[1] != START for group, _ in signature):
            return False
        needed = Counter()
        for group, count in signature:
            needed[group] += count
        return all(available_groups.get(g, 0) >= c for g, c in needed.items())

    def has_realizable_signature(self, activity, available_groups, require_active):
        """Whether any observed signature of ``activity`` is realizable now.

        Lets the generator mask activities *before* drawing one, so it never
        commits to an activity for which no observed participant structure fits
        the current object state (joint activity+participant feasibility).
        """
        distribution = self._counts.get(activity)
        if not distribution:
            return False
        return any(
            self._realizable(s, available_groups, require_active) for s in distribution
        )

    def sample_signature(self, activity, available_groups, require_active, rng):
        """Sample a participant signature realizable from ``available_groups``.

        Returns the signature as a tuple of ``((group), count)`` or ``None`` when
        no observed signature fits the current object state.
        """
        distribution = self._counts.get(activity)
        if not distribution:
            return None
        candidates = {
            s: n
            for s, n in distribution.items()
            if self._realizable(s, available_groups, require_active)
        }
        if not candidates:
            return None
        signatures = list(candidates)
        weights = [candidates[s] for s in signatures]
        return rng.choices(signatures, weights=weights, k=1)[0]


def _cover_leftovers(events, object_type_map, used):
    """Attach not-yet-used objects to an existing event of a matching type.

    Guarantees every structure object appears in at least one event without
    distorting the generated control flow (objects only join existing events).
    """
    leftover = [o for o in object_type_map if o not in used]
    if not leftover or not events:
        return
    for oid in leftover:
        obj_type = object_type_map[oid]
        target = 0
        for idx, (_, objs) in enumerate(events):
            if any(object_type_map.get(x) == obj_type for x in objs):
                target = idx
                break
        events[target][1].append(oid)
        used.add(oid)


def _build_case_graph(events, object_type_map):
    """Build the EOG-style case graph from generated events + their objects.

    Edges are re-derived from object sharing exactly as ``ObjectCentricEventLog.
    eog`` builds them, so the partial-order structure re-emerges from the objects
    even though generation is linear.
    """
    graph = nx.DiGraph()
    object_sequence = defaultdict(list)
    for idx, (activity, objs) in enumerate(events):
        node = f"e{idx}"
        node_objects = sorted(set(objs))
        graph.add_node(node, label=activity, objects=node_objects)
        for oid in node_objects:
            object_sequence[oid].append(node)

    edge_types = defaultdict(set)
    edge_objects = defaultdict(set)
    for oid, sequence in object_sequence.items():
        obj_type = object_type_map.get(oid, "UNKNOWN")
        for u, v in zip(sequence, sequence[1:], strict=False):
            edge_types[(u, v)].add(obj_type)
            edge_objects[(u, v)].add(oid)

    for (u, v), types in edge_types.items():
        graph.add_edge(
            u, v, type="|".join(sorted(types)), objects=sorted(edge_objects[(u, v)])
        )
    return graph, dict(object_type_map)


def _as_object_graph(object_pool):
    """Normalize an object pool to a typed relation graph.

    Accepts either an ``nx.Graph`` (the cloned connected-component skeleton, whose
    edges carry the object relations) or a plain ``{object_id: type}`` map (then a
    relationless graph — participant selection falls back to unconstrained).
    """
    if isinstance(object_pool, nx.Graph):
        return object_pool
    graph = nx.Graph()
    for oid, otype in object_pool.items():
        graph.add_node(oid, type=otype)
    return graph


class ExecutionGenerator:
    """Incremental generator of one object-centric execution over a fixed pool.

    Produces the execution **one event at a time** via :meth:`step`, so the playout
    can drive generation lazily and feed runtime state (resource load, wall-clock
    time) back into it through ``runtime_context``. :meth:`run` drives it to
    completion for the whole-execution case.

    Solves conditional simulation ``P(activity, participants | EOG_so_far,
    object_pool)``: the object pool is a *cloned connected-component skeleton* whose
    edges carry the object relations, so participant selection stays within one
    interaction cluster (which Item belongs to which Order). Connectivity — every
    non-start event shares an already-active object — holds by construction via the
    ``require_active`` realizability mask. Coverage — every pool object appears in
    some event — is enforced where reachable (END is blocked while pool objects
    remain and an activity can still consume them).
    """

    def __init__(
        self,
        object_pool,
        activity_model,
        participation_model,
        mandatory_types,
        config,
        rng,
        max_events=1000,
    ):
        self.object_graph = _as_object_graph(object_pool)
        self.object_type_map = {
            oid: self.object_graph.nodes[oid]["type"] for oid in self.object_graph
        }
        self.activity_model = activity_model
        self.participation_model = participation_model
        self.config = config
        self.rng = rng
        self.max_events = max_events
        self.present_types = set(self.object_type_map.values())
        self.total_by_type = Counter(self.object_type_map.values())
        self.last_act = {}
        self.context = [START]
        self.events = []
        self.done = False
        self.allowed = frozenset(
            activity
            for activity, mandatory in mandatory_types.items()
            if set(mandatory) <= self.present_types
        )

    def _state(self):
        return _summarize_state(
            self.context,
            self.last_act,
            self.object_type_map,
            self.total_by_type,
            self.present_types,
            self.config,
            self.events,
        )

    def _available_groups(self):
        groups = Counter()
        for oid, obj_type in self.object_type_map.items():
            groups[(obj_type, self.last_act.get(oid, START))] += 1
        return groups

    def _all_used(self):
        return len(self.last_act) == len(self.object_type_map)

    def _allowed_now(self):
        """Activities that may fire in the current object state.

        Joint activity+participant masking: an activity is allowed only if its
        mandatory types are present AND it has a realizable participant signature
        for the current object state (with an active object for non-start events).
        Drawing from this set means the generator never commits to an activity for
        which no observed participant structure fits — so no wrong-type object is
        ever force-added afterwards. (This is the frequentist stand-in for OCPN
        transition enabling in the current marking.)
        """
        available = self._available_groups()
        require_active = bool(self.events)
        return frozenset(
            activity
            for activity in self.allowed
            if self.participation_model.has_realizable_signature(
                activity, available, require_active
            )
        )

    def step(self, runtime_context=None):
        """Generate and return the next event, or ``None`` when complete.

        ``runtime_context`` is the seam for later playout-conditioned generation
        (resource load, wall-clock time, ...). It is currently ignored: while the
        models do not read runtime state, generating the whole execution up front
        and generating it incrementally are statistically identical.
        """
        if self.done or len(self.events) >= self.max_events:
            self.done = True
            return None
        state = self._state()
        allowed = self._allowed_now()
        activity = self.activity_model.sample_next(state, allowed, self.rng)
        if activity == END:
            # Coverage: block END while pool objects remain AND something can
            # still fire; on a genuine dead-end, end and let to_graph() attach any
            # stragglers.
            if self._all_used() or not allowed:
                self.done = True
                return None
            activity = self._forced_activity(state, allowed)
            if activity is None:
                self.done = True
                return None
        participants = self._select_participants(activity)
        event = (activity, participants)
        self.events.append(event)
        for oid in participants:
            self.last_act[oid] = activity
        self.context.append(activity)
        return event

    def _forced_activity(self, state, allowed):
        distribution = {
            a: p
            for a, p in self.activity_model.next_distribution(state, allowed).items()
            if a != END
        }
        if not distribution:
            return None
        activities = list(distribution)
        weights = [distribution[a] for a in activities]
        return self.rng.choices(activities, weights=weights, k=1)[0]

    def _select_participants(self, activity):
        signature = self.participation_model.sample_signature(
            activity,
            self._available_groups(),
            require_active=bool(self.events),
            rng=self.rng,
        )
        if signature is None:
            return self._enforce_invariants([])
        by_group = defaultdict(list)
        for oid, obj_type in self.object_type_map.items():
            by_group[(obj_type, self.last_act.get(oid, START))].append(oid)
        for group in by_group:
            by_group[group].sort()
        # Active groups first, so unused objects can attach to a *related* active
        # anchor (keeps the event within one interaction cluster).
        ordered = sorted(signature, key=lambda gc: gc[0][1] == START)
        chosen = []
        for group, count in ordered:
            chosen.extend(self._pick_related(by_group[group], chosen, count))
        return self._enforce_invariants(chosen)

    def _pick_related(self, pool, anchors, count):
        """Pick ``count`` objects from ``pool``, preferring those related (adjacent
        in the object graph) to the already-chosen anchors; falls back to any when
        no relation exists (e.g. a relationless pool)."""
        candidates = list(pool)
        self.rng.shuffle(candidates)
        if anchors:
            related = [
                o
                for o in candidates
                if any(self.object_graph.has_edge(o, a) for a in anchors)
            ]
            related_set = set(related)
            candidates = related + [o for o in candidates if o not in related_set]
        return candidates[:count]

    def _enforce_invariants(self, chosen):
        """Guarantee a non-empty object set (a rare defensive net).

        Connectivity — a non-start event includes an already-active object — is
        guaranteed upstream by the ``require_active`` realizability mask, so no
        active object is force-added here (which could otherwise attach a
        semantically wrong object type to the event).
        """
        chosen = list(dict.fromkeys(chosen))
        if not chosen:
            unused = sorted(
                oid for oid in self.object_type_map if oid not in self.last_act
            )
            pool = unused or sorted(self.object_type_map)
            if pool:
                chosen.append(pool[0])
        return chosen

    def to_graph(self):
        """Build the EOG-style case graph from the events generated so far."""
        used = set(self.last_act)
        _cover_leftovers(self.events, self.object_type_map, used)
        return _build_case_graph(self.events, self.object_type_map)

    def run(self):
        """Drive :meth:`step` to completion; return ``(graph, object_type_map)``."""
        while self.step() is not None:
            pass
        return self.to_graph()


class StateSpaceModel:
    """The advanced-simulation generative transition model.

    Bundles the learned generation components — the ``StatefulActivityVMM``, the
    ``ParticipationSignatureModel``, and the per-activity mandatory object types
    (for gating). It models ``P(activity, participants | structure, prefix)``:
    given a fixed object structure it generates which activities fire, in what
    order, with which participants.

    The object structures themselves — which arrive, how often, and the skeleton
    to clone — are owned by the ``ObjectStructureVariant`` arrival units (see
    ``variants/state_space_executions.py``), not by this model. So this model is
    purely generative; the playout hands it a cloned object pool via
    :meth:`new_generator`.
    """

    def __init__(self, activity_model, participation_model, mandatory_types, config):
        self.activity_model = activity_model
        self.participation_model = participation_model
        self.mandatory_types = mandatory_types
        self.config = config

    @classmethod
    def build(cls, ocel, config=None):
        """Build the generative model from a log (typically process-area filtered)."""
        config = config or StateConfig()
        executions = extract_state_space_executions(ocel)
        activity_model = StatefulActivityVMM.build(executions, config)
        participation_model = ParticipationSignatureModel.build(executions)
        mandatory_types = ObjectParticipationModel.build(executions).mandatory_types
        return cls(activity_model, participation_model, mandatory_types, config)

    def new_generator(self, object_pool, rng, max_events=1000):
        """An :class:`ExecutionGenerator` over a given object pool (graph or map)."""
        return ExecutionGenerator(
            object_pool,
            self.activity_model,
            self.participation_model,
            self.mandatory_types,
            self.config,
            rng,
            max_events,
        )
