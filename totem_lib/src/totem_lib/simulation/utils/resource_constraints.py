import itertools
import json
from collections import Counter, defaultdict


def _build_resource_lookup(ocel, resource_type_map):
    """Map event_id -> {resource_type: frozenset(resource_ids)}.

    The ``process_area_resources`` list is populated by ``filter_by_process_area``.
    Resource IDs are grouped by their object type via ``resource_type_map``.

    Args:
        ocel: The Object-Centric Event Log.
        resource_type_map (dict): resource_id -> resource_type. Must be the
            *unfiltered* ``obj_type_map``: a filtered log cannot resolve the type
            of its process-area resources. Resources whose type cannot be resolved
            are skipped (they cannot be enforced per type at simulation time).

    Returns:
        dict: event_id -> {resource_type: frozenset(resource_ids of that type)}.
              Types not used by an event are simply absent from its dict.
    """
    lookup = {}
    for row in ocel.events.select(["_eventId", "_attributes"]).iter_rows(named=True):
        by_type: dict[str, set] = defaultdict(set)
        if row["_attributes"]:
            resources = json.loads(row["_attributes"]).get("process_area_resources", [])
            for rid in resources or []:
                res_type = resource_type_map.get(rid)
                if res_type is not None:
                    by_type[res_type].add(rid)
        lookup[row["_eventId"]] = {t: frozenset(ids) for t, ids in by_type.items()}
    return lookup


