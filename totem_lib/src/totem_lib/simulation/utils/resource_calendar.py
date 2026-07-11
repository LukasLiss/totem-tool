import datetime as dt
import random

WEEKDAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
]
HOURS_PER_DAY = 24


def availability_probability(prob_by_weekday, timestamp_s: int) -> float:
    """Availability probability of a calendar at a given Unix-second timestamp.

    Args:
        prob_by_weekday: A calendar's probability matrix ``{weekday: [24 floats]}``
            (i.e. ``ResourceCalendar.probability``). May be falsy/empty.
        timestamp_s: Unix timestamp in seconds (UTC).

    Returns:
        The probability in ``[0, 1]``; ``1.0`` when the calendar is empty or the
        weekday/hour is missing (treated as "always available").
    """
    if not prob_by_weekday:
        return 1.0
    t = dt.datetime.fromtimestamp(timestamp_s, tz=dt.timezone.utc)
    hours = prob_by_weekday.get(WEEKDAYS[t.weekday()])
    if not hours:
        return 1.0
    return hours[t.hour]


def available_seconds_between(prob_by_weekday, start_s: int, end_s: int) -> float:
    """Expected available seconds in ``[start_s, end_s)`` under a calendar.

    Weights every second by the calendar's availability probability for its
    clock hour, so an hour with probability ``p`` contributes ``p * seconds``.
    This is the working-time content of a wall-clock span: it discounts the
    time a resource is simply not present (nights, weekends) rather than busy.

    Used to discount a discovered cooldown gap to its expected occupation. The
    playout then re-realizes that occupation stochastically (Bernoulli presence
    per hour in ``_CalendarGate``), so the round trip holds in expectation.

    Args:
        prob_by_weekday: A calendar's probability matrix ``{weekday: [24 floats]}``.
            Falsy/empty means "always available" → the full wall-clock span.
        start_s: Start Unix timestamp in seconds (UTC), inclusive.
        end_s: End Unix timestamp in seconds (UTC), exclusive.

    Returns:
        Expected available seconds in the span (``0.0`` if ``end_s <= start_s``).
    """
    if end_s <= start_s:
        return 0.0
    if not prob_by_weekday:
        return float(end_s - start_s)

    total = 0.0
    cur = start_s
    while cur < end_s:
        hour_end = (cur // 3600) * 3600 + 3600
        slice_end = min(hour_end, end_s)
        p = availability_probability(prob_by_weekday, cur)
        total += p * (slice_end - cur)
        cur = slice_end
    return total


# Safety cap for the hour-stepping burn-down below: stops runaway iteration on a
# (near-)zero calendar where available time accrues so slowly it would never reach
# the target. ~5 years of hours.
_MAX_ACCRUAL_HOURS = HOURS_PER_DAY * 365 * 5


def wall_clock_end_for_available(
    prob_by_weekday, start_s: int, work_seconds: float
) -> int:
    """Wall-clock second at which ``work_seconds`` of available time accrue.

    Deterministic inverse of :func:`available_seconds_between`: advances wall-clock
    time from ``start_s``, accumulating each hour's probability-weighted available
    seconds, until ``work_seconds`` is reached. Off-hours (low/zero probability)
    stretch the span; nights and weekends push the end further out.

    This is the counterpart to the playout's realized (Bernoulli) burn-down
    in ``_CalendarGate.cooldown_end``: it is used when analysing history — e.g. to
    re-express a calendar-discounted cooldown (measured in available seconds) back as
    the wall-clock time a resource becomes idle again — where no realized shift schedule
    exists and a deterministic estimate is wanted.

    Args:
        prob_by_weekday: A calendar's probability matrix ``{weekday: [24 floats]}``.
            Falsy/empty means "always available" → ``start_s + work_seconds``.
        start_s: Start Unix timestamp in seconds (UTC).
        work_seconds: Available seconds to accumulate (``<= 0`` returns ``start_s``).

    Returns:
        The Unix second (UTC) at which the accumulated available time reaches
        ``work_seconds`` (rounded to the nearest second). For a (near-)zero calendar
        that never accrues enough, the remainder is added as wall clock after the cap.
    """
    if work_seconds <= 0:
        return start_s
    if not prob_by_weekday:
        return start_s + int(round(work_seconds))

    remaining = float(work_seconds)
    cur = start_s
    for _ in range(_MAX_ACCRUAL_HOURS):
        hour_end = (cur // 3600) * 3600 + 3600
        p = availability_probability(prob_by_weekday, cur)
        avail = p * (hour_end - cur)
        if avail >= remaining:
            # Finishes inside this hour
            return int(round(cur + remaining / p))
        remaining -= avail
        cur = hour_end
    return int(round(cur + remaining))


class ResourceCalendar:
    """
    A probabilistic resource calendar containing the resource availability information.

    Can represent either a resource type (e.g., "Forklift") or an individual resource
    (e.g., "Forklift_42"), depending on how it was constructed.

    Attributes:
        identifier: String to identify the connected resource/resource type
        type: Denotes whether this calendar is for a resource type or an individual resource
        probability: dict[weekday][hour] -> float in [0, 1]
    """

    def __init__(self, identifier: str, type: str):
        self.identifier = identifier
        self.type = type
        self.probability: dict[str, list[float]] = {
            day: [1.0] * HOURS_PER_DAY for day in WEEKDAYS
        }

    def get_probability(self, weekday: str, hour: int) -> float:
        """Returns the availability probability for the given weekday and hour."""
        return self.probability[weekday][hour]

    def is_available(self, timestamp: dt.datetime) -> bool:
        """Bernoulli trial whether the resource is available at this datetime."""
        weekday = WEEKDAYS[timestamp.weekday()]
        prob = self.get_probability(weekday, timestamp.hour)
        return random.random() < prob

    def to_dict(self) -> dict:
        return {
            "identifier": self.identifier,
            "type": self.type,
            "probability": self.probability,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ResourceCalendar":
        cal = cls(data["identifier"], data["type"])
        cal.probability = data["probability"]
        cal.type = data["type"]
        return cal


def discover_resource_calendars(
    ocel,
    resource_types: list[str],
    obj_type_map: dict[str, str] | None = None,
) -> dict[str, ResourceCalendar]:
    """
    Discovers a probabilistic availability calendar per resource type from an OCEL.

    Availability is a property of the resource itself, not of any single process
    area, so it is measured across **all activities** in which the resource takes
    part

    For each (weekday, hour) slot the type calendar is the **average** availability
    across the type's resources:
        P_type(slot) = (sum_r  weeks r was active at slot) / (num_resources * total_weeks)

    A type whose resources are each present half the weeks reads ~0.5.

    Args:
        ocel: Unfiltered ObjectCentricEventLog. Resources are identified from each
            event's ``_objects`` by type, across every activity.
        resource_types: Object types to treat as resources.
        obj_type_map: Optional object-ID -> object-type map. Defaults to
            ``ocel.obj_type_map``.

    Returns:
        dict mapping resource_type -> ResourceCalendar (the type average).
    """
    resource_types_set = set(resource_types)

    if ocel.events.is_empty():
        return {}

    sorted_events = ocel.events.sort("_timestampUnix")
    if obj_type_map is None:
        obj_type_map = ocel.obj_type_map

    # Per type & slot, collect the distinct (resource_id, iso_week) pairs active
    # there;
    # active_pairs[rtype][weekday][hour] = set of (rid, (year, week))
    active_pairs: dict[str, dict[str, list[set]]] = {
        rt: {day: [set() for _ in range(HOURS_PER_DAY)] for day in WEEKDAYS}
        for rt in resource_types
    }
    resource_ids_by_type: dict[str, set[str]] = {rt: set() for rt in resource_types}

    all_weeks: set[tuple[int, int]] = set()

    for row in sorted_events.iter_rows(named=True):
        resources = [
            rid
            for rid in (row["_objects"] or [])
            if obj_type_map.get(rid) in resource_types_set
        ]
        if not resources:
            continue

        timestamp = row["_timestampUnix"]
        t = dt.datetime.fromtimestamp(timestamp, tz=dt.timezone.utc)
        weekday = WEEKDAYS[t.weekday()]
        hour = t.hour
        year_week = t.isocalendar()[:2]

        all_weeks.add(year_week)

        for rid in resources:
            rtype = obj_type_map.get(rid)
            if not rtype or rtype not in resource_types_set:
                continue

            resource_ids_by_type[rtype].add(rid)
            active_pairs[rtype][weekday][hour].add((rid, year_week))

    total_weeks = len(all_weeks)
    if total_weeks == 0:
        return {rt: ResourceCalendar(rt, "type") for rt in resource_types}

    # Build per-type calendars as the average availability across the type's
    # resources: mean_r P_resource(available).
    type_calendars = {}
    for rtype in resource_types:
        cal = ResourceCalendar(rtype, "type")
        rids = resource_ids_by_type.get(rtype, set())
        if rids:
            denom = len(rids) * total_weeks
            slots = active_pairs[rtype]
            for day in WEEKDAYS:
                for h in range(HOURS_PER_DAY):
                    cal.probability[day][h] = len(slots[day][h]) / denom
        type_calendars[rtype] = cal

    return type_calendars
