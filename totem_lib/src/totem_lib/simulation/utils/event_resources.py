import json


def event_resource_ids(ocel) -> dict[str, list[str]]:
    """Map every event to the ids of the resources it used.

    Resources are read from the ``process_area_resources`` key of the event
    attributes, which ``filter_by_process_area`` populates. Events without that
    key or with malformed attributes, and all events of a log without an
    ``_attributes`` column, map to an empty list.

    Args:
        ocel: The Object-Centric Event Log.

    Returns:
        dict: event_id -> list of resource ids, in attribute order.
    """
    if "_attributes" not in ocel.events.columns:
        return {event_id: [] for event_id in ocel.events["_eventId"].to_list()}

    lookup = {}
    for row in ocel.events.select(["_eventId", "_attributes"]).iter_rows(named=True):
        resources = []
        if row["_attributes"]:
            try:
                attributes = json.loads(row["_attributes"])
            except json.JSONDecodeError:
                attributes = {}
            resources = attributes.get("process_area_resources") or []
        lookup[row["_eventId"]] = resources
    return lookup
