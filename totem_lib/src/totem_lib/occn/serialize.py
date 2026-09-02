from .occn import OCCausalNet


def serialize_occn(occn: OCCausalNet) -> dict:
    """
    Converts an OCCausalNet to a JSON-serializable dict for the frontend.

    max_count of -1 (sentinel for infinity) is serialized as null.

    Returns
    -------
    dict with keys:
        object_types, relative_occurrence_threshold, activities, edges,
        input_marker_groups, output_marker_groups
    """
    activities = [
        {"id": act, "count": occn.activity_count.get(act, 0)}
        for act in occn.activities
    ]

    edges = [
        {
            "source": u,
            "target": v,
            "object_type": data["objectType"],
            "dependence_measure": data.get("dependenceMeasure"),
        }
        for u, v, data in occn.dependency_graph.edges(data=True)
    ]

    def serialize_marker(marker: OCCausalNet.Marker) -> dict:
        max_count = None if marker.max_count == float("inf") else marker.max_count
        return {
            "related_activity": marker.related_activity,
            "object_type": marker.object_type,
            "min_count": marker.min_count,
            "max_count": max_count,
            "marker_key": marker.marker_key,
        }

    def serialize_marker_group(mg: OCCausalNet.MarkerGroup) -> dict:
        support = None if mg.support_count == float("inf") else mg.support_count
        return {
            "support_count": support,
            "markers": [serialize_marker(m) for m in mg.markers],
        }

    def serialize_groups(groups: dict) -> dict:
        return {
            act: [serialize_marker_group(mg) for mg in mgs]
            for act, mgs in groups.items()
        }

    return {
        "object_types": sorted(occn.object_types),
        "relative_occurrence_threshold": occn.relative_occurrence_threshold,
        "activities": activities,
        "edges": edges,
        "input_marker_groups": serialize_groups(occn.input_marker_groups),
        "output_marker_groups": serialize_groups(occn.output_marker_groups),
    }
