def _canonical_key(marker_group):
    """
    Order-independent sort key for a MarkerGroup, used to break ties between
    equally frequent groups: fewer markers first, then the sorted marker
    content (related activity, object type, cardinalities), then the marker
    keys. Two groups that compare equal under this key are equal groups.
    """
    markers = marker_group.markers
    content = sorted(
        (m.related_activity, m.object_type, m.min_count, m.max_count) for m in markers
    )
    keyed = sorted(
        (m.related_activity, m.object_type, m.min_count, m.max_count, m.marker_key)
        for m in markers
    )
    return (len(markers), content, keyed)


def filter4(input_marker_groups, output_marker_groups, threshold, activity_count):
    """
    Filters input_marker_groups and output_marker_groups by relative support, then
    recursively keeps only those MarkerGroups that remain connected.

    Every marker of a kept group that would otherwise be left without a
    counterpart is repaired by adding the most frequent compatible group of the
    related activity. Equally frequent candidates are resolved by a canonical
    key (see ``_canonical_key``), so the result is independent of the order of
    the input lists (e.g. after a JSON round trip).

    Parameters
    ----------
    input_marker_groups : Dict[str, List[OCCausalNet.MarkerGroup]]
        Input marker groups of the activities
    output_marker_groups : Dict[str, List[OCCausalNet.MarkerGroup]]
        Output marker groups of the activities
    threshold : float
        Minimum relative support = support_count / activity_count[activity]
    activity_count : Dict[str,int]
        Absolute frequency of each activity in the event log.

    Returns
    -------
    Tuple[
        Dict[str, List[OCCausalNet.MarkerGroup]],
        Dict[str, List[OCCausalNet.MarkerGroup]]
    ]
        (filtered_input_marker_groups, filtered_output_marker_groups)
    """

    def filterByTreshold(marker_groups, activity):
        """
        Filters a list of MarkerGroups by relative support.

        Parameters
        ----------
        marker_groups : List[OCCausalNet.MarkerGroup]
            The MarkerGroups to filter.
        activity : str
            Activity name whose frequency is used for relative support.

        Returns
        -------
        List[OCCausalNet.MarkerGroup]
            Those groups whose support_count / activity_count[activity] > threshold.
        """
        filteredMarkerGroups = [
            marker_group
            for marker_group in marker_groups
            if marker_group.support_count / activity_count[activity] > threshold
        ]
        return filteredMarkerGroups

    def getMostFrequent(marker_groups):
        """
        Returns the most frequent MarkerGroup in the list.

        Ties in support_count are broken by ``_canonical_key`` (fewest markers
        first, then marker content), never by list position, so the result
        does not depend on the order in which the marker groups are stored.

        Parameters
        ----------
        marker_groups : List[OCCausalNet.MarkerGroup]
            List of marker groups to examine.

        Returns
        -------
        OCCausalNet.MarkerGroup
            The one with the highest support_count.
        """
        if not marker_groups:
            raise Exception(
                "Invalid marker groups provided for some activity. Error: no candidate marker group"
            )
        return min(
            marker_groups,
            key=lambda marker_group: (-marker_group.support_count, _canonical_key(marker_group)),
        )

    def getSubsequentInputMarkerGroups(most_frequent_marker_group, activity):
        """
        For every marker in *most_frequent_marker_group* (which belongs to an
        **output** marker group of *activity*) look up the corresponding input
        marker groups of the marker's successor activity.
        Keeps only the most frequent ones and adds them to the
        *filtered_input_marker_groups* structure.

        Parameters
        ----------
        most_frequent_marker_group : OCCausalNet.MarkerGroup
        activity : str
        """
        for marker in most_frequent_marker_group.markers:
            succ_activity = marker.related_activity
            if succ_activity in input_marker_groups.keys():
                possible_input_marker_groups = [
                    x
                    for x in input_marker_groups[succ_activity]
                    if (activity, marker.object_type)
                    in [(y.related_activity, y.object_type) for y in x.markers]
                ]
                most_frequent_marker_group = getMostFrequent(possible_input_marker_groups)
                addToFilteredInputMarkerGroups(most_frequent_marker_group, succ_activity)

    def addToFilteredOutputMarkerGroups(most_frequent_marker_group, activity):
        """
        Inserts *most_frequent_marker_group* into *filtered_output_marker_groups* and
        triggers the recursive traversal to the input side.

        Parameters
        ----------
        most_frequent_marker_group : OCCausalNet.MarkerGroup
        activity : str
        """
        if most_frequent_marker_group not in filtered_output_marker_groups[activity]:
            filtered_output_marker_groups[activity].append(most_frequent_marker_group)
            getSubsequentInputMarkerGroups(most_frequent_marker_group, activity)

    def getSubsequentOutputMarkerGroups(most_frequent_marker_group, activity):
        """
        For every marker in *most_frequent_marker_group* (which belongs to an
        **input** marker_group of *activity*) look up the corresponding output
        marker groups of the marker's predecessor activity.
        Keeps only the most frequent ones and adds them to the
        *filtered_output_marker_groups* structure.

        Parameters
        ----------
        most_frequent_marker_group : OCCausalNet.MarkerGroup
        activity : str
        """
        for marker in most_frequent_marker_group.markers:
            pred_activity = marker.related_activity
            if pred_activity in output_marker_groups.keys():
                possible_output_marker_groups = [
                    x
                    for x in output_marker_groups[pred_activity]
                    if (activity, marker.object_type)
                    in [(y.related_activity, y.object_type) for y in x.markers]
                ]
                most_frequent_marker_group = getMostFrequent(possible_output_marker_groups)
                addToFilteredOutputMarkerGroups(most_frequent_marker_group, pred_activity)

    def addToFilteredInputMarkerGroups(most_frequent_marker_group, activity):
        """
        Inserts *most_frequent_marker_group* into *filtered_input_marker_groups* and
        triggers the recursive traversal to the output side.

        Parameters
        ----------
        most_frequent_marker_group : OCCausalNet.MarkerGroup
        activity : str
        """
        if most_frequent_marker_group not in filtered_input_marker_groups[activity]:
            filtered_input_marker_groups[activity].append(most_frequent_marker_group)
            getSubsequentOutputMarkerGroups(most_frequent_marker_group, activity)

    filtered_output_marker_groups = {act: [] for act in output_marker_groups.keys()}
    filtered_input_marker_groups = {act: [] for act in input_marker_groups.keys()}

    for act in filtered_output_marker_groups.keys():
        filteredMarkerGroups = filterByTreshold(output_marker_groups[act], act)
        for marker_group in filteredMarkerGroups:
            addToFilteredOutputMarkerGroups(marker_group, act)

    for act in filtered_input_marker_groups.keys():
        filteredMarkerGroups = filterByTreshold(input_marker_groups[act], act)
        for marker_group in filteredMarkerGroups:
            addToFilteredInputMarkerGroups(marker_group, act)

    return filtered_input_marker_groups, filtered_output_marker_groups
