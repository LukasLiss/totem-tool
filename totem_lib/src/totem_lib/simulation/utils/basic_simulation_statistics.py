import json
from collections import Counter, defaultdict
from datetime import datetime, timezone

WEEKDAY_NAMES = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
]


def variant_arrival_distribution(ocel, variants):
    """
    Computes the arrival distribution of variants, broken down by weekday and hour of day.

    The arrival time of an execution is defined as the minimum event timestamp within
    that execution (i.e. the start of the case).

    Args:
        ocel: ObjectCentricEventLog
        variants: Variants object

    Returns:
        dict: {
            variant: {
                "weekday_counts":           {weekday_name: int},
                "weekday_probabilities":    {weekday_name: float},
                "hourly_counts":            {weekday_name: {hour: int}},
                "hourly_probabilities":     {weekday_name: {hour: float}},
                "avg_arrivals_per_hour":    {weekday_name: {hour: float}},
            }
        }
    """

    # Calculate how often each weekday occurs in the observation period.
    timestamps = ocel.events.select("_timestampUnix").to_series().drop_nulls().to_list()

    start_dt = datetime.fromtimestamp(min(timestamps), tz=timezone.utc)
    end_dt = datetime.fromtimestamp(max(timestamps), tz=timezone.utc)

    total_days = (end_dt.date() - start_dt.date()).days + 1
    full_weeks, remaining_days = divmod(total_days, 7)
    # Every weekday appears at least full_weeks times; weekdays from start_weekday to (start_weekday + remaining_days - 1) appear one extra time.
    observed_weekdays = {
        WEEKDAY_NAMES[i]: full_weeks
        + (1 if (i - start_dt.weekday()) % 7 < remaining_days else 0)
        for i in range(7)
    }

    result = {}

    for variant in variants:
        weekday_counts = defaultdict(int)
        hourly_counts = defaultdict(lambda: defaultdict(int))

        for execution in variant.executions:
            timestamps = [ocel.get_event_timestamp(event_id) for event_id in execution]
            timestamps = [t for t in timestamps if t is not None]
            if not timestamps:
                continue

            start_ts = min(timestamps)
            dt = datetime.fromtimestamp(start_ts, tz=timezone.utc)
            weekday = WEEKDAY_NAMES[dt.weekday()]
            hour = dt.hour

            weekday_counts[weekday] += 1
            hourly_counts[weekday][hour] += 1

        total_executions = sum(weekday_counts.values())

        result[variant] = {
            "weekday_counts": dict(weekday_counts),
            "weekday_probabilities": (
                {day: count / total_executions for day, count in weekday_counts.items()}
                if total_executions > 0
                else {}
            ),
            "hourly_counts": {
                day: dict(hour_counts) for day, hour_counts in hourly_counts.items()
            },
            "hourly_probabilities": {
                day: {
                    hour: count / sum(hour_counts.values())
                    for hour, count in hour_counts.items()
                }
                for day, hour_counts in hourly_counts.items()
            },
            "avg_arrivals_per_hour": {
                day: {
                    hour: count / observed_weekdays[day]
                    for hour, count in hour_counts.items()
                }
                for day, hour_counts in hourly_counts.items()
                if observed_weekdays.get(day, 0) > 0
            },
        }

    return result


