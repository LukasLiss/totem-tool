import networkx as nx

def create_from_dict(marker_groups):
    """
    Internal implementation for OCCausalNet.from_dict.
    
    See OCCausalNet.from_dict for full documentation and parameter details.
    """
    from .occn import OCCausalNet
    # infer activities
    activities = set(marker_groups.keys())

    # get input and output marker groups
    input_marker_groups = {}
    output_marker_groups = {}

    # make all keys=0 unique
    # find max key
    max_key = max(
        [
            key
            for groups in marker_groups.values()
            for group in groups.get("img", []) + groups.get("omg", [])
            for _, _, _, key in group
        ],
        default=0,
    )
    key_counter = max_key + 1

    # give markers with key=0 a unique key and set inf as max count if max count is -1
    for groups in marker_groups.values():
        for group in groups.get("img", []) + groups.get("omg", []):
            for i, (
                related_activity,
                object_type,
                count_range,
                marker_key,
            ) in enumerate(group):
                if marker_key == 0:
                    group[i] = (
                        related_activity,
                        object_type,
                        (
                            count_range
                            if count_range[1] != -1
                            else (count_range[0], float("inf"))
                        ),
                        key_counter,
                    )
                    key_counter += 1
                elif count_range[1] == -1:
                    group[i] = (
                        related_activity,
                        object_type,
                        (count_range[0], float("inf")),
                        marker_key,
                    )
            key_counter = max_key + 1

    for activity, groups in marker_groups.items():
        img = groups.get("img", [])
        omg = groups.get("omg", [])

        if img:
            input_marker_groups[activity] = [
                OCCausalNet.MarkerGroup(
                    markers=[
                        OCCausalNet.Marker(
                            related_activity, object_type, count_range, marker_key
                        )
                        for related_activity, object_type, count_range, marker_key in group
                    ]
                )
                for group in img
            ]
        if omg:
            output_marker_groups[activity] = [
                OCCausalNet.MarkerGroup(
                    markers=[
                        OCCausalNet.Marker(
                            related_activity, object_type, count_range, marker_key
                        )
                        for related_activity, object_type, count_range, marker_key in group
                    ]
                )
                for group in omg
            ]

    # infer arcs from the marker groups
    arcs = dict()
    for activity in activities:
        for group in output_marker_groups.get(activity, []):
            for marker in group.markers:
                related_activity = marker.related_activity
                object_type = marker.object_type
                if activity not in arcs:
                    arcs[activity] = {}
                if related_activity not in arcs[activity]:
                    arcs[activity][related_activity] = {}
                if object_type not in arcs[activity][related_activity]:
                    arcs[activity][related_activity][object_type] = {}
                arcs[activity][related_activity][object_type] = {
                    "object_type": object_type
                }
    # create the dependency graph
    dependency_graph = nx.MultiDiGraph(arcs)

    # create the object-centric causal net
    occn = OCCausalNet(
        dependency_graph,
        output_marker_groups,
        input_marker_groups,
    )
    return occn