from totem_lib import OCCausalNet, OCPetriNet
import networkx as nx

AUX_ACTIVITY_PREFIX = "_silent_aux_"
POST_AUX_ACTIVITY_PREFIX = AUX_ACTIVITY_PREFIX + "out_"
PRE_AUX_ACTIVITY_PREFIX = AUX_ACTIVITY_PREFIX + "in_"


def ocpn_to_occn(ocpn: OCPetriNet) -> OCCausalNet:
    """
    Convets an object-centric Petri net to an object-centric causal net.
    
    Reference:
    Kuhlmann et al. (2025). A Transformation between Object-Centric Causal Nets and Object-Centric Petri Nets.
    RWTH Aachen University. https://doi.org/10.18154/RWTH-2026-00605

    Parameters
    ----------
    ocpn: OCPetriNet
        The object-centric Petri net to be converted.

    Returns
    ----------
    OCCausalNet
        The resulting object-centric causal net.
    """
    # assert no place start with AUX_ACTIVITY_PREFIX to be able to identify auxiliary places
    for p in ocpn.places:
        if p.name.startswith(AUX_ACTIVITY_PREFIX):
            raise ValueError(
                f"Place {p.name} starts with the reserved prefix '{AUX_ACTIVITY_PREFIX}'."
            )

    places = ocpn.places
    transitions = ocpn.transitions
    object_types = ocpn.object_types

    dependencies = dict()
    input_marker_groups = dict()
    output_marker_groups = dict()

    # get multi-object types per transition
    multi_ots = get_multi_object_types(ocpn)

    # create dependencies and marker groups for transitions
    transition_dependencies_marker_groups(
        transitions,
        multi_ots,
        dependencies,
        input_marker_groups,
        output_marker_groups,
    )

    # create dependencies and marker groups for places
    place_dependencies_marker_groups(
        places,
        multi_ots,
        dependencies,
        input_marker_groups,
        output_marker_groups,
    )

    # handle start and end places
    start_places = {
        ot: [p for p in ocpn.initial_marking.places if p.object_type == ot]
        for ot in ocpn.object_types
    }
    end_places = {
        ot: [p for p in ocpn.final_marking.places if p.object_type == ot]
        for ot in ocpn.object_types
    }

    # add START and END activities and their dependencies and marker groups
    start_end_act_dependencies_marker_groups(
        object_types,
        dependencies,
        input_marker_groups,
        output_marker_groups,
        start_places,
        end_places,
    )

    # add START and END activities to marker groups of start and end places
    add_start_end_act_markers(
        object_types,
        input_marker_groups,
        output_marker_groups,
        start_places,
        end_places,
    )

    # create the occn
    occn = OCCausalNet(
        dependency_graph=nx.MultiDiGraph(dependencies),
        output_marker_groups=output_marker_groups,
        input_marker_groups=input_marker_groups,
    )

    return occn


def get_multi_object_types(ocpn: OCPetriNet) -> dict:
    """
    Returns a dictionary mapping transition names to two dictionaries of multi-input/multi-output
    object types
    mapping object types to True if they are variable and False otherwise.
    A multi-input/output object type is one that has at least two incoming/outgoing arcs
    to/from the transition.

    Parameters
    ----------
    ocpn: OCPetriNet
        The Object-centric Petri Net to analyze.

    Returns
    -------
    dict: Dictionary with transition names as keys a dictionary mapping "input" and "output"
          to dictionaries of multi-input/multi-output object types to True/False.
    """
    multi_ots = {}
    for t in ocpn.transitions:
        multi_ots[t.name] = {"input": dict(), "output": dict()}
        in_ots = [arc.object_type for arc in t.in_arcs]
        multi_ots[t.name]["output"] = dict()
        out_ots = [arc.object_type for arc in t.out_arcs]

        for ot in set(in_ots):
            if in_ots.count(ot) > 1:
                multi_ots[t.name]["input"][ot] = any(
                    arc.is_variable for arc in t.in_arcs if arc.object_type == ot
                )

        for ot in set(out_ots):
            if out_ots.count(ot) > 1:
                multi_ots[t.name]["output"][ot] = any(
                    arc.is_variable for arc in t.out_arcs if arc.object_type == ot
                )

    return multi_ots


