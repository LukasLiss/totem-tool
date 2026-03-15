from totem_lib import OCPetriNet

# object type for binding places used to redstric the OCPN to firing one input and output marker group per firing of the activity
BINDING_OBJECT_TYPE = "_binding"

# prefix for silent transitions in the OCPN
SILENT_TRANSITION_PREFIX = "_silent"


def occn_to_ocpn(occn):
    """
    Converts an Object-centric Causal Net (OCCN) to an Object-centric Petri Net (OCPN) with empty markings.
    All cardinalities c!=(1,1) are treated as c=(0, *). Keys for input marker groups are ignored.

    Reference:
    Kuhlmann et al. (2025). A Transformation between Object-Centric Causal Nets and Object-Centric Petri Nets.
    RWTH Aachen University. https://doi.org/10.18154/RWTH-2026-00605

    Parameters
    ----------
    occn: OCCausalNet
        The Object-centric Causal Net to convert.

    Returns
    -------
    OCPetriNet
        The converted Object-centric Petri Net with empty markings.
    """
    activities = occn.activities
    object_types = occn.object_types
    img = occn.input_marker_groups
    omg = occn.output_marker_groups

    assert (
        BINDING_OBJECT_TYPE not in object_types
    ), f"The binding object type {BINDING_OBJECT_TYPE} must not be present in the OCCN."

    assert not (
        any(activity.startswith(SILENT_TRANSITION_PREFIX) for activity in activities)
    ), f"The OCCN must not contain any activities with prefix {SILENT_TRANSITION_PREFIX}."
    
    assert (
        all(f"START_{object_type}" in activities for object_type in object_types)
    ), "All object types must have a corresponding start activity labeled 'START_{object_type}'."
    
    assert (
        all(f"END_{object_type}" in activities for object_type in object_types)
    ), "All object types must have a corresponding end activity labeled 'END_{object_type}'."

    ordered_key_groups_input = build_ordered_key_groups(activities, img)
    ordered_key_groups_output = build_ordered_key_groups(activities, omg)

    places = set()
    place_names = set()
    transitions = set()
    arcs = set()
    
    # create global input binding place
    p_input_binding = OCPetriNet.Place(
        name=f"p{BINDING_OBJECT_TYPE}_global_input",
        object_type=BINDING_OBJECT_TYPE,
    )
    
    places.add(p_input_binding)

    # recursively create OCPN for every activity
    for activity in activities:
        transform_activity(
            activity=activity,
            places=places,
            places_names=place_names,
            transitions=transitions,
            arcs=arcs,
            input_marker_groups=ordered_key_groups_input.get(activity, []),
            output_marker_groups=ordered_key_groups_output.get(activity, []),
            object_types=object_types,
            p_input_binding=p_input_binding,
        )
        
    # create OCPN
    ocpn = OCPetriNet(
        places=places,
        transitions=transitions,
        arcs=arcs,
    )
    
    return ocpn
        


def build_ordered_key_groups(activities, marker_groups):
    """
    Builds a hierarchy of object type groups, key groups and markers for each activity in the given list of activities.
    Object type groups are ordered by object type name.
    Key groups are ordered by the number of markers and by the number of markers with min_count=1 and max_count=1.
    Markers in key groups are ordered by min_count and max_count, effectively putting markers with (1,1) first.

    Parameters
    ----------
    activities: list
        List of activities for which to build the key groups.
    marker_groups: dict
        Dictionary mapping activities to their corresponding marker groups.
        The keys are activity names and the values are lists of marker groups.

    Returns
    -------
    dict
        A dictionary where keys are activities and values are lists of lists of tuples (object_type, object_type_group),
        where each object_type_group is a sorted list of tuples (marker_key, marker_key_group),
        where each marker_key_group is a sorted list of markers.
    """
    # build the hiearchy of key groups, object type groups and ks for each marker group
    key_groups = {}
    for a in activities:
        key_groups[a] = []
        # key_groups[a] is a list of marker groups (dicts)
        # key: values of a marker group is object type: object type group
        # key: values of object type groups are marker_key: key group
        for marker_group in marker_groups.get(a, []):
            marker_group_dict = {}
            for marker in marker_group.markers:
                # add the marker to the key group
                marker_key = marker.marker_key
                object_type = marker.object_type
                if object_type not in marker_group_dict:
                    marker_group_dict[object_type] = {}
                if marker_key not in marker_group_dict[object_type]:
                    marker_group_dict[object_type][marker_key] = []
                marker_group_dict[object_type][marker_key].append(marker)
            if marker_group_dict:
                key_groups[a].append(marker_group_dict)
            

    # sort the key groups
    for a in activities:
        for i, marker_group in enumerate(key_groups[a]):
            for object_type in marker_group:
                for marker_key in marker_group[object_type]:
                    # sort markers by c=(1,1) and then by min_count and max_count
                    marker_group[object_type][marker_key].sort(
                        key=lambda m: (m.min_count != 1, m.max_count != 1, m.min_count, m.max_count)
                    )
                # sort key groups where key groups are ordered by the number of markers.
                # Of the same number, key groups with more markers with c=(1,1) come first,
                # effectively putting key groups with size 1 with 1 marker with c=(1,1) first
                marker_group[object_type] = sorted(
                    marker_group[object_type].items(),
                    key=lambda x: (
                        len(x[1]),  # fewer markers first
                        -sum(
                            1 for m in x[1] if m.min_count == 1 and m.max_count == 1
                        ),  # more (1,1) markers first
                    ),
                )
            # sort the object type groups by alphabetical order of object types
            marker_group = sorted(
                marker_group.items(), key=lambda x: x[0]  # sort by object type name
            )
            key_groups[a][i] = marker_group
        # marker groups for an activity do not need to be sorted
    return key_groups


