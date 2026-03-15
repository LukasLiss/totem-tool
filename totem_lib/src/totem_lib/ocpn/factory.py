from . import OCPetriNet, OCMarking
from pm4py import PetriNet
from collections import Counter
import uuid

def create_from_dict(dict_repr):
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
    labeled_transitions = {label: OCPetriNet.Transition(label=label, name=str(uuid.uuid4())) for label in activities}
    
    for ot, net in petri_nets.items():
        pn, im, fm = net
        
        # transitions
        for t in pn.transitions:
            if not t.label:
                # labeled transitions are already in labeled_transitions
                name = f"{ot}_{t.name}" # make name unique
                unlabeled_transitions[name] = OCPetriNet.Transition(name=name)
        
        # places 
        for p in pn.places:
            name = f"{ot}_{p.name}" # make name unique
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
            
            a = OCPetriNet.Arc(source=source, target=target, object_type=ot, is_variable=is_double)
            arcs.append(a)
            source.add_out_arc(a)
            target.add_in_arc(a)
        
        # markings
        for p in im:
            initial_marking += OCMarking({places[f"{ot}_{p.name}"]: Counter([f"{ot}_{i}" for i in range(im[p])])})
        for p in fm:
            final_marking += OCMarking({places[f"{ot}_{p.name}"]: Counter([f"{ot}_{i}" for i in range(fm[p])])})
    
    # create the OCPetriNet object
    ocpn_obj = OCPetriNet(
        places = set(places.values()),
        transitions = set(labeled_transitions.values()) | set(unlabeled_transitions.values()),
        arcs = set(arcs),
        initial_marking=initial_marking,
        final_marking=final_marking,
    )
    return ocpn_obj