def get_aux_place_name(transition_name, object_type, is_input_aux):
    """
    Returns the name of the auxiliary place for a given transition and object type.

    Parameters
    ----------
    transition_name: str
        The name of the transition.
    object_type: str
        The object type associated with the auxiliary place.
    is_input_aux: bool
        Whether the auxiliary place is an input auxiliary place (True) or output auxiliary place (False).

    Returns
    -------
    str: The name of the auxiliary place.
    """
    prefix = PRE_AUX_ACTIVITY_PREFIX if is_input_aux else POST_AUX_ACTIVITY_PREFIX
    return f"{prefix}{transition_name}_{object_type}"


def transition_dependencies_marker_groups(
    transitions,
    multi_ots,
    dependencies,
    input_marker_groups,
    output_marker_groups,
):
    """
    Creates dependencies and marker groups for transitions in the Object-centric Petri Net.
    Each transition has one input marker group featuring a marker for each input arc,
    and one output marker group featuring a marker for each output arc.

    Parameters
    ----------
    transitions: list
        List of transitions in the Object-centric Petri Net.
    multi_ots: dict
        Dictionary mapping transition names to multi-object types.
    dependencies: dict
        Dictionary to store dependencies between activities.
    input_marker_groups: dict
        Dictionary to store input marker groups.
    output_marker_groups: dict
        Dictionary to store output marker groups.
    """
    for t in transitions:
        # dependencies
        dependencies[t.name] = dict()  # add as activity

        # get multi object types for this transition
        multi_input = multi_ots.get(t.name, dict()).get("input", dict())
        multi_output = multi_ots.get(t.name, dict()).get("output", dict())

        for arc in t.in_arcs:
            if arc.object_type in multi_input:
                # aux. place goes in between source place and transition
                aux_place_name = get_aux_place_name(
                    t.name, arc.object_type, is_input_aux=True
                )
                add_dependency(
                    dependencies, arc.source, aux_place_name, arc.object_type
                )
                add_dependency(dependencies, aux_place_name, t, arc.object_type)
            else:
                add_dependency(dependencies, arc.source, t, arc.object_type)
        for arc in t.out_arcs:
            if arc.object_type in multi_output:
                # aux. place goes in between transition and target place
                aux_place_name = get_aux_place_name(
                    t.name, arc.object_type, is_input_aux=False
                )
                add_dependency(dependencies, t, aux_place_name, arc.object_type)
                add_dependency(
                    dependencies, aux_place_name, arc.target, arc.object_type
                )
            else:
                add_dependency(dependencies, t, arc.target, arc.object_type)

        # markers from input aux activities
        input_aux_markers = [
            OCCausalNet.Marker(
                related_activity=(
                    get_aux_place_name(t.name, object_type, is_input_aux=True)
                ),
                object_type=object_type,
                count_range=(0, float("inf")) if multi_input[object_type] else (1, 1),
                marker_key=get_next_key(),
            )
            for object_type in multi_input
        ]

        # single input marker group
        input_marker_groups[t.name] = [
            OCCausalNet.MarkerGroup(
                [
                    OCCausalNet.Marker(
                        related_activity=arc.source.name,
                        object_type=arc.object_type,
                        count_range=(0, float("inf")) if arc.is_variable else (1, 1),
                        marker_key=get_next_key(),
                    )
                    for arc in t.in_arcs
                    if arc.object_type not in multi_input
                ]
                + input_aux_markers
            )
        ]

        # markers to output aux activities
        output_aux_markers = [
            OCCausalNet.Marker(
                related_activity=(
                    get_aux_place_name(t.name, object_type, is_input_aux=False)
                ),
                object_type=object_type,
                count_range=(0, float("inf")) if multi_output[object_type] else (1, 1),
                marker_key=get_next_key(),
            )
            for object_type in multi_output
        ]

        # single output marker group
        output_marker_groups[t.name] = [
            OCCausalNet.MarkerGroup(
                [
                    OCCausalNet.Marker(
                        related_activity=(arc.target.name),
                        object_type=arc.object_type,
                        count_range=(0, float("inf")) if arc.is_variable else (1, 1),
                        marker_key=get_next_key(),
                    )
                    for arc in t.out_arcs
                    if arc.object_type not in multi_output
                ]
                + output_aux_markers
            )
        ]

        # add marker groups for input auxiliary places
        for ot in multi_input:
            aux_place_name = get_aux_place_name(t.name, ot, is_input_aux=True)
            output_marker_groups[aux_place_name] = [
                # single marker group with one marker for the transition
                OCCausalNet.MarkerGroup(
                    [
                        OCCausalNet.Marker(
                            related_activity=t.name,
                            object_type=ot,
                            count_range=(1, 1),
                            marker_key=get_next_key(),
                        )
                    ]
                )
            ]
            input_marker_groups[aux_place_name] = [
                # marker for every predecessor of t with this object type
                OCCausalNet.MarkerGroup(
                    [
                        OCCausalNet.Marker(
                            related_activity=arc.source.name,
                            object_type=ot,
                            count_range=(1, 1),
                            marker_key=get_next_key(),
                        )
                        for arc in t.in_arcs
                        if arc.object_type == ot
                    ]
                )
            ]

        # add marker groups for output auxiliary places
        for ot in multi_output:
            aux_place_name = get_aux_place_name(t.name, ot, is_input_aux=False)
            input_marker_groups[aux_place_name] = [
                # single marker group with one marker for the transition
                OCCausalNet.MarkerGroup(
                    [
                        OCCausalNet.Marker(
                            related_activity=t.name,
                            object_type=ot,
                            count_range=(1, 1),
                            marker_key=get_next_key(),
                        )
                    ]
                )
            ]
            output_marker_groups[aux_place_name] = [
                # marker for every successor of t with this object type
                OCCausalNet.MarkerGroup(
                    [
                        OCCausalNet.Marker(
                            related_activity=arc.target.name,
                            object_type=ot,
                            count_range=(1, 1),
                            marker_key=get_next_key(),
                        )
                        for arc in t.out_arcs
                        if arc.object_type == ot
                    ]
                )
            ]


