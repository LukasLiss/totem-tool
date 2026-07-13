import json
import random
from collections import defaultdict

from .resource_calendar import (
    availability_probability,
    available_seconds_between,
    wall_clock_end_for_available,
)

ALLOCATION_STRATEGIES = [
    "random",
    "FIFO",
    "LIFO",
]  # TODO: consider adding more complex strategies(round-robin,...)

_COOLDOWN_HISTOGRAM_BINS = 20


def _build_cooldown_histogram(
    durations: list[float], n_bins: int = _COOLDOWN_HISTOGRAM_BINS
) -> tuple[list[float], list[int]]:
    """Bin observed cooldown durations into an empirical histogram.

    Args:
        durations: Observed cooldown durations in seconds (at least one).
        n_bins: Maximum number of equal-width bins.

    Returns:
        ``(bin_edges, bin_counts)`` with ``len(bin_edges) == len(bin_counts) + 1``.
        A degenerate range (all durations equal) yields a single zero-width bin
        ``([v, v], [n])`` so a draw always returns ``v``.
    """
    low = float(min(durations))
    high = float(max(durations))
    if high <= low:
        return [low, low], [len(durations)]
    n = max(1, min(n_bins, len(durations)))
    width = (high - low) / n
    edges = [low + i * width for i in range(n + 1)]
    counts = [0] * n
    for d in durations:
        idx = int((d - low) / width)
        if idx >= n:  # d == high falls into the last bin
            idx = n - 1
        counts[idx] += 1
    return edges, counts


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
                    "bin_edges":      list[float],  # len == len(bin_counts) + 1
                    "bin_counts":     list[int],    # empirical histogram weights
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
        edges, counts = _build_cooldown_histogram(durations)
        result[activity][resource_type] = {
            "bin_edges": edges,
            "bin_counts": counts,
            "min_duration_s": min(durations),
            "max_duration_s": max(durations),
            "sample_count": len(durations),
        }

    return result


def sample_cooldown(entry: dict, rng: random.Random = random) -> float:
    """Draw a cooldown (seconds) from an empirical cooldown-distribution entry.

    The draw is a non-parametric bootstrap from the entry's histogram
    (``bin_edges`` + ``bin_counts``): a bin is chosen with probability
    proportional to its count and a value is drawn uniformly inside it. No
    distributional shape is assumed.

    An optional ``[select_min_s, select_max_s]`` interval (set when the user
    trims the range in the UI) restricts the draw to that band: bins are clipped
    to the interval and weighted by their overlap, then renormalised — i.e.
    values outside the band are excluded, not capped. An entry without a usable
    histogram (empty or all-zero bins), or an interval containing no samples,
    yields ``0.0`` — i.e. no cooldown.

    Args:
        entry: One ``{resource_type: stats}`` value from
            ``resource_cooldown_distribution`` (or a frontend override of it).
        rng: Random source; pass a seeded ``random.Random`` for reproducibility.

    Returns:
        A non-negative cooldown in seconds.
    """
    edges = entry.get("bin_edges")
    counts = entry.get("bin_counts")
    if not edges or not counts:
        return 0.0

    lo = entry.get("select_min_s")
    hi = entry.get("select_max_s")
    lo = float(edges[0]) if lo is None else float(lo)
    hi = float(edges[-1]) if hi is None else float(hi)
    if hi < lo:
        lo, hi = hi, lo

    # Clip each bin to [lo, hi]; a bin contributes its overlap fraction of the
    # count and is drawn from uniformly within the overlapping sub-range.
    segments: list[tuple[float, float, float]] = []  # (weight, low, high)
    total = 0.0
    for i, count in enumerate(counts):
        if count <= 0:
            continue
        e0, e1 = edges[i], edges[i + 1]
        if e1 <= e0:  # zero-width (degenerate / all-equal) bin at value e0
            if lo <= e0 <= hi:
                segments.append((count, e0, e0))
                total += count
            continue
        a = max(e0, lo)
        b = min(e1, hi)
        if b <= a:
            continue
        weight = count * (b - a) / (e1 - e0)
        segments.append((weight, a, b))
        total += weight

    if total <= 0:
        return 0.0
    threshold = rng.uniform(0.0, total)
    cumulative = 0.0
    for weight, low, high in segments:
        cumulative += weight
        if threshold <= cumulative:
            return rng.uniform(low, high) if high > low else float(low)
    _, low, high = segments[-1]
    return rng.uniform(low, high) if high > low else float(low)


