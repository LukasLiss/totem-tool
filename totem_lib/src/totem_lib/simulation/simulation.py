import random
import json
from collections import defaultdict
import datetime as dt
import numpy as np
import polars as pl

from totem_lib import totemDiscovery, mlpaDiscovery
from totem_lib.ocel.ocel import ObjectCentricEventLog, EVENTS_SCHEMA, OBJECTS_SCHEMA
from totem_lib.variants.ocvariants import find_object_variants_connected_component
from totem_lib.simulation.utils.basic_simulation_statistics import WEEKDAY_NAMES, variant_arrival_distribution as compute_variant_arrival_distribution, resource_distribution_of_variants
from totem_lib.simulation.utils.resource_constraints import generate_resource_constraints
from totem_lib.simulation.utils.resource_statistics import resource_cooldown_distribution, calculate_resource_allocation_strategy

### Default Configuration
RESOURCE_CONSTRAINT_VIOLATION_DEGREE = 0.0  # Degree to which resource constraints can be violated. Value between 0 and 1 where 0 means strictly following all constraints and 1 allows to ignore all constraints.
CONSTRAINT_LOOKBACK_LENGTH = None  # Number of prior events to look back for when checking constraints. Higher values may lead to more realistic simulations but also increased computational complexity. If value is None, then all prior events will be considered.

def _get_node_objects(graph, node):
    """Collect all object IDs from incident edges of a node."""
    objects = set()
    for pred in graph.predecessors(node):
        for obj_id in graph.edges[pred, node].get('objects', []):
            objects.add(obj_id)
    for succ in graph.successors(node):
        for obj_id in graph.edges[node, succ].get('objects', []):
            objects.add(obj_id)
    return objects


def _select_by_strategy(available_rids, strategy):
    """Pick a resource ID from available list based on allocation strategy."""
    if not available_rids:
        return None
    if strategy == 'FIFO':
        return available_rids[0]
    elif strategy == 'LIFO':
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
        act = event['_activity']
        for rid in event.get('process_area_resources', []):
            res_type = resource_id_type_map.get(rid)
            if res_type:
                result[act][res_type].append(rid)
    return result


