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

- ``StatefulActivityVMM`` — ``P(activity | S)`` with the state ``S = (h, G)``:
  the activity history ``h`` and the capped number of objects per group ``(type,
  last activity)`` ``G``. Sparsity is resolved by the backoff ``(h, G) -> G -> h
  -> last(h) -> *``; a support threshold on the admissible continuations picks the
  first level with enough evidence.
- ``ParticipationSignatureModel`` — ``P(participant signature | activity)``, the
  joint count of participants per pre-event object group, so multi-object
  dependencies are preserved and only pool-realizable signatures are drawn.

``ExecutionGenerator`` weaves both into a connected event graph, one event at a
time, so the playout can drive generation lazily and  in the future can feed runtime
state back through ``runtime_context``; ``run`` drives it to completion.
Connectivity (every non-start event shares an object with the case so far) holds
by construction. ``END`` is delayed while an allowed activity can still take an
unused object; objects unused at the end are omitted. The EOG structure re-emerges from
object sharing, so linear generation still yields a partial-order graph.
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
    """Parameters of the object-centric state ``S_j = (h_j, G_j)``.

    ``h_j`` is the activity history, the last ``suffix_length`` elements of
    ``<START, a_1, ..., a_j>``. ``G_j`` maps every object group ``(type, last
    activity)`` to its number of objects, capped at ``group_cap``. A backoff level
    is used only if its admissible continuations have at least ``min_support``
    observations; the last level needs a single one.

    ``use_history`` and ``use_groups`` select the state components for the
    ablations ``history_only`` and ``groups_only``.
    """

    def __init__(
        self,
        suffix_length=DEFAULT_MAX_ORDER,
        group_cap=3,
        min_support=3,
        use_history=True,
        use_groups=True,
    ):
        if not (use_history or use_groups):
            raise ValueError("the state needs the history, the groups or both")
        self.suffix_length = suffix_length
        self.group_cap = group_cap
        self.min_support = min_support
        self.use_history = use_history
        self.use_groups = use_groups

    @classmethod
    def history_only(cls, **kw):
        """Ablation: activity history ``h_j`` only."""
        return cls(use_groups=False, **kw)

    @classmethod
    def groups_only(cls, **kw):
        """Ablation: object groups ``G_j`` only."""
        return cls(use_history=False, **kw)


_ActivityState = namedtuple("_ActivityState", ["history", "groups"])


def _summarize_state(context, groups, config):
    """The state ``S_j = (h_j, G_j)`` as hashable tuples.

    Shared by training and generation so their projection keys always match.

    Args:
        context: ``<START, a_1, ..., a_j>``.
        groups: Number of objects per group ``(type, last activity)``, unused
            objects in ``(type, START)``.
        config: The ``StateConfig``.
    """
    history = tuple(context[-config.suffix_length :])
    capped = tuple(
        sorted((g, min(config.group_cap, n)) for g, n in groups.items() if n > 0)
    )
    return _ActivityState(history, capped)


def _activity_projections(state, config):
    """Backoff projections of ``state``, richest first, as count keys.

    ``(h, G) -> G -> h -> last(h) -> *``; the ablations keep the levels of their
    component.
    """
    keys = []
    if config.use_history and config.use_groups:
        keys.append(("HG", state.history, state.groups))
    if config.use_groups:
        keys.append(("G", state.groups))
    if config.use_history:
        keys.append(("H", state.history))
        keys.append(("L", state.history[-1:]))
    keys.append(("*",))
    return keys


def _initial_groups(object_types):
    return Counter((t, START) for t in object_types.values() if t is not None)


def _advance_groups(groups, last_act, object_types, activity, object_ids):
    """Move the participants of an event into the group of ``activity``."""
    for oid in object_ids:
        obj_type = object_types.get(oid)
        if obj_type is None:
            continue
        groups[(obj_type, last_act.get(oid, START))] -= 1
        groups[(obj_type, activity)] += 1
        last_act[oid] = activity


def _execution_activity_examples(execution, config):
    """``(S_j, a_{j+1})`` for ``0 <= j < n`` and ``(S_n, END)`` of one execution."""
    object_types = execution.object_types
    groups = _initial_groups(object_types)
    context = [START]
    last_act = {}
    examples = []
    for activity, object_ids in execution.events:
        examples.append((_summarize_state(context, groups, config), activity))
        _advance_groups(groups, last_act, object_types, activity, object_ids)
        context.append(activity)
    examples.append((_summarize_state(context, groups, config), END))
    return examples


class StatefulActivityVMM:
    """Next-activity distribution ``P_act(a | S)`` with backoff.

    Holds counts ``{projection_key: Counter{activity_or_END: n}}`` for every
    backoff level. A query uses the first level whose admissible continuations
    have at least ``min_support`` observations; the last level (``*``) only needs
    one.
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

    def next_distribution(self, state, admissible=None):
        """Distribution over the admissible outcomes for ``state``.

        Args:
            state: The ``_ActivityState``.
            admissible: Activities (and possibly ``END``) that may follow; ``None``
                admits every observed outcome.

        Returns:
            ``{activity_or_END: probability}``, or ``{END: 1.0}`` when no level has
            an admissible observation.
        """
        keys = _activity_projections(state, self.config)
        for level, key in enumerate(keys):
            counts = self._counts.get(key)
            if not counts:
                continue
            filtered = {
                a: n for a, n in counts.items() if admissible is None or a in admissible
            }
            total = sum(filtered.values())
            if total == 0:
                continue
            if total >= self.config.min_support or level == len(keys) - 1:
                return {a: n / total for a, n in filtered.items()}
        return {END: 1.0}

    def sample_next(self, state, admissible, rng):
        distribution = self.next_distribution(state, admissible)
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

    def can_join(self, activity, available_groups, require_active):
        """Whether a realizable observed signature of ``activity`` takes an unused
        object, i.e. includes a group ``(type, START)``."""
        return any(
            self._realizable(s, available_groups, require_active)
            and any(group[1] == START for group, _ in s)
            for s in self._counts.get(activity, {})
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
    ``require_active`` realizability mask. ``END`` is admissible once no allowed
    activity has a realizable signature that takes an unused object; objects still
    unused at the end are not part of the generated execution.
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
        self.groups = _initial_groups(self.object_type_map)
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
        return _summarize_state(self.context, self.groups, self.config)

    def _available_groups(self):
        """Uncapped ``Av_j``: number of pool objects per group."""
        return Counter({g: n for g, n in self.groups.items() if n > 0})

    def _can_join(self, allowed):
        """``CanJoin_j``: an allowed activity has a realizable signature that takes
        an unused object."""
        available = self._available_groups()
        require_active = bool(self.events)
        return any(
            self.participation_model.can_join(activity, available, require_active)
            for activity in allowed
        )

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
        allowed = self._allowed_now()
        if self._can_join(allowed):
            admissible = allowed
        else:
            admissible = allowed | {END}
        activity = self.activity_model.sample_next(self._state(), admissible, self.rng)
        if activity == END:
            self.done = True
            return None
        participants = self._select_participants(activity)
        event = (activity, participants)
        self.events.append(event)
        _advance_groups(
            self.groups, self.last_act, self.object_type_map, activity, participants
        )
        self.context.append(activity)
        return event

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
        """EOG-style case graph of the events generated so far, with the type map
        of the objects that took part in them."""
        used = {
            oid: t for oid, t in self.object_type_map.items() if oid in self.last_act
        }
        return _build_case_graph(self.events, used)

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
