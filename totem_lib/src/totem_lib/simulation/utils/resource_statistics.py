import json
import statistics
import itertools
from collections import defaultdict

ALLOCATION_STRATEGIES = ["random", "FIFO", "LIFO"] # TODO: consider adding more complex strategies(round-robin,...)

def resource_cooldown_distribution(ocel, objects_to_analyze: list[str], activities: list[str]) -> dict:
    """
    For each activity in the list and each resource type in the list, computes the distribution of how long
    a resource of that type is occupied after performing that activity.

    Duration is measured as the gap between the current event's timestamp and the
    next event in which the same resource appears. To end an interval all activites are considered, not only the tracked ones.
    Although the simulation mainly uses filtered logs, this function considers the entire log to accuratly capture resource cooldowns.

    Args:
        ocel: ObjectCentricEventLog
        objects_to_analyze: list of object types to consider as resources
        activities: list of activity names to analyse

    Returns:
        dict: {
            activity: {
                resource_type: {
                    "mean_duration_s":  float,
                    "std_duration_s":   float,
                    "min_duration_s":   float,
                    "max_duration_s":   float,
                    "sample_count":     int,
                }
            }
        }
    """

    
    open_cooldowns: dict[str, tuple[int, str]] = {}
    finished_intervals: dict[tuple[str, str], list[int]] = defaultdict(list)

    activities_set = set(activities)

    if ocel.events.is_empty():
        print("Error: Cannot compute resource cooldown distribution on an empty event log.")
        return {}

    sorted_events = ocel.events.sort("_timestampUnix")

    for row in sorted_events.iter_rows(named=True):
        timestamp = row["_timestampUnix"]
        activity = row["_activity"]
        objects = row["_objects"]

        for obj_id in objects:
            resource_type = ocel.obj_type_map.get(obj_id)
            if resource_type not in objects_to_analyze:
                continue

            if obj_id in open_cooldowns:
                # Any event closes an open interval, regardless of whether its activity is tracked
                start_ts, start_act = open_cooldowns.pop(obj_id)
                finished_intervals[(start_act, resource_type)].append(timestamp - start_ts)

            if activity in activities_set:
                # Only tracked activities open a new interval
                open_cooldowns[obj_id] = (timestamp, activity)

    result: dict[str, dict] = defaultdict(dict)
    for (activity, resource_type), durations in finished_intervals.items():
        result[activity][resource_type] = {
            "mean_duration_s": statistics.mean(durations),
            "std_duration_s": statistics.stdev(durations) if len(durations) > 1 else 0.0,
            "min_duration_s": min(durations),
            "max_duration_s": max(durations),
            "sample_count": len(durations),
        }

    return result


def calculate_resource_allocation_strategy(ocel, resource_cooldowns: dict = None, resource_type_map: dict = None) -> dict:
    """
    Analyzes the event log to determine the most likely resource allocation strategy per resource type.

    The algorithm replays the event log chronologically and maintains an idle queue per resource type,
    ordered by the time each resource last became free. For each event, it
    checks at which position in the idle queue the actually assigned resource sits:
    position 0 → FIFO, last position → LIFO, anywhere else → random.

    Args:
        ocel: ObjectCentricEventLog — typically the filtered OCEL (contains process_area_resources in _attributes).
        resource_cooldowns: The resource cooldown distribution, structured as
                            {activity: {resource_type: {"mean_duration_s": float, ...}}}.
                            Used to schedule when a resource becomes idle again after an event.
                            If None or missing an entry, cooldown defaults to 0.
        resource_type_map: Optional. A dict mapping resource_id -> resource_type, used to resolve
                           the type of resources in process_area_resources. Needed, as algorithm also runs on filtered OCELs
                           where the resource types are no longer directly visible
    Returns:
        dict: {resource_type: strategy} where strategy is one of ALLOCATION_STRATEGIES
    """
    if resource_cooldowns is None:
        resource_cooldowns = {}
    if resource_type_map is None:
        resource_type_map = ocel.obj_type_map

    # scores[resource_type][strategy] = hit count
    scores: dict[str, dict[str, int]] = defaultdict(lambda: {"FIFO": 0, "LIFO": 0, "random": 0})
    
    # idle_queue[resource_type] = list of (available_at_ts, resource_id), sorted ascending by ts (FIFO order)
    idle_queue: dict[str, list[tuple[int, str]]] = defaultdict(list)

    # Iterate over events 
    for row in ocel.events.sort("_timestampUnix").iter_rows(named=True):
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

        # Group resources by type
        resources_by_type: dict[str, str] = {}
        for rid in resources:
            rt = resource_type_map.get(rid)
            if rt and rt not in resources_by_type:
                resources_by_type[rt] = rid

        for rt, actual_rid in resources_by_type.items():
            # Candidate queue: resources that are in idle at this timestamp, sorted FIFO-first (earliest free first)
            candidates = sorted(
                [(ts, rid) for ts, rid in idle_queue[rt] if ts <= timestamp],
                key=lambda x: x[0],
            )
            candidate_ids = [rid for _, rid in candidates]

            if actual_rid in candidate_ids:
                pos = candidate_ids.index(actual_rid)
                n = len(candidate_ids)
                if n == 1 or pos == 0:
                    scores[rt]["FIFO"] += 1
                elif pos == n - 1:
                    scores[rt]["LIFO"] += 1
                else:
                    scores[rt]["random"] += 1

            # Reschedule resource: remove old entry, add with updated availability
            idle_queue[rt] = [(ts, rid) for ts, rid in idle_queue[rt] if rid != actual_rid]
            mean_cooldown = resource_cooldowns.get(activity, {}).get(rt, {}).get("mean_duration_s", 0)
            idle_queue[rt].append((int(timestamp + mean_cooldown), actual_rid))

    # Pick the strategy with the highest score per resource type
    result: dict[str, str] = {}
    for rt, s in scores.items():
        total = sum(s.values())
        result[rt] = max(s, key=lambda k: s[k]) if total > 0 else "random"

    return result