def transform_activity(
    places,
    places_names,
    transitions,
    arcs,
    activity,
    input_marker_groups,
    output_marker_groups,
    object_types,
    p_input_binding
):
    """
    Creates the necessary places, transitions, and arcs for an activity in the OCPN.

    Parameters
    ----------
    places: set
        Set of places in the OCPN.
    places_names: set
        Set of place names in the OCPN to avoid duplications.
    transitions: set
        Set of transitions in the OCPN.
    arcs: set
        Set of arcs in the OCPN.
    activity: str
        The name of the activity to transform.
    input_marker_groups: list
        List of input marker groups for the activity, where each marker group is a list of object type groups.
    output_marker_groups: list
        List of output marker groups for the activity, where each marker group is a list of object type groups.
    object_types: set
        Set of all object types in the OCPN.
    p_input_binding: OCPetriNet.Place
        The input binding place for the activity construct.
    """
    is_start = activity.startswith("START_")
    if is_start:
        assert not input_marker_groups, f"Start activity {activity} is a START activity and must not have input marker groups."
    is_end = activity.startswith("END_")
    if is_end:
        assert not output_marker_groups, f"End activity {activity} is an END activity and must not have output marker groups."

    # transition
    t = OCPetriNet.Transition(name=activity, label=activity)
    transitions.add(t)

    
    # input and output places
    non_variable_object_types, variable_object_types = get_activity_object_types(
        object_types, input_marker_groups, output_marker_groups
    )
    
        
    for object_type in non_variable_object_types | variable_object_types:
        is_variable = object_type in variable_object_types
        
        p_i = add_place(
            OCPetriNet.Place(
                name=label_activity_place(activity, True, object_type),
                object_type=object_type,
                ),
            places, 
            places_names
        )
        p_o = add_place(
            OCPetriNet.Place(
                name=label_activity_place(activity, False, object_type),
                object_type=object_type,
                ),
            places, 
            places_names
        )
        
        # arcs for input and output places
        add_arc(
            OCPetriNet.Arc(
                source=p_i,
                target=t,
                object_type=object_type,
                is_variable=is_variable,
                ),
            arcs
        )
        add_arc(
            OCPetriNet.Arc(
                source=t,
                target=p_o,
                object_type=object_type,
                is_variable=is_variable,
                ),
            arcs
        )
        
    # binding places
    if not is_start:
        p_i_t = add_place(
            OCPetriNet.Place(
                name=f"p{BINDING_OBJECT_TYPE}#{activity}_input",
                object_type=BINDING_OBJECT_TYPE
                ),
            places,
            places_names,
        )
    if not is_end:
        p_o_t = add_place(
            OCPetriNet.Place(
                name=f"p{BINDING_OBJECT_TYPE}#{activity}_output",
                object_type=BINDING_OBJECT_TYPE
                ),
            places,
            places_names,
        )
    
    # arcs for binding places
    if is_start:
        add_arc(
            OCPetriNet.Arc(
                source=p_input_binding,
                target=t,
                object_type=BINDING_OBJECT_TYPE,    
            ),
            arcs
        )
    else:
        add_arc(
            OCPetriNet.Arc(
                source=p_i_t,
                target=t,
                object_type=BINDING_OBJECT_TYPE,    
            ),
            arcs
        )
    if is_end:
        add_arc(
            OCPetriNet.Arc(
                source=t,
                target=p_input_binding,
                object_type=BINDING_OBJECT_TYPE,    
            ),
            arcs
        )
    else:
        add_arc(
            OCPetriNet.Arc(
                source=t,
                target=p_o_t,
                object_type=BINDING_OBJECT_TYPE,    
            ),
            arcs
        )
    
    # add marker groups
    for marker_group in input_marker_groups:
        transform_marker_group(
            activity=activity,
            places=places,
            places_names=places_names,
            transitions=transitions,
            arcs=arcs,
            marker_group=marker_group,
            p_input_binding=p_input_binding,
            p_output_binding=p_i_t,
            is_output_marker_group=False,  
        )
    for marker_group in output_marker_groups:
        transform_marker_group(
            activity=activity,
            places=places,
            places_names=places_names,
            transitions=transitions,
            arcs=arcs,
            marker_group=marker_group,
            p_input_binding=p_o_t,
            p_output_binding=p_input_binding,
            is_output_marker_group=True,  
        )
    
    


