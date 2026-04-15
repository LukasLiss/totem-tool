import statistics
from collections import defaultdict


def resource_cooldown_distribution(ocel, objects_to_analyze: list[str], activities: list[str]) -> dict:
    """
    For each activity and each resource type, computes the distribution of how long
    a resource of that type is occupied after performing that activity.

    Duration is measured as the gap between the current event's timestamp and the
    next event in which the same resource appears (i.e., the resource's cooldown time).
    Although the simulation mainly uses filtered logs, this function considers the entire log to accuratly capture resource cooldowns.

    Args:
        ocel: ObjectCentricEventLog
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
                    "samples":          list[float],  # individual durations in seconds
                }
            }
        }
    """

    
    open_cooldowns: dict[str, tuple[int, str]] = {}
    finished_intervals: dict[tuple[str, str], list[int]] = defaultdict(list)

    sorted_events = ocel.events.sort("_timestampUnix")
    for row in sorted_events.iter_rows(named=True):
        event_id = row["_eventId"]
        timestamp = row["_timestampUnix"]
        activity = row["_activity"]
        objects = row["_objects"]

        # Only analyze events that are needed for the simulation
        if activity not in activities:
            continue
        
        for obj_id in objects:
            # Only consider objects that appear as resources, and therefore are relevant for the simulation
            if ocel.obj_type_map.get(obj_id) not in objects_to_analyze:
                continue
            
            
            if obj_id not in open_cooldowns:
                # If did not appear beforehand, start a new cooldown interval
                open_cooldowns[obj_id] = (timestamp, activity)
            else:
                # If object already appeared before, close cooldown interval and start a new one
                start_ts, start_act = open_cooldowns.pop(obj_id)
                finished_intervals[(start_act, obj_id)].append(timestamp - start_ts)
                open_cooldowns[obj_id] = (timestamp, activity)

    result = defaultdict(dict)
    # Aggregate durations by activity and resource type
    for (activity, obj_id), durations in finished_intervals.items():
        resource_type = ocel.obj_type_map.get(obj_id)
        if resource_type is None:
            continue
        result[activity][resource_type] = {
            "mean_duration_s": statistics.mean(durations),
            "std_duration_s": statistics.stdev(durations) if len(durations) > 1 else 0.0,
            "min_duration_s": min(durations),
            "max_duration_s": max(durations),
            "sample_count": len(durations),
            "samples": durations,
        }

    return result
