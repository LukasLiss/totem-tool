import statistics
from collections import defaultdict


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