def get_activity_object_types(object_types, input_marker_groups, output_marker_groups):
    """
    Returns a set of non-variable object types and a set of variable object types for the given marker groups.
    Non-variable object types are those where exactly one object of that type is involved in every firing of the activity.

    Parameters
    ----------
    object_types: set
        Set of all object types in the OCPN.
    input_marker_groups: list
        List of input marker groups for the activity, where each marker group is a list of object type groups.
    output_marker_groups: list
        List of output marker groups for the activity, where each marker group is a list of object type groups.

    Returns
    -------
    tuple
        A tuple containing two sets:
        - The first set contains non-variable object types.
        - The second set contains variable object types.
    """
    found_object_types = set()
    # all object types are non-variable unless found otherwise
    non_variable_object_types = {ot: True for ot in object_types}

    for marker_group in input_marker_groups + output_marker_groups:
        for object_type in object_types:
            # Find object type group in the marker_group 
            # (needs to be done like this to catch object types only present in input or output markers)
            matches = [otg for otg in marker_group if otg[0] == object_type]
            if len(matches) > 1:
                raise ValueError(f"More than one object type group found for object type {object_type} in marker_group.")
            object_type_group = matches[0] if matches else (object_type, [])
            
            object_type = object_type_group[0]
            if matches:
                found_object_types.add(object_type)
            markers = [m for key_group in object_type_group[1] for m in key_group[1]]
            # non-variable object types have exactly one marker in its object type group and its cardinalities are (1,1)
            if not (
                len(markers) == 1
                and markers[0].min_count == 1
                and markers[0].max_count == 1
            ):
                # not a non-variable object type
                non_variable_object_types[object_type] = False

    variable_object_types = set(
        ot for ot in found_object_types if not non_variable_object_types[ot]
    )
    non_variable_object_types = set(
        ot for ot in found_object_types if non_variable_object_types[ot]
    )

    return non_variable_object_types, variable_object_types


def transform_marker_group(
    activity,
    places,
    places_names,
    transitions,
    arcs,
    marker_group,
    p_input_binding,
    p_output_binding,
    is_output_marker_group,
):
    """
    Transforms a marker group into a construct of places, transitions, and arcs in the OCPN.
    Places, transitions, and arcs are updated to include the marker group.

    Parameters
    ----------
    activity: str
        The name of the activity which the marker group belongs to.
    places: set
        Set of places in the OCPN.
    places_names: set
        Set of place names in the OCPN to avoid duplications.
    transitions: set
        Set of transitions in the OCPN.
    arcs: set
        Set of arcs in the OCPN.
    marker_group: list
        The marker group to transform, which is a list of object type groups (tuples of object type and list of key groups).
    p_input_binding: OCPetriNet.Place
        The input binding place for the marker group construct.
    p_output_binding: OCPetriNet.Place
        The output binding place for the marker group construct.
    is_output_marker_group: bool
        Indicates if the marker group is an output marker group (True) or an input marker group (False).
    """
    silent_id = get_next_id()
    p_b_i = p_input_binding
    p_b_o = (
        p_output_binding
        if len(marker_group) == 1
        else add_place(
            OCPetriNet.Place(
                name=f"p{BINDING_OBJECT_TYPE}#{silent_id}_1",
                object_type=BINDING_OBJECT_TYPE,
            ),
            places,
            places_names,
        )
    )
    for i, object_type_group in enumerate(marker_group):
        # create construct

        if is_output_marker_group:
            transform_output_object_type_group(
                activity=activity,
                places=places,
                places_names=places_names,
                transitions=transitions,
                arcs=arcs,
                object_type_group=object_type_group,
                p_input_binding=p_b_i,
                p_output_binding=p_b_o,
            )
        else:
            transform_input_object_type_group(
                activity=activity,
                places=places,
                places_names=places_names,
                transitions=transitions,
                arcs=arcs,
                object_type_group=object_type_group,
                p_input_binding=p_b_i,
                p_output_binding=p_b_o,
            )

        # next input and output binding places
        p_b_i = p_b_o
        # for last object type group, p_output_binding is used. We check for >= in case len is 1.
        p_b_o = (
            p_output_binding
            if (i >= len(marker_group) - 2)
            else add_place(
                OCPetriNet.Place(
                    name=f"p{BINDING_OBJECT_TYPE}#{silent_id}_{i + 2}",
                    object_type=BINDING_OBJECT_TYPE,
                ),
                places,
                places_names,
            )
        )


