import random
from collections import defaultdict

from .resource_calendar import available_seconds_between


def resource_cooldown_distribution(
    ocel,
    objects_to_analyze: list[str],
    activities: list[str],
    calendars: dict[str, dict] | None = None,
) -> dict:
    """
    For each activity in the list and each resource type in the list, computes the distribution of how long
    a resource of that type is occupied after performing that activity.

    Duration is measured as the gap between the current event's timestamp and the
    next event in which the same resource appears. To end an interval all activites are considered, not only the tracked ones.
    Although the simulation mainly uses filtered logs, this function considers the entire log to accuratly capture resource cooldowns.

    When ``calendars`` is given, an interval's duration is the resource's
    *available* (working) time in the gap rather than the raw wall-clock span:
    the time the resource is simply not present (nights, weekends) is discounted.

    Args:
        ocel: ObjectCentricEventLog
        objects_to_analyze: list of object types to consider as resources
        activities: list of activity names to analyse
        calendars: Optional ``{resource_type: {weekday: [24 floats]}}`` calendar
            probabilities. A type without an entry falls back to wall-clock time.

    Returns:
        dict: {
            activity: {
                resource_type: {
                    "samples":        list[float],  # observed cooldowns in seconds
                    "min_duration_s": float,
                    "max_duration_s": float,
                    "sample_count":   int,
                }
            }
        }
    """

    open_cooldowns: dict[str, tuple[int, str]] = {}
    finished_intervals: dict[tuple[str, str], list[float]] = defaultdict(list)

    activities_set = set(activities)
    calendars = calendars or {}

    if ocel.events.is_empty():
        print(
            "Error: Cannot compute resource cooldown distribution on an empty event log."
        )
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
                calendar = calendars.get(resource_type)
                duration = (
                    available_seconds_between(calendar, start_ts, timestamp)
                    if calendar
                    else timestamp - start_ts
                )
                finished_intervals[(start_act, resource_type)].append(duration)

            if activity in activities_set:
                # Only tracked activities open a new interval
                open_cooldowns[obj_id] = (timestamp, activity)

    result: dict[str, dict] = defaultdict(dict)
    for (activity, resource_type), durations in finished_intervals.items():
        result[activity][resource_type] = {
            "samples": [float(d) for d in durations],
            "min_duration_s": min(durations),
            "max_duration_s": max(durations),
            "sample_count": len(durations),
        }

    return result


def sample_cooldown(entry: dict, rng: random.Random = random) -> float:
    """Draw a cooldown (seconds) from an empirical cooldown-distribution entry.

    The draw is a non-parametric bootstrap: one of the entry's observed
    ``samples`` is picked uniformly at random. No distributional shape is
    assumed and no binning is applied. An entry without samples yields ``0.0``
    — i.e. no cooldown.

    Args:
        entry: One ``{resource_type: stats}`` value from
            ``resource_cooldown_distribution``.
        rng: Random source; pass a seeded ``random.Random`` for reproducibility.

    Returns:
        A non-negative cooldown in seconds.
    """
    samples = entry.get("samples") if entry else None
    if not samples:
        return 0.0
    return float(rng.choice(samples))
