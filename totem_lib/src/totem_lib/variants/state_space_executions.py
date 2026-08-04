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
            ``((type, count), ...)``.
        events: ``[(activity, (object_id, ...)), ...]`` in linearized
            (timestamp, event_id) order.
        event_ids: The component's event ids in the same linearized order, so the
            per-variant statistics (arrival, resource demand, constraints) can be
            computed from the log exactly as for the simple-mode variants.
        object_graph: The component's typed object co-occurrence subgraph (nodes =
            objects with a ``type`` attribute, edges = "shared an event"). This is
            the relational skeleton (which Item belongs to which Order); the
            simulation clones it so participant selection can stay within one
            interaction cluster.
        structure_key: An isomorphism-invariant hash of ``object_graph`` (typed) —
            used to cluster components for the arrival distribution, so
            structurally-different pools are distinct arrival units.
    """

    def __init__(
        self, object_types, signature, events, event_ids, object_graph, structure_key
    ):
        self.object_types = object_types
        self.signature = signature
        self.events = events
        self.event_ids = event_ids
        self.object_graph = object_graph
        self.structure_key = structure_key

    @property
    def activity_sequence(self):
        """The linearized activity sequence of the execution."""
        return [activity for activity, _ in self.events]


def structure_signature(object_types):
    """Sorted object-type multiset of a component"""
    counts = Counter(t for t in object_types.values() if t is not None)
    return tuple(sorted(counts.items()))


def structure_key(object_graph):
    """Isomorphism-invariant key of a typed object graph (for arrival clustering)."""
    return nx.weisfeiler_lehman_graph_hash(object_graph, node_attr="type")


def extract_state_space_executions(ocel):
    """Extract the connected components of ``ocel`` as state-space executions.

    Objects are connected when they co-occur in an event;
    each connected component is one execution.

    Args:
        ocel: The (typically process-area-filtered) ObjectCentricEventLog.

    Returns:
        A list of ``StateSpaceExecution`` records, one per connected component.
    """
    obj_type_map = ocel.obj_type_map
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
                object_graph.add_node(oid, type=obj_type_map.get(oid))
            object_to_events[oid].append(eid)
        for u, v in itertools.combinations(objects, 2):
            object_graph.add_edge(u, v)

    executions = []
    for component in nx.connected_components(object_graph):
        event_ids = set()
        for oid in component:
            event_ids.update(object_to_events[oid])
        ordered = sorted(event_ids, key=lambda e: (event_info[e][1], e))
        events = [(event_info[e][0], tuple(event_info[e][2])) for e in ordered]
        object_types = {oid: obj_type_map.get(oid) for oid in component}
        subgraph = object_graph.subgraph(component).copy()
        executions.append(
            StateSpaceExecution(
                object_types,
                structure_signature(object_types),
                events,
                list(ordered),
                subgraph,
                structure_key(subgraph),
            )
        )
    return executions


class ObjectStructureVariant:
    """One object connected-component structure as a simulation arrival unit.

    The advanced-simulation analogue of the simple mode's ``Variant``: where a
    simple-mode variant groups executions by their control-flow signature, an
    ``ObjectStructureVariant`` groups connected components by their **object
    structure** (isomorphism of the typed object graph). It is the unit the
    advanced simulation arrives, mines resource demand/constraints, and clones a
    skeleton from — everything the simple mode keyed on the variant, the advanced
    mode keys on this.

    It is deliberately duck-type compatible with ``Variant`` for the per-variant
    statistics: ``id``/``support``/``executions`` mean the same, so
    ``variant_arrival_distribution``, ``resource_distribution_of_variants`` and
    ``generate_resource_constraints`` consume it unchanged.

    Attributes:
        id: The ``structure_key`` (isomorphism-invariant hash) of the structure.
        support: Number of connected components observed with this structure.
        executions: ``[[event_id, ...], ...]`` — one linearized event-id list per
            component, as the per-variant statistics expect.
        object_graph: A representative typed object skeleton (nodes carry ``type``,
            edges carry the object relations) cloned on instantiation.
        signature: The object-type multiset ``((type, count), ...)`` (for display).
    """

    def __init__(self, id, support, executions, object_graph, signature):
        self.id = id
        self.support = support
        self.executions = executions
        self.object_graph = object_graph
        self.signature = signature

    def __iter__(self):
        return iter(self.executions)

    def __repr__(self):
        return f"<ObjectStructureVariant {self.signature}, support={self.support}>"

    def instantiate(self, instance_id):
        """Clone the representative skeleton with fresh object ids.

        Returns a typed ``nx.Graph`` (nodes carry ``type``, edges carry the object
        relations) with ids ``f"{type}_inst{instance_id}_{index}"`` — so
        participant selection can stay within one interaction cluster.
        """
        template = self.object_graph
        mapping = {}
        graph = nx.Graph()
        for index, node in enumerate(sorted(template.nodes())):
            obj_type = template.nodes[node].get("type")
            new_id = f"{obj_type}_inst{instance_id}_{index}"
            mapping[node] = new_id
            graph.add_node(new_id, type=obj_type)
        for u, v in template.edges():
            graph.add_edge(mapping[u], mapping[v])
        return graph


def find_object_structure_variants(ocel):
    """Discover the object-structure variants of ``ocel`` (advanced-sim arrival units).

    Groups the connected components (via :func:`extract_state_space_executions`)
    by their isomorphism-invariant ``structure_key`` and wraps each cluster in an
    :class:`ObjectStructureVariant`. This is the advanced-mode counterpart of
    ``find_object_variants_connected_component`` — computed once, up front, and
    then fed to the same per-variant model-building statistics.

    Args:
        ocel: The (typically process-area-filtered) ObjectCentricEventLog.

    Returns:
        A list of ``ObjectStructureVariant``, sorted by descending support.
    """
    grouped = defaultdict(list)
    for execution in extract_state_space_executions(ocel):
        grouped[execution.structure_key].append(execution)

    variants = [
        ObjectStructureVariant(
            id=key,
            support=len(group),
            executions=[execution.event_ids for execution in group],
            object_graph=group[0].object_graph,
            signature=group[0].signature,
        )
        for key, group in grouped.items()
    ]
    variants.sort(key=lambda v: v.support, reverse=True)
    return variants