def transform_input_object_type_group(
    activity,
    places,
    places_names,
    transitions,
    arcs,
    object_type_group,
    p_input_binding,
    p_output_binding,
):
    """
    Transforms an object type group of an input marker group into a construct of places, transitions, and arcs in the OCPN.
    Places, transitions, and arcs are updated to include the object type group.
    For input marker groups, we treat all keys as unique.

    Parameters
    ----------
    activity: str
        The name of the activity which the object type group belongs to.
    places: set
        Set of places in the OCPN.
    places_names: set
        Set of place names in the OCPN to avoid duplications.
    transitions: set
        Set of transitions in the OCPN.
    arcs: set
        Set of arcs in the OCPN.
    object_type_group: (object_type, list)
        The object type group to transform, which is a tuple of the object type and a sorted list of key groups.
    p_input_binding: OCPetriNet.Place
        The input binding place for the object type group construct.
    p_output_binding: OCPetriNet.Place
        The output binding place for the object type group construct.
    """
    silent_id = get_next_id()
    # we skip the key groups for input marker groups, as we ignore input marker keys
    # grab all markers of the object type group
    markers = [marker for key_group in object_type_group[1] for marker in key_group[1]]
    # sort them by by c=(1,1) and then by min_count and max_count
    markers.sort(key=lambda m: (m.min_count != 1, m.max_count != 1, m.min_count, m.max_count))

    # proceed with the construct
    ot = object_type_group[0]
    p_b_i = p_input_binding
    p_b_o = (
        p_output_binding
        if len(markers) == 1
        else add_place(
            OCPetriNet.Place(
                name=f"p{BINDING_OBJECT_TYPE}#{silent_id}_1",
                object_type=BINDING_OBJECT_TYPE,
            ),
            places,
            places_names,
        )
    )
    for i, marker in enumerate(markers):
        # transform the marker
        # input and output place
        pi = add_place(
            OCPetriNet.Place(
                name=label_arc_place(marker.related_activity, activity, ot),
                object_type=ot,
            ),
            places,
            places_names,
        )
        po = add_place(
            OCPetriNet.Place(
                name=label_activity_place(activity, True, ot), object_type=ot
            ),
            places,
            places_names,
        )
        # create construct
        transform_marker(
            places=places,
            places_names=places_names,
            transitions=transitions,
            arcs=arcs,
            marker=marker,
            p_input=pi,
            p_output=po,
            p_input_binding=p_b_i,
            p_output_binding=p_b_o,
            is_output_marker=False,
            key_group_length=1,  # does not matter for input markers
            is_last_key_group=True,  # does not matter for input markers
            is_first_marker=i==0
        )

        # next input and output binding places
        p_b_i = p_b_o
        # for last key group, p_output_binding is used. We check for >= in case len is 1.
        p_b_o = (
            p_output_binding
            if (i >= len(markers) - 2)
            else add_place(
                OCPetriNet.Place(
                    name=f"p{BINDING_OBJECT_TYPE}#{silent_id}_{i + 2}",
                    object_type=BINDING_OBJECT_TYPE,
                ),
                places,
                places_names,
            )
        )