def object_distribution_of_variants(ocel, variants):
    """
    For each variant and each activity within it, computes the distribution of object
    types per activity invocation:
    - With what probability does an object type appear at a given activity invocation
    - How many objects of that type are typically involved

    Args:
        ocel: ObjectCentricEventLog
        variants: Variants object

    Returns:
        dict: {
            variant: {
                activity: {
                    object_type: {
                        "presence_probability":    float,          # fraction of invocations with this type
                        "count_distribution":      {count: float}, # P(count | type is present)
                        "mean_count":              float,          # mean count across all invocations (absent = 0)
                        "mean_count_when_present": float,          # mean count given type is present
                    }
                }
            }
        }
    """
    result = {}

    for variant in variants:
        # Collect per-activity object-type counts across all invocations
        # activity -> list of Counter({obj_type: count}) — one entry per invocation
        activity_invocations: dict[str, list[Counter]] = defaultdict(list)

        for execution in variant.executions:
            for event_id in execution:
                activity = ocel.get_event_activity(event_id)
                if activity is None:
                    continue
                type_counts = Counter()
                for obj_id in ocel.get_value(event_id, "event_objects") or []:
                    obj_type = ocel.obj_type_map.get(obj_id)
                    if obj_type:
                        type_counts[obj_type] += 1
                activity_invocations[activity].append(type_counts)

        activity_stats = {}
        for activity, invocations in activity_invocations.items():
            num_invocations = len(invocations)
            all_types = set()
            for tc in invocations:
                all_types.update(tc.keys())

            type_stats = {}
            for obj_type in all_types:
                counts = [tc.get(obj_type, 0) for tc in invocations]
                present_counts = [c for c in counts if c > 0]
                num_present = len(present_counts)

                type_stats[obj_type] = {
                    "presence_probability": num_present / num_invocations,
                    "count_distribution": (
                        {
                            cnt: freq / num_present
                            for cnt, freq in Counter(present_counts).items()
                        }
                        if num_present > 0
                        else {}
                    ),
                    "mean_count": sum(counts) / num_invocations,
                    "mean_count_when_present": (
                        sum(present_counts) / num_present if num_present > 0 else 0.0
                    ),
                }

            activity_stats[activity] = type_stats

        result[variant] = activity_stats

    return result


def resource_distribution_of_variants(ocel, variants, obj_type_map=None):
    """
    For each variant and each activity within it, computes the empirical
    distribution of how many resources of each **type** are used per activity
    invocation.

    Resources are read from _attributes JSON ("process_area_resources" key). Resource IDs are mapped to their type via
    obj_type_map.

    Args:
        ocel: ObjectCentricEventLog
        variants: Variants object
        obj_type_map: Optional mapping from object ID to object type. Must be
            passed when ``ocel`` is a process-area-filtered log: such a log no
            longer contains the resource objects

    Returns:
        dict: {
            variant: {
                activity: {
                    resource_type: {
                        "count_distribution": {count: float},  # P(count) over all
                            # invocations
                    }
                }
            }
        }
    """
    obj_type_map = obj_type_map if obj_type_map is not None else ocel.obj_type_map

    # Build event_id -> resource list from _attributes JSON (set by filter_by_process_area)
    resource_lookup: dict[str, list] = {
        row["_eventId"]: (
            json.loads(row["_attributes"]).get("process_area_resources", [])
            if row["_attributes"]
            else []
        )
        for row in ocel.events.select(["_eventId", "_attributes"]).iter_rows(named=True)
    }

    result = {}

    for variant in variants:
        # activity -> list of Counter({resource_type: count}) — one entry per invocation
        activity_invocations: dict[str, list[Counter]] = defaultdict(list)

        for execution in variant.executions:
            for event_id in execution:
                activity = ocel.get_event_activity(event_id)
                if activity is None:
                    continue
                resource_ids = resource_lookup.get(event_id) or []
                # Map resource IDs to their types and count per type
                type_counts = Counter(
                    obj_type_map[rid] for rid in resource_ids if rid in obj_type_map
                )
                activity_invocations[activity].append(type_counts)

        activity_stats = {}
        for activity, invocations in activity_invocations.items():
            num_invocations = len(invocations)
            all_types = set()
            for tc in invocations:
                all_types.update(tc.keys())

            type_stats = {}
            for res_type in all_types:
                counts = [tc.get(res_type, 0) for tc in invocations]
                type_stats[res_type] = {
                    "count_distribution": {
                        cnt: freq / num_invocations
                        for cnt, freq in Counter(counts).items()
                    },
                }

            activity_stats[activity] = type_stats

        result[variant] = activity_stats

    return result


def activity_delay_distribution(ocel):
    """
    Per activity, the empirical pool of *delays* (in seconds) between an event
    becoming enabled and actually occurring.

    Args:
        ocel: ObjectCentricEventLog (typically the process-area-filtered log, so
            the EOG structure matches what the simulation reproduces).

    Returns:
        dict: {activity: [delay_s, ...]} — one bootstrap sample pool per activity.
    """
    eog = ocel.eog
    delays: dict[str, list[int]] = defaultdict(list)
    for node, data in eog.nodes(data=True):
        preds = list(eog.predecessors(node))
        if not preds:
            continue
        enabling_ts = max(eog.nodes[p]["timestamp"] for p in preds)
        delays[data["label"]].append(max(0, data["timestamp"] - enabling_ts))
    return dict(delays)
