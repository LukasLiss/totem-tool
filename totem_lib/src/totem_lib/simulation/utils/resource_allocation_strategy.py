import json
from collections import defaultdict

from .resource_calendar import availability_probability, wall_clock_end_for_available
from .resource_cooldown import sample_cooldown

ALLOCATION_STRATEGIES = [
    "random",
    "FIFO",
    "LIFO",
]  # TODO: consider adding more complex strategies(round-robin,...)


def calculate_resource_allocation_strategy(
    ocel,
    resource_cooldowns: dict = None,
    resource_type_map: dict = None,
    calendars: dict[str, dict] | None = None,
) -> dict:
    """
    Analyzes the event log to determine the most likely resource allocation strategy per resource type.

    The algorithm replays the event log chronologically and maintains an idle queue per resource type,
    ordered by the time each resource last became free. For each event and resource
    type, it checks which positions of the idle queue the assigned resources occupy:
    the k front-most positions → FIFO, the k back-most → LIFO, any other
    combination → random. An event may consume several resources of the same type;
    it is then scored once, and only when all of them are in the idle queue. Every
    assigned resource leaves the queue and re-enters it with its own cooldown.

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
                            {activity: {resource_type: {"samples": [...], ...}}}.
                            Each replay step draws a cooldown from the observed
                            samples via ``sample_cooldown`` to schedule when a
                            resource becomes idle again. A missing entry means
                            cooldown 0.
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
        resources_by_type: dict[str, list[str]] = defaultdict(list)
        for rid in dict.fromkeys(resources):
            rt = resource_type_map.get(rid)
            if rt:
                resources_by_type[rt].append(rid)

        for rt, actual_rids in resources_by_type.items():
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
            position_of = {rid: i for i, rid in enumerate(candidate_ids)}

            # Only a fully idle pick is evidence about the strategy: if one of the
            # assigned resources was not in the queue, the replay disagrees with
            # the log and the positions say nothing
            positions = sorted(
                position_of[rid] for rid in actual_rids if rid in position_of
            )
            if len(positions) == len(actual_rids):
                k = len(positions)
                n = len(candidate_ids)
                if positions == list(range(k)):
                    scores[rt]["FIFO"] += 1
                elif positions == list(range(n - k, n)):
                    scores[rt]["LIFO"] += 1
                else:
                    scores[rt]["random"] += 1

            # Reschedule resources: remove old entries, add with updated availability
            taken = set(actual_rids)
            idle_queue[rt] = [
                (ts, rid) for ts, rid in idle_queue[rt] if rid not in taken
            ]
            for rid in actual_rids:
                cooldown = sample_cooldown(
                    resource_cooldowns.get(activity, {}).get(rt, {})
                )
                # The cooldown is calendar-discounted working time; convert it back to
                # the wall-clock second the resource becomes idle again under the calendar.
                available_at = (
                    wall_clock_end_for_available(calendar, int(timestamp), cooldown)
                    if calendar
                    else int(timestamp + cooldown)
                )
                idle_queue[rt].append((available_at, rid))

    # Pick the strategy with the highest score per resource type
    result: dict[str, str] = {}
    for rt, s in scores.items():
        total = sum(s.values())
        result[rt] = max(s, key=lambda k: s[k]) if total > 0 else "random"

    return result