def transform_output_object_type_group(
    activity,
    places,
    places_names,
    transitions,
    arcs,
    object_type_group,
    p_input_binding,
    p_output_binding,
):
    """
    Transforms an object type group of an output marker group into a construct of places, transitions, and arcs in the OCPN.
    Places, transitions, and arcs are updated to include the object type group.

    Parameters
    ----------
    activity: str
        The name of the activity which the object type group belongs to.
    places: set
        Set of places in the OCPN.
    places_names: set
        Set of place names in the OCPN to avoid duplications.
    transitions: set
        Set of transitions in the OCPN.
    arcs: set
        Set of arcs in the OCPN.
    object_type_group: (object_type, list)
        The object type group to transform, which is a tuple of the object type and a sorted list of key groups.
    p_input_binding: OCPetriNet.Place
        The input binding place for the object type group construct.
    p_output_binding: OCPetriNet.Place
        The output binding place for the object type group construct.
    """
    silent_id = get_next_id()
    p_b_i = p_input_binding
    p_b_o = (
        p_output_binding
        if len(object_type_group[1]) == 1
        else add_place(
            OCPetriNet.Place(
                name=f"p{BINDING_OBJECT_TYPE}#{silent_id}_1",
                object_type=BINDING_OBJECT_TYPE,
            ),
            places,
            places_names,
        )
    )
    for i, key_group in enumerate(object_type_group[1]):
        # transform the key group
        is_last_key_group = i == len(object_type_group[1]) - 1
        transform_output_key_group(
            activity=activity,
            places=places,
            places_names=places_names,
            transitions=transitions,
            arcs=arcs,
            key_group=key_group,
            p_input_binding=p_b_i,
            p_output_binding=p_b_o,
            is_last_key_group=is_last_key_group,
        )

        # next input and output binding places
        p_b_i = p_b_o
        # for last key group, p_output_binding is used. We check for >= in case len is 1.
        p_b_o = (
            p_output_binding
            if (i >= len(object_type_group[1]) - 2)
            else add_place(
                OCPetriNet.Place(
                    name=f"p{BINDING_OBJECT_TYPE}#{silent_id}_{i + 2}",
                    object_type=BINDING_OBJECT_TYPE,
                ),
                places,
                places_names,
            )
        )


