from collections import Counter, defaultdict
from datetime import datetime, timezone

from .event_resources import event_resource_ids
from .resource_calendar import WEEKDAYS, available_seconds_between


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
        WEEKDAYS[i]: full_weeks
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
            weekday = WEEKDAYS[dt.weekday()]
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

    resource_lookup = event_resource_ids(ocel)

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


def usual_resource_types(ocel, obj_type_map=None) -> dict[str, list[str]]:
    """The resource types that usually execute each activity.

    For every activity, the most frequent set of resource types among its
    events; ties go to the lexicographically smallest set. Activities that
    usually run without resources get no entry.

    Args:
        ocel: ObjectCentricEventLog, typically process-area-filtered (resources
            are read from the ``process_area_resources`` attribute).
        obj_type_map: Mapping from object ID to object type. Must be passed
            for a process-area-filtered log, which no longer contains the
            resource objects.

    Returns:
        dict: ``{activity: [resource_type, ...]}`` with the types sorted.
    """
    obj_type_map = obj_type_map if obj_type_map is not None else ocel.obj_type_map
    resource_lookup = event_resource_ids(ocel)
    type_sets: dict[str, Counter] = defaultdict(Counter)
    for event_id, activity in ocel.events.select(["_eventId", "_activity"]).iter_rows():
        types = tuple(
            sorted(
                {
                    obj_type_map[rid]
                    for rid in resource_lookup.get(event_id) or []
                    if rid in obj_type_map
                }
            )
        )
        type_sets[activity][types] += 1
    usual = {}
    for activity, counter in type_sets.items():
        types = min(counter, key=lambda t: (-counter[t], t))
        if types:
            usual[activity] = list(types)
    return usual


def activity_delay_distribution(ocel, working_windows=None):
    """
    Per activity, the empirical pool of *delays* (in seconds) between an event
    becoming enabled and actually occurring.

    With ``working_windows``, a delay is measured in the activity's working
    time: the hours its window marks closed (nights, weekends) do not count,
    because the playout adds them again when it converts the sampled delay back
    to wall-clock time. Without a window, a delay is wall-clock time.

    Args:
        ocel: ObjectCentricEventLog (typically the process-area-filtered log, so
            the EOG structure matches what the simulation reproduces).
        working_windows: Optional ``{activity: window matrix}`` as returned by
            ``activity_working_windows``.

    Returns:
        dict: {activity: [delay_s, ...]} — one bootstrap sample pool per activity.
    """
    working_windows = working_windows or {}
    eog = ocel.eog
    delays: dict[str, list[int]] = defaultdict(list)
    for node, data in eog.nodes(data=True):
        preds = list(eog.predecessors(node))
        if not preds:
            continue
        enabling_ts = max(eog.nodes[p]["timestamp"] for p in preds)
        end_ts = max(enabling_ts, data["timestamp"])
        window = working_windows.get(data["label"])
        delay = (
            int(available_seconds_between(window, enabling_ts, end_ts))
            if window
            else end_ts - enabling_ts
        )
        delays[data["label"]].append(delay)
    return dict(delays)