def _allocate_resources(activity, variant_constraints, simulated_events,
                        resource_queues, resource_id_type_map, allocation_strategy,
                        needed_res_types, simulation_config):
    """
    Allocate resources for an activity, respecting the given constraints.

    Uses a two-phase approach:
        Phase 1 — Resolve all constraints into per-type sets:
            - exact:        Resources forced by same_resource constraints (exact match)
            - forbidden:    Resources excluded by disjoint constraints
            - allowed_only: Resources where current Activity has Subset Constraint with previous Event -> Resources must be subset from this set
            - must_use:     Resources where previous Events have Subset Constraint with current activity -> Must be included

        Phase 2 — Allocate per resource type using the resolved sets:
            - If exact is set, validate and use it directly.
            - Otherwise, filter candidates by forbidden/allowed_only, include must_use,
              and fill remaining slots via allocation strategy.

    The simulation_config controls constraint strictness via two parameters:
        - resource_constraint_violation_degree:
            0   → All constraints are hard filters (strict mode).
            0-1 → subset acts as a soft preference; same_resource/disjoint still enforced.
            1   → All constraints are skipped entirely.
        - constraint_lookback_length:
            If set, only the last N simulated events are considered for constraint resolution.

    Args:
        activity: The activity to allocate resources for.
        variant_constraints: Constraints dict for this variant: {activity: {other_activity: constraint_type}}.
        simulated_events: List of already simulated events in this instance,
                          each with '_activity' and 'process_area_resources' keys.
        resource_queues: Currently available resources: {res_type: [res_id, ...]}.
        resource_id_type_map: Mapping from resource ID to resource type.
        allocation_strategy: {res_type: strategy_name} for picking from available pool.
        needed_res_types: Dict {res_type: count} — how many of each type this activity needs.
        simulation_config: Config of the Simulation Model.

    Returns:
        dict {res_type: [res_id, ...]} if allocation succeeded, None if not possible.
    """

    violation_degree = simulation_config.resource_constraint_violation_degree
    lookback = simulation_config.constraint_lookback_length
    strict_constraints = (violation_degree == 0)

    # If violation_degree == 1, skip all constraint logic and just allocate freely
    if violation_degree >= 1.0:
        assignment = {}
        for res_type, n in needed_res_types.items():
            available = list(resource_queues.get(res_type, []))
            if len(available) < n:
                return None
            strategy = allocation_strategy.get(res_type, 'random')
            selected = []
            for _ in range(n):
                chosen = _select_by_strategy(available, strategy)
                selected.append(chosen)
                available.remove(chosen)
            assignment[res_type] = selected
        return assignment

    # Apply lookback limit to simulated events
    previous_events_limited = simulated_events
    if lookback is not None:
        previous_events_limited = simulated_events[-lookback:]

    constraints_for_activity = variant_constraints.get(activity, {})
    prior_assignments = _get_resources_by_activity(previous_events_limited, resource_id_type_map)

    # ── Phase 1: Resolve constraints into per-type sets ──

    exact = {}                      # res_type -> set of res_ids (from same_resource)
    forbidden = defaultdict(set)    # res_type -> set of res_ids to exclude
    allowed_only = {}               # res_type -> set of res_ids (intersection of subset refs)
    must_use = defaultdict(set)     # res_type -> set of res_ids that must be included

    for other_act, ctype in constraints_for_activity.items():
        if other_act not in prior_assignments:
            continue

        for res_type, res_ids in prior_assignments[other_act].items():
            # TODO: Logik checken
            if res_type not in needed_res_types:
                continue
            refs = set(res_ids)

            if ctype == "same_resource":
                if res_type in exact and exact[res_type] != refs:
                    return None  # Conflicting same_resource constraints
                exact[res_type] = refs

            elif ctype == "disjoint":
                forbidden[res_type] |= refs

            elif ctype == "subset":
                if res_type not in allowed_only:
                    allowed_only[res_type] = set(refs)
                else:
                    allowed_only[res_type] &= refs

            elif ctype == "superset":
                must_use[res_type] |= refs

    # ── Phase 2: Allocate per resource type ──

    assignment = {}

    for res_type, n in needed_res_types.items():
        free = set(resource_queues.get(res_type, []))

        # --- Exact allocation (same_resource) ---
        if res_type in exact:
            selected = exact[res_type]

            if len(selected) != n:
                return None  # Count mismatch

            if not selected.issubset(free):
                return None  # Required resources not available

            if selected & forbidden[res_type]:
                return None  # Conflicts with disjoint constraint

            if must_use.get(res_type) and not must_use[res_type].issubset(selected):
                return None  # Conflicts with superset constraint

            if res_type in allowed_only and not selected.issubset(allowed_only[res_type]):
                return None  # Conflicts with subset constraint

            assignment[res_type] = list(selected)
            continue

        # --- Build candidate list ---
        candidates = list(resource_queues.get(res_type, []))

        if strict_constraints and res_type in allowed_only:
            candidates = [r for r in candidates if r in allowed_only[res_type]]

        candidates = [r for r in candidates if r not in forbidden[res_type]]

        # Validate must_use feasibility
        must = must_use.get(res_type, set())
        if not must.issubset(set(candidates)):
            return None  # Must-use resources not available or excluded

        if len(must) > n:
            return None  # More must-use resources than needed

        # --- Select remaining resources ---
        remaining = [r for r in candidates if r not in must]
        k = n - len(must)

        if strict_constraints:
            # Hard mode: all resources must come from candidates (already filtered)
            # TODO: check that comment is wrong, not logic itself. Because there can be additional resources
            if len(remaining) < k:
                return None

            strategy = allocation_strategy.get(res_type, 'random')
            extra = []
            for _ in range(k):
                chosen = _select_by_strategy(remaining, strategy)
                extra.append(chosen)
                remaining.remove(chosen)
        else:
            # Soft mode: prefer allowed_only as a preference, then fill from full pool
            # TODO: Hier muss noch irgendeine Logik rein, die unterscheidet was in dem Degree drinsteht. Also irgendeine Logik die irgendwie basierend auf einer Wahrscheinlichkeit den Grad der Abweichung beschränkt
            preferred = []
            fallback = []
            if res_type in allowed_only:
                for r in remaining:
                    if r in allowed_only[res_type]:
                        preferred.append(r)
                    else:
                        fallback.append(r)
            else:
                fallback = remaining

            strategy = allocation_strategy.get(res_type, 'random')
            extra = []

            # First pick from preferred
            for _ in range(min(k, len(preferred))):
                chosen = _select_by_strategy(preferred, strategy)
                extra.append(chosen)
                preferred.remove(chosen)

            # Then fill from fallback
            still_needed = k - len(extra)
            if still_needed > 0:
                if len(fallback) < still_needed:
                    return None
                for _ in range(still_needed):
                    chosen = _select_by_strategy(fallback, strategy)
                    extra.append(chosen)
                    fallback.remove(chosen)

        assignment[res_type] = list(must) + extra

    return assignment

