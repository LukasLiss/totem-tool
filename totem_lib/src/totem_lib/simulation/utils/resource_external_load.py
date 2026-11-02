import polars as pl


def discover_pa_capacity_shares(
    ocel, resource_types: list[str], activities: list[str]
) -> dict[str, float]:
    """Estimates the share of each resource type's capacity left for a process area.

    Resources are shared: in the full log they also work on activities outside
    the process area, which the playout never simulates. This heuristic
    (event-frequency-based external capacity discounting) takes the share of a
    type's event participations that belong to the process area as the share of
    its capacity available to it:

        s = N_pa / N_all

    Every event counts once per participating resource instance. The event share
    is read as a capacity share although activities occupy a resource for
    different times; it is an assumption, not a measured utilisation.

    Args:
        ocel: Unfiltered ObjectCentricEventLog. Must contain the events outside
            the process area, otherwise every share is 1.
        resource_types: Object types treated as resources.
        activities: Activities of the process area.

    Returns:
        ``{resource_type: share}`` with ``share`` in ``[0, 1]``. A type without
        any observed event is omitted, since the log carries no evidence about
        it; consumers treat a missing type as ``1.0`` (no external load).
    """
    if not resource_types or ocel.events.is_empty():
        return {}

    resource_objects = ocel.objects.filter(
        pl.col("_objType").is_in(resource_types)
    ).select("_objId", "_objType")

    counts = (
        ocel.events.select("_eventId", "_activity", "_objects")
        .explode("_objects", empty_as_null=False)
        .unique(["_eventId", "_objects"])
        .join(resource_objects, left_on="_objects", right_on="_objId")
        .group_by("_objType")
        .agg(
            pl.len().alias("total"),
            pl.col("_activity").is_in(activities).sum().alias("pa"),
        )
    )

    return {
        row["_objType"]: row["pa"] / row["total"]
        for row in counts.iter_rows(named=True)
        if row["total"] > 0
    }
