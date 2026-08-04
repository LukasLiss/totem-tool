import datetime as dt
import json
import random
from collections import Counter, defaultdict

import numpy as np
import polars as pl

from totem_lib import mlpaDiscovery, totemDiscovery
from totem_lib.ocel.ocel import EVENTS_SCHEMA, OBJECTS_SCHEMA, ObjectCentricEventLog
from totem_lib.simulation.utils.basic_simulation_statistics import (
    WEEKDAY_NAMES,
    activity_delay_distribution,
    resource_distribution_of_variants,
)
from totem_lib.simulation.utils.basic_simulation_statistics import (
    variant_arrival_distribution as compute_variant_arrival_distribution,
)
from totem_lib.simulation.utils.resource_calendar import (
    availability_probability,
    discover_resource_calendars,
)
from totem_lib.simulation.utils.resource_constraints import (
    generate_resource_constraints,
)
from totem_lib.simulation.utils.resource_statistics import (
    calculate_resource_allocation_strategy,
    resource_cooldown_distribution,
    sample_cooldown,
)
from totem_lib.simulation.utils.state_space import StateSpaceModel
from totem_lib.variants.ocvariants import find_object_variants_connected_component
from totem_lib.variants.state_space_executions import find_object_structure_variants

### Default Configuration
RESOURCE_CONSTRAINT_VIOLATION_DEGREE = 0.0  # Degree to which resource constraints can be violated. Value between 0 and 1 where 0 means strictly following all constraints and 1 allows to ignore all constraints.
CONSTRAINT_LOOKBACK_LENGTH = None  # Number of prior events to look back for when checking constraints. Higher values may lead to more realistic simulations but also increased computational complexity. If value is None, then all prior events will be considered.
# Relative cost of violating each constraint type, expressed in budget units. A
# higher cost makes a violation of that type rarer for a given violation degree.
VIOLATION_COST_WEIGHTS = {
    "same_resource": 2.0,
    "subset": 1.0,
    "disjoint": 1.0,
    "superset": 1.0,
}
# Whether to space successor activities additionally by sampled inter-event times
# Needed when the only resource based steering of activity enablement is not enough
# This might occur, when the log is sparse, or many resources are available
MODEL_ACTIVITY_DURATIONS = True


class _ViolationBudget:
    """
    Per-instance budget for soft resource-constraint violations.

    The budget is measured in *cost units*. The cost of a single resource pick is
    the **sum** of ``cost_weights[type]`` over every constraint that pick would
    break — so a resource that violates several constraints at once is charged
    for all of them (see ``_inclusion_cost``).
    The budget is set once per process instance, based on the known/expected number of events and following from that the expected number of resource allocations.
    It is then spent online, one constraint-relevant resource slot at a time, to avoid temporal bias.
    """

    def __init__(self, remaining_budget, remaining_slots, cost_weights):
        self.remaining_budget = float(remaining_budget)
        self.remaining_slots = int(remaining_slots)
        self.cost_weights = cost_weights
        self.used = 0.0

    def clone(self):
        c = _ViolationBudget(
            self.remaining_budget, self.remaining_slots, self.cost_weights
        )
        c.used = self.used
        return c

    def try_spend(self, cost, forced):
        """
        Decide whether to spend ``cost`` budget units at the current slot.

        ``cost`` is the *summed* violation cost of the resource being considered
        (0 if it is fully compliant). The per-slot probability keeps the expected
        spend per slot constant — ``remaining_budget / remaining_slots`` — so
        violations are spread evenly over the execution and a dearer violation
        (higher cost) is correspondingly rarer.

        Args:
            cost: Summed cost of the candidate violation (>= 0).
            forced: True if there is no compliant (cost-0) alternative for this
                slot, so the violation is unavoidable.

        Returns:
            True  -> spend (budget already charged),
            False -> do not violate this slot,
            None  -> infeasible: a forced violation cannot be afforded, so the
                     whole allocation must fail.
        """
        if cost <= 0:
            # Compliant pick: no charge, but the slot is consumed.
            self.remaining_slots = max(0, self.remaining_slots - 1)
            return False

        if forced:
            if self.remaining_budget < cost:
                return None
            self.remaining_budget -= cost
            self.used += cost
            self.remaining_slots = max(0, self.remaining_slots - 1)
            return True

        spend = False
        if self.remaining_budget >= cost and self.remaining_slots > 0:
            p = min(1.0, (self.remaining_budget / self.remaining_slots) / cost)
            if random.random() < p:
                spend = True
                self.remaining_budget -= cost
                self.used += cost
        self.remaining_slots = max(0, self.remaining_slots - 1)
        return spend


def _estimate_constraint_slots(
    variant_constraints, variant_res_dist, resource_pool_expanded
):
    """
    Estimate the number of constraint-relevant resource slots of a process instance.
    Used in the simple Simulation Model to set the per-instance violation budget.

    Sums, for every activity that carries at least one resource constraint, the
    *expected* number of resources it needs of each type present in the pool.

    Args:
        variant_constraints: {activity: {other_activity: {res_type: constraint_type}}}
            dict for this variant.
        variant_res_dist: {activity: {res_type: {"count_distribution": {count: float}}}} dict for this variant.
        resource_pool_expanded: Set of resource types actually available in the pool.

    Returns:
        Expected slot count as a float.
    """
    total = 0.0
    for activity in variant_constraints:
        activity_res_dist = variant_res_dist.get(activity, {})
        for res_type, stats in activity_res_dist.items():
            if res_type in resource_pool_expanded:
                total += max(0.0, _distribution_mean(stats["count_distribution"]))
    return total


def _estimate_expected_constraint_slots(
    expected_activity_occurrences,
    constrained_activities,
    expected_resource_demand,
    resource_pool_expanded,
):
    """
    Expected number of constraint-relevant resource slots of a *state-space* instance.
    Used in the Advanced Simulation Model to set the per-instance violation budget.

    Args:
        expected_activity_occurrences: {activity: E[#occurrences per instance]},
            e.g. expected number of visits to transitions labelled with the
            activity before absorption in the state space.
        constrained_activities: Set/collection of activities that carry at least
            one discovered resource constraint (the indicator above).
        expected_resource_demand: {activity: {res_type: {"count_distribution":
            {count: float}}}} — empirical resource demand per occurrence.
        resource_pool_expanded: Resource types actually available in the pool.

    Returns:
        Expected slot count as a float. Callers resolve the fractional part via
        stochastic rounding in ``_make_violation_budget``.
    """
    constrained = set(constrained_activities)
    total = 0.0
    for activity, expected_visits in expected_activity_occurrences.items():
        if activity not in constrained:
            continue
        demand = expected_resource_demand.get(activity, {})
        for res_type, stats in demand.items():
            if res_type in resource_pool_expanded:
                mean = _distribution_mean(stats.get("count_distribution", {}))
                total += expected_visits * max(0.0, mean)
    return total


def _estimate_structure_activity_occurrences(structure_variant, model, rng, n_samples):
    """Monte-Carlo estimate of expected activity occurrences for one structure. - Needed for the advanced playout, 
    as the events of the variant, are not already given be the input variant

    Generates ``n_samples`` executions over a fresh clone of the structure's
    skeleton and averages the activity counts. Feeds the per-structure violation
    budget (the state-space analogue of the variant playout's expected-slot count,
    where the DAG makes the occurrences exact).
    """
    totals = Counter()
    for i in range(n_samples):
        graph, _ = model.new_generator(
            structure_variant.instantiate(-(i + 1)), rng
        ).run()
        for _, data in graph.nodes(data=True):
            totals[data["label"]] += 1
    return {activity: n / n_samples for activity, n in totals.items()}


def _make_violation_budget(total_slots, simulation_config):
    """
    Pre-sample a per-instance ``_ViolationBudget`` from a (possibly expected) slot count.

    Args:
        total_slots: Number (int or float) of constraint-relevant slots.
        simulation_config: Provides violation degree and cost weights.

    Returns:
        A fresh ``_ViolationBudget`` for one process instance.
    """
    degree = simulation_config.resource_constraint_violation_degree
    raw_budget = total_slots * degree
    budget_units = int(raw_budget)
    if random.random() < (raw_budget - budget_units):
        budget_units += 1  # stochastic rounding of the fractional part
    return _ViolationBudget(
        budget_units,
        max(0, round(total_slots)),
        simulation_config.violation_cost_weights,
    )


