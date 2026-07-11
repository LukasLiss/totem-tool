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
