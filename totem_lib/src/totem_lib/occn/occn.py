from copy import deepcopy
from itertools import combinations
import networkx as nx
from typing import Any, Generic, Set, Tuple, List, Dict
from collections import Counter, defaultdict
from functools import cached_property
from .utils.filter import filter4


class OCCausalNet(object):
    """
    Object-Centric Causal Net capturing dependency graph and marker groups.
    Start activities are named "START_{object_type}" and end activities "END_{object_type}".

    Reference:
    Liss et al. (2025). Object-Centric Causal Nets.
    CAiSE 2025. https://doi.org/10.1007/978-3-031-94571-7_6
    """

    class Marker(object):
        """
        Represents a single marker in an object-centric causal net.
        """

        def __init__(
            self, related_activity, object_type, count_range: Tuple, marker_key: int
        ):
            """
            Constructor

            Parameters
            ----------
            related_activity : str
                Activity that has to fulfill the marker (predecessor or successor)
            object_type : str
                object type of the marker
            count_range : Tuple
                Min and max number of markers consumable ('cardinalities')
            marker_key : int
                Key of the marker
            """
            if not isinstance(count_range, (tuple, list)) or len(count_range) != 2:
                raise TypeError(f"count_range must be a tuple of 2 cardinalities, got {count_range}")
            if not count_range[0] <= count_range[1]:
                raise ValueError(f"Invalid count_range {count_range}, min_count must be <= max_count")
            
            self.__related_activity = related_activity
            self.__object_type = object_type
            self.__count_range = count_range
            self.__marker_key = marker_key

        def __repr__(self):
            return f"(a={self.related_activity}, ot={self.object_type}, c={self.count_range}, k={self.marker_key})"

        def __str__(self):
            return self.__repr__()

        def __hash__(self):
            return hash(
                (
                    self.related_activity,
                    self.object_type,
                    self.min_count,
                    self.max_count,
                    self.marker_key,
                )
            )

        def __get_related_activity(self):
            return self.__related_activity

        def __get_object_type(self):
            return self.__object_type

        def __get_count_range(self):
            return self.__count_range

        def __get_min_count(self):
            return self.__count_range[0]

        def __get_max_count(self):
            return self.__count_range[1]

        def __get_marker_key(self):
            return self.__marker_key

        def __set_marker_key(self, marker_key: int):
            self.__marker_key = marker_key

        def __eq__(self, other):
            if isinstance(other, OCCausalNet.Marker):
                return (
                    self.related_activity == other.related_activity
                    and self.object_type == other.object_type
                    and self.min_count == other.min_count
                    and self.max_count == other.max_count
                    and self.marker_key == other.marker_key
                )
            return False

        related_activity = property(__get_related_activity)
        object_type = property(__get_object_type)
        count_range = property(__get_count_range)
        min_count = property(__get_min_count)
        max_count = property(__get_max_count)
        marker_key = property(__get_marker_key, __set_marker_key)

    class MarkerGroup(object):
        """
        Represents a group of markers. A group of markers semantically
        represents the AND gate of all markers in the group.
        """

        def __init__(
            self,
            markers: List["OCCausalNet.Marker"],
            support_count: int = float("inf"),
        ):
            """
            Constructor

            Parameters
            ----------
            markers : List[OCCausalNet.Marker]
                List of markers that comprise the group
            support_count : int
                Frequency of this marker group in the event log. May be used to
                filter infrequent marker groups.
                Default is inf.
            """
            if not (isinstance(markers, list) and len(markers) > 0):
                raise TypeError("markers must be a non-empty list of OCCausalNet.Marker")
            
            self.__markers = markers
            self.__support_count = support_count

        def __repr__(self):
            return f"({self.markers}, count={self.support_count})"

        def __str__(self):
            return self.__repr__()

        def __eq__(self, other):
            if isinstance(other, OCCausalNet.MarkerGroup):
                return (
                    Counter(self.markers) == Counter(other.markers)
                    and self.support_count == other.support_count
                )
            return False

        def __hash__(self):
            return hash(
                (
                    frozenset(self.markers),
                    self.support_count,
                )
            )

        def __get_markers(self):
            return self.__markers

        def __get_support_count(self):
            return self.__support_count

        @cached_property
        def dict_representation(self):
            """
            Returns a dictionary representation of the marker group for
            efficient checking if the marker group can be bound with a
            given set of objects per related activity and object type.
            Is only computed once and cached.
            Is invalid if the marker group is changed after initialization.
            Assumes that the marker group is valid, i.e., there is at most one
            marker per related activity and object type.

            Returns
            -------
            defaultdict[str, defaultdict[str, tuple[int, int]]]
                Dictionary representation of the marker group, mapping
                related activities to objects types to min and max cardinalities.
            """
            result = defaultdict(lambda: defaultdict(lambda: (float("inf"), 0)))
            for marker in self.markers:
                related_activity = marker.related_activity
                object_type = marker.object_type
                result[related_activity][object_type] = (
                    marker.min_count,
                    marker.max_count if marker.max_count != -1 else float("inf"),
                )
            return result

        @cached_property
        def key_constraints(self):
            """
            Returns all tuples (related_activity, object_type, related_activity_2) that
            cannot share objects due to having the same key.
            Is only computed once and cached.
            Is invalid if the marker group is changed after initialization.

            Returns
            -------
            List[Tuple[str, str, str]]
                List of tuples (related_activity, object_type, related_activity_2)
                that cannot share the same marker key.
            """
            # group related activities by (marker_key, object_type)
            grouped = defaultdict(list)
            for marker in self.markers:
                grouped[(marker.marker_key, marker.object_type)].append(
                    marker.related_activity
                )

            # Generate constraints from groups with >= 2 elements
            constraints = []
            for (marker_key, object_type), related_activities in grouped.items():
                if len(related_activities) > 1:
                    for act1, act2 in combinations(related_activities, 2):
                        constraints.append((act1, object_type, act2))

            return constraints

        markers = property(__get_markers)
        support_count = property(__get_support_count)

    def __init__(
        self,
        dependency_graph: nx.MultiDiGraph,
        output_marker_groups: Dict[str, List["OCCausalNet.MarkerGroup"]],
        input_marker_groups: Dict[str, List["OCCausalNet.MarkerGroup"]],
        activity_count: Dict[str, int] = None,
        relative_occurrence_threshold: float = 0,
    ):
        """
        Constructor

        Parameters
        ----------
        dependency_graph : nx.MultiDiGraph
            Object-centric dependency graph
            Arc (a, object_type, a') must be encoded as dg[a][a'][object_type] = {"object_type": object_type}
        output_marker_groups : Dict[str, List[OCCausalNet.MarkerGroup]]
            Output marker groups per activity
        input_marker_groups : Dict[str, List[OCCausalNet.MarkerGroup]]
            Input marker groups per activity
        activity_count : Dict[str, int]
            Activity counts in the event log for filtering of infrequent marker groups.
        relative_occurrence_threshold : float
            Relative threshold for filtering infrequent marker groups. Range is [0,1].
            Default is 0, meaning no filtering.
        """
        if relative_occurrence_threshold < 0 or relative_occurrence_threshold > 1:
            raise ValueError(
                f"relative_occurrence_threshold must be in [0,1], got {relative_occurrence_threshold}"
            )
            
        self.__dependency_graph = dependency_graph
        self.__activities = list(dependency_graph._node.keys())
        for activity in self.__activities:
            if activity not in input_marker_groups:
                input_marker_groups[activity] = []
            if activity not in output_marker_groups:
                output_marker_groups[activity] = []
        if activity_count is None:
            activity_count = {act: 1 for act in self.__activities}
        self.__edges = dependency_graph._succ
    
        self.__relative_occurrence_threshold = relative_occurrence_threshold
        self.__input_marker_groups, self.__output_marker_groups = filter4(
            input_marker_groups,
            output_marker_groups,
            self.__relative_occurrence_threshold,
            activity_count,
        )
        self.__object_types = {
            o.object_type
            for binds in self.__input_marker_groups.values()
            for bs in binds
            for o in bs.markers
        }
        # Make sure a start and end activity exists for each object type
        for ot in self.__object_types:
            start_act = f"START_{ot}"
            end_act = f"END_{ot}"
            assert start_act in self.__activities, f"Missing start activity {start_act} for object type {ot}"
            assert end_act in self.__activities, f"Missing end activity {end_act} for object type {ot}"
        # Assert no other START and END activities are present
        for act in self.__activities:
            if act.startswith("START_"):
                ot = act[len("START_") :]
                assert ot in self.__object_types, f"Unexpected start activity {act} for unknown object type {ot}"
            if act.startswith("END_"):
                ot = act[len("END_") :]
                assert ot in self.__object_types, f"Unexpected end activity {act} for unknown object type {ot}"
        self.__activity_count = activity_count

    def __repr__(self):
        # A OCCN is fully defined by its activities and marker groups
        ret = f"Activities: {self.activities}"
        for act in self.activities:
            img = (
                self.input_marker_groups[act] if act in self.input_marker_groups else []
            )
            ret += f"\nInput_marker_groups[{act}]: {img}\n"
            omg = (
                self.output_marker_groups[act]
                if act in self.output_marker_groups
                else []
            )
            ret += f"Output_marker_groups[{act}]: {omg}"
        return ret

    def __str__(self):
        return self.__repr__()

    def __hash__(self):
        return id(self)

    def __eq__(self, other):
        if isinstance(other, OCCausalNet):
            return (
                set(self.activities) == set(other.activities)
                and set(self.edges) == set(other.edges)
                and all(
                    Counter(self.input_marker_groups.get(a, []))
                    == Counter(other.input_marker_groups.get(a, []))
                    for a in self.activities
                )
                and all(
                    Counter(self.output_marker_groups.get(a, []))
                    == Counter(other.output_marker_groups.get(a, []))
                    for a in self.activities
                )
                and set(self.object_types) == set(other.object_types)
                and all(
                    self.activity_count.get(a, 0) == other.activity_count.get(a, 0)
                    for a in self.activities
                )
                and self.relative_occurrence_threshold
                == other.relative_occurrence_threshold
            )
        return False

    def __get_dependency_graph(self):
        return self.__dependency_graph

    def __get_activities(self):
        return self.__activities

    def __get_edges(self):
        return self.__edges

    def __get_input_marker_groups(self):
        return self.__input_marker_groups

    def __get_output_marker_groups(self):
        return self.__output_marker_groups

    def __get_object_types(self):
        return self.__object_types

    def __get_activity_count(self):
        return self.__activity_count

    def __get_relative_occurrence_threshold(self):
        return self.__relative_occurrence_threshold

    dependency_graph = property(__get_dependency_graph)
    activities = property(__get_activities)
    edges = property(__get_edges)
    input_marker_groups = property(__get_input_marker_groups)
    output_marker_groups = property(__get_output_marker_groups)
    object_types = property(__get_object_types)
    activity_count = property(__get_activity_count)
    relative_occurrence_threshold = property(__get_relative_occurrence_threshold)

    @classmethod
    def from_dict(cls, marker_groups):
        """
        Create an object-centric causal net from a dictionary of marker groups.
        Does not consider activity counts or the relative occurence threshold.
        May mutate the input data.

        Parameters
        ----------
        marker_groups : dict[str, ]
            Dict of marker groups per activity. Syntax:
            ```python
            {
                "activity_name": {
                    # Specify input marker groups (img) and output marker groups (omg)
                    "img": [
                        # Each marker group is a list of markers:
                        [
                            (activity, object_type, (min_count, max_count), marker_key),
                            # max_count = -1 for infinity
                            # marker_key = 0 will assign a unique key automatically
                            ...
                        ],
                        ...
                    ],
                    "omg": [
                        ...
                    ]
                },
                ...
            }
            ```

        Returns
        -------
        OCCausalNet
            Object-centric causal net
        """
        # local import to avoid circular dependencies
        from .factory import create_from_dict

        return create_from_dict(marker_groups)