def _mine_constraints_from_executions(
    executions,
    resource_lookup,
    ocel,
    support_threshold_percentage,
    min_pair_executions,
):
    """Mine resource constraints from a set of process executions, per resource type.

    Compares, per execution and per resource type, the typed resource sets of
    every activity pair and aggregates the observed relationships. A relation is
    emitted for a (pair, resource_type) when its support (fraction of observed
    resource-set comparisons exhibiting the relation) reaches
    ``support_threshold_percentage`` in both directions.

    Only resource types used by *both* activities of a pair are compared: an
    activity that never uses a type carries no relation on it. This mirrors the
    allocator, which enforces a per-type relation only when both the prior and the
    current activity involve that type.

    Args:
        executions: Iterable of executions, each a list of event ids.
        resource_lookup (dict): event_id -> {resource_type: frozenset(ids)}.
        ocel: The Object-Centric Event Log for looking up event activities.
        support_threshold_percentage (float): Minimum support ratio for a relation.
        min_pair_executions (int): A (pair, resource_type) must appear in at least
            this many executions to be considered (evidence floor against small
            samples).

    Returns:
        dict: {activity: {other_activity: {resource_type: constraint_type}}}.
              Constraint types: "same_resource" (symmetric), "disjoint"
              (symmetric), and the asymmetric pair "subset"/"superset".
    """
    # Keyed by (activity1, activity2, resource_type).
    aggregated_constraints = defaultdict(lambda: [0, 0, 0, 0])
    # Number of executions in which each (pair, resource_type) appears.
    executions_with_pair = defaultdict(int)

    for execution in executions:
        process_exec_analysis_dict = defaultdict(lambda: [0, 0, 0, 0])

        # Group event IDs by activity
        activity_to_events = defaultdict(list)
        for event_id in execution:
            activity = ocel.get_value(event_id, "event_activity")
            activity_to_events[activity].append(event_id)

        # Per activity, per resource type: how often each typed resource-set
        # occurs. Only events that actually use >=1 resource of a type contribute
        # to that type; an event without a type is simply absent for it.
        activity_to_typed_counts: dict[str, dict[str, Counter]] = {}
        for act, event_ids in activity_to_events.items():
            typed_counts: dict[str, Counter] = defaultdict(Counter)
            for event_id in event_ids:
                for res_type, res_set in resource_lookup.get(event_id, {}).items():
                    typed_counts[res_type][res_set] += 1
            activity_to_typed_counts[act] = typed_counts

        activities = list(activity_to_typed_counts.keys())
        activity_pairs = list(itertools.permutations(activities, 2)) + [
            (act, act) for act in activities
        ]
        for act1, act2 in activity_pairs:
            counts1 = activity_to_typed_counts[act1]
            counts2 = activity_to_typed_counts[act2]
            # Only types used by BOTH activities carry a meaningful relation.
            for res_type in counts1.keys() & counts2.keys():
                key = (act1, act2, res_type)
                for rs1, count1 in counts1[res_type].items():
                    for rs2, count2 in counts2[res_type].items():
                        # Number of event pairs sharing this resource-set combination.
                        combinations = count1 * count2

                        # Vector indices: [same_resource, 1subsetof2, disjoint, Not_defined]
                        # same_resource: A\B = {} and B\A = {} (sets are equal)
                        if not (rs1 - rs2) and not (rs2 - rs1):
                            process_exec_analysis_dict[key][0] += combinations

                        # 1 subset of 2
                        elif rs1.issubset(rs2):
                            process_exec_analysis_dict[key][1] += combinations

                        # disjoint: A ∩ B = {} (no shared resources)
                        elif rs1.isdisjoint(rs2):
                            process_exec_analysis_dict[key][2] += combinations

                        # no specific relationship, but still count for correct support calculation
                        else:
                            process_exec_analysis_dict[key][3] += combinations

        # For self-pairs (act, act): subtract the diagonal — each event paired with
        # itself is not meaningful for constraint detection (trivially same_resource).
        for act in activities:
            for res_type, counter in activity_to_typed_counts[act].items():
                key = (act, act, res_type)
                for _rs, count in counter.items():
                    process_exec_analysis_dict[key][0] -= count

        # Aggregate the execution's entries and record, per (pair, resource_type),
        # that it was present in this execution. A key is present iff it has at
        # least one resource comparison (sum > 0), which excludes single-event
        # self-pairs whose vector is all zeros after the diagonal subtraction above.
        for key, vector in process_exec_analysis_dict.items():
            if sum(vector) <= 0:
                continue
            executions_with_pair[key] += 1
            aggregated_constraints[key] = [
                a + b for a, b in zip(aggregated_constraints[key], vector, strict=True)
            ]

    # Evidence floor: a (pair, resource_type) must be observed in at least
    # min_pair_executions executions to be trustworthy.
    filtered_constraints = {
        key: vector
        for key, vector in aggregated_constraints.items()
        if executions_with_pair[key] >= min_pair_executions
    }

    # Construct constraints.
    # Format: {activity: {other_activity: {resource_type: constraint_type}}}
    # allows O(1) lookup of all constraints for a given activity during simulation replay
    constraints_for_variant = defaultdict(lambda: defaultdict(dict))
    processed_pairs = set()
    for key, vector in filtered_constraints.items():
        act1, act2, res_type = key
        if (act2, act1, res_type) in processed_pairs:
            continue
        processed_pairs.add(key)
        total = sum(vector)
        if total == 0:
            continue

        inverse_key = (act2, act1, res_type)
        inverse_vector = filtered_constraints.get(inverse_key, [0, 0, 0, 0])
        inverse_total = sum(inverse_vector)
        if inverse_total == 0:
            # No evidence for the reverse direction -> cannot confirm the
            # relation (and avoids a division by zero below). Skip the pair.
            continue

        # Support of each relation as a fraction of the observed resource-set
        # pairs. Vector indices: [same_resource, rs1⊊rs2, disjoint, neither].
        same_fwd = vector[0] / total
        same_inv = inverse_vector[0] / inverse_total
        # Subset-or-equal: rs1 ⊆ rs2 covers strict subset (idx 1) and equality (idx 0).
        subset_fwd = (vector[1] + vector[0]) / total
        # If act1 ⊆ act2, the reverse pair (act2, act1) is "neither" (idx 3),
        # i.e. act2 is a superset of act1.
        superset_inv = inverse_vector[3] / inverse_total
        disjoint_fwd = vector[2] / total
        disjoint_inv = inverse_vector[2] / inverse_total

        if (
            same_fwd >= support_threshold_percentage
            and same_inv >= support_threshold_percentage
        ):
            # Same resource (symmetric)
            constraints_for_variant[act1][act2][res_type] = "same_resource"
            constraints_for_variant[act2][act1][res_type] = "same_resource"
            processed_pairs.add(inverse_key)

        elif (
            subset_fwd >= support_threshold_percentage
            and superset_inv >= support_threshold_percentage
        ):
            # Asymmetric: act1 ⊆ act2, emit both directions.
            constraints_for_variant[act1][act2][res_type] = "subset"
            constraints_for_variant[act2][act1][res_type] = "superset"
            processed_pairs.add(inverse_key)

        elif (
            disjoint_fwd >= support_threshold_percentage
            and disjoint_inv >= support_threshold_percentage
        ):
            # Disjoint (symmetric)
            constraints_for_variant[act1][act2][res_type] = "disjoint"
            constraints_for_variant[act2][act1][res_type] = "disjoint"
            processed_pairs.add(inverse_key)

    # Collapse the nested defaultdicts into plain dicts.
    return {
        act: {other: dict(types) for other, types in others.items()}
        for act, others in constraints_for_variant.items()
    }


