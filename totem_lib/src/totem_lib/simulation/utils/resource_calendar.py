import datetime as dt
import json
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
            day: [0.0] * HOURS_PER_DAY for day in WEEKDAYS
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
    activities: list[str],
) -> tuple[dict[str, ResourceCalendar], dict[str, ResourceCalendar]]:
    """
    Discovers probabilistic resource calendars from an Object-Centric Event Log.

    For each (weekday, hour) slot, computes:

        P(available) = number of weeks with at least one event / total observed weeks

    Returns two sets of calendars:
    - Per resource type: aggregated across all instances of that type.
      Used during simulation to decide whether a resource type is available at a tick.
    - Per individual resource ID: based on that specific resource's events.
      Used for computing accurate cooldowns (filtering out off-hours).

    Args:
        ocel: ObjectCentricEventLog (filtered, with process_area_resources in _attributes)
        resource_types: Object types to treat as resources
        activities: Activity names to consider

    Returns:
        (type_calendars, resource_calendars) where:
        - type_calendars: dict mapping resource_type -> ProbabilisticResourceCalendar
        - resource_calendars: dict mapping resource_id -> ProbabilisticResourceCalendar
    """
    activities_set = set(activities)
    resource_types_set = set(resource_types)

    if ocel.events.is_empty():
        return {}, {}

    sorted_events = ocel.events.sort("_timestampUnix")
    obj_type_map = ocel.obj_type_map

    # Collect active weeks per resource type AND per individual resource ID
    # active_weeks_by_type[resource_type][weekday][hour] = set of (year, iso_week)
    # active_weeks_by_rid[resource_id][weekday][hour] = set of (year, iso_week)
    active_weeks_by_type: dict[str, dict[str, list[set]]] = {
        rtype: {day: [set() for _ in range(HOURS_PER_DAY)] for day in WEEKDAYS}
        for rtype in resource_types
    }
    active_weeks_by_rid: dict[str, dict[str, list[set]]] = {}

    all_weeks: set[tuple[int, int]] = set()

    for row in sorted_events.iter_rows(named=True):
        activity = row["_activity"]
        if activity not in activities_set:
            continue

        resources = _extract_resources(row, obj_type_map, resource_types_set)
        if not resources:
            continue

        timestamp = row["_timestampUnix"]
        t = dt.datetime.fromtimestamp(timestamp, tz=dt.timezone.utc)
        weekday = WEEKDAYS[t.weekday()]
        hour = t.hour
        year_week = t.isocalendar()[:2]

        all_weeks.add(year_week)

        seen_types = set()
        for rid in resources:
            rtype = obj_type_map.get(rid)
            if not rtype or rtype not in resource_types_set:
                continue

            # Per type (deduplicate: one event counts once per type)
            if rtype not in seen_types:
                active_weeks_by_type[rtype][weekday][hour].add(year_week)
                seen_types.add(rtype)

            # Per individual resource
            if rid not in active_weeks_by_rid:
                active_weeks_by_rid[rid] = {
                    day: [set() for _ in range(HOURS_PER_DAY)] for day in WEEKDAYS
                }
            active_weeks_by_rid[rid][weekday][hour].add(year_week)

    total_weeks = len(all_weeks)
    if total_weeks == 0:
        return (
            {rt: ResourceCalendar(rt) for rt in resource_types},
            {},
        )

    # Build per-type calendars
    type_calendars = {}
    for rtype in resource_types:
        cal = ResourceCalendar(rtype)
        for day in WEEKDAYS:
            for h in range(HOURS_PER_DAY):
                n_active = len(active_weeks_by_type[rtype][day][h])
                cal.probability[day][h] = n_active / total_weeks
        type_calendars[rtype] = cal

    # Build per-resource calendars
    resource_calendars = {}
    for rid, weeks_data in active_weeks_by_rid.items():
        cal = ResourceCalendar(rid)
        for day in WEEKDAYS:
            for h in range(HOURS_PER_DAY):
                n_active = len(weeks_data[day][h])
                cal.probability[day][h] = n_active / total_weeks
        resource_calendars[rid] = cal

    return type_calendars, resource_calendars


def _extract_resources(
    row: dict, obj_type_map: dict, resource_types_set: set
) -> list[str]:
    """Extracts resource IDs from process_area_resources in the event's _attributes."""
    if not row["_attributes"]:
        return []
    try:
        attrs = json.loads(row["_attributes"])
        resources = attrs.get("process_area_resources", [])
    except (json.JSONDecodeError, TypeError):
        return []

    return [rid for rid in resources if obj_type_map.get(rid) in resource_types_set]