def _distribution_mean(count_distribution):
    """Expected value E[count] of an empirical count distribution {count: prob}."""
    return sum(count * prob for count, prob in count_distribution.items())


def _sample_resource_count(stats):
    """
    Draw the number of resources of one type an activity needs this invocation.

    Args:
        stats: Per-(activity, resource_type) stats dict from
            ``resource_distribution_of_variants``.

    Returns:
        A non-negative integer resource count.
    """
    dist = stats["count_distribution"]
    return random.choices(list(dist.keys()), weights=list(dist.values()), k=1)[0]


def _sample_activity_delay(activity, activity_delays):
    """
    Sample the delay (seconds) before ``activity`` fires, from the
    empirical pool learned by ``activity_delay_distribution``.
    """
    samples = activity_delays.get(activity)
    if not samples:
        return 0
    return random.choice(samples)


def _get_node_objects(graph, node):
    """Collect all object IDs from incident edges of a node."""
    objects = set()
    for pred in graph.predecessors(node):
        for obj_id in graph.edges[pred, node].get("objects", []):
            objects.add(obj_id)
    for succ in graph.successors(node):
        for obj_id in graph.edges[node, succ].get("objects", []):
            objects.add(obj_id)
    return objects


def _next_resource_free(blocked_resources, tick):
    """
    Earliest tick at which a currently blocked resource frees again, or None if
    none are blocked. A resource-blocked instance cannot make progress before
    this time
    """
    future = [cd for _, cd in blocked_resources if cd > tick]
    return min(future) if future else None


def _earliest_future_ready(inst, tick, activity_delays):
    """
    Earliest future ``ready_at`` among the instance's currently enabled nodes
    (duration model), or None if every enabled node is already due.
    """
    ready_at = inst["ready_at"]
    preds_map = inst["preds_map"]
    finish_tick = inst["finish_tick"]
    node_labels = inst["node_labels"]
    earliest = None
    for n in inst["enabled_set"]:
        preds = preds_map[n]
        if not preds:
            continue  # start node: due now, not a future wake
        ra = ready_at.get(n)
        if ra is None:
            enabling_tick = max(finish_tick[p] for p in preds)
            ra = enabling_tick + _sample_activity_delay(node_labels[n], activity_delays)
            ready_at[n] = ra
        if ra > tick and (earliest is None or ra < earliest):
            earliest = ra
    return earliest


class _CalendarGate:
    """Realizes one probabilistic shift schedule per resource instance.

    A calendar states the *probability* a resource is present in a given
    (weekday, hour) slot. The gate turns that into a single realized schedule:
    for each ``(resource, absolute clock hour)`` the on/off decision is drawn
    **once** (Bernoulli with the slot probability) and cached, so a resource can
    never be "present" for one query and "absent" for another in the same hour.
    This is used for resource allocation & cooldown elapsing.  An individual resource
    calendar takes precedence over its type calendar; with neither, the resource
    is always present.

    Calendars are the serialized ``{id: {weekday: [24 floats]}}`` probability
    matrices (``ResourceCalendar.probability``).
    """

    # Safety cap for the hour-stepping burn-down below: stops runaway iteration
    # on a (near-)zero calendar where presence accrues so slowly it would never
    # exhaust the budget. ~5 years of hours.
    _MAX_COOLDOWN_HOURS = 24 * 365 * 5

    def __init__(self, type_calendars, resource_calendars):
        self.type_cals = type_calendars or {}
        self.res_cals = resource_calendars or {}
        self.active = bool(self.type_cals or self.res_cals)
        # One realized presence bit per (resource, absolute clock hour), shared by
        # allocation and cooldown
        self._shift: dict[tuple[str, int], bool] = {}

    def _calendar(self, rid, res_type):
        """The calendar governing a resource instance (per-instance over type)."""
        return self.res_cals.get(rid) or self.type_cals.get(res_type)

    def _present(self, rid, res_type, hour_index, timestamp_s) -> bool:
        """Realized presence of a resource in an absolute clock hour (cached)."""
        key = (rid, hour_index)
        cached = self._shift.get(key)
        if cached is not None:
            return cached
        calendar = self._calendar(rid, res_type)
        p = availability_probability(calendar, timestamp_s) if calendar else 1.0
        if p >= 1.0:
            value = True
        elif p <= 0.0:
            value = False
        else:
            value = random.random() < p
        self._shift[key] = value
        return value

    def is_available(self, rid, res_type, hour_index, timestamp_s) -> bool:
        if not self.active:
            return True
        return self._present(rid, res_type, hour_index, timestamp_s)

    def cooldown_end(self, rid, res_type, start_s, work_seconds) -> int:
        """Absolute second at which a cooldown of ``work_seconds`` finishes.

        The cooldown is working time, so it burns only while the resource is
        realized as present — consuming the same per-hour Bernoulli presence bits
        as allocation. Hours the resource is absent pause the countdown, pushing
        the reuse past the gap. Ungated (no calendar) → plain wall-clock advance.
        """
        if work_seconds <= 0:
            return start_s
        if not self.active or not self._calendar(rid, res_type):
            return start_s + int(round(work_seconds))
        remaining = float(work_seconds)
        cur = start_s
        for _ in range(self._MAX_COOLDOWN_HOURS):
            hour_index = cur // 3600
            hour_end = (hour_index + 1) * 3600
            if self._present(rid, res_type, hour_index, cur):
                avail = hour_end - cur
                if avail >= remaining:
                    return int(round(cur + remaining))
                remaining -= avail
            cur = hour_end
        # Fallback for a (near-)zero calendar: add the remainder as wall clock.
        return int(round(cur + remaining))


def _select_by_strategy(available_rids, strategy):
    """Pick a resource ID from available list based on allocation strategy."""
    if not available_rids:
        return None
    if strategy == "FIFO":
        return available_rids[0]
    elif strategy == "LIFO":
        return available_rids[-1]
    else:
        return random.choice(available_rids)


def _get_resources_by_activity(simulated_events, resource_id_type_map):
    """
    Build mapping {activity: {res_type: [res_id, ...]}} from simulated events.
    Each simulated event has keys '_activity' and 'process_area_resources' (list of res_ids).
    """
    result = defaultdict(lambda: defaultdict(list))
    for event in simulated_events:
        act = event["_activity"]
        for rid in event.get("process_area_resources", []):
            res_type = resource_id_type_map.get(rid)
            if res_type:
                result[act][res_type].append(rid)
    return result


def _inclusion_cost(resource, restrictive_constraints, cost_weights):
    """
    Summed violation cost of *including* ``resource``.

    Adds up the weight of every restrictive constraint the resource would break:
    a ``subset``/``same_resource`` constraint is broken when the resource lies
    *outside* its reference set, a ``disjoint`` constraint when it lies *inside*.
    A resource that breaks several constraints pays for all of them.

    Args:
        resource: The resource ID under consideration.
        restrictive_constraints: List of (ctype, refs) where ctype is one of
            "subset", "same_resource", "disjoint" and refs is a frozenset.
        cost_weights: Per-type cost weights (e.g. VIOLATION_COST_WEIGHTS).

    Returns:
        Total cost (float). 0.0 means the resource is fully compliant.
    """
    cost = 0.0
    for ctype, refs in restrictive_constraints:
        if ctype == "disjoint":
            if resource in refs:
                cost += cost_weights.get("disjoint", 1.0)
        else:  # "subset" or "same_resource": the resource must lie within refs
            if resource not in refs:
                cost += cost_weights.get(ctype, 1.0)
    return cost


