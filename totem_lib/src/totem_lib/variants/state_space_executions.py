"""State-space executions: connected components with their full linearized traces.

A *state-space execution* is one connected component of the object co-occurrence
graph (objects are connected when they share an event), together with its
timestamp-linearized event trace of ``(activity, objects)`` pairs and its
object-type structure signature.

This is deliberately distinct from ``Variant.executions`` (in ``ocvariants.py``),
which are *grouped* lists of bare event ids: those identify which events belong to
a case but carry no activity/object content, so they cannot train the advanced
simulation's state space.
"""

import itertools
from collections import Counter, defaultdict

import networkx as nx


class StateSpaceExecution:
    """One connected component: its object structure plus its linearized trace.

    Attributes:
        object_types: Mapping ``{object_id: object_type}`` of the component's
            objects.
        signature: The structure signature — the sorted object-type multiset
            ``((type, count), ...)`` — used to cluster components (e.g. for the
            simulation's arrival distribution).
        events: ``[(activity, (object_id, ...)), ...]`` in linearized
            (timestamp, event_id) order.
    """

    def __init__(self, object_types, signature, events):
        self.object_types = object_types
        self.signature = signature
        self.events = events

    @property
    def activity_sequence(self):
        """The linearized activity sequence of the execution."""
        return [activity for activity, _ in self.events]


def structure_signature(object_types):
    """Sorted object-type multiset of a component"""
    counts = Counter(t for t in object_types.values() if t is not None)
    return tuple(sorted(counts.items()))


def extract_state_space_executions(ocel):
    """Extract the connected components of ``ocel`` as state-space executions.

    Objects are connected when they co-occur in an event; 
    each connected component is one execution.
    
    Args:
        ocel: The (typically process-area-filtered) ObjectCentricEventLog.

    Returns:
        A list of ``StateSpaceExecution`` records, one per connected component.
    """
    object_graph = nx.Graph()
    object_to_events = defaultdict(list)
    event_info = {}

    for row in ocel.events.select(
        ["_eventId", "_activity", "_timestampUnix", "_objects"]
    ).iter_rows(named=True):
        eid = row["_eventId"]
        objects = row["_objects"] or []
        ts = int(row["_timestampUnix"]) if row["_timestampUnix"] is not None else 0
        event_info[eid] = (row["_activity"], ts, objects)
        for oid in objects:
            if not object_graph.has_node(oid):
                object_graph.add_node(oid)
            object_to_events[oid].append(eid)
        for u, v in itertools.combinations(objects, 2):
            object_graph.add_edge(u, v)

    obj_type_map = ocel.obj_type_map
    executions = []
    for component in nx.connected_components(object_graph):
        event_ids = set()
        for oid in component:
            event_ids.update(object_to_events[oid])
        ordered = sorted(event_ids, key=lambda e: (event_info[e][1], e))
        events = [(event_info[e][0], tuple(event_info[e][2])) for e in ordered]
        object_types = {oid: obj_type_map.get(oid) for oid in component}
        executions.append(
            StateSpaceExecution(object_types, structure_signature(object_types), events)
        )
    return executions
