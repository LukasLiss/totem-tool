import json
from collections import defaultdict

import numpy as np

from .resource_calendar import availability_probability, wall_clock_end_for_available

ALLOCATION_STRATEGIES = [
    "random",
    "FIFO",
    "LIFO",
]  # TODO: consider adding more complex strategies(round-robin,...)

# Categories of an informative assignment (the strategy counting vector).
ASSIGNMENT_CATEGORIES = ("FIFO", "LIFO", "other")

# Reasons an assignment is not counted as evidence about the strategy.
EXCLUSION_REASONS = ("first_seen", "not_idle", "constraint_violation", "no_choice")

# A deterministic strategy needs this many hits ...
MIN_ABSOLUTE_SUPPORT = 5
# ... and this share of all informative assignments of its type.
MIN_RELATIVE_SUPPORT = 0.6

# Quantile of the cooldown samples a resource is assumed busy after an event.
BUSY_QUANTILE = 0.95


def _resource_calendar(calendars: dict, rid: str, rtype: str):
    """The calendar governing a log resource: its own entry, else its type's."""
    return calendars.get(rid) or calendars.get(rtype)


def _resource_present(calendars: dict, rid: str, rtype: str, timestamp: int) -> bool:
    """Whether the resource can be present at ``timestamp`` (probability > 0)."""
    calendar = _resource_calendar(calendars, rid, rtype)
    return calendar is None or availability_probability(calendar, timestamp) > 0


def _busy_times(resource_cooldowns: dict, busy_quantile: float) -> dict:
    """The minimum busy time per (activity, resource type).

    Args:
        resource_cooldowns: {activity: {resource_type: {"samples": [...], ...}}}.
        busy_quantile: Quantile of the samples taken as the busy time.

    Returns:
        dict: (activity, resource_type) -> busy seconds. Entries without samples
        are absent (busy time 0).
    """
    return {
        (activity, rt): float(np.quantile(entry["samples"], busy_quantile))
        for activity, by_type in resource_cooldowns.items()
        for rt, entry in by_type.items()
        if entry.get("samples")
    }


def _constraints_by_event(variants, resource_constraints, fallback_constraints):
    """Map every event to its process execution and that execution's constraints.

    Args:
        variants: Iterable of variants, each with ``executions`` (lists of event
            ids). ``None`` disables constraint handling.
        resource_constraints: ``{variant: {activity: {other_activity:
            {resource_type: constraint_type}}}}`` for the frequent variants.
        fallback_constraints: The constraint set of all other variants.

    Returns:
        dict: event_id -> (execution index, constraints of its variant).
    """
    lookup = {}
    if variants is None:
        return lookup
    resource_constraints = resource_constraints or {}
    fallback_constraints = fallback_constraints or {}
    execution_index = 0
    for variant in variants:
        constraints = resource_constraints.get(variant, fallback_constraints)
        for execution in variant.executions:
            for event_id in execution:
                lookup[event_id] = (execution_index, constraints)
            execution_index += 1
    return lookup


def _apply_constraints(candidate_ids, rt, activity_constraints, prior):
    """Split the candidate queue of one resource type along the constraints.

    Mirrors the strict playout allocator: a ``superset`` relation forces the prior
    activity's resources into the assignment, ``subset``/``same_resource`` restrict
    the choice to them and ``disjoint`` excludes them. Given the execution's
    history, every relation is a condition on a single resource, so the feasible
    assignments are exactly the forced resources plus any subset of the free ones.

    Args:
        candidate_ids: Candidate queue of type ``rt``.
        rt: The resource type.
        activity_constraints: ``{other_activity: {resource_type: constraint_type}}``
            of the event's activity.
        prior: ``{activity: {resource_type: set(resource_ids)}}`` assigned earlier
            in the same process execution.

    Returns:
        tuple[set, list]: The forced resources, and the remaining
        constraint-compliant candidates in queue order.
    """
    forced = set()
    excluded = set()
    allowed = None
    for other_activity, type_ctype_map in activity_constraints.items():
        ctype = type_ctype_map.get(rt)
        refs = prior.get(other_activity, {}).get(rt)
        if ctype is None or not refs:
            continue
        if ctype == "superset":
            forced |= refs
        elif ctype == "disjoint":
            excluded |= refs
        else:
            allowed = set(refs) if allowed is None else allowed & refs
    free = [
        rid
        for rid in candidate_ids
        if rid not in forced
        and rid not in excluded
        and (allowed is None or rid in allowed)
    ]
    return forced, free