def _allocate_single_type(n, free, constraints, vb, strategy):
    """
    Allocate ``n`` resources of one type, spending the violation budget ``vb``.

    ``constraints`` is the *raw*, un-aggregated list of constraints affecting this
    type — one ``(ctype, refs)`` entry per (prior activity, constraint).

    When the budget allows a deliberate violation, the *cheapest* non-compliant
    resource is chosen (minimal deviation); a violation is otherwise only taken
    when forced (no compliant resource is available).

    Args:
        n: Number of resources to allocate.
        free: Iterable of currently available resource IDs of this type.
        constraints: List of (ctype, frozenset(refs)) affecting this type.
        vb: The (cloned) _ViolationBudget to spend.
        strategy: Allocation strategy name for picking within a pool.

    Returns:
        list of resource IDs, or None if no feasible allocation exists.
    """
    weights = vb.cost_weights
    restrictive = [
        (ct, refs)
        for ct, refs in constraints
        if ct in ("subset", "disjoint", "same_resource")
    ]
    superset_refs = [refs for ct, refs in constraints if ct == "superset"]

    free_pool = list(free)
    selected = []

    # --- no constraints on this type: plain strategy allocation, no budget ---
    # These slots are not constraint-relevant, so they must NOT consume the
    # violation budget's slot counter
    if not restrictive and not superset_refs:
        if len(free_pool) < n:
            return None
        for _ in range(n):
            chosen = _select_by_strategy(free_pool, strategy)
            free_pool.remove(chosen)
            selected.append(chosen)
        return selected

    # --- superset (must_use): required inclusions / charged omissions ---
    if superset_refs:
        required_counts = Counter()
        for refs in superset_refs:
            for m in refs:
                required_counts[m] += 1
        w_sup = weights.get("superset", 1.0)
        for m, cnt in required_counts.items():
            if m in free_pool and len(selected) < n:
                # Include m, but pay for any *other* constraints it breaks.
                if vb.try_spend(_inclusion_cost(m, restrictive, weights), True) is None:
                    return None
                free_pool.remove(m)
                selected.append(m)
            else:
                # Cannot include (unavailable or no slot left) -> charged omission.
                if vb.try_spend(cnt * w_sup, forced=True) is None:
                    return None

    if len(selected) > n:
        return None

    # --- remaining slots: pick by summed inclusion cost ---
    # Inclusion cost
    costs = {r: _inclusion_cost(r, restrictive, weights) for r in free_pool}
    for _ in range(n - len(selected)):
        if not free_pool:
            return None

        compliant = [r for r in free_pool if costs[r] == 0]
        violating = [r for r in free_pool if costs[r] > 0]

        # The deviation we would take this slot is the cheapest non-compliant one.
        if violating:
            min_cost = min(costs[r] for r in violating)
            cheapest = [r for r in violating if costs[r] == min_cost]
            viol_cand = _select_by_strategy(cheapest, strategy)
            viol_cost = costs[viol_cand]
        else:
            viol_cand, viol_cost = None, 0.0

        forced = not compliant
        spent = vb.try_spend(viol_cost, forced=forced)
        if spent is None:
            return None  # forced violation the budget cannot afford
        if spent:
            chosen = viol_cand
        else:
            chosen = _select_by_strategy(compliant, strategy)

        free_pool.remove(chosen)
        selected.append(chosen)

    return selected


def _allocate_resources(
    activity,
    variant_constraints,
    simulated_events,
    resource_queues,
    resource_id_type_map,
    allocation_strategy,
    needed_res_types,
    simulation_config,
    violation_budget,
    prior_assignments_full=None,
):
    """
    Allocate resources for an activity, respecting the given constraints.

    Uses a two-phase approach:
        Phase 1 — Collect the raw constraints per resource type (one entry per
            (prior activity, constraint type).

        Phase 2 — Allocate per resource type via ``_allocate_single_type``, which
            spends the per-instance violation budget on a working copy. The copy
            is only committed (returned) when the whole allocation succeeds.

    The simulation_config controls constraint strictness via:
        - resource_constraint_violation_degree:
            0   → strict: constraints act as hard filters (budget is 0).
            0-1 → soft: up to ~degree of the constraint-relevant resource slots
                  of an instance may deviate, weighted by violation_cost_weights.
            1   → all constraints are skipped entirely.
        - constraint_lookback_length:
            If set, only the last N simulated events are considered.
        - violation_cost_weights:
            Relative cost per constraint type (same_resource is dearest).

    Args:
        activity: The activity to allocate resources for.
        variant_constraints: Constraints dict for this variant:
            {activity: {other_activity: {res_type: constraint_type}}}.
        simulated_events: List of already simulated events in this instance,
                          each with '_activity' and 'process_area_resources' keys.
        resource_queues: Currently available resources: {res_type: [res_id, ...]}.
        resource_id_type_map: Mapping from resource ID to resource type.
        allocation_strategy: {res_type: strategy_name} for picking from available pool.
        needed_res_types: Dict {res_type: count} — how many of each type this activity needs.
        simulation_config: Config of the Simulation Model.
        violation_budget: The instance's _ViolationBudget (spent on a working copy).
        prior_assignments_full: Optional pre-built {activity: {res_type: [res_id, ...]}}
            covering the instance's full history (maintained incrementally by the
            caller). Used directly when no lookback window is configured to avoid
            rescanning ``simulated_events`` on every allocation.

    Returns:
        (assignment, budget) where assignment is {res_type: [res_id, ...]} and
        budget is the updated _ViolationBudget on success, or (None, unchanged
        budget) if no allocation is possible.
    """

    violation_degree = simulation_config.resource_constraint_violation_degree

    # If violation_degree == 1, skip all constraint logic and just allocate freely
    if violation_degree == 1.0:
        assignment = {}
        for res_type, n in needed_res_types.items():
            available = list(resource_queues.get(res_type, []))
            if len(available) < n:
                return None, violation_budget
            strategy = allocation_strategy.get(res_type, "random")
            selected = []
            for _ in range(n):
                chosen = _select_by_strategy(available, strategy)
                selected.append(chosen)
                available.remove(chosen)
            assignment[res_type] = selected
        return assignment, violation_budget

    # Resolve the prior resource assignments to check constraints against.
    lookback = simulation_config.constraint_lookback_length
    if lookback is not None:
        prior_assignments = _get_resources_by_activity(
            simulated_events[-lookback:], resource_id_type_map
        )
    elif prior_assignments_full is not None:
        prior_assignments = prior_assignments_full
    else:
        prior_assignments = _get_resources_by_activity(
            simulated_events, resource_id_type_map
        )

    constraints_for_activity = variant_constraints.get(activity, {})

    # ── Phase 1: Collect the raw constraints per resource type ──
    # Constraints are keyed per resource type: {other_activity: {res_type: ctype}}.
    # Each type's relation is enforced only against that type's prior resources.
    constraints_by_type = defaultdict(list)  # res_type -> [(ctype, frozenset), ...]
    for other_act, type_ctype_map in constraints_for_activity.items():
        if other_act not in prior_assignments:
            continue
        for res_type, res_ids in prior_assignments[other_act].items():
            if res_type not in needed_res_types:
                continue
            ctype = type_ctype_map.get(res_type)
            if ctype is None:
                continue
            constraints_by_type[res_type].append((ctype, frozenset(res_ids)))

    # ── Phase 2: Allocate per resource type, spending a working copy of the budget ──

    vb = violation_budget.clone()
    assignment = {}

    for res_type, n in needed_res_types.items():
        strategy = allocation_strategy.get(res_type, "random")
        result = _allocate_single_type(
            n,
            resource_queues.get(res_type, []),
            constraints_by_type.get(res_type, []),
            vb,
            strategy,
        )
        if result is None:
            return None, violation_budget  # discard the working copy
        assignment[res_type] = result

    return assignment, vb


class OCProcessAreaSimulationConfiguration:
    """
    Configuration for OC Process Area Simulation.
    This class captures all the parameters and settings needed to run a simulation. It includes:

    - Resource constraint violation degree: Degree to which resource constraints can be violated. Value between 0 and 1 where 0 means strictly following all Constraints and 1 allows to ignore all constraints
    - Constraint_Lookback_Length: Number of prior events to look back for when checking constraints. Higher values may lead to more realistic simulations but also increased computational complexity. If value is None, then all prior events will be considered
    - Violation_Cost_Weights: Relative cost (in budget units) of violating each
      constraint type. A higher cost makes that violation type rarer for a given
      violation degree;
    - Model_Activity_Durations: When True, successor activities are delayed by
      inter-activity durations sampled from the log so simulated cycle times are
      realistic. When False, activities fire on the next tick when enabled
    """

    def __init__(
        self,
        resource_constraint_violation_degree=RESOURCE_CONSTRAINT_VIOLATION_DEGREE,
        constraint_lookback_length=CONSTRAINT_LOOKBACK_LENGTH,
        violation_cost_weights=VIOLATION_COST_WEIGHTS,
        model_activity_durations=MODEL_ACTIVITY_DURATIONS,
    ):
        self.resource_constraint_violation_degree = resource_constraint_violation_degree
        self.constraint_lookback_length = constraint_lookback_length
        self.violation_cost_weights = violation_cost_weights.copy()
        self.model_activity_durations = model_activity_durations


