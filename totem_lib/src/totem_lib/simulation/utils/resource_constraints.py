from collections import defaultdict, Counter
import itertools


def generate_resource_constraints(ocel, variants, support_threshold_percentage=0.8, min_occurrences_within_execution=5, min_occurrences_across_executions=10):
    """
    Generate resource constraints based on the given variants and support threshold.

    Args:
        ocel: The Object-Centric Event Log for looking up event data.
        variants (Variants): A Variants object containing Variant instances.
        support_threshold_percentage (float): Minimum support ratio for a constraint to be kept.
        min_occurrences_within_execution (int): Minimum total vector sum within a single execution.
        min_occurrences_across_executions (int): Minimum total vector sum across all executions.

    Returns:
        dict: Keys are Variant objects, values are dicts mapping activity -> {other_activity: constraint_type}.
              Constraint types: "same_resource", "subset" (act1 ⊆ act2), "disjoint".
    """

    constraints = {}

    for v_idx, variant in enumerate(variants):
        print(f"[Variant {v_idx}] support={variant.support}, executions={len(variant.executions)}")
        aggregated_constraints = defaultdict(lambda: [0, 0, 0, 0])

        for e_idx, execution in enumerate(variant.executions):  
            process_exec_analysis_dict = defaultdict(lambda: [0, 0, 0, 0])

            # Group event IDs by activity
            activity_to_events = defaultdict(list)
            for event_id in execution:
                activity = ocel.get_value(event_id, "event_activity")
                activity_to_events[activity].append(event_id)

            print(f"  [Execution {e_idx}] {len(execution)} events, {len(activity_to_events)} activities, max_events_per_act={max((len(v) for v in activity_to_events.values()), default=0)}")

            # Group events per activity by their resource frozenset and count occurrences. Avoid pairwise comparisons on acitvity level
            activity_to_resource_counts: dict[str, Counter] = {
                act: Counter(
                    frozenset(ocel.get_value(event_id, "resources") or [])
                    for event_id in event_ids
                )
                for act, event_ids in activity_to_events.items()
            }

            activities = list(activity_to_resource_counts.keys())
            pairs = list(itertools.permutations(activities, 2)) + [(act, act) for act in activities]
            for (act1, act2) in pairs:
                key = (act1, act2)
                for rs1, count1 in activity_to_resource_counts[act1].items():
                    for rs2, count2 in activity_to_resource_counts[act2].items():
                        # Compare resource sets and update vector counts based on their relationship
                        pairs = count1 * count2

                        # Vector indices: [same_resource, 1subsetof2, disjoint, Not_defined]
                        # same_resource: A\B = {} and B\A = {} (sets are equal)
                        if not (rs1 - rs2) and not (rs2 - rs1):
                            process_exec_analysis_dict[key][0] += pairs

                        # 1 subset of 2
                        elif rs1.issubset(rs2):
                            process_exec_analysis_dict[key][1] += pairs

                        # disjoint: A ∩ B = {} (no shared resources)
                        elif rs1.isdisjoint(rs2):
                            process_exec_analysis_dict[key][2] += pairs

                        # no specific relationship, but still count for correct support calculation
                        else:
                            process_exec_analysis_dict[key][3] += pairs

            # For self-pairs (act, act): subtract the diagonal — each event paired with itself
            # is not meaningful for constraint detection (trivially same_resource).
            for act in activities:
                key = (act, act)
                for _rs, count in activity_to_resource_counts[act].items():
                    process_exec_analysis_dict[key][0] -= count

            # Filter: remove entries that not appear at least min_occurrences_within_execution times within process execution
            filtered_exec_dict = {
                key: vector
                for key, vector in process_exec_analysis_dict.items()
                if sum(vector) >= min_occurrences_within_execution
            }

            # Aggregate filtered entries onto variant-level dict
            for key, vector in filtered_exec_dict.items():
                aggregated_constraints[key] = [
                    a + b for a, b in zip(aggregated_constraints[key], vector)
                ]

        # Filter: Remove entries that do not appear at least min_occurrences_across_executions times across executions within variant
        filtered_constraints = {
            key: vector
            for key, vector in aggregated_constraints.items()
            if sum(vector) >= min_occurrences_across_executions
        }

        # Construct constraints for this variant
        # Format: {activity: {other_activity: constraint_type}}
        # allows O(1) lookup of all constraints for a given activity during simulation replay
        constraints_for_variant = defaultdict(dict)
        processed_pairs = set()
        for key, vector in filtered_constraints.items():
            act1, act2 = key
            if (act2, act1) in processed_pairs:
                continue
            processed_pairs.add(key)
            total = sum(vector)
            if total == 0:
                continue

            inverse_vector = filtered_constraints.get((act2, act1), [0, 0, 0, 0])
            inverse_total = sum(inverse_vector)

            if (vector[0] / total >= support_threshold_percentage
                    and inverse_vector[0] / inverse_total >= support_threshold_percentage):
                # Same resource (symmetric)
                constraints_for_variant[act1][act2] = "same_resource"
                constraints_for_variant[act2][act1] = "same_resource"
                processed_pairs.add((act2, act1))

            elif (vector[1]  + vector[0] / total >= support_threshold_percentage # Subset or Equal
                    and inverse_vector[3] / inverse_total >= support_threshold_percentage):
                # Subset relation (act1 resources ⊆ act2 resources)
                constraints_for_variant[act1][act2] = "subset"

            elif (vector[2] / total >= support_threshold_percentage
                    and inverse_vector[2] / inverse_total >= support_threshold_percentage):
                # Disjoint (symmetric)
                constraints_for_variant[act1][act2] = "disjoint"
                constraints_for_variant[act2][act1] = "disjoint"
                processed_pairs.add((act2, act1))

        constraints[variant] = dict(constraints_for_variant)

    return constraints