def transform_output_key_group(
    activity,
    places,
    places_names,
    transitions,
    arcs,
    key_group,
    p_input_binding,
    p_output_binding,
    is_last_key_group,
    p_input=None,
):
    """
    Transforms a key group of an output marker group into a construct of places, transitions, and arcs in the OCPN.
    Places, transitions, and arcs are updated to include the key group.

    Parameters
    ----------
    activity: str
        The name of the activity which the key group belongs to.
    places: set
        Set of places in the OCPN.
    places_names: set
        Set of place names in the OCPN to avoid duplications.
    transitions: set
        Set of transitions in the OCPN.
    arcs: set
        Set of arcs in the OCPN.
    key_group: (marker_key, list)
        The key group to transform, which is a tupel of the marker key and a sorted list of markers.
    p_input_binding: OCPetriNet.Place
        The input binding place for the key group construct.
    p_output_binding: OCPetriNet.Place
        The output binding place for the key group construct.
    is_last_key_group: bool
        Indicates if the key group is the last key group of its object type group.
    p_input: OCPetriNet.Place, optional
        The input place for case 2 of this construct. Only to be set when recursively calling this function from case 3.
    """
    ot = key_group[1][0].object_type
    # 3 cases can occur
    if len(key_group[1]) == 1:
        # case 1: key group with one marker
        marker = key_group[1][0]
        # input and output place
        pi = add_place(
            OCPetriNet.Place(
                name=label_activity_place(activity, False, ot), object_type=ot
            ),
            places,
            places_names,
        )
        po = add_place(
            OCPetriNet.Place(
                name=label_arc_place(activity, marker.related_activity, ot),
                object_type=ot,
            ),
            places,
            places_names,
        )
        # create construct
        transform_marker(
            places=places,
            places_names=places_names,
            transitions=transitions,
            arcs=arcs,
            marker=marker,
            p_input=pi,
            p_output=po,
            p_input_binding=p_input_binding,
            p_output_binding=p_output_binding,
            is_output_marker=True,
            key_group_length=len(key_group[1]),
            is_last_key_group=is_last_key_group,
            is_first_marker=True 
         )
    else:
        silent_id = get_next_id()
        if is_last_key_group:
            # case 2: key group with multiple markers, last key group of its object type group
            p_b_i = p_input_binding
            p_b_o = add_place(
                OCPetriNet.Place(
                    name=f"p{BINDING_OBJECT_TYPE}#{silent_id}_1",
                    object_type=BINDING_OBJECT_TYPE,
                ),
                places,
                places_names,
            )

            for i, marker in enumerate(key_group[1]):
                # input and output place
                pi = (
                    p_input
                    if p_input is not None
                    else add_place(  # p_input is set when recursively calling this function from case 3
                        OCPetriNet.Place(
                            name=label_activity_place(activity, False, ot),
                            object_type=ot,
                        ),
                        places,
                        places_names,
                    )
                )
                po = add_place(
                    OCPetriNet.Place(
                        name=label_arc_place(activity, marker.related_activity, ot),
                        object_type=ot,
                    ),
                    places,
                    places_names,
                )
                # create construct
                transform_marker(
                    places=places,
                    places_names=places_names,
                    transitions=transitions,
                    arcs=arcs,
                    marker=marker,
                    p_input=pi,
                    p_output=po,
                    p_input_binding=p_b_i,
                    p_output_binding=p_b_o,
                    is_output_marker=True,
                    key_group_length=len(key_group[1]),
                    is_last_key_group=is_last_key_group,
                    is_first_marker=i == 0,
                )

                # next input and output binding places
                p_b_i = p_b_o
                # for last marker, p_output_binding is used
                p_b_o = (
                    p_output_binding
                    if i >= (len(key_group[1]) - 2)
                    else add_place(
                        OCPetriNet.Place(
                            name=f"p{BINDING_OBJECT_TYPE}#{silent_id}_{i + 2}",
                            object_type=BINDING_OBJECT_TYPE,
                        ),
                        places,
                        places_names,
                    )
                )
        else:
            # case 3: key group with multiple markers, not the last key group of its object type group
            # this is the same as case 2 with some extra on top, so we create the extra and thenn call case 2

            # places
            px = add_place(
                OCPetriNet.Place(
                    name=f"p#{silent_id}_X",
                    object_type=ot,
                ),
                places,
                places_names,
            )
            p_alpha = add_place(
                OCPetriNet.Place(
                    name=f"p{BINDING_OBJECT_TYPE}#{silent_id}_alpha",
                    object_type=BINDING_OBJECT_TYPE,
                ),
                places,
                places_names,
            )
            p_beta = add_place(
                OCPetriNet.Place(
                    name=f"p{BINDING_OBJECT_TYPE}#{silent_id}_beta",
                    object_type=BINDING_OBJECT_TYPE,
                ),
                places,
                places_names,
            )
            # transitions
            t1 = OCPetriNet.Transition(
                name=f"{SILENT_TRANSITION_PREFIX}#{silent_id}_1",
            )
            t2 = OCPetriNet.Transition(
                name=f"{SILENT_TRANSITION_PREFIX}#{silent_id}_2",
            )
            transitions.update([t1, t2])
            # arcs
            p_a_o_ot = add_place(
                OCPetriNet.Place(
                    name=label_activity_place(activity, False, ot),
                    object_type=ot,
                ),
                places,
                places_names,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=p_a_o_ot,
                    target=t1,
                    object_type=ot,
                    is_variable=True,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t1,
                    target=p_a_o_ot,
                    object_type=ot,
                    is_variable=True,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t1,
                    target=px,
                    object_type=ot,
                    is_variable=True,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=p_a_o_ot,
                    target=t2,
                    object_type=ot,
                    is_variable=True,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t2,
                    target=px,
                    object_type=ot,
                    is_variable=True,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=p_input_binding,
                    target=t2,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t2,
                    target=p_alpha,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=p_alpha,
                    target=t1,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t1,
                    target=p_beta,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )

            # call case 2 by setting is_last_key_group to True, provide px as input place
            transform_output_key_group(
                activity=activity,
                places=places,
                places_names=places_names,
                transitions=transitions,
                arcs=arcs,
                key_group=key_group,
                p_input_binding=p_beta,
                p_output_binding=p_output_binding,
                is_last_key_group=True,
                p_input=px,
            )