class OCProcessAreaSimulationModel:
    """
    Represents the Object-Centric Simulation Model for a specific process area.

    This model captures the behavior of objects, resources and their apearance in activities based on the OCEL and the discovered variants.
    It can be used to simulate the execution of the process area under different scenarios, such as varying arrival rates, resource availability, and object interactions.
    It includes:
    - ToTem Model: The discovered ToTem model for the process, giving higher-level information about the process
    - PlayoutStrategy: Strategy for the playout of the simulation model. This can be a simple playout based on the discovered variants, or a more complex playout based on the stochastic state-space of the process.
    - Resource Constraints: Constraints captued from the OCEL or coming from user input, that represent extra knowledge about the resources used by different events
    - Resource Allocation Strategy: A strategy for allocating resources to events during the simulation, based on the observed behavior in the OCEL or from user input.
    - Resource Cooldown Distribution: A distribution capturing the cooldown times of resources after being used in specific events.
    """

    def __init__(
        self,
        playout_strategy,
        resource_constraints,
        resource_allocation_strategy,
        resource_cooldown_distribution,
        totem_model,
        needed_resources_per_activity,
        simulation_config,
        source_log_start_unix,
        activity_delays=None,
        type_calendars=None,
        resource_calendars=None,
        fallback_constraints=None,
    ):
        self.playout_strategy = playout_strategy
        self.resource_constraints = resource_constraints
        self.fallback_constraints = fallback_constraints or {}
        self.resource_allocation_strategy = resource_allocation_strategy
        self.resource_cooldown_distribution = resource_cooldown_distribution
        self.totem_model = totem_model
        self.needed_resources_per_activity = needed_resources_per_activity
        self.simulation_config = simulation_config
        self.source_log_start_unix = source_log_start_unix
        self.activity_delays = activity_delays or {}
        self.type_calendars = type_calendars or {}
        self.resource_calendars = resource_calendars or {}

    def run(
        self,
        sim_duration_s: int,
        resource_pool: dict,
        tick_size_s: int = 60,
        start_datetime: dt.datetime = None,
        progress_callback=None,
    ):
        return self.playout_strategy.run(
            self,
            sim_duration_s,
            resource_pool,
            tick_size_s,
            start_datetime,
            progress_callback=progress_callback,
        )

    @classmethod
    def for_simple_simulation(cls, ocel, process_area, resource_types=None):

        # Discover ToTem Model and MLPA
        totem_model = totemDiscovery(ocel)
        mlpa = mlpaDiscovery(totem_model)

        # Discover resource availability calendars
        type_calendars = {}
        if resource_types:
            type_calendars = {
                rtype: cal.probability
                for rtype, cal in discover_resource_calendars(
                    ocel, resource_types, ocel.obj_type_map
                ).items()
            }

        # Calculate Resource Cooldown Distribution including the resource calendars
        cooldown_types = resource_types if resource_types else process_area.object_types
        resource_cooldown_dist = resource_cooldown_distribution(
            ocel, cooldown_types, process_area.activities, calendars=type_calendars
        )

        # Filter event log on Process Area
        filtered_ocel = ocel.filter_by_process_area(mlpa, process_area)

        # Calculate Variants
        variants = find_object_variants_connected_component(filtered_ocel)

        # Calculate Variants Arrival Distribution
        var_arrival_dist = compute_variant_arrival_distribution(filtered_ocel, variants)

        # Initilize Playout Strategy
        playout_strategy = VariantPlayoutStrategy(variants, var_arrival_dist)

        # Calculate Resource Constraints
        resource_constraints, fallback_constraints = generate_resource_constraints(
            filtered_ocel, variants, ocel.obj_type_map, support_threshold_percentage=0.8
        )

        # Calculate Resource Allocation Strategy
        resource_allocation_strategy = calculate_resource_allocation_strategy(
            filtered_ocel, resource_cooldown_dist, ocel.obj_type_map, type_calendars
        )

        # Calculate needed resources per activity.
        needed_resources_per_activity = resource_distribution_of_variants(
            filtered_ocel, variants, ocel.obj_type_map
        )

        # First event of the filtered log — the default simulation start.
        source_log_start_unix = (
            filtered_ocel.events.select("_timestampUnix").to_series().min()
        )

        # Inter-activity delays (for the duration model)
        activity_delays = activity_delay_distribution(filtered_ocel)

        return cls(
            playout_strategy,
            resource_constraints,
            resource_allocation_strategy,
            resource_cooldown_dist,
            totem_model,
            needed_resources_per_activity,
            OCProcessAreaSimulationConfiguration(),
            source_log_start_unix,
            activity_delays=activity_delays,
            type_calendars=type_calendars,
            fallback_constraints=fallback_constraints,
        )

    @classmethod
    def for_advanced_simulation(
        cls, ocel, process_area, resource_types=None, runtime_context_provider=None
    ):
        # Discover ToTem Model and MLPA
        totem_model = totemDiscovery(ocel)
        mlpa = mlpaDiscovery(totem_model)

        # Discover resource availability calendars
        type_calendars = {}
        if resource_types:
            type_calendars = {
                rtype: cal.probability
                for rtype, cal in discover_resource_calendars(
                    ocel, resource_types, ocel.obj_type_map
                ).items()
            }

        # Calculate Resource Cooldown Distribution
        cooldown_types = resource_types if resource_types else process_area.object_types
        resource_cooldown_dist = resource_cooldown_distribution(
            ocel, cooldown_types, process_area.activities, calendars=type_calendars
        )

        # Filter event log on Process Area
        filtered_ocel = ocel.filter_by_process_area(mlpa, process_area)

        # Object-structure variants: the arrival units (object connected components
        # clustered by structure). This mirrors for_simple_simulation — everything
        # the simple mode keys on a Variant, the advanced mode keys on one of these.
        structure_variants = find_object_structure_variants(filtered_ocel)

        # Arrival distribution per structure variant.
        arrival_distribution = compute_variant_arrival_distribution(
            filtered_ocel, structure_variants
        )

        # Generative transition model: activities + participants over a structure.
        state_space_model = StateSpaceModel.build(filtered_ocel)

        # Playout strategy
        playout_strategy = StateSpacePlayoutStrategy(
            state_space_model,
            structure_variants,
            arrival_distribution,
            runtime_context_provider,
        )

        # Per-structure resource constraints, plus a pooled global fallback.
        resource_constraints, fallback_constraints = generate_resource_constraints(
            filtered_ocel,
            structure_variants,
            ocel.obj_type_map,
            support_threshold_percentage=0.8,
        )

        # Calculate Resource Allocation Strategy
        resource_allocation_strategy = calculate_resource_allocation_strategy(
            filtered_ocel, resource_cooldown_dist, ocel.obj_type_map, type_calendars
        )

        # Per-structure needed resources per activity.
        needed_resources_per_activity = resource_distribution_of_variants(
            filtered_ocel, structure_variants, ocel.obj_type_map
        )

        # First event of the filtered log — the default simulation start.
        source_log_start_unix = (
            filtered_ocel.events.select("_timestampUnix").to_series().min()
        )

        # Inter-activity delays (for the duration model)
        activity_delays = activity_delay_distribution(filtered_ocel)

        return cls(
            playout_strategy,
            resource_constraints,
            resource_allocation_strategy,
            resource_cooldown_dist,
            totem_model,
            needed_resources_per_activity,
            OCProcessAreaSimulationConfiguration(),
            source_log_start_unix,
            activity_delays=activity_delays,
            type_calendars=type_calendars,
            fallback_constraints=fallback_constraints,
        )