class OCCausalNetState(defaultdict):
    """
    The state of an object-centric causal net is a mapping from activities `act` to
    multisets (`Counter`) of outstanding obligations `(act2, object_id, object_type)` from `act2` to `act`.

    Example:
    An outstanding obligation from activity `A` to activity `B` for object `o1` of type `order`
    is represented as the tuple `(A, 'o1', 'order')` in the multiset for activity `B`.

    ```python
    state = OCCausalNetState({'B': Counter([('A', 'o1', 'order')])})
    ```

    Supports standard multiset operations: equality, subset (<=), addition (+), subtraction (-), e.g.,
    ```python
    new_state = state + OCCausalNetState({'C': Counter([('B', 'o2', 'item')])})
    ```
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        """Initializes the OCCausalNetState, querying unspecified activities defaults to an empty multiset."""
        super().__init__(Counter)
        data_args = args
        if args and args[0] is Counter:
            data_args = args[1:]
        initial_data = dict(*data_args, **kwargs)
        for act, obligations in initial_data.items():
            self[act] = Counter(obligations)

    def __hash__(self):
        return frozenset(
            (act, frozenset(counter.items()))
            for act, counter in self.items()
            if counter
        ).__hash__()

    def __eq__(self, other):
        if not isinstance(other, OCCausalNetState):
            return False
        return all(
            self.get(a, Counter()) == other.get(a, Counter())
            for a in set(self.keys()) | set(other.keys())
        )

    def __le__(self, other):
        for a, self_counter in self.items():
            other_counter = other.get(a, Counter())
            # Every obligation count in self must be less than or equal to the count in other.
            if not all(
                other_counter.get(pred, 0) >= count
                for pred, count in self_counter.items()
            ):
                return False
        return True

    def __add__(self, other):
        result = OCCausalNetState()
        for a, self_counter in self.items():
            result[a] += self_counter
        for a, other_counter in other.items():
            result[a] += other_counter
        return result

    def __sub__(self, other):
        result = OCCausalNetState()
        for a, self_counter in self.items():
            diff = self_counter - other.get(a, Counter())
            if diff != Counter():
                result[a] = diff
        return result

    def __repr__(self):
        # e.g.  [(a, o1[order], a'), ...]
        sorted_entries = sorted(self.items(), key=lambda item: item[0])
        obligations = [
            f"({a}, {obj_id}[{ot}], {ot}):{count}"
            for (a, obl) in sorted_entries
            for ((a_prime, obj_id, ot), count) in obl
        ]
        return f'[{", ".join(obligations) if obligations else ""}]'

    def __str__(self):
        return self.__repr__()

    def __deepcopy__(self, memodict={}):
        new_state = OCCausalNetState()
        memodict[id(self)] = new_state
        for act, obligations in self.items():
            act_copy = (
                memodict[id(act)] if id(act) in memodict else deepcopy(act, memodict)
            )
            counter_copy = (
                memodict[id(obligations)]
                if id(obligations) in memodict
                else deepcopy(obligations, memodict)
            )
            new_state[act_copy] = counter_copy
        return new_state
    
    def __bool__(self):
        return self.is_empty == False

    @property
    def activities(self) -> Set:
        """
        Set of activities with outstanding obligations.
        """
        return set(act for act in self.keys() if self[act])

    @property
    def is_empty(self) -> bool:
        """
        Whether the state has no outstanding obligations.
        """
        return self.activities == set()
