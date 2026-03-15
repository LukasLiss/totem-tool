from collections import Counter, defaultdict
from copy import deepcopy
from typing import Collection, Dict, Any, Set


class OCMarking(defaultdict):
    """
    An object-centric marking (for `OCPetriNets`) represented as a mapping from places to multisets (`Counter`) of object IDs.
    
    ```
    marking = OCMarking({p: Counter(["object1", "object2"])})
    ```
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        """Initializes the OCMarking, querying unspecified places defaults to an empty multiset."""
        super().__init__(Counter)
        data_args = args
        if args and args[0] is Counter:
            data_args = args[1:]
        initial_data = dict(*data_args, **kwargs)
        for place, objects in initial_data.items():
            self[place] = Counter(objects)

    def __hash__(self):
        return frozenset(
            (place, frozenset(counter.items()))
            for place, counter in self.items()
            if counter
        ).__hash__()

    def __eq__(self, other):
        if not isinstance(other, OCMarking):
            return False
        return all(
            self.get(p, Counter()) == other.get(p, Counter())
            for p in set(self.keys()) | set(other.keys())
        )

    def __le__(self, other):
        for place, self_counter in self.items():
            other_counter = other.get(place, Counter())
            # Every object count in self must be less than or equal to the count in other.
            if not all(
                other_counter.get(obj_id, 0) >= count
                for obj_id, count in self_counter.items()
            ):
                return False
        return True

    def __add__(self, other):
        result = OCMarking()
        for place, self_counter in self.items():
            result[place] += self_counter
        for place, other_counter in other.items():
            result[place] += other_counter
        return result

    def __sub__(self, other):
        result = OCMarking()
        for place, self_counter in self.items():
            diff = self_counter - other.get(place, Counter())
            if diff != Counter():
                result[place] = diff
        return result

    def __repr__(self):
        # e.g.  ["p1:{o1, o2}", "p2: {o2, o3}", …]
        sorted_entries = sorted(self.items(), key=lambda item: item[0].name)
        return (
            ", ".join(f"{place.name}: {objects}" for (place, objects) in sorted_entries)
            if sorted_entries
            else "[]"
        )

    def __str__(self):
        return self.__repr__()

    def __deepcopy__(self, memodict={}):
        new_marking = OCMarking()
        memodict[id(self)] = new_marking
        for place, objects in self.items():
            place_copy = (
                memodict[id(place)]
                if id(place) in memodict
                else deepcopy(place, memodict)
            )
            counter_copy = (
                memodict[id(objects)]
                if id(objects) in memodict
                else deepcopy(objects, memodict)
            )
            new_marking[place_copy] = counter_copy
        return new_marking

    @property
    def places(self) -> Set:
        """
        Returns the set of all places in the marking that contain tokens.

        Returns
        ------------
        Set[str]
            Set of place names in the marking.
        """
        return set([p for p in self.keys() if self[p]])


class OCPetriNet():
    class Place():
        def __init__(
            self, name, object_type, in_arcs=None, out_arcs=None, properties=None
        ):
            """
            Constructor

            Parameters
            ------------
            name
                human-readable identifier
            object_type
                the type/color of objects this place holds
            in_arcs
                set of incoming arcs
            out_arcs
                set of outgoing arcs
            properties
                dict of additional properties
            """
            self.__name = name
            self.__in_arcs = set() if in_arcs is None else in_arcs
            self.__out_arcs = set() if out_arcs is None else out_arcs
            self.__properties = dict() if properties is None else properties
            self.__object_type = object_type

        def add_in_arc(self, arc):
            """
            Adds an incoming arc to the place.

            Parameters
            ------------
            arc: OCPetriNet.Arc
                the arc to add
            """
            self.__in_arcs.add(arc)
            assert arc.target == self
            assert arc.object_type == self.object_type

        def add_out_arc(self, arc):
            """
            Adds an outgoing arc to the place.

            Parameters
            ------------
            arc: OCPetriNet.Arc
                the arc to add
            """
            self.__out_arcs.add(arc)
            assert arc.source == self
            assert arc.object_type == self.object_type
            
        def __set_name(self, name):
            self.__name = name

        def __get_name(self):
            return self.__name

        def __get_out_arcs(self):
            return self.__out_arcs

        def __get_in_arcs(self):
            return self.__in_arcs

        def __get_properties(self):
            return self.__properties

        def __get_object_type(self):
            return self.__object_type

        def __repr__(self):
            return f"{self.name}[{self.object_type}]"

        def __str__(self):
            return self.__repr__()
        
        def __eq__(self, other):
            return id(self) == id(other)
        
        def __hash__(self):
            return id(self)

        def __deepcopy__(self, memodict={}):
            if id(self) in memodict:
                return memodict[id(self)]
            new_place = OCPetriNet.Place(
                self.name, self.object_type, properties=self.properties
            )
            memodict[id(self)] = new_place
            # attached arcs
            for arc in self.in_arcs:
                arc_copy = deepcopy(arc, memodict)
                new_place.in_arcs.add(arc_copy)
            for arc in self.out_arcs:
                arc_copy = deepcopy(arc, memodict)
                new_place.out_arcs.add(arc_copy)

            return new_place

        name = property(__get_name, __set_name)
        in_arcs = property(__get_in_arcs)
        out_arcs = property(__get_out_arcs)
        properties = property(__get_properties)
        object_type = property(__get_object_type)

    class Transition():
        
        def __init__(
            self,
            name,
            label=None,
            in_arcs=None,
            out_arcs=None,
            properties=None,
        ):
            self.__name = name
            self.__label = None if label is None else label
            self.__in_arcs = set() if in_arcs is None else in_arcs
            self.__out_arcs = set() if out_arcs is None else out_arcs
            self.__properties = dict() if properties is None else properties

        def add_in_arc(self, arc):
            """
            Adds an incoming arc to the place.

            Parameters
            ------------
            arc: OCPetriNet.Arc
                the arc to add
            """
            self.__in_arcs.add(arc)
            assert arc.target == self

        def add_out_arc(self, arc):
            """
            Adds an outgoing arc to the place.

            Parameters
            ------------
            arc: OCPetriNet.Arc
                the arc to add
            """
            self.__out_arcs.add(arc)
            assert arc.source == self
            
        def __set_name(self, name):
            self.__name = name

        def __get_name(self):
            return self.__name

        def __set_label(self, label):
            self.__label = label

        def __get_label(self):
            return self.__label

        def __get_out_arcs(self):
            return self.__out_arcs

        def __get_in_arcs(self):
            return self.__in_arcs

        def __get_properties(self):
            return self.__properties

        def __repr__(self):
            if self.label is None:
                return "(" + str(self.name) + ", None)"
            else:
                return "(" + str(self.name) + ", '" + str(self.label) + "')"

        def __str__(self):
            return self.__repr__()

        def __eq__(self, other):
            return id(self) == id(other)

        def __hash__(self):
            return id(self)

            
        def __deepcopy__(self, memodict={}):
            if id(self) in memodict:
                return memodict[id(self)]
            new_trans = OCPetriNet.Transition(
                self.name, self.label, properties=self.properties
            )
            memodict[id(self)] = new_trans
            for arc in self.in_arcs:
                new_arc = deepcopy(arc, memo=memodict)
                new_trans.in_arcs.add(new_arc)
            for arc in self.out_arcs:
                new_arc = deepcopy(arc, memo=memodict)
                new_trans.out_arcs.add(new_arc)
            return new_trans

        name = property(__get_name, __set_name)
        label = property(__get_label, __set_label)
        in_arcs = property(__get_in_arcs)
        out_arcs = property(__get_out_arcs)
        properties = property(__get_properties)
            
    class Arc():
        def __init__(
            self,
            source,
            target,
            object_type,
            is_variable=False,
            properties=None,
        ):
            """
            Constructor

            Parameters
            ------------
            source
                source place / transition
            target
                target place / transition
            is_variable
                whether the arc is a variable arc
            properties
                dict of additional properties
            """
            if type(source) is type(target):
                raise Exception("Petri nets are bipartite graphs. Source and target cannot be of the same type.")
            self.__source = source
            self.__target = target
            self.__properties = dict() if properties is None else properties
            self.__object_type = object_type
            self.__is_variable = is_variable
            
        def __get_source(self):
            return self.__source

        def __get_target(self):
            return self.__target

        def __get_properties(self):
            return self.__properties

        def __get_object_type(self):
            return self.__object_type

        def __get_is_variable(self):
            return self.__is_variable

        def __repr__(self):
            source_rep = repr(self.source)
            target_rep = repr(self.target)
            base = source_rep + "->" + target_rep
            var = "variable" if self.is_variable else "non-variable"
            return f"{base}:{self.object_type}:{var}"
        
        def __str__(self):
            return self.__repr__()
        
        def __hash__(self):
            return id(self)
        
        def __eq__(self, other):
            return self.source == other.source and self.target == other.target

        def __deepcopy__(self, memodict={}):
            if id(self) in memodict:
                return memodict[id(self)]
            new_source = memodict.get(id(self.source), deepcopy(self.source, memodict))
            new_target = memodict.get(id(self.target), deepcopy(self.target, memodict))
            new_arc = OCPetriNet.Arc(
                new_source,
                new_target,
                self.object_type,
                is_variable=self.is_variable,
                properties=self.properties,
            )
            memodict[id(self)] = new_arc
            # reattach
            new_source.out_arcs.add(new_arc)
            new_target.in_arcs.add(new_arc)
            return new_arc

        source = property(__get_source)
        target = property(__get_target)
        properties = property(__get_properties)
        object_type = property(__get_object_type)
        is_variable = property(__get_is_variable)

    def __init__(
        self,
        name: str = None,
        places: Collection[Place] = None,
        transitions: Collection[Transition] = None,
        arcs: Collection[Arc] = None,
        initial_marking: OCMarking = None,
        final_marking: OCMarking = None,
        properties: Dict[str, Any] = None,
    ):
        """
        Constructor

        Parameters
        ------------
        name
            human-readable identifier
        places
            collection of places
        transitions
            collection of transitions
        arcs
            collection of arcs
        initial_marking
            initial marking of the net
        final_marking
            final marking of the net
        properties
            dict of additional properties
        """
        self.__name = "" if name is None else name
        self.__places = set() if places is None else places
        self.__transitions = set() if transitions is None else transitions
        self.__arcs = set() if arcs is None else arcs
        self.__properties = dict() if properties is None else properties
        self.__initial_marking = initial_marking
        self.__final_marking = final_marking
        self.__assert_well_formed()

    def __get_name(self) -> str:
        return self.__name

    def __set_name(self, name):
        self.__name = name

    def __get_places(self) -> Collection[Place]:
        return self.__places

    def __get_transitions(self) -> Collection[Transition]:
        return self.__transitions

    def __get_arcs(self) -> Collection[Arc]:
        return self.__arcs

    def __get_properties(self) -> Dict[str, Any]:
        return self.__properties

    def __get_initial_marking(self):
        return self.__initial_marking

    def __get_final_marking(self):
        return self.__final_marking
    
    def __hash__(self):
        ret = 0
        for p in self.places:
            ret += hash(p)
            ret = ret % 479001599
        for t in self.transitions:
            ret += hash(t)
            ret = ret % 479001599
        return ret
    
    def __eq__(self, other):
        return id(self) == id(other)

    def __deepcopy__(self, memodict={}):
        new_net = OCPetriNet(self.name)
        memodict[id(self)] = new_net
        for p in self.places:
            p_copy = OCPetriNet.Place(p.name, p.object_type, properties=p.properties)
            new_net.places.add(p_copy)
            memodict[id(p)] = p_copy
        for t in self.transitions:
            t_copy = OCPetriNet.Transition(t.name, t.label, properties=t.properties)
            new_net.transitions.add(t_copy)
            memodict[id(t)] = t_copy
        for a in self.arcs:
            src = memodict[id(a.source)]
            tgt = memodict[id(a.target)]
            a_copy = OCPetriNet.Arc(
                src,
                tgt,
                a.object_type,
                is_variable=a.is_variable,
                properties=a.properties,
            )
            src.out_arcs.add(a_copy)
            tgt.in_arcs.add(a_copy)
            new_net.arcs.add(a_copy)
            memodict[id(a)] = a_copy

        def copy_marking(marking):
            if marking is None:
                return None
            copied_marking = OCMarking()
            for place, objects in marking.items():
                place_copy = memodict.get(id(place))
                if place_copy is None:
                    place_copy = OCPetriNet.Place(
                        place.name, place.object_type, properties=place.properties
                    )
                    memodict[id(place)] = place_copy
                    new_net.places.add(place_copy)
                copied_marking[place_copy] = objects.copy()
            return copied_marking

        new_net._OCPetriNet__initial_marking = copy_marking(self.initial_marking)
        new_net._OCPetriNet__final_marking = copy_marking(self.final_marking)
        return new_net

    def __repr__(self):
        ret = [f"OCPN {self.name}:\nobject_types: ["]
        object_types_rep = []
        for ot in self.object_types:
            object_types_rep.append(ot)
        object_types_rep.sort()
        ret.append(" " + ", ".join(object_types_rep) + " ")
        ret.append("]\nplaces: [")
        places_rep = []
        for place in self.places:
            places_rep.append(repr(place))
        places_rep.sort()
        ret.append(" " + ", ".join(places_rep) + " ")
        ret.append("]\ntransitions: [")
        trans_rep = []
        for trans in self.transitions:
            trans_rep.append(repr(trans))
        trans_rep.sort()
        ret.append(" " + ", ".join(trans_rep) + " ")
        ret.append("]\narcs: [")
        arcs_rep = []
        for arc in self.arcs:
            arcs_rep.append(repr(arc))
        arcs_rep.sort()
        ret.append(" " + ", ".join(arcs_rep) + " ")
        ret.append("]\ninitial_marking: [")
        initial_marking_rep = [repr(self.initial_marking)]
        ret.append(" " + ", ".join(initial_marking_rep) + " ")
        ret.append("]\nfinal_marking: [")
        final_marking_rep = [repr(self.final_marking)]
        ret.append(" " + ", ".join(final_marking_rep) + " ")
        ret.append("]")
        return "".join(ret)

    def __str__(self):
        return self.__repr__()

    def __assert_well_formed(self):
        """
        Asserts that the OCPN is well-formed, i.e., all transitions have,
        for each object type, only either variable or non-variable arcs, but not both.
        """
        for t in self.transitions:
            for ot in self.object_types:
                var_arcs = {
                    a for a in t.in_arcs if a.is_variable and a.object_type == ot
                }
                non_var_arcs = {
                    a for a in t.in_arcs if not a.is_variable and a.object_type == ot
                }
                if var_arcs and non_var_arcs:
                    raise ValueError(f"Transition {t} is not well-formed.")

    name = property(__get_name, __set_name)
    places = property(__get_places)
    transitions = property(__get_transitions)
    arcs = property(__get_arcs)
    properties = property(__get_properties)
    initial_marking = property(__get_initial_marking)
    final_marking = property(__get_final_marking)

    @property
    def object_types(self) -> Set[str]:
        """
        Returns the set of all object types (colors) used in this net.

        Returns
        ------------
        Set[str]
            Set of object types (colors) used in this net.
        """
        return {p.object_type for p in self.places}