def _classify_assignment(chosen: list[str], free: list[str], idle_since: dict) -> str:
    """Classify the free picks of an assignment against the free candidates.

    The pick is consistent with FIFO when no unchosen candidate became idle
    earlier than a chosen one, and with LIFO when none became idle later. The
    comparison uses the next-idle times rather than queue positions, so ties do
    not depend on the queue's internal order. A pick consistent with both (no
    alternative, or all candidates tied) carries no evidence.

    Args:
        chosen: The assigned resources that were a free choice.
        free: The free candidates (``chosen`` is a subset of them).
        idle_since: resource_id -> next-idle timestamp.

    Returns:
        str: ``"FIFO"``, ``"LIFO"``, ``"other"`` or ``"no_choice"``.
    """
    chosen_set = set(chosen)
    rest = [idle_since[rid] for rid in free if rid not in chosen_set]
    picked = [idle_since[rid] for rid in chosen]
    if not picked or not rest:
        return "no_choice"
    fifo = max(picked) <= min(rest)
    lifo = min(picked) >= max(rest)
    if fifo and lifo:
        return "no_choice"
    if fifo:
        return "FIFO"
    if lifo:
        return "LIFO"
    return "other"


def count_allocation_evidence(
    ocel,
    resource_cooldowns: dict = None,
    resource_type_map: dict = None,
    calendars: dict[str, dict] | None = None,
    variants=None,
    resource_constraints: dict | None = None,
    fallback_constraints: dict | None = None,
    busy_quantile: float = BUSY_QUANTILE,
) -> dict[str, dict[str, int]]:
    """
    Replays the event log and counts the evidence about each type's allocation strategy.

    The replay processes the events chronologically and keeps, per resource type,
    the time at which each resource becomes idle again. For each event and
    resource type, the candidates are the registered resources that are idle and
    present under their calendar. The assignment is then classified as one of
    ``ASSIGNMENT_CATEGORIES`` (see ``_classify_assignment``) or excluded for one of
    ``EXCLUSION_REASONS``:

    - ``first_seen``: an assigned resource appears for the first time; it is not
      known whether it was selectable before.
    - ``not_idle``: an assigned resource is still busy or off shift in the
      replay, so the replay disagrees with the log.
    - ``constraint_violation``: the assignment breaks a mined constraint — it
      omits a resource forced by a ``superset`` relation or includes one the
      other relations rule out. The strict playout never produces it.
    - ``no_choice``: every feasible assignment is the observed one, e.g. as many
      candidates as required, or all candidates tied.

    When ``variants`` is given, the resource constraints restrict the candidates
    as in the strict playout allocator: resources forced by a ``superset``
    relation are no choice and leave both the assignment and the queue, and the
    remaining picks are classified against the constraint-compliant candidates
    only.

    Afterwards every assigned resource re-enters the queue after a busy time,
    whether or not the assignment was counted. The log does not show when a
    resource was released, only when it was used again: a cooldown sample is the
    gap until the next use. The busy time is therefore a high quantile of the
    activity's samples, so a resource only counts as idle — as a candidate and as
    a pick — once it almost certainly was. This trades evidence for correct
    candidate sets: under load, a shorter busy time makes resources that were
    still occupied look idle and invents alternatives that did not exist. When
    ``calendars`` is given, the busy time is calendar-discounted working time and
    is converted to the wall-clock end at which it accrues under the resource's
    calendar.

    Args:
        ocel: ObjectCentricEventLog — typically the filtered OCEL (contains process_area_resources in _attributes).
        resource_cooldowns: The resource cooldown distribution, structured as
                            {activity: {resource_type: {"samples": [...], ...}}}.
                            A missing entry means busy time 0.
        resource_type_map: Optional. A dict mapping resource_id -> resource_type, used to resolve
                           the type of resources in process_area_resources. Needed, as algorithm also runs on filtered OCELs
                           where the resource types are no longer directly visible
        calendars: Optional ``{key: {weekday: [24 floats]}}`` calendar probabilities
                   keyed by resource id (preferred) or resource type (fallback). A
                   resource with neither falls back to wall-clock time.
        variants: Optional variants of ``ocel`` whose executions scope the
                  constraints. Without them, constraints are ignored.
        resource_constraints: Per-variant constraints from ``generate_resource_constraints``.
        fallback_constraints: The pooled constraints for variants not in ``resource_constraints``.
        busy_quantile: Quantile of an activity's cooldown samples taken as the
                       busy time of the resources it uses.

    Returns:
        dict: {resource_type: {category: count}} over ``ASSIGNMENT_CATEGORIES`` and
        ``EXCLUSION_REASONS``, for every resource type assigned in the log.
    """
    if resource_cooldowns is None:
        resource_cooldowns = {}
    if resource_type_map is None:
        resource_type_map = ocel.obj_type_map
    calendars = calendars or {}
    busy_times = _busy_times(resource_cooldowns, busy_quantile)
    event_constraints = _constraints_by_event(
        variants, resource_constraints, fallback_constraints
    )

    counts: dict[str, dict[str, int]] = defaultdict(
        lambda: dict.fromkeys(ASSIGNMENT_CATEGORIES + EXCLUSION_REASONS, 0)
    )

    # idle_since[resource_type][resource_id] = timestamp the resource is idle again
    idle_since: dict[str, dict[str, int]] = defaultdict(dict)

    # prior[execution][activity][resource_type] = resources assigned so far
    prior: dict[int, dict[str, dict[str, set]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(set))
    )

    for row in ocel.events.sort("_timestampUnix", maintain_order=True).iter_rows(
        named=True
    ):
        timestamp: int = row["_timestampUnix"]
        activity: str = row["_activity"]

        if not row["_attributes"]:
            continue
        try:
            attrs = json.loads(row["_attributes"])
        except json.JSONDecodeError:
            continue

        resources: list[str] = attrs.get("process_area_resources") or []
        if not resources:
            continue

        resources_by_type: dict[str, list[str]] = defaultdict(list)
        for rid in dict.fromkeys(resources):
            rt = resource_type_map.get(rid)
            if rt:
                resources_by_type[rt].append(rid)

        execution, constraints = event_constraints.get(row["_eventId"], (None, {}))
        history = prior[execution] if execution is not None else {}
        activity_constraints = constraints.get(activity, {})

        for rt, actual_rids in resources_by_type.items():
            idle = idle_since[rt]
            candidates = [
                rid
                for rid, ts in idle.items()
                if ts <= timestamp and _resource_present(calendars, rid, rt, timestamp)
            ]
            candidate_set = set(candidates)

            if any(rid not in idle for rid in actual_rids):
                outcome = "first_seen"
            elif not candidate_set.issuperset(actual_rids):
                outcome = "not_idle"
            else:
                forced, free = _apply_constraints(
                    candidates, rt, activity_constraints, history
                )
                chosen = [rid for rid in actual_rids if rid not in forced]
                if not forced.issubset(actual_rids) or not set(free).issuperset(chosen):
                    outcome = "constraint_violation"
                else:
                    outcome = _classify_assignment(chosen, free, idle)
            counts[rt][outcome] += 1

            busy = busy_times.get((activity, rt), 0.0)
            for rid in actual_rids:
                calendar = _resource_calendar(calendars, rid, rt)
                idle[rid] = (
                    wall_clock_end_for_available(calendar, int(timestamp), busy)
                    if calendar
                    else int(timestamp + busy)
                )

        if execution is not None:
            for rt, actual_rids in resources_by_type.items():
                history[activity][rt].update(actual_rids)

    return dict(counts)


