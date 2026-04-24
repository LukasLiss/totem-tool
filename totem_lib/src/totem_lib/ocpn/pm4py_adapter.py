from . import OCPetriNet, OCMarking
from pm4py import PetriNet, Marking
from pm4py.objects.petri_net.utils.petri_utils import add_arc_from_to
from collections import Counter
from typing import Any, Dict
import uuid


def from_pm4py_dict(dict_repr):
    """
    Creates an object-centric Petri net object from the dictionary
    representation used in the PM4Py library (see pm4py.algo.discovery.ocel.ocpn.variants.classic).
    Only considers the properties `activities`, `petri_nets`, and `double_arcs_on_activity`.
    All other information is lost.

    Parameters
    -----------------
    dict_repr
        Dictionary containing the properties of the object-centric Petri net

    Returns
    ----------------
    OCPetriNet
        Object-centric Petri net object
    """
    activities = dict_repr["activities"]
    petri_nets = dict_repr["petri_nets"]
    double_arcs_on_activity = dict_repr["double_arcs_on_activity"]

    places = dict()
    unlabeled_transitions = dict()
    arcs = []
    initial_marking = OCMarking()
    final_marking = OCMarking()

    # Labeled transitions
    labeled_transitions = {
        label: OCPetriNet.Transition(label=label, name=str(uuid.uuid4()))
        for label in activities
    }

    for ot, net in petri_nets.items():
        pn, im, fm = net

        # transitions
        for t in pn.transitions:
            if not t.label:
                # labeled transitions are already in labeled_transitions
                name = f"{ot}_{t.name}"  # make name unique
                unlabeled_transitions[name] = OCPetriNet.Transition(name=name)

        # places
        for p in pn.places:
            name = f"{ot}_{p.name}"  # make name unique
            places[name] = OCPetriNet.Place(name=name, object_type=ot)

        # arcs
        for arc in pn.arcs:
            is_double = False
            if isinstance(arc.source, PetriNet.Transition):
                if arc.source.label:
                    source = labeled_transitions[arc.source.label]
                    is_double = double_arcs_on_activity[ot][arc.source.label]
                else:
                    source = unlabeled_transitions[f"{ot}_{arc.source.name}"]
                target = places[f"{ot}_{arc.target.name}"]
            elif isinstance(arc.source, PetriNet.Place):
                source = places[f"{ot}_{arc.source.name}"]
                if arc.target.label:
                    target = labeled_transitions[arc.target.label]
                    is_double = double_arcs_on_activity[ot][arc.target.label]
                else:
                    target = unlabeled_transitions[f"{ot}_{arc.target.name}"]
            else:
                raise ValueError("Unknown arc source type")

            a = OCPetriNet.Arc(
                source=source, target=target, object_type=ot, is_variable=is_double
            )
            arcs.append(a)
            source.add_out_arc(a)
            target.add_in_arc(a)

        # markings
        for p in im:
            initial_marking += OCMarking(
                {places[f"{ot}_{p.name}"]: Counter([f"{ot}_{i}" for i in range(im[p])])}
            )
        for p in fm:
            final_marking += OCMarking(
                {places[f"{ot}_{p.name}"]: Counter([f"{ot}_{i}" for i in range(fm[p])])}
            )

    # create the OCPetriNet object
    ocpn_obj = OCPetriNet(
        places=set(places.values()),
        transitions=set(labeled_transitions.values())
        | set(unlabeled_transitions.values()),
        arcs=set(arcs),
        initial_marking=initial_marking,
        final_marking=final_marking,
    )
    return ocpn_obj

def to_pm4py_dict(ocpn: OCPetriNet):
    """
    Converts an OCPetriNet object to the dictionary representation used in the PM4Py library 
    (see pm4py.algo.discovery.ocel.ocpn.variants.classic).
    Only the essential components of the OCPetriNet are retained in the dict representation: 
    `activities`, `object_types`, `petri_nets`, `double_arcs_on_activity`, `start_activities`, 
    and `end_activities`.

    Parameters
    ----------
    ocpn: OCPetriNet
        The object-centric Petri net to be converted.

    Returns
    ----------
    ocpn: Dict[str, Any]
        Dict representation of the object-centric Petri net.
    """
    
    object_types = ocpn.object_types
    activities = {t.label for t in ocpn.transitions if t.label}
    petri_nets = {ot: _project_ocpn_on_object_type(ocpn, ot) for ot in object_types}
    double_arcs_on_activity = _get_double_arcs(ocpn)
    start_activities = _get_start_end_activities(ocpn, ocpn.initial_marking)
    end_activities = _get_start_end_activities(ocpn, ocpn.final_marking)

    alternative_format = {
        "activities": activities,
        "object_types": object_types,
        "petri_nets": petri_nets,
        "double_arcs_on_activity": double_arcs_on_activity,
        "start_activities": start_activities,
        "end_activities": end_activities,
        # information not extracted in this implementation
        "edges": {
            "event_couples": {ot: {} for ot in object_types},
            "event_pairs": {ot: {} for ot in object_types},
            "total_objects": {ot: {} for ot in object_types},
        },
        "activities_indep": {
            "events": {ot: {} for ot in object_types},
            "unique_objects": {ot: {} for ot in object_types},
            "total_objects": {ot: {} for ot in object_types},
        },
        "activities_ot": {
            "events": {ot: {} for ot in object_types},
            "unique_objects": {ot: {} for ot in object_types},
            "total_objects": {ot: {} for ot in object_types},
        },
        "tbr_results": {},
    }

    return alternative_format