def transform_marker(
    places,
    places_names,
    transitions,
    arcs,
    marker,
    p_input,
    p_output,
    p_input_binding,
    p_output_binding,
    is_output_marker,
    key_group_length,
    is_last_key_group,
    is_first_marker
):
    """
    Transforms a marker into a construct of places, transitions, and arcs in the OCPN.
    Places, transitions, and arcs are updated to include the marker.

    Parameters
    ----------
    places: set
        Set of places in the OCPN.
    places_names: set
        Set of place names in the OCPN to which the place name will be added.
    transitions: set
        Set of transitions in the OCPN.
    arcs: set
        Set of arcs in the OCPN.
    marker: Marker
        The marker to transform.
    p_input: OCPetriNet.Place
        The input place for the marker construct.
    p_output: OCPetriNet.Place
        The output place for the marker construct.
    p_input_binding: OCPetriNet.Place
        The input binding place for the marker construct.
    p_output_binding: OCPetriNet.Place
        The output binding place for the marker construct.
    is_output_marker: bool
        True if the marker is part of an output marker group, False if it is part of an input marker group.
    key_group_length: int
        The length of the key group to which the marker belongs. Does not matter for input markers.
    is_last_key_group: bool
        Indicates if the marker is in the last key group of its object type group. Does not matter for input markers.
    is_first_marker: bool
        Indicates if the marker is the first marker in its input object type group. Does not matter for output markers.
    """
    # id to avoid name clashes
    silent_id = get_next_id()

    # 6 cases can occur
    if marker.min_count == 1 and marker.max_count == 1:
        if is_output_marker and not is_last_key_group and key_group_length == 1:
            # case 1: (1,1) marker with duplication
            # places
            for p in [p_input, p_output, p_input_binding, p_output_binding]:
                add_place(p, places, places_names)
            # transitions
            t1 = OCPetriNet.Transition(
                name=f"{SILENT_TRANSITION_PREFIX}#{silent_id}_1",
            )
            t2 = OCPetriNet.Transition(
                name=f"{SILENT_TRANSITION_PREFIX}#{silent_id}_2",
            )
            transitions.update([t1, t2])
            # arcs
            add_arc(
                OCPetriNet.Arc(
                    source=p_input,
                    target=t1,
                    object_type=marker.object_type,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t1,
                    target=p_input,
                    object_type=marker.object_type,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t1,
                    target=p_output,
                    object_type=marker.object_type,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=p_input,
                    target=t2,
                    object_type=marker.object_type,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t2,
                    target=p_output,
                    object_type=marker.object_type,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=p_input_binding,
                    target=t1,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=p_input_binding,
                    target=t2,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t1,
                    target=p_output_binding,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t2,
                    target=p_output_binding,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
        elif (not is_output_marker) and (not is_first_marker):
            # case 2: (1,1) marker with unification
            # places
            for p in [p_input, p_output, p_input_binding, p_output_binding]:
                add_place(p, places, places_names)
            # transitions
            t1 = OCPetriNet.Transition(
                name=f"{SILENT_TRANSITION_PREFIX}#{silent_id}_1",
            )
            t2 = OCPetriNet.Transition(
                name=f"{SILENT_TRANSITION_PREFIX}#{silent_id}_2",
            )
            transitions.update([t1, t2])
            # arcs
            add_arc(
                OCPetriNet.Arc(
                    source=p_input,
                    target=t1,
                    object_type=marker.object_type,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=p_output,
                    target=t1,
                    object_type=marker.object_type,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t1,
                    target=p_output,
                    object_type=marker.object_type,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=p_input,
                    target=t2,
                    object_type=marker.object_type,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t2,
                    target=p_output,
                    object_type=marker.object_type,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=p_input_binding,
                    target=t1,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=p_input_binding,
                    target=t2,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t1,
                    target=p_output_binding,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t2,
                    target=p_output_binding,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
        else:
            # case 2: (1,1) marker without duplication/unification
            # places
            places.update([p_input, p_output, p_input_binding, p_output_binding])
            # transitions
            t = OCPetriNet.Transition(
                name=f"{SILENT_TRANSITION_PREFIX}#{silent_id}",
            )
            transitions.add(t)
            # arcs
            add_arc(
                OCPetriNet.Arc(
                    source=p_input,
                    target=t,
                    object_type=marker.object_type,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t,
                    target=p_output,
                    object_type=marker.object_type,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=p_input_binding,
                    target=t,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t,
                    target=p_output_binding,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
    else:
        # marker with min_count != 1 or max_count != 1
        if is_output_marker and not is_last_key_group and key_group_length == 1:
            # case 4: square marker with duplication
            # places
            px = OCPetriNet.Place(
                name=f"p{BINDING_OBJECT_TYPE}#{silent_id}",
                object_type=BINDING_OBJECT_TYPE,
            )
            places.update([p_input, p_output, p_input_binding, p_output_binding, px])
            # transitions
            t1 = OCPetriNet.Transition(
                name=f"{SILENT_TRANSITION_PREFIX}#{silent_id}_1",
            )
            t2 = OCPetriNet.Transition(
                name=f"{SILENT_TRANSITION_PREFIX}#{silent_id}_2",
            )
            transitions.update([t1, t2])
            # arcs
            add_arc(
                OCPetriNet.Arc(
                    source=p_input,
                    target=t1,
                    object_type=marker.object_type,
                    is_variable=True,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t1,
                    target=p_input,
                    object_type=marker.object_type,
                    is_variable=True,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t1,
                    target=p_output,
                    object_type=marker.object_type,
                    is_variable=True,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=p_input,
                    target=t2,
                    object_type=marker.object_type,
                    is_variable=True,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t2,
                    target=p_output,
                    object_type=marker.object_type,
                    is_variable=True,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=p_input_binding,
                    target=t2,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t2,
                    target=px,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=px,
                    target=t1,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t1,
                    target=p_output_binding,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
        elif (not is_output_marker) and (not is_first_marker):
            # case 5: square marker with unification 
            # places
            px = OCPetriNet.Place(
                name=f"p{BINDING_OBJECT_TYPE}#{silent_id}",
                object_type=BINDING_OBJECT_TYPE,
            )
            places.update([p_input, p_output, p_input_binding, p_output_binding, px])
            # transitions
            t1 = OCPetriNet.Transition(
                name=f"{SILENT_TRANSITION_PREFIX}#{silent_id}_1",
            )
            t2 = OCPetriNet.Transition(
                name=f"{SILENT_TRANSITION_PREFIX}#{silent_id}_2",
            )
            transitions.update([t1, t2])
            # arcs
            add_arc(
                OCPetriNet.Arc(
                    source=p_input,
                    target=t1,
                    object_type=marker.object_type,
                    is_variable=True,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=p_output,
                    target=t1,
                    object_type=marker.object_type,
                    is_variable=True,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t1,
                    target=p_output,
                    object_type=marker.object_type,
                    is_variable=True,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=p_input,
                    target=t2,
                    object_type=marker.object_type,
                    is_variable=True,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t2,
                    target=p_output,
                    object_type=marker.object_type,
                    is_variable=True,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=p_input_binding,
                    target=t1,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t1,
                    target=px,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=px,
                    target=t2,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t2,
                    target=p_output_binding,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
        else:
            # case 6: square marker without duplication/unification
            # places
            places.update([p_input, p_output, p_input_binding, p_output_binding])
            # transitions
            t = OCPetriNet.Transition(
                name=f"{SILENT_TRANSITION_PREFIX}#{silent_id}",
            )
            transitions.add(t)
            # arcs
            add_arc(
                OCPetriNet.Arc(
                    source=p_input,
                    target=t,
                    object_type=marker.object_type,
                    is_variable=True,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t,
                    target=p_output,
                    object_type=marker.object_type,
                    is_variable=True,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=p_input_binding,
                    target=t,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )
            add_arc(
                OCPetriNet.Arc(
                    source=t,
                    target=p_output_binding,
                    object_type=BINDING_OBJECT_TYPE,
                    is_variable=False,
                ),
                arcs,
            )


def add_arc(arc, arcs):
    """
    Adds an arc to the OCPN and its source and target.

    Parameters
    ----------
    arc: OCPetriNet.Arc
        The arc to add to the OCPN.
    arcs: set
        Set of arcs in the OCPN to which the arc will be added.
    """
    arcs.add(arc)
    arc.source.add_out_arc(arc)
    arc.target.add_in_arc(arc)


def add_place(place, places, places_names) -> OCPetriNet.Place:
    """
    Adds a place to the OCPN and its name to the set of place names.
    Does not add the place if a place with the same name already exists in the OCPN.
    Returns the place if it was added, otherwise returns the existing place.

    Parameters
    ----------
    place: OCPetriNet.Place
        The place to add to the OCPN.
    places: set
        Set of places in the OCPN to which the place will be added.
    places_names: set
        Set of place names in the OCPN to which the place name will be added.

    Returns
    -------
    OCPetriNet.Place
        The place that was added or the existing place if it was not added.
    """
    if place.name not in places_names:
        places.add(place)
        places_names.add(place.name)
        return place
    else:
        # if the place already exists, return the existing place
        for p in places:
            if p.name == place.name:
                return p
        raise ValueError(f"Place with name {place.name} not found in places.")


def label_activity_place(activity_name, is_input, object_type):
    """
    Returns the name for an input / output place of an activity.

    Parameters
    ----------
    activity_name: str
        The name of the activity.
    is_input: bool
        Indicates if the place is an input place (True) or an output place (False).
    object_type: str
        The object type of the activity.

    Returns
    -------
    str
        The name of the place.
    """
    prefix = f"p_{activity_name}_i" if is_input else f"p_{activity_name}_o"
    return f"{prefix}_{object_type}"


def label_arc_place(source, target, object_type):
    """
    Returns the name for the place corresponding to an arc between two activities.

    Parameters
    ----------
    source: str
        The name of the source activity.
    target: str
        The name of the target activity.
    object_type: str
        The object type of the arc.
    """
    return f"p_arc({source},{target})_{object_type}"


def get_next_id():
    """
    Returns a unique id for a silent transition, starting from 0.
    """
    # initialize on first call
    if not hasattr(get_next_id, "counter"):
        get_next_id.counter = 0
    current = get_next_id.counter
    get_next_id.counter += 1
    return current