# --- Shared playout helpers --------------------------------------------------
# Both playout strategies drive the same tick-based resource/cooldown/calendar/
# duration loop; only the *source of the next event* differs (replay a discovered
# variant DAG vs. generate the next event from the state space). These module-level
# helpers hold the machinery both loops share, so each ``run`` stays focused on its
# own spawning + firing logic instead of one class inheriting the other's loop.


def generate_arrival_schedule(
    payloads, arrival_distributions, start_datetime, sim_duration_s: int
) -> list:
    """Pre-compute a Poisson arrival schedule for the simulation period.

    Iterates hour by hour over the simulation period. For each hour slot, draws
    ``n ~ Poisson(sum of avg_arrivals_per_hour across all payloads)`` arrivals,
    assigns each a payload proportional to its ``avg_arrivals_per_hour[weekday]
    [hour]`` and a uniformly random offset within the hour.

    Args:
        payloads: The arrival units to schedule — the discovered variants for the
            variant playout, or ``[None]`` for the state-space playout (a single
            aggregate arrival stream).
        arrival_distributions: ``{payload: {"avg_arrivals_per_hour": {weekday:
            {hour: rate}}}}``.
        start_datetime: datetime of simulation start.
        sim_duration_s: total simulation duration in seconds.

    Returns:
        list of ``(arrival_time_s, payload)`` tuples, sorted ascending by time.
    """
    payload_list = list(payloads)
    schedule = []
    hour_s = 3600

    current_s = 0
    while current_s < sim_duration_s:
        slot_dt = dt.datetime.fromtimestamp(
            start_datetime.timestamp() + current_s, tz=dt.timezone.utc
        )
        weekday = WEEKDAY_NAMES[slot_dt.weekday()]
        hour = slot_dt.hour

        avg_per_payload = [
            arrival_distributions.get(p, {})
            .get("avg_arrivals_per_hour", {})
            .get(weekday, {})
            .get(hour, 0.0)
            for p in payload_list
        ]
        total_avg = sum(avg_per_payload)

        if total_avg > 0:
            n_arrivals = np.random.poisson(total_avg)
            for _ in range(n_arrivals):
                chosen = random.choices(payload_list, weights=avg_per_payload, k=1)[0]
                offset_s = random.randint(0, hour_s - 1)
                arrival_s = current_s + offset_s
                if arrival_s < sim_duration_s:
                    schedule.append((arrival_s, chosen))

        current_s += hour_s

    schedule.sort(key=lambda x: x[0])
    return schedule


def _expand_resource_pool(resource_pool):
    """Expand ``{res_type: count}`` into concrete resource ids and free queues.

    Returns ``(resource_pool_expanded, resource_id_type_map, resource_queues)``:
    ids are ``f"{res_type}_{i+1}"`` and every resource starts free (available).
    """
    resource_pool_expanded = {}
    resource_id_type_map = {}
    for res_type, count in resource_pool.items():
        res_ids = [f"{res_type}_{i + 1}" for i in range(count)]
        resource_pool_expanded[res_type] = res_ids
        for rid in res_ids:
            resource_id_type_map[rid] = res_type
    resource_queues = {
        res_type: list(rids) for res_type, rids in resource_pool_expanded.items()
    }
    return resource_pool_expanded, resource_id_type_map, resource_queues


def _release_elapsed_cooldowns(
    blocked_resources, tick, resource_queues, resource_id_type_map
):
    """Free every resource whose cooldown has elapsed by ``tick``.

    Appends freed resources back onto their queue (mutating ``resource_queues``)
    and returns the still-blocked set.
    """
    freed = set()
    for res_id, cooldown_end in blocked_resources:
        if cooldown_end <= tick:
            freed.add((res_id, cooldown_end))
            resource_queues[resource_id_type_map[res_id]].append(res_id)
    return blocked_resources - freed


def _partition_due_instances(active_executions, tick):
    """Split active instances into ``(due_now, waiting)`` at ``tick``.

    The due list is shuffled to avoid FIFO bias in resource granting; the caller
    re-queues processed instances onto ``waiting``.
    """
    due = []
    waiting = []
    for inst in active_executions:
        (due if inst["next_wake"] <= tick else waiting).append(inst)
    random.shuffle(due)
    return due, waiting


def _sample_needed_resources(activity_res_dist, resource_pool_expanded):
    """Draw the resource demand of one activity occurrence.

    Returns ``{res_type: count}`` for the pool-present types this occurrence needs
    (count > 0).
    """
    needed = {}
    for res_type, stats in activity_res_dist.items():
        if res_type not in resource_pool_expanded:
            continue
        n = _sample_resource_count(stats)
        if n > 0:
            needed[res_type] = n
    return needed


def _calendar_filtered_queues(
    calendar_gate, resource_queues, needed_res_types, hour_index, hour_ts
):
    """Restrict the free queues to resources present this hour (calendar gating).

    Returns the full queues unchanged when no calendars are active.
    """
    if not calendar_gate.active:
        return resource_queues
    return {
        t: [
            rid
            for rid in resource_queues.get(t, ())
            if calendar_gate.is_available(rid, t, hour_index, hour_ts)
        ]
        for t in needed_res_types
    }


def _commit_resource_allocation(
    allocated,
    activity,
    resource_queues,
    resource_id_type_map,
    cooldown_dist,
    calendar_gate,
    hour_ts,
    base_ts,
    blocked_resources,
):
    """Remove allocated resources from the free queues and put them on cooldown.

    Mutates ``resource_queues`` and ``blocked_resources`` in place; returns the
    flat list of allocated resource ids.
    """
    all_allocated_rids = []
    for res_type, res_ids in allocated.items():
        for rid in res_ids:
            resource_queues[res_type].remove(rid)
            all_allocated_rids.append(rid)
            cd = sample_cooldown(cooldown_dist.get(activity, {}).get(res_type, {}))
            cooldown_end = (
                calendar_gate.cooldown_end(rid, res_type, hour_ts, cd) - base_ts
            )
            blocked_resources.add((rid, cooldown_end))
    return all_allocated_rids


def _record_instance_firing(inst, activity, allocated_rids, resource_id_type_map):
    """Record a fired event on the instance for constraint tracking.

    Updates ``simulated_events`` and the incremental ``resources_by_activity``
    cache the constraint allocator reads.
    """
    inst["simulated_events"].append(
        {"_activity": activity, "process_area_resources": allocated_rids}
    )
    act_resources = inst["resources_by_activity"].setdefault(activity, {})
    for rid in allocated_rids:
        rtype = resource_id_type_map.get(rid)
        if rtype:
            act_resources.setdefault(rtype, []).append(rid)


def _jittered_event_time(base_ts, tick, tick_size_s, sim_duration_s):
    """Absolute event timestamp with sub-tick jitter, so events are not tied to
    tick boundaries (jitter stays inside the remaining horizon)."""
    jitter_window = min(tick_size_s, sim_duration_s - tick)
    jitter = random.randint(0, jitter_window - 1) if jitter_window > 0 else 0
    return base_ts + tick + jitter