class OCProcessAreaSimulationConfiguration:
    """
    Configuration for OC Process Area Simulation.
    This class captures all the parameters and settings needed to run a simulation. It includes:

    - Resource constraint violation degree: Degree to which resource constraints can be violated. Value between 0 and 1 where 0 means strictly following all Constraints and 1 allows to ignore all constraints
    - Constraint_Lookback_Length: Number of prior events to look back for when checking constraints. Higher values may lead to more realistic simulations but also increased computational complexity. If value is None, then all prior events will be considered
    """
    def __init__(
                self,
                resource_constraint_violation_degree=RESOURCE_CONSTRAINT_VIOLATION_DEGREE,
                constraint_lookback_length=CONSTRAINT_LOOKBACK_LENGTH):
        self.resource_constraint_violation_degree = resource_constraint_violation_degree
        self.constraint_lookback_length = constraint_lookback_length

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

    def __init__(self, playout_strategy, resource_constraints, resource_allocation_strategy, resource_cooldown_distribution, totem_model, needed_resources_per_activity, simulation_config):
        self.playout_strategy = playout_strategy
        self.resource_constraints = resource_constraints
        self.resource_allocation_strategy = resource_allocation_strategy
        self.resource_cooldown_distribution = resource_cooldown_distribution
        self.totem_model = totem_model
        self.needed_resources_per_activity = needed_resources_per_activity
        self.simulation_config = simulation_config

    def run(self, sim_duration_s: int, resource_pool: dict, tick_size_s: int = 60, start_datetime: dt.datetime = None):
        return self.playout_strategy.run(self, sim_duration_s, resource_pool, tick_size_s, start_datetime)

    @classmethod
    def for_simple_simulation(cls, ocel, process_area):

        # Discover ToTem Model and MLPA
        totem_model = totemDiscovery(ocel)
        mlpa = mlpaDiscovery(totem_model)

        # Calculate Resource Cooldown Distribution
        resource_cooldown_dist = resource_cooldown_distribution(ocel, process_area.object_types, process_area.activities)

        # Filter event log on Process Area
        filtered_ocel = ocel.filter_by_process_area(mlpa, process_area)

        # Calculate Variants
        variants = find_object_variants_connected_component(filtered_ocel)

        # Calculate Variants Arrival Distribution
        var_arrival_dist = compute_variant_arrival_distribution(filtered_ocel, variants)

        # Initilize Playout Strategy
        playout_strategy = VariantPlayoutStrategy(variants, var_arrival_dist)

        # Calculate Resource Constraints
        resource_constraints = generate_resource_constraints(filtered_ocel, variants, 0.8, 2, 5)

        # Calculate Resource Allocation Strategy
        resource_allocation_strategy = calculate_resource_allocation_strategy(filtered_ocel, resource_cooldown_dist, ocel.obj_type_map)

        # Calculate needed resources per activity
        needed_resources_per_activity = resource_distribution_of_variants(filtered_ocel, variants)
    
        return cls(playout_strategy, resource_constraints, resource_allocation_strategy, resource_cooldown_dist, totem_model, needed_resources_per_activity, OCProcessAreaSimulationConfiguration())

    @classmethod
    def for_advanced_simulation(cls, ocel, process_area):
        # TODO: Implement advanced simulation model (state-space, connected components + arrival distribution)

        # Calculate Resource Cooldown Distribution
        resource_cooldown_dist = resource_cooldown_distribution(ocel, process_area.object_types, process_area.activities)
        
        # Filter event log on Process Area
        mlpa = mlpaDiscovery(cls.totem_model)
        filtered_ocel = ocel.filter_by_process_area(mlpa, get_level_of_process_area(mlpa, process_area), process_area)

        # Calculate State-Space

        # Calculate Connected Components

        # Calculate Connected Component Arrival Distribution

        # Initilize Playout Strategy
        playout_strategy = StateSpacePlayoutStrategy()

        # Calculate Resource Constraints
        resource_constraints = generate_resource_constraints(filtered_ocel, process_area, 0.8, 2, 5)

        # Calculate Resource Allocation Strategy
        resource_allocation_strategy = calculate_resource_allocation_strategy(filtered_ocel, resource_cooldown_dist, ocel.obj_type_map)
        
        return cls(playout_strategy, resource_constraints, resource_allocation_strategy, resource_cooldown_dist, None, None, OCProcessAreaSimulationConfiguration())


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
    
    def generate_arrival_schedule(self, start_datetime, sim_duration_s: int) -> list:
        """
        Pre-computes an arrival schedule for the simulation.

        Iterates hour by hour over the simulation period. For each hour slot,
        draws n ~ Poisson(sum of avg_arrivals_per_hour across all variants) to
        determine how many instances arrive. Each instance is then assigned a
        variant proportionally to avg_arrivals_per_hour[weekday][hour] and a
        uniformly random offset within that hour.

        Args:
            start_datetime: datetime of simulation start
            sim_duration_s: total simulation duration in seconds

        Returns:
            list of (arrival_time_s, variant) tuples, sorted ascending by arrival_time_s
        """
        variant_list = list(self.variants)
        schedule = []
        hour_s = 3600

        current_s = 0
        while current_s < sim_duration_s:
            slot_dt = dt.datetime.fromtimestamp(
                start_datetime.timestamp() + current_s, tz=dt.timezone.utc
            )
            weekday = WEEKDAY_NAMES[slot_dt.weekday()]
            hour = slot_dt.hour

            # avg arrivals per variant for this slot
            avg_per_variant = [
                self.variant_arrival_distribution.get(v, {})
                    .get("avg_arrivals_per_hour", {})
                    .get(weekday, {})
                    .get(hour, 0.0)
                for v in variant_list
            ]
            total_avg = sum(avg_per_variant)

            if total_avg > 0:
                n_arrivals = np.random.poisson(total_avg)
                for _ in range(n_arrivals):
                    chosen_variant = random.choices(variant_list, weights=avg_per_variant, k=1)[0]
                    offset_s = random.randint(0, hour_s - 1)
                    arrival_s = current_s + offset_s
                    if arrival_s < sim_duration_s:
                        schedule.append((arrival_s, chosen_variant))

            current_s += hour_s

        schedule.sort(key=lambda x: x[0])
        return schedule

    def run(self, simulation_model, sim_duration_s: int, resource_pool: dict, tick_size_s: int = 60, start_datetime: dt.datetime = None) -> dict:
        """
        Runs the variant-based simulation.

        Args:
            simulation_model: OCProcessAreaSimulationModel
            sim_duration_s: Total simulation duration in seconds
            resource_pool: {resource_type: count} — e.g. {'Forklift': 3, 'Crane': 2}
            tick_size_s: Clock tick size in seconds
            start_datetime: datetime of simulation start

        Returns:
            (ObjectCentricEventLog, finished_count)
        """

        # --- Initialize simulation parameters ---
        if start_datetime is None:
            start_datetime = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=sim_duration_s)

        allocation_strategy = simulation_model.resource_allocation_strategy
        cooldown_dist = simulation_model.resource_cooldown_distribution
        resource_constraints = simulation_model.resource_constraints or {}
        resource_distribution_of_variants = simulation_model.needed_resources_per_activity or {}
        simulation_config = simulation_model.simulation_config

        schedule = self.generate_arrival_schedule(start_datetime, sim_duration_s)

        # Generate resource IDs and initialize queues: {resource_type: [(available_at_s, resource_id), ...]}
        resource_pool_expanded = {}
        resource_id_type_map = {}
        for res_type, count in resource_pool.items():
            res_ids = [f"{res_type}_{i+1}" for i in range(count)]
            resource_pool_expanded[res_type] = res_ids
            for rid in res_ids:
                resource_id_type_map[rid] = res_type
        
        # TODO: Find solution to start with realistic initial resource availability => If all immediately available, not realistic
        resource_queues = {
            res_type: list(rids) for res_type, rids in resource_pool_expanded.items()
        }

        blocked_resources = set()  # Track resources currently blocked due to constraints
        active_executions = []
        finished_count = 0
        event_output = []
        object_output = {} 
        instance_counter = 0
        schedule_idx = 0

        # --- Main simulation loop ---
        for tick in range(0, sim_duration_s, tick_size_s):

            # Phase A: Spawn new instances from arrival schedule
            while schedule_idx < len(schedule) and schedule[schedule_idx][0] <= tick:
                _, variant = schedule[schedule_idx]
                schedule_idx += 1
                # Build obj_map that maps original object IDs to new simulated IDs
                inst_graph = variant.graph.copy()
                obj_map = {}
                obj_id_to_type = {}
                for _, _, data in inst_graph.edges(data=True):
                    edge_type = data.get('type', '')
                    types = edge_type.split('|')
                    for orig_oid in data.get('objects', []):
                        if orig_oid not in obj_id_to_type and types[0]:
                            obj_id_to_type[orig_oid] = types[0]
                for orig_oid, otype in obj_id_to_type.items():
                    new_oid = f"{otype}_inst{instance_counter}_{len(obj_map)}"
                    obj_map[orig_oid] = new_oid
                    object_output[new_oid] = otype

                active_executions.append({
                    'id': instance_counter,
                    'event_object_graph': inst_graph,
                    'finished_nodes': set(),
                    'simulated_events': [],
                    'variant': variant,
                    'obj_map': obj_map,
                })

                instance_counter += 1
            
            # Phase B: Free up resources that have completed their cooldown
            freed = set()
            for res_id, cooldown_end in blocked_resources:
                if cooldown_end <= tick:
                    freed.add((res_id, cooldown_end))
                    res_type = resource_id_type_map[res_id]
                    resource_queues[res_type].append(res_id)
            blocked_resources -= freed


            # Phase C: Try executing enabled activities for each active instance
            next_active = []
            for inst in active_executions:
                graph = inst['event_object_graph']

                # Find enabled nodes: all predecessors already done
                enabled = [
                    n for n in graph.nodes()
                    if n not in inst['finished_nodes']
                    and all(p in inst['finished_nodes'] for p in graph.predecessors(n))
                ]

                for node in enabled:
                    activity = graph.nodes[node]['label']

                    # TODO: Geht das nicht mir Random Int oder so deutlich einfacher?
                    # Determine how many resources of each type this activity needs
                    variant_res_dist = resource_distribution_of_variants.get(inst['variant'], {})
                    activity_res_dist = variant_res_dist.get(activity, {})
                    # Round mean_count to get the needed count per type, only for types in the pool
                    needed_res_types = {
                        res_type: round(stats["mean_count"])
                        for res_type, stats in activity_res_dist.items()
                        if res_type in resource_pool_expanded and round(stats["mean_count"]) > 0
                    }

                    variant_constraints = resource_constraints.get(inst['variant'], {})

                    # Allocate resources respecting constraints
                    allocated = _allocate_resources(
                        activity, variant_constraints, inst['simulated_events'],
                        resource_queues, resource_id_type_map, allocation_strategy,
                        needed_res_types, simulation_config
                    )

                    if allocated is None:
                        # Cannot fire this activity, as no resource allocation is possible
                        continue

                    # --- Execute the activity ---

                    # Remove allocated resources from queues and block them
                    all_allocated_rids = []
                    for res_type, res_ids in allocated.items():
                        for rid in res_ids:
                            resource_queues[res_type].remove(rid)
                            all_allocated_rids.append(rid)

                            # Schedule resource cooldown return
                            stats = cooldown_dist.get(activity, {}).get(res_type, {})
                            mean_cd = stats.get('mean_duration_s', 0)
                            std_cd = stats.get('std_duration_s', 0)
                            cd = max(0, random.gauss(mean_cd, std_cd)) if std_cd > 0 else mean_cd
                            blocked_resources.add((rid, tick + cd))

                    # Record simulated event for constraint tracking
                    inst['simulated_events'].append({
                        '_activity': activity,
                        'process_area_resources': all_allocated_rids,
                    })

                    # Build event: collect process objects from incident edges + resources
                    node_objs = _get_node_objects(graph, node)
                    event_objects = [inst['obj_map'][oid] for oid in node_objs if oid in inst['obj_map']]
                    event_objects.extend(all_allocated_rids)

                    abs_ts = int(start_datetime.timestamp()) + tick

                    event_output.append({
                        '_eventId': f"sim_e_{inst['id']}_{node}",
                        '_activity': activity,
                        '_timestampUnix': abs_ts,
                        '_objects': sorted(set(event_objects)),
                        '_qualifiers': [],
                        '_attributes': json.dumps({'process_area_resources': all_allocated_rids}),
                    })

                    inst['finished_nodes'].add(node)

                # Check completion
                if len(inst['finished_nodes']) == graph.number_of_nodes():
                    finished_count += 1
                else:
                    next_active.append(inst)

            active_executions = next_active

        # --- 3. Build output OCEL ---
        if event_output:
            events_df = pl.DataFrame(event_output, schema=EVENTS_SCHEMA)
        else:
            events_df = pl.DataFrame(schema=EVENTS_SCHEMA)

        obj_data = []
        for oid, otype in object_output.items():
            obj_data.append({'_objId': oid, '_objType': otype, '_targetObjects': [], '_qualifiers': []})

        if obj_data:
            objects_df = pl.DataFrame(obj_data, schema=OBJECTS_SCHEMA)
        else:
            objects_df = pl.DataFrame(schema=OBJECTS_SCHEMA)

        return ObjectCentricEventLog(events_df, objects_df), finished_count