def calculate_resource_allocation_strategy(
    ocel,
    resource_cooldowns: dict = None,
    resource_type_map: dict = None,
    calendars: dict[str, dict] | None = None,
) -> dict:
    """
    Analyzes the event log to determine the most likely resource allocation strategy per resource type.

    The algorithm replays the event log chronologically and maintains an idle queue per resource type,
    ordered by the time each resource last became free. For each event, it
    checks at which position in the idle queue the actually assigned resource sits:
    position 0 → FIFO, last position → LIFO, anywhere else → random.

    When ``calendars`` is given, the replay is made consistent with the calendar in
    two ways, matching what the playout allocation actually sees:
    - **Cooldowns are calendar-discounted working time.** A resource's next-idle
      time is the wall-clock end at which its (available-seconds) cooldown accrues
      under the calendar.
    - **Off-shift resources are not candidates.** A resource type that is never
      present (probability 0) at the event's clock hour is excluded from the idle
      queue-position computation, so it does not distort the FIFO/LIFO index.

    Args:
        ocel: ObjectCentricEventLog — typically the filtered OCEL (contains process_area_resources in _attributes).
        resource_cooldowns: The resource cooldown distribution, structured as
                            {activity: {resource_type: {"bin_edges": [...],
                            "bin_counts": [...], ...}}}. Each replay step draws a
                            cooldown from the empirical histogram via
                            ``sample_cooldown`` to schedule when a resource
                            becomes idle again. A missing entry means cooldown 0.
        resource_type_map: Optional. A dict mapping resource_id -> resource_type, used to resolve
                           the type of resources in process_area_resources. Needed, as algorithm also runs on filtered OCELs
                           where the resource types are no longer directly visible
        calendars: Optional ``{resource_type: {weekday: [24 floats]}}`` calendar
                   probabilities. A type without an entry falls back to wall-clock time.
    Returns:
        dict: {resource_type: strategy} where strategy is one of ALLOCATION_STRATEGIES
    """
    if resource_cooldowns is None:
        resource_cooldowns = {}
    if resource_type_map is None:
        resource_type_map = ocel.obj_type_map
    calendars = calendars or {}

    # scores[resource_type][strategy] = hit count
    scores: dict[str, dict[str, int]] = defaultdict(
        lambda: {"FIFO": 0, "LIFO": 0, "random": 0}
    )

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
            calendar = calendars.get(rt)
            # A type that is never present at this clock hour (probability 0) cannotbe a candidate
            type_present = (
                calendar is None or availability_probability(calendar, timestamp) > 0
            )
            # Candidate queue: resources that are in idle at this timestamp, sorted FIFO-first (earliest free first)
            candidates = (
                sorted(
                    [(ts, rid) for ts, rid in idle_queue[rt] if ts <= timestamp],
                    key=lambda x: x[0],
                )
                if type_present
                else []
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
            idle_queue[rt] = [
                (ts, rid) for ts, rid in idle_queue[rt] if rid != actual_rid
            ]
            cooldown = sample_cooldown(resource_cooldowns.get(activity, {}).get(rt, {}))
            # The cooldown is calendar-discounted working time; convert it back to
            # the wall-clock second the resource becomes idle again under the calendar.
            available_at = (
                wall_clock_end_for_available(calendar, int(timestamp), cooldown)
                if calendar
                else int(timestamp + cooldown)
            )
            idle_queue[rt].append((available_at, actual_rid))

    # Pick the strategy with the highest score per resource type
    result: dict[str, str] = {}
    for rt, s in scores.items():
        total = sum(s.values())
        result[rt] = max(s, key=lambda k: s[k]) if total > 0 else "random"

    return result