def generate_resource_constraints(
    ocel,
    variants,
    resource_type_map,
    support_threshold_percentage=0.8,
    min_variant_frequency=0.05,
    min_variant_executions=5,
):
    """
    Generate per-resource-type resource constraints per variant, plus a pooled
    global fallback.

    Constraints are mined and applied per variant. A variant is mined on its own
    executions only if it is frequent enough (combined guard: it must have at
    least ``min_variant_executions`` executions AND cover at least
    ``min_variant_frequency`` of all executions). Infrequent variants are left out
    of the per-variant result and instead fall back to a global constraint set
    mined over all executions pooled together, which carries far more evidence.

    Relations are mined separately for each resource type: for an activity pair,
    each shared resource type gets its own relation, so a pair may e.g. share the
    same *worker* while using *disjoint* machines. This matches the allocator,
    which enforces constraints per resource type.

    Args:
        ocel: The Object-Centric Event Log for looking up event data.
        variants (Variants): A Variants object containing Variant instances.
        resource_type_map (dict): resource_id -> resource_type, used to split
            resources by type. Must be the *unfiltered* ``obj_type_map`` (a
            filtered log cannot resolve its process-area resources' types).
        support_threshold_percentage (float): Minimum support ratio for a relation
            (fraction of observed resource-set comparisons exhibiting it).
        min_variant_frequency (float): Minimum fraction of all executions a variant
            must cover to be mined on its own.
        min_variant_executions (int): Minimum number of executions a variant must
            have to be mined on its own; also the per-(pair, type) evidence floor
            used when mining the global fallback.

    Returns:
        tuple[dict, dict]:
            - per_variant: keyed by the frequent Variant objects only, each mapping
              activity -> {other_activity: {resource_type: constraint_type}}.
            - fallback: a single {activity: {other_activity: {resource_type:
              constraint_type}}} dict mined over all executions, applied to
              variants not in ``per_variant``.
            Constraint types: "same_resource" (symmetric), "disjoint" (symmetric),
            and the asymmetric pair "subset"/"superset" — if act1's resources of a
            type are a subset of act2's, then (act1, act2) is "subset" for that type
            and the inverse (act2, act1) is "superset". Emitting both directions
            lets the simulator enforce the relation regardless of which activity
            fires first.
    """
    resource_lookup = _build_resource_lookup(ocel, resource_type_map)

    total_executions = sum(len(variant.executions) for variant in variants)

    # Global fallback mined over all executions pooled together, with an evidence
    # floor so globally-rare pairs do not produce small-sample noise.
    all_executions = [
        execution for variant in variants for execution in variant.executions
    ]
    fallback = _mine_constraints_from_executions(
        all_executions,
        resource_lookup,
        ocel,
        support_threshold_percentage,
        min_variant_executions,
    )

    per_variant = {}
    for variant in variants:
        n = len(variant.executions)
        frequent_enough = (
            n >= min_variant_executions
            and total_executions
            and n / total_executions >= min_variant_frequency
        )
        if frequent_enough:
            per_variant[variant] = _mine_constraints_from_executions(
                variant.executions,
                resource_lookup,
                ocel,
                support_threshold_percentage,
                1,
            )

    return per_variant, fallback
