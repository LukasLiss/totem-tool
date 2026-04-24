from . import OCPetriNet, OCMarking, pre_set
from typing import Dict, FrozenSet, Iterator, Set, Tuple
from collections import Counter, defaultdict
from itertools import chain, combinations

class OCPetriNetSemantics():
    @classmethod
    def is_enabled(cls, pn: OCPetriNet, transition: OCPetriNet.Transition, marking: OCMarking) -> bool:
        """
        Checks whether a given transition is enabled in a given object-centric Petri net and marking.
        A transition is enabled if every non-variable arc has at least one object in the corresponding place,
        and at least one arc can consume a token.

        Parameters
        ----------
        net
            object-centric Petri net
        transition
            transition to check
        marking
            marking to check

        Returns
        -------
        bool
            true if enabled, false otherwise
        """
        if transition not in pn.transitions:
            return False
        
        any_enabled = False
        for a in transition.in_arcs:
            if marking[a.source] == Counter():
                if not a.is_variable:
                    return False
            else:
                any_enabled = True
        return any_enabled
    
    @classmethod
    def is_binding_enabled(cls, pn: OCPetriNet, transition: OCPetriNet.Transition, marking: OCMarking, objects: Dict[str, Set]) -> bool:
        """
        Checks whether a given binding is enabled for a transition in a given object-centric Petri net and marking.

        Parameters
        ----------
        pn
            object-centric Petri net
        transition
            transition to check
        marking
            marking to check
        objects
            dict of objects per object type, e.g., {"order": {"order1", "order2"}}

        Returns
        -------
        bool
            true if binding is enabled, false otherwise
        """
        # We need to consume at least one token
        at_least_one_object = False
        
        # Check for every in-arc if:
        # - the binding respects the variability of the in-arc
        # - the state contains the necessary tokens
        for a in transition.in_arcs:
            ot = a.object_type
            
            obj_set = objects.get(ot, set())
            
            # Check if variability of arc is respected
            if (not a.is_variable) and (not len(obj_set) == 1):
                # nv-arc must be bound to exactly one object
                return False
            
            if not obj_set:
                # We assign not objects to this variable arc
                continue
            
            at_least_one_object = True
            
            # Check if state contains all tokens
            place_tokens = marking[a.source].keys()
            if not obj_set <= place_tokens:
                # tokens not present
                return False
        
        return at_least_one_object
    
    @classmethod
    def check_and_fire(
        cls, pn: OCPetriNet, transition: OCPetriNet.Transition, marking: OCMarking, objects: Dict[str, Set]
    ) -> OCMarking:
        """
        Checks if a transition is enabled and fires it with the given set of objects.
        If the transition is not enabled, it returns None.

        Parameters
        ----------
        pn
            object-centric Petri net
        transition
            transition to fire
        marking
            marking to use
        objects
            dict of objects per object type, e.g., {"order": {"order1", "order2"}}

        Returns
        -------
        OCMarking or None
            New marking after firing the transition or None if the transition was not enabled.
        """
        if cls.is_binding_enabled(pn, transition, marking, objects):
            return cls.fire(pn, transition, marking, objects)
        return None
    
    @classmethod
    def fire(
        cls, pn: OCPetriNet, transition: OCPetriNet.Transition, marking: OCMarking, objects: Dict[str, Set]
    ) -> OCMarking:
        """
        Execute a transition for a given set of objects per object type
        For performance reasons, this function does not check if the transition is enabled or binding passed set of objects is valid, i.e.,
        this should be performed by the invoking algorithm or using `check_and_fire` (if needed). Hence, markings can become negative.

        Parameters
        ----------
        pn
            object-centric Petri net
        transition
            transition to execute
        marking
            marking to use
        objects
            dict of objects per object type, e.g., {"order": {"order1", "order2"}}

        Returns
        -------
        OCMarking
            newly reached marking
        """
        # Copy counters place-wise so firing does not mutate the input marking.
        m_out = OCMarking({place: counter.copy() for place, counter in marking.items()})
        for a in transition.in_arcs:
            obj_set = objects.get(a.object_type, set())
            m_out[a.source] -= Counter(obj_set)
        for a in transition.out_arcs:
            obj_set = objects.get(a.object_type, set())
            m_out[a.target] += Counter(obj_set)
        return m_out
    
    @classmethod
    def replay(cls, ocpn: OCPetriNet, trace, initial_marking=None, final_marking=None):
        """
        Replays a trace on the object-centric Petri net.
        Starts with the initial marking and check if the trace reaches the final marking.
        
        Parameters
        ----------
        ocpn : OCPetriNet
            The object-centric Petri net to replay on.
        trace : tuple
            A trace from the object-centric Petri net,
            represented as a tuple of (transition_name, {object_type: set(object_ids)}) tuples.
        initial_marking : OCMarking, optional
            The initial marking to start the replay from. If None, the initial marking of the ocpn is used.
        final_marking : OCMarking, optional
            The final marking to check after the replay. If None, the final marking of the ocpn is used.
        """
        if not initial_marking:
            initial_marking = ocpn.initial_marking
        if not final_marking:
            final_marking = ocpn.final_marking
        
        transitions = {t.name: t for t in ocpn.transitions}
        
        # start in the initial marking
        marking = initial_marking
        
        # replay each binding
        for transition_name, objects in trace:
            t = transitions[transition_name]
            
            # Check if the binding is enabled
            if not cls.is_binding_enabled(ocpn, t, marking, objects):
                return False
            
            # Fire
            marking = cls.fire(ocpn, t, marking, objects)
        
        # Check if we are in the final marking
        return cls._is_final(marking, final_marking)
    
    @classmethod
    def _is_final(cls, marking: OCMarking, final_marking: OCMarking) -> bool:
        """
        Checks if the given marking is a valid final marking.
        May be overriden by subclasses.

        Parameters
        ----------
        marking
            marking to check
        final_marking
            final marking to check against

        Returns
        -------
        bool
            true if marking is a final marking, false otherwise
        """
        return marking == final_marking
    
    @classmethod
    def enabled_transitions(
        cls, pn: OCPetriNet, marking: OCMarking
    ) -> Set[OCPetriNet.Transition]:
        """
        Returns the enabled transitions in a given object-centric Petri net and marking

        Parameters
        ----------
        net
            object-centric Petri net
        marking
            marking to check

        Returns
        -------
        Set[OCPetriNet.Transition]
            Set of enabled transitions
        """
        return {t for t in pn.transitions if cls.is_enabled(pn, t, marking)}
    
    
    @classmethod
    def get_possible_bindings(
        cls, pn: OCPetriNet, transition: OCPetriNet.Transition, marking: OCMarking
    ) -> Iterator[Dict[str, Set]]:
        """
        Returns an Iterator on the possible bindings for a given transition 
        in a given object-centric Petri net and marking. 

        Parameters
        ----------
        net
            object-centric Petri net
        transition
            transition to check
        marking
            marking to check

        Returns
        -------
        Iterator[Dict[str, Set]]
            Iterator on all possible bindings (key is object type, value is a set of objects)
        """

        def get_common_objects(places: Set[OCPetriNet.Place], marking: OCMarking) -> Set:
            """
            Get the intersection of objects in a set of places for the given marking.

            The resulting set contains objects present in ALL specified places.

            Parameters
            ----------
            places
                Set of places to consider
            marking
                Marking to consider

            Returns
            -------
            Set
                Set containing the common objects
            """
            if not places:
                return set()

            # iter to avoid treating the first place as a special case
            places_iter = iter(places)

            result_counter = marking[next(places_iter)].copy()

            for place in places_iter:
                if not result_counter:
                    break
                # intersect with the current place's objects
                result_counter &= marking[place]

            return set(result_counter)

        def get_powerset(object_type: str, objects: Set) -> Set[FrozenSet[Tuple]]:
            """
            Generate the powerset of a set of objects in the form (object_type, object_id).

            Parameters
            ----------
            object_type
                The type of the objects
            objects
                Set of objects to generate the powerset for

            Returns
            -------
            Set[FrozenSet[Tuple]]
                Set of frozen sets representing the powerset of the input set
            """
            items = [(object_type, obj_id) for obj_id in objects]
            powerset_iterator = chain.from_iterable(
                combinations(items, r) for r in range(len(items) + 1)
            )
            return {frozenset(subset) for subset in powerset_iterator}

        def recursive_bindings(
            variable_object_types: Set[str],
            non_variable_object_types: Set[str],
            available_objects: Dict[str, Set],
        ) -> Set[FrozenSet[Tuple]]:
            """
            Recursively generate all possible bindings given the remaining object types and available objects.

            Parameters
            ----------
            variable_object_types
                Set of variable object types to consider
            non_variable_object_types
                Set of non-variable object types to consider
            available_objects
                Dictionary where keys are object types and values are sets of available objects for that type

            Returns
            -------
            Set[FrozenSet[Tuple]]
                Set of possible bindings (as frozen sets of tuples (object_type, object_id))
            """
            # Base case
            if not non_variable_object_types and not variable_object_types:
                # empty binding
                return {frozenset()} 
        
            # Recursive case
            # Pick next object type to process. Non-variable object types are processed first.
            is_variable = not non_variable_object_types
            types_to_process = variable_object_types if is_variable else non_variable_object_types
            ot = types_to_process.pop()
            
            try:
                ot_objects = available_objects.get(ot, set())
                
                # Get all possible object combinations for this object type
                if is_variable:
                    # For variable object types, we can pick 0-all objects (powerset)
                    current_options = get_powerset(ot, ot_objects)
                else:
                    # For non-variable object types, we must pick exactly one object
                    current_options = {frozenset({(ot, obj)}) for obj in ot_objects}
                    # No options -> no bindings possible
                    if not current_options:
                        return set()
                    
                # Recursively get bindings for the remaining object types
                sub_bindings = recursive_bindings(
                    variable_object_types,
                    non_variable_object_types,
                    available_objects,
                )
                
                # cross product current options with sub-bindings
                bindings = {
                    sub_binding.union(option)
                    for option in current_options
                    for sub_binding in sub_bindings
                }
                
                return bindings
                
            finally:
                # restore the set of object types
                types_to_process.add(ot)


        if transition not in pn.transitions:
            # no binding to yield
            return

        # get object types involved in t and whether they are variable
        non_variable_object_types = set()
        variable_object_types = set()
        for a in transition.in_arcs:
            if a.is_variable:
                variable_object_types.add(a.object_type)
            else:
                non_variable_object_types.add(a.object_type)

        # get predecessor places per object type
        predecessors = {
            ot: pre_set(transition, ot)
            for ot in non_variable_object_types | variable_object_types
        }

        # per ot, get objects present in all predecessor places
        common_objects = {
            ot: get_common_objects(predecessors[ot], marking)
            for ot in non_variable_object_types | variable_object_types
        }

        # get bindings
        frozenset_bindings = recursive_bindings(
            variable_object_types, non_variable_object_types, common_objects
        )
        
        # Loop through immutable bindings and yield dictionary one by one
        for fs_binding in frozenset_bindings:
            # do not yield the empty binding
            if not fs_binding:
                continue
            
            binding_dict = defaultdict(set)
            for ot, obj in fs_binding:
                binding_dict[ot].add(obj)
                
            yield binding_dict