def _project_ocpn_on_object_type(
    ocpn: OCPetriNet, object_type
) -> tuple[PetriNet, Marking, Marking]:
    """
    Projects the OCPetriNet into a tuple containing the Petri net projection and the initial and final marking projections for the object type.

    Parameters
    ----------
    ocpn: OCPetriNet
        The object-centric Petri net to be split.
    object_type: str
        The object type for which the projection is to be created.

    Returns
    ----------
    tuple[PetriNet, Marking, Marking]
        A tuple containing the Petri net projection, initial marking, and final marking projection for the object type.
    """
    # extract places by ot
    places = [p for p in ocpn.places if p.object_type == object_type]

    # extract arcs from those places
    arcs = [
        a
        for p in places
        for a in p.out_arcs | p.in_arcs
        if a.object_type == object_type
    ]

    # extract transitions as those used in the arcs
    transitions = {
        a.source for a in arcs if isinstance(a.source, OCPetriNet.Transition)
    } | {a.target for a in arcs if isinstance(a.target, OCPetriNet.Transition)}

    # construct net projection
    pn_places = {p: PetriNet.Place(p.name) for p in places}
    pn_transitions = {t: PetriNet.Transition(name=t.name, label=t.label) for t in transitions}

    # create pn
    pn = PetriNet(
        name=f"{ocpn.name}_{object_type}",
        places=set(pn_places.values()),
        transitions=set(pn_transitions.values()),
    )

    # add arcs
    for arc in arcs:
        source = pn_places.get(arc.source, pn_transitions.get(arc.source))
        target = pn_places.get(arc.target, pn_transitions.get(arc.target))

        add_arc_from_to(source, target, pn)

    # initial (& final) marking as multiset of places in the initial marking where the count is the number of objects of that type in the place
    initial_marking = oc_marking_to_petri(ocpn.initial_marking, pn_places)
    final_marking = oc_marking_to_petri(ocpn.final_marking, pn_places)

    return pn, initial_marking, final_marking


def oc_marking_to_petri(
    oc_marking: OCMarking,
    pn_places: Dict[OCPetriNet.Place, PetriNet.Place],
) -> Marking:
    """
    Convert an object-centric marking to a classic Petri-net Marking that
    contains only the places that are keys of the `pn_places` dictionary.

    Parameters
    ----------
    oc_marking: OCMarking
        The object-centric marking to convert.
    pn_places: Dict[OCPetriNet.Place, PetriNet.Place]
        A mapping from object-centric Petri net places to classic Petri net places.

    Returns
    ----------
    Marking
        A classic Petri net marking (place -> token count)
    """
    petri_marking = Marking()
    if not oc_marking:
        return petri_marking

    # Aggregate multiplicities per place for the requested object type
    for place, counter in oc_marking.items():
        if place in pn_places.keys():
            if pn_places[place] not in petri_marking:
                petri_marking[pn_places[place]] = 0
            petri_marking[pn_places[place]] += sum(counter.values())

    return petri_marking


def _get_double_arcs(ocpn: OCPetriNet) -> Dict[str, Any]:
    """
    Returns a dictionary mapping each object type to a dict mapping an activity to True if only connected to variable arcs, or False if only connected to non-variable arcs.

    Parameters
    ----------
    ocpn: OCPetriNet
        The object-centric Petri net to analyze.

    Returns
    ----------
    Dict[str, Any]
        A dictionary where keys are object types and values are dicts where keys are
        activity names and values are True if only connected to variable arcs, or False if only connected to non-variable arcs.
    """
    double_arcs = {ot: {} for ot in ocpn.object_types}
    for arc in ocpn.arcs:
        ot = arc.object_type
        act = arc.source.label if isinstance(arc.source, OCPetriNet.Transition) else arc.target.label
        if act is None:
            continue
        if act in double_arcs[ot]:
            if double_arcs[ot][act] != arc.is_variable:
                raise ValueError(
                    f"Transition {act} in object type {ot} is connected to both variable and non-variable arcs. The given OCPetriNet is invalid."
                )
        double_arcs[ot][act] = arc.is_variable

    return double_arcs


def _get_start_end_activities(
    ocpn: OCPetriNet,
    marking: OCMarking
) -> Dict[str, Any]:
    """
    Returns a dictionary mapping each object type to a dict mapping the start/end activities to empty sets for events, unique_objects, and total_objects.

    Parameters
    ----------
    ocpn: OCPetriNet
        The object-centric Petri net to analyze.
    marking: OCMarking
        The initial or final marking of the OCPetriNet, used to determine start or end activities.

    Returns
    ----------
    Dict[str, Any]
        The start or end activities dictionaries.
    """
    # activities are those occuring in the given marking
    activities = {ot: {} for ot in ocpn.object_types}
    
    if marking is None:
        return activities
    
    for p in marking.places:
        ot = p.object_type
        if p not in activities[ot]:
            activities[ot][p.name] = {
                "events": set(),
                "unique_objects": set(),
                "total_objects": set(),
            }
            
    return activities