def place_dependencies_marker_groups(
    places, multi_ots, dependencies, input_marker_groups, output_marker_groups
):
    """
    Creates dependencies and marker groups for places in the Object-centric Petri Net.
    Each place has one input marker group per input arc having one marker each,
    and one output marker group per output arc having one marker each.

    Parameters
    ----------
    places: list
        List of places in the Object-centric Petri Net.
    multi_ots: dict
        Dictionary mapping transition names to multi-object types.
    dependencies: dict
        Dictionary to store dependencies between activities.
    input_marker_groups: dict
        Dictionary to store input marker groups.
    output_marker_groups: dict
        Dictionary to store output marker groups.
    """

    def is_predecessor_transition_with_multi_variant(arc):
        """
        Checks if the source of the arc is a transition with and the object type
        of the arc is a multi-output object type for the given transition.
        """
        return isinstance(
            arc.source, OCPetriNet.Transition
        ) and arc.object_type in multi_ots.get(arc.source.name, dict()).get(
            "output", dict()
        )

    def is_successor_transition_with_multi_variant(arc):
        """
        Checks if the target of the arc is a transition with and the object type
        of the arc is a multi-input object type for the given transition.
        """
        return isinstance(
            arc.target, OCPetriNet.Transition
        ) and arc.object_type in multi_ots.get(arc.target.name, dict()).get(
            "input", dict()
        )

    for p in places:
        # dependencies
        if p.name not in dependencies:
            dependencies[p.name] = dict()  # add as activity
        for arc in p.in_arcs:
            if not is_predecessor_transition_with_multi_variant(arc):
                add_dependency(dependencies, arc.source, p, arc.object_type)
            else:
                pass  # dependency for auxiliary places was already added
        for arc in p.out_arcs:
            if not is_successor_transition_with_multi_variant(arc):
                add_dependency(dependencies, p, arc.target, arc.object_type)
            else:
                pass  # dependency for auxiliary places was already added

        # one-element marker group per arc
        input_marker_groups[p.name] = [
            OCCausalNet.MarkerGroup(
                [
                    OCCausalNet.Marker(
                        related_activity=(
                            arc.source.name
                            if not is_predecessor_transition_with_multi_variant(arc)
                            else get_aux_place_name(
                                arc.source.name, arc.object_type, is_input_aux=False
                            )
                        ),  # connect to aux place instead if multi-variant ot
                        object_type=arc.object_type,
                        count_range=(1, float("inf")),
                        marker_key=get_next_key(),
                    )
                ]
            )
            for arc in p.in_arcs
        ]

        output_marker_groups[p.name] = [
            OCCausalNet.MarkerGroup(
                [
                    OCCausalNet.Marker(
                        related_activity=(
                            arc.target.name
                            if not is_successor_transition_with_multi_variant(arc)
                            else get_aux_place_name(
                                arc.target.name, arc.object_type, is_input_aux=True
                            )
                        ),
                        object_type=arc.object_type,
                        count_range=(1, float("inf")),
                        marker_key=get_next_key(),
                    )
                ]
            )
            for arc in p.out_arcs
        ]