class StateSpacePlayoutStrategy:
    """
    A more complex playout strategy that simulates the execution of the process based on the stochastic state-space of the process. 
    It can be used to simulate the process using a Stochastic State-space approach, receiving just Connected-Components of Objects as Input, and calculating the connected Events, based on the state space.
    Input needed:
    - Stochastic State-space: A representation of the process behavior in terms of states and transitions, capturing the probabilities of events appearances and object interactions.
    - Connected Component Distribution: A distribution of the connected components of objects, used for simulating the arrival of new cases in the process.
    """
    def __init__(self, state_space, connected_component_distribution):
        self.state_space = state_space
        self.connected_component_distribution = connected_component_distribution
        return
    
    def run(self, simulation_model):
        return


if __name__ == "__main__":
    from datetime import datetime
    import networkx as nx
    from totem_lib import totemDiscovery, import_ocel, mlpaDiscovery
    from totem_lib.variants.ocvariants import find_object_variants_connected_component, find_variants
    from totem_lib.simulation.utils.resource_constraints import generate_resource_constraints
    from totem_lib.simulation.utils.basic_simulation_statistics import (
        variant_arrival_distribution,
        object_distribution_of_variants,
        resource_distribution_of_variants,
    )
    from totem_lib.simulation.utils.resource_statistics import (
        resource_cooldown_distribution,
        calculate_resource_allocation_strategy
    )
    from totem_lib.simulation.utils.process_area import ProcessArea

    # load a sample OCEL
    print(f'Start importing Event Log, start time: {datetime.now()}')
    ocel = import_ocel(r'C:\Users\basti\Documents\Studium\MA\container_logistics.json')
    #ocel = import_ocel(r'C:\Users\basti\Documents\Studium\MA\ocel2-export.xml')
    
    #print(f'Start totem Discovery, start time: {datetime.now()}')
    totem = totemDiscovery(ocel)

    #print(f'Start MLPA Discovery, start time: {datetime.now()}')
    mlpa = mlpaDiscovery(totem)
    print(mlpa)
    pa1 = ProcessArea(
        object_types=['Transport Document', 'Customer Order'],
        activities=['Create Transport Document', 'Register Customer Order', 'Book Vehicles'],
    )

    pa2 = ProcessArea(
        object_types=['Container', 'Customer Order'],
        activities=['Create Transport Document', 'Register Customer Order', 'Book Vehicles','Bring to Loading Bay', 'Drive to Terminal', 'Reschedule Container', 'Pick Up Empty Container', 'Depart', 'Order Empty Containers', 'Place in Stock', 'Load to Vehicle', 'Weigh'],
    )
    # filtered_ocel = ocel.filter_by_process_area(mlpa, pa)
    # #filtered_ocel = ocel.filter_by_process_area(mlpa, 2, ['Transport Document', 'Customer Order', 'Container'])
    # #print (filtered_ocel.events)

    # variants = find_object_variants_connected_component(ocel)
    # #print(variant_arrival_distribution(ocel, variants))
    # for variant in variants:
    #     print(variant)
    #     print(variant.graph.nodes(data=True))
        

    #resource_constraints = generate_resource_constraints(filtered_ocel, connected_components, 0.8, 2, 5)

    #cooldown = resource_cooldown_distribution(ocel, ['Transport Document', 'Customer Order', 'Container'], ['Reschedule Container', 'Register Customer Order', 'Load Truck'])
    #print(cooldown)

    #allocation_strategy = calculate_resource_allocation_strategy(filtered_ocel, cooldown, ocel.obj_type_map)

    #playout_strategy = VariantPlayoutStrategy(connected_components, variant_arrival_distribution(filtered_ocel, connected_components))

    
    #print(filtered_ocel)
    filtered_ocel = ocel.filter_by_process_area(mlpa, pa2)
    simulation_model = OCProcessAreaSimulationModel.for_simple_simulation(ocel, pa2)
    sim_log, finished_count = simulation_model.run(sim_duration_s=3600*24*7*100, resource_pool={'Truck': 3, 'Forklift': 5}, tick_size_s=60)
    print(f"Finished {finished_count} instances in the simulation.")
    print(sim_log)