def _schedule_next_tick(
    tick, sim_duration_s, tick_size_s, active_executions, schedule, schedule_idx
):
    """Next grid tick to jump to, or ``None`` to end the run.

    Fast-forwards to the earliest tick where something can happen — the next
    instance wake or the next arrival — snapped up to the tick grid. Returns
    ``None`` at the horizon or when nothing is left to do.
    """
    if tick >= sim_duration_s:
        return None
    candidates = []
    if active_executions:
        candidates.append(min(inst["next_wake"] for inst in active_executions))
    if schedule_idx < len(schedule):
        candidates.append(schedule[schedule_idx][0])
    if not candidates:
        return None
    target = min(candidates)
    next_tick = ((target + tick_size_s - 1) // tick_size_s) * tick_size_s
    if next_tick <= tick:
        next_tick = tick + tick_size_s
    return min(next_tick, sim_duration_s)


def _build_output_log(event_output, object_output):
    """Assemble the simulated ``ObjectCentricEventLog`` from collected events and
    objects (events sorted by timestamp to undo the sub-tick jitter)."""
    if event_output:
        events_df = pl.DataFrame(event_output, schema=EVENTS_SCHEMA).sort(
            "_timestampUnix"
        )
    else:
        events_df = pl.DataFrame(schema=EVENTS_SCHEMA)
    obj_data = [
        {"_objId": oid, "_objType": otype, "_targetObjects": [], "_qualifiers": []}
        for oid, otype in object_output.items()
    ]
    objects_df = (
        pl.DataFrame(obj_data, schema=OBJECTS_SCHEMA)
        if obj_data
        else pl.DataFrame(schema=OBJECTS_SCHEMA)
    )
    return ObjectCentricEventLog(events_df, objects_df)


class VariantPlayoutStrategy:
    """
    A simple playout strategy that simulates the execution of the process based on the discovered variants.
    It can be used to simulate the process under the assumption that the behavior of the process is well captured by the discovered variants, and that the arrival of new cases follows the observed variant distribution.
    Input needed:
    - Variants: The discovered variants from the OCEL, giving the possible execution paths in the process
    - Variant Arrival Distribution: Distribution of variant arrivals, used for simulating the arrival of new cases in the process
    """

    def __init__(self, variants, variant_arrival_distribution):
        self.variants = variants
        self.variant_arrival_distribution = variant_arrival_distribution
        return

    def _spawn_instance(
        self,
        variant,
        instance_id,
        tick,
        object_output,
        resource_constraints,
        fallback_constraints,
        resource_distribution,
        resource_pool_expanded,
        simulation_config,
    ):
        """Build one active-instance record from a variant arrival.

        Clones the variant's representative graph, mints fresh object ids, sizes
        the per-instance violation budget, and precomputes the static graph
        structure the playout loop walks. Subclasses override this to spawn
        instances differently (e.g. by generating them from a state space).
        """
        inst_graph = variant.graph.copy()
        obj_map = {}
        obj_id_to_type = {}
        for _, _, data in inst_graph.edges(data=True):
            types = data.get("type", "").split("|")
            for orig_oid in data.get("objects", []):
                if orig_oid not in obj_id_to_type and types[0]:
                    obj_id_to_type[orig_oid] = types[0]
        for orig_oid, otype in obj_id_to_type.items():
            new_oid = f"{otype}_inst{instance_id}_{len(obj_map)}"
            obj_map[orig_oid] = new_oid
            object_output[new_oid] = otype

        total_slots = _estimate_constraint_slots(
            resource_constraints.get(variant, fallback_constraints),
            resource_distribution.get(variant, {}),
            resource_pool_expanded,
        )
        violation_budget = _make_violation_budget(total_slots, simulation_config)

        nodes = list(inst_graph.nodes())
        preds_map = {n: tuple(inst_graph.predecessors(n)) for n in nodes}
        node_objects = {n: _get_node_objects(inst_graph, n) for n in nodes}
        node_labels = {n: inst_graph.nodes[n]["label"] for n in nodes}
        pending_preds = {n: len(preds_map[n]) for n in nodes}
        return {
            "id": instance_id,
            "succ_map": {n: tuple(inst_graph.successors(n)) for n in nodes},
            "preds_map": preds_map,
            "node_objects": node_objects,
            "node_labels": node_labels,
            "pending_preds": pending_preds,
            "enabled_set": {n for n in nodes if pending_preds[n] == 0},
            "total_nodes": len(nodes),
            "finished_nodes": set(),
            "simulated_events": [],
            "variant": variant,
            "obj_map": obj_map,
            "violation_budget": violation_budget,
            "spawn_tick": tick,
            "finish_tick": {},
            "ready_at": {},
            "needed_res": {},
            "resources_by_activity": {},
            "next_wake": tick,
        }

    def run(
        self,
        simulation_model,
        sim_duration_s: int,
        resource_pool: dict,
        tick_size_s: int = 60,
        start_datetime: dt.datetime = None,
        progress_callback=None,
    ) -> dict:
        """
        Runs the variant-based simulation.

        Args:
            simulation_model: OCProcessAreaSimulationModel
            sim_duration_s: Total simulation duration in seconds
            resource_pool: {resource_type: count} — e.g. {'Forklift': 3, 'Crane': 2}
            tick_size_s: Clock tick size in seconds
            start_datetime: datetime of simulation start. Defaults to the filtered source log's first event
            progress_callback: Optional callable invoked with the fraction of the
                simulated time span elapsed (0.0-1.0) as the clock advances, so a
                caller can report simulation progress.

        Returns:
            (ObjectCentricEventLog, finished_count, spawned_count)
        """

        # --- Initialize simulation parameters ---
        if start_datetime is None:
            start_datetime = dt.datetime.fromtimestamp(
                simulation_model.source_log_start_unix, tz=dt.timezone.utc
            )
        print("Started Simulation")
        allocation_strategy = simulation_model.resource_allocation_strategy
        cooldown_dist = simulation_model.resource_cooldown_distribution
        resource_constraints = simulation_model.resource_constraints or {}
        # Variants without their own mined constraints fall back to the pooled set.
        fallback_constraints = simulation_model.fallback_constraints or {}
        resource_distribution_of_variants = (
            simulation_model.needed_resources_per_activity or {}
        )
        simulation_config = simulation_model.simulation_config

        # Calendar-based resource availability gating
        calendar_gate = _CalendarGate(
            simulation_model.type_calendars, simulation_model.resource_calendars
        )
        base_ts = int(start_datetime.timestamp())

        activity_delays = simulation_model.activity_delays or {}
        model_durations = bool(
            simulation_config.model_activity_durations and activity_delays
        )

        schedule = generate_arrival_schedule(
            self.variants,
            self.variant_arrival_distribution,
            start_datetime,
            sim_duration_s,
        )

        # TODO: Find solution to start with realistic initial resource availability => If all immediately available, not realistic
        resource_pool_expanded, resource_id_type_map, resource_queues = (
            _expand_resource_pool(resource_pool)
        )

        blocked_resources = set()  # Resources currently blocked (on cooldown)
        active_executions = []
        finished_count = 0
        event_output = []
        object_output = {}
        instance_counter = 0
        schedule_idx = 0

        # --- Main simulation loop ---
        # Event-aware ticking: step tick-by-tick while instances are active, but
        # fast-forward over empty stretches straight to the next arrival's tick.
        tick = 0
        while True:
            # Report how much of the simulated time span has elapsed. Throttling
            # (e.g. only on whole-percent changes) is left to the callback.
            if progress_callback is not None:
                progress_callback(
                    min(tick, sim_duration_s) / sim_duration_s
                    if sim_duration_s
                    else 1.0
                )

            # Phase A: Spawn new instances from arrival schedule
            while schedule_idx < len(schedule) and schedule[schedule_idx][0] <= tick:
                _, payload = schedule[schedule_idx]
                schedule_idx += 1
                active_executions.append(
                    self._spawn_instance(
                        payload,
                        instance_counter,
                        tick,
                        object_output,
                        resource_constraints,
                        fallback_constraints,
                        resource_distribution_of_variants,
                        resource_pool_expanded,
                        simulation_config,
                    )
                )
                instance_counter += 1

            # Phase B: free resources whose cooldown elapsed.
            blocked_resources = _release_elapsed_cooldowns(
                blocked_resources, tick, resource_queues, resource_id_type_map
            )

            # Current clock hour, used for calendar-based shift gating.
            hour_ts = base_ts + tick
            hour_index = hour_ts // 3600

            # Phase C: try executing enabled activities for each due instance.
            due_instances, next_active = _partition_due_instances(
                active_executions, tick
            )
            for inst in due_instances:
                finished_nodes = inst["finished_nodes"]
                preds_map = inst["preds_map"]
                node_labels = inst["node_labels"]
                ready_at = inst["ready_at"]
                finish_tick = inst["finish_tick"]
                needed_res_cache = inst["needed_res"]
                enabled = list(inst["enabled_set"])
                # Randomise the order of concurrently enabled nodes
                random.shuffle(enabled)

                # Track whether the instance made progress or was held back by
                # resource availability, to schedule its next examination
                fired_any = False
                resource_blocked = False

                variant_res_dist = resource_distribution_of_variants.get(
                    inst["variant"], {}
                )
                variant_constraints = resource_constraints.get(
                    inst["variant"], fallback_constraints
                )

                for node in enabled:
                    activity = node_labels[node]

                    # Duration model: hold a node back until its enabling time
                    # + sampled inter-activity delay. Execution-start nodes (no predecessors) fire immediately;
                    if model_durations:
                        preds = preds_map[node]
                        if preds:
                            if node not in ready_at:
                                enabling_tick = max(finish_tick[p] for p in preds)
                                ready_at[node] = enabling_tick + _sample_activity_delay(
                                    activity, activity_delays
                                )
                            if tick < ready_at[node]:
                                continue  # not due yet

                    # Determine how many resources of each type this activity needs
                    needed_res_types = needed_res_cache.get(node)
                    if needed_res_types is None:
                        needed_res_types = _sample_needed_resources(
                            variant_res_dist.get(activity, {}), resource_pool_expanded
                        )
                        needed_res_cache[node] = needed_res_types

                    # Restrict to resources available this hour (calendar gating);
                    # falls back to the full free pool when no calendars are set.
                    available_queues = _calendar_filtered_queues(
                        calendar_gate,
                        resource_queues,
                        needed_res_types,
                        hour_index,
                        hour_ts,
                    )

                    # Cheap availability pre-check: skip the full constraint
                    # allocation when a needed type plainly lacks free units
                    if any(
                        len(available_queues.get(t, ())) < cnt
                        for t, cnt in needed_res_types.items()
                    ):
                        resource_blocked = True
                        continue

                    # Allocate resources respecting constraints
                    allocated, new_budget = _allocate_resources(
                        activity,
                        variant_constraints,
                        inst["simulated_events"],
                        available_queues,
                        resource_id_type_map,
                        allocation_strategy,
                        needed_res_types,
                        simulation_config,
                        inst["violation_budget"],
                        prior_assignments_full=inst["resources_by_activity"],
                    )

                    if allocated is None:
                        # Due now but no resource allocation possible: held back
                        # until a resource frees.
                        resource_blocked = True
                        continue

                    # Commit the budget only now that the activity actually fires.
                    inst["violation_budget"] = new_budget
                    fired_any = True

                    # --- Execute the activity ---
                    all_allocated_rids = _commit_resource_allocation(
                        allocated,
                        activity,
                        resource_queues,
                        resource_id_type_map,
                        cooldown_dist,
                        calendar_gate,
                        hour_ts,
                        base_ts,
                        blocked_resources,
                    )
                    _record_instance_firing(
                        inst, activity, all_allocated_rids, resource_id_type_map
                    )

                    # Build event from the precomputed incident objects (#A).
                    obj_map = inst["obj_map"]
                    event_objects = [
                        obj_map[oid]
                        for oid in inst["node_objects"][node]
                        if oid in obj_map
                    ]
                    abs_ts = _jittered_event_time(
                        base_ts, tick, tick_size_s, sim_duration_s
                    )
                    event_output.append(
                        {
                            "_eventId": f"sim_e_{inst['id']}_{node}",
                            "_activity": activity,
                            "_timestampUnix": abs_ts,
                            "_objects": sorted(set(event_objects)),
                            "_qualifiers": [],
                            "_attributes": json.dumps(
                                {"process_area_resources": all_allocated_rids}
                            ),
                        }
                    )

                    finished_nodes.add(node)
                    inst["enabled_set"].discard(node)
                    # Record the fire tick so successors can compute their enabling time
                    finish_tick[node] = tick
                    # Incrementally advance the enabled
                    pending_preds = inst["pending_preds"]
                    enabled_set = inst["enabled_set"]
                    for succ in inst["succ_map"][node]:
                        pending_preds[succ] -= 1
                        if pending_preds[succ] == 0:
                            enabled_set.add(succ)

                # Check completion
                if len(finished_nodes) == inst["total_nodes"]:
                    finished_count += 1
                else:
                    # Schedule the next examination of this instance:
                    #   - just fired   → revisit next tick (successors may follow)
                    #   - else sleep until the earliest of its next future
                    #     ready_at and, if a due node was resource-blocked, the
                    #     next time a resource frees.
                    if fired_any:
                        inst["next_wake"] = tick + tick_size_s
                    else:
                        wake = (
                            _earliest_future_ready(inst, tick, activity_delays)
                            if model_durations
                            else None
                        )
                        if resource_blocked:
                            nf = _next_resource_free(blocked_resources, tick)
                            cand = (
                                nf if nf is not None else sim_duration_s + tick_size_s
                            )
                            wake = cand if wake is None else min(wake, cand)
                            if calendar_gate.active:
                                next_hour = (hour_index + 1) * 3600 - base_ts
                                wake = (
                                    next_hour if wake is None else min(wake, next_hour)
                                )
                        inst["next_wake"] = (
                            wake if wake is not None else tick + tick_size_s
                        )
                    next_active.append(inst)

            active_executions = next_active

            # --- Advance the clock to the next tick where something can happen. ---
            next_tick = _schedule_next_tick(
                tick,
                sim_duration_s,
                tick_size_s,
                active_executions,
                schedule,
                schedule_idx,
            )
            if next_tick is None:
                break
            tick = next_tick

        return (
            _build_output_log(event_output, object_output),
            finished_count,
            instance_counter,
        )


class StateSpacePlayoutStrategy:
    """Incremental state-space playout: the next event is generated *inside* the loop.

    Instead of replaying a discovered variant, each arrival draws an object
    structure and gets an ``ExecutionGenerator``; its next event is generated only
    when the instance is ready to fire it, so a ``runtime_context`` (resource
    utilisation, clock — extend as needed) can steer the generation probabilities
    at the decision point. The resource / cooldown / calendar / duration machinery
    is shared with the variant playout.

    Generation is **sequential per instance** (one event at a time). Intra-instance
    concurrency of a pre-generated DAG is traded for this runtime awareness — a
    minor loss for object-centric processes where events share a leading object and
    the DAG is nearly a chain. Concurrency *between* instances is unchanged.

    The arrival units are ``ObjectStructureVariant``s (object connected components
    clustered by structure): the schedule draws *which* structure arrives *when*,
    its skeleton is cloned, and the state-space model generates the activities over
    it. Resource demand and constraints are keyed **per structure variant** (with a
    pooled fallback) — exactly as the variant playout keys them per variant. This is
    a standalone strategy — it shares the tick-loop machinery with
    ``VariantPlayoutStrategy`` through the module-level helpers, not by inheritance.
    """

    def __init__(
        self,
        state_space_model,
        structure_variants,
        arrival_distribution,
        runtime_context_provider=None,
    ):
        self.state_space_model = state_space_model
        # Arrival units (object connected components clustered by structure) and
        # their per-structure arrival distribution ({structure_variant: profile}).
        self.structure_variants = structure_variants
        self.arrival_distribution = arrival_distribution
        # Optional hook: ``provider(runtime_state) -> context`` decides what the
        # generation sees each step. Default = the raw runtime_state below.
        self.runtime_context_provider = runtime_context_provider

    def _runtime_context(self, tick, abs_time, resource_queues, resource_pool_expanded):
        """Runtime facts handed to ``generator.step`` each step (the conditioning
        seam — the models ignore it for now).

        Builds a base ``runtime_state`` of clock + resource facts; a
        ``runtime_context_provider`` can map it to any context the generation model
        wants (e.g. add attributes, or flag a utilisation threshold). Resource
        utilisation is just the default example, not a fixed contract.
        """
        free = {rt: len(resource_queues.get(rt, ())) for rt in resource_pool_expanded}
        total = {rt: len(ids) for rt, ids in resource_pool_expanded.items()}
        runtime_state = {
            "tick": tick,
            "abs_time": abs_time,
            "resource_pool": total,
            "resource_free": free,
            "resource_utilization": {
                rt: (1.0 - free[rt] / total[rt] if total[rt] else 0.0) for rt in total
            },
        }
        if self.runtime_context_provider is not None:
            return self.runtime_context_provider(runtime_state)
        return runtime_state

    def run(
        self,
        simulation_model,
        sim_duration_s: int,
        resource_pool: dict,
        tick_size_s: int = 60,
        start_datetime: dt.datetime = None,
        progress_callback=None,
    ) -> dict:
        if start_datetime is None:
            start_datetime = dt.datetime.fromtimestamp(
                simulation_model.source_log_start_unix, tz=dt.timezone.utc
            )
        allocation_strategy = simulation_model.resource_allocation_strategy
        cooldown_dist = simulation_model.resource_cooldown_distribution
        resource_constraints = simulation_model.resource_constraints or {}
        # Structures without their own mined constraints fall back to the pooled set.
        fallback_constraints = simulation_model.fallback_constraints or {}
        # Resource demand per structure variant: {structure_variant: {activity: ...}}.
        resource_distribution = simulation_model.needed_resources_per_activity or {}
        simulation_config = simulation_model.simulation_config
        calendar_gate = _CalendarGate(
            simulation_model.type_calendars, simulation_model.resource_calendars
        )
        base_ts = int(start_datetime.timestamp())
        activity_delays = simulation_model.activity_delays or {}
        model_durations = bool(
            simulation_config.model_activity_durations and activity_delays
        )

        schedule = generate_arrival_schedule(
            self.structure_variants,
            self.arrival_distribution,
            start_datetime,
            sim_duration_s,
        )

        resource_pool_expanded, resource_id_type_map, resource_queues = (
            _expand_resource_pool(resource_pool)
        )

        # Per-structure violation budget: a structure's expected activity
        # occurrences (Monte-Carlo) × its resource demand. Mirrors the variant
        # playout's per-variant budget; only worth it when soft violations are
        # enabled and the structure carries constraints.
        expected_slots_by_variant = {}
        if simulation_config.resource_constraint_violation_degree > 0:
            for structure_variant in self.structure_variants:
                variant_constraints = resource_constraints.get(
                    structure_variant, fallback_constraints
                )
                if not variant_constraints:
                    continue
                expected_occurrences = _estimate_structure_activity_occurrences(
                    structure_variant, self.state_space_model, random, n_samples=200
                )
                expected_slots_by_variant[structure_variant] = (
                    _estimate_expected_constraint_slots(
                        expected_occurrences,
                        set(variant_constraints),
                        resource_distribution.get(structure_variant, {}),
                        resource_pool_expanded,
                    )
                )

        blocked_resources = set()
        active_executions = []
        finished_count = 0
        event_output = []
        object_output = {}
        instance_counter = 0
        schedule_idx = 0

        tick = 0
        while True:
            if progress_callback is not None:
                progress_callback(
                    min(tick, sim_duration_s) / sim_duration_s
                    if sim_duration_s
                    else 1.0
                )

            # Phase A: spawn — the scheduled structure variant arrives; clone its
            # skeleton and attach a generator (do not pre-run it).
            while schedule_idx < len(schedule) and schedule[schedule_idx][0] <= tick:
                _, structure_variant = schedule[schedule_idx]
                schedule_idx += 1
                object_graph = structure_variant.instantiate(instance_counter)
                generator = self.state_space_model.new_generator(object_graph, random)
                active_executions.append(
                    {
                        "id": instance_counter,
                        "structure_variant": structure_variant,
                        "generator": generator,
                        "obj_types": generator.object_type_map,
                        "pending": None,
                        "event_index": 0,
                        "last_finish": tick,
                        "ready_at": tick,
                        "simulated_events": [],
                        "resources_by_activity": {},
                        "violation_budget": _make_violation_budget(
                            expected_slots_by_variant.get(structure_variant, 0.0),
                            simulation_config,
                        ),
                        "next_wake": tick,
                    }
                )
                instance_counter += 1

            # Phase B: free resources whose cooldown elapsed.
            blocked_resources = _release_elapsed_cooldowns(
                blocked_resources, tick, resource_queues, resource_id_type_map
            )

            hour_ts = base_ts + tick
            hour_index = hour_ts // 3600

            # Phase C: step + fire due instances.
            due_instances, next_active = _partition_due_instances(
                active_executions, tick
            )

            for inst in due_instances:
                # Lazily generate the next event when none is pending.
                if inst["pending"] is None:
                    event = inst["generator"].step(
                        self._runtime_context(
                            tick, hour_ts, resource_queues, resource_pool_expanded
                        )
                    )
                    if event is None:
                        finished_count += 1
                        continue  # instance complete; drop it
                    inst["pending"] = event
                    # The first event of a case has no predecessor, so it fires at
                    # the arrival tick with no inter-activity delay — mirrors the
                    # variant playout, where execution-start nodes (no predecessors)
                    # fire immediately and only successor nodes carry a sampled delay.
                    delay = (
                        _sample_activity_delay(event[0], activity_delays)
                        if model_durations and inst["event_index"] > 0
                        else 0
                    )
                    inst["ready_at"] = inst["last_finish"] + delay

                activity, participants = inst["pending"]

                # Duration model: hold the event until its ready tick.
                if model_durations and tick < inst["ready_at"]:
                    inst["next_wake"] = inst["ready_at"]
                    next_active.append(inst)
                    continue

                # Resource demand + constraints of this instance's structure
                # (fall back to the pooled constraint set), mirroring the variant
                # playout's per-variant lookup.
                structure_variant = inst["structure_variant"]
                variant_res_dist = resource_distribution.get(structure_variant, {})
                variant_constraints = resource_constraints.get(
                    structure_variant, fallback_constraints
                )

                # Resources this activity needs.
                needed_res_types = _sample_needed_resources(
                    variant_res_dist.get(activity, {}), resource_pool_expanded
                )
                available_queues = _calendar_filtered_queues(
                    calendar_gate,
                    resource_queues,
                    needed_res_types,
                    hour_index,
                    hour_ts,
                )

                resource_blocked = any(
                    len(available_queues.get(t, ())) < cnt
                    for t, cnt in needed_res_types.items()
                )
                allocated, new_budget = None, inst["violation_budget"]
                if not resource_blocked:
                    allocated, new_budget = _allocate_resources(
                        activity,
                        variant_constraints,
                        inst["simulated_events"],
                        available_queues,
                        resource_id_type_map,
                        allocation_strategy,
                        needed_res_types,
                        simulation_config,
                        inst["violation_budget"],
                        prior_assignments_full=inst["resources_by_activity"],
                    )
                    resource_blocked = allocated is None

                if resource_blocked:
                    # Keep the pending event; retry when a resource frees.
                    nf = _next_resource_free(blocked_resources, tick)
                    wake = nf if nf is not None else tick + tick_size_s
                    if calendar_gate.active:
                        wake = min(wake, (hour_index + 1) * 3600 - base_ts)
                    inst["next_wake"] = wake
                    next_active.append(inst)
                    continue

                # --- Fire the event ---
                inst["violation_budget"] = new_budget
                all_allocated_rids = _commit_resource_allocation(
                    allocated,
                    activity,
                    resource_queues,
                    resource_id_type_map,
                    cooldown_dist,
                    calendar_gate,
                    hour_ts,
                    base_ts,
                    blocked_resources,
                )
                _record_instance_firing(
                    inst, activity, all_allocated_rids, resource_id_type_map
                )

                # Register only the participating objects (coverage is enforced by
                # the generator's END-block, so unused pool objects never appear).
                for oid in participants:
                    object_output[oid] = inst["obj_types"].get(oid)

                event_output.append(
                    {
                        "_eventId": f"sim_e_{inst['id']}_{inst['event_index']}",
                        "_activity": activity,
                        "_timestampUnix": _jittered_event_time(
                            base_ts, tick, tick_size_s, sim_duration_s
                        ),
                        "_objects": sorted(set(participants)),
                        "_qualifiers": [],
                        "_attributes": json.dumps(
                            {"process_area_resources": all_allocated_rids}
                        ),
                    }
                )
                inst["event_index"] += 1
                inst["last_finish"] = tick
                inst["pending"] = None
                inst["next_wake"] = tick + tick_size_s
                next_active.append(inst)

            active_executions = next_active

            # --- Advance the clock to the next tick where something can happen. ---
            next_tick = _schedule_next_tick(
                tick,
                sim_duration_s,
                tick_size_s,
                active_executions,
                schedule,
                schedule_idx,
            )
            if next_tick is None:
                break
            tick = next_tick

        return (
            _build_output_log(event_output, object_output),
            finished_count,
            instance_counter,
        )