def select_allocation_strategy(
    counts: dict[str, int],
    min_absolute_support: int = MIN_ABSOLUTE_SUPPORT,
    min_relative_support: float = MIN_RELATIVE_SUPPORT,
) -> str:
    """Pick a resource type's strategy from its counting vector.

    FIFO or LIFO is chosen only when it is the unique most frequent category, has
    at least ``min_absolute_support`` hits and a share of at least
    ``min_relative_support`` of the informative assignments. Otherwise — too
    little, ambiguous, or mostly ``other`` evidence — the type falls back to
    ``"random"``.

    Args:
        counts: {category: count}, as returned per type by ``count_allocation_evidence``.
        min_absolute_support: Minimum number of hits of the chosen strategy.
        min_relative_support: Minimum share of the chosen strategy among the
            informative assignments.

    Returns:
        str: One of ``ALLOCATION_STRATEGIES``.
    """
    vector = {h: counts.get(h, 0) for h in ASSIGNMENT_CATEGORIES}
    best = max(vector, key=vector.get)
    unique = all(vector[best] > v for h, v in vector.items() if h != best)
    if (
        best in ("FIFO", "LIFO")
        and unique
        and vector[best] >= min_absolute_support
        and vector[best] / sum(vector.values()) >= min_relative_support
    ):
        return best
    return "random"


def calculate_resource_allocation_strategy(
    ocel,
    resource_cooldowns: dict = None,
    resource_type_map: dict = None,
    calendars: dict[str, dict] | None = None,
    variants=None,
    resource_constraints: dict | None = None,
    fallback_constraints: dict | None = None,
    min_absolute_support: int = MIN_ABSOLUTE_SUPPORT,
    min_relative_support: float = MIN_RELATIVE_SUPPORT,
    busy_quantile: float = BUSY_QUANTILE,
) -> dict:
    """
    Analyzes the event log to determine the most likely resource allocation strategy per resource type.

    Counts the evidence with ``count_allocation_evidence`` and selects a strategy
    per type with ``select_allocation_strategy``. See there for the arguments.

    Returns:
        dict: {resource_type: strategy} for every resource type assigned in the
        log, where strategy is one of ALLOCATION_STRATEGIES.
    """
    counts = count_allocation_evidence(
        ocel,
        resource_cooldowns,
        resource_type_map,
        calendars,
        variants,
        resource_constraints,
        fallback_constraints,
        busy_quantile,
    )
    return {
        rt: select_allocation_strategy(c, min_absolute_support, min_relative_support)
        for rt, c in counts.items()
    }