def start_end_act_dependencies_marker_groups(
    object_types,
    dependencies,
    input_marker_groups,
    output_marker_groups,
    start_places,
    end_places,
):
    """
    Adds a START and END activity for each object type.
    Creates dependencies and marker groups for those new activities.
    Each START / END activity has one input / output marker group consisting
    of markers for every start / end place.

    Parameters
    ----------
    object_types: list
        List of object types in the Object-centric Petri Net.
    dependencies: dict
        Dictionary to store dependencies between activities.
    input_marker_groups: dict
        Dictionary to store input marker groups.
    output_marker_groups: dict
        Dictionary to store output marker groups.
    start_places: dict
        Dictionary mapping object types to their start places.
    end_places: dict
        Dictionary mapping object types to their end places.
    """
    for ot in object_types:
        # START places
        dependencies[f"START_{ot}"] = dict()
        for p in start_places[ot]:
            add_dependency(dependencies, f"START_{ot}", p, ot)

        # one output marker group
        output_marker_groups[f"START_{ot}"] = [
            OCCausalNet.MarkerGroup(
                [
                    OCCausalNet.Marker(
                        related_activity=p.name,
                        object_type=ot,
                        count_range=(1, float("inf")),
                        marker_key=get_next_key(),
                    )
                    for p in start_places[ot]
                ]
            )
        ]

        # END places
        dependencies[f"END_{ot}"] = dict()
        for p in end_places[ot]:
            add_dependency(dependencies, p, f"END_{ot}", ot)

        # one input marker group
        input_marker_groups[f"END_{ot}"] = [
            OCCausalNet.MarkerGroup(
                [
                    OCCausalNet.Marker(
                        related_activity=p.name,
                        object_type=ot,
                        count_range=(1, float("inf")),
                        marker_key=get_next_key(),
                    )
                    for p in end_places[ot]
                ]
            )
        ]


def add_start_end_act_markers(
    object_types, input_marker_groups, output_marker_groups, start_places, end_places
):
    """
    Adds markers for the START and END activities to the start / end places.
    These markers are the same as for any other predecessor / successor activity.

    Parameters
    ----------
    object_types: list
        List of object types in the Object-centric Petri Net.
    input_marker_groups: dict
        Dictionary to store input marker groups.
    output_marker_groups: dict
        Dictionary to store output marker groups.
    start_places: dict
        Dictionary mapping object types to their start places.
    end_places: dict
        Dictionary mapping object types to their end places.
    """
    for ot in object_types:
        for p in start_places[ot]:
            # add new marker group
            if p.name not in input_marker_groups:
                input_marker_groups[p.name] = []
            input_marker_groups[p.name].append(
                OCCausalNet.MarkerGroup(
                    [
                        OCCausalNet.Marker(
                            related_activity=f"START_{ot}",
                            object_type=ot,
                            count_range=(1, float("inf")),
                            marker_key=get_next_key(),
                        )
                    ]
                )
            )
        for p in end_places[ot]:
            # add new marker group
            if p.name not in output_marker_groups:
                output_marker_groups[p.name] = []
            output_marker_groups[p.name].append(
                OCCausalNet.MarkerGroup(
                    [
                        OCCausalNet.Marker(
                            related_activity=f"END_{ot}",
                            object_type=ot,
                            count_range=(1, float("inf")),
                            marker_key=get_next_key(),
                        )
                    ]
                )
            )


def add_dependency(dependencies: dict, source, target, object_type):
    """
    Adds a dependency to the dependencies dictionary. Ignores duplicate dependencies.

    Parameters
    ----------
    dependencies: dict
        The dictionary to which the dependency will be added.
    source: str or OCPetriNet.Place or OCPetriNet.Transition
        The source of the dependency arc.
    target str or OCPetriNet.Place or OCPetriNet.Transition
        The target of the dependency arc.
    object_type
        The object type associated with the dependency.
    """
    source_label = source if isinstance(source, str) else source.name
    target_label = target if isinstance(target, str) else target.name
    if source_label not in dependencies:
        dependencies[source_label] = dict()
    if target_label not in dependencies[source_label]:
        dependencies[source_label][target_label] = dict()
    if object_type not in dependencies[source_label][target_label]:
        dependencies[source_label][target_label][object_type] = {
            "object_type": object_type
        }


def get_next_key():
    """
    Will return a unique key for each call, starting from 0.
    """
    # initialize on first call
    if not hasattr(get_next_key, "counter"):
        get_next_key.counter = 0
    current = get_next_key.counter
    get_next_key.counter += 1
    return current