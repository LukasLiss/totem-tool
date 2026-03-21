import polars as pl

from totem_lib.ocel.ocel import ObjectCentricEventLog
from totem_lib.variants.ocvariants import find_object_variants_connected_component


def make_ocel(events, objects):
    return ObjectCentricEventLog(
        events=pl.DataFrame(events),
        objects=pl.DataFrame(objects),
    )


def _event(eid, activity, t, objects):
    return {
        "_eventId": eid,
        "_activity": activity,
        "_timestampUnix": t,
        "_objects": objects,
        "_qualifiers": [],
        "_attributes": "",
    }


def _object(oid, otype):
    return {"_objId": oid, "_objType": otype, "_targetObjects": [], "_qualifiers": []}


def test_two_identical_components_one_variant():
    """
    Object-Graph
    Component A (o1, o2)
    Component B (o3, o4) 
    Both follow the same event sequence Pick→Pack with the same object types.
    Should yield one variant with support = 2.
    """
    events = [
        _event("e1", "Pick", 1, ["o1", "o2"]),
        _event("e2", "Pack", 2, ["o1", "o2"]),
        _event("e3", "Pick", 3, ["o3", "o4"]),
        _event("e4", "Pack", 4, ["o3", "o4"]),
    ]
    objects = [_object(f"o{i}", "Box") for i in range(1, 5)]

    variants = find_object_variants_connected_component(make_ocel(events, objects))

    assert len(variants) == 1
    assert variants[0].support == 2


def test_two_different_components_two_variants():
    """
    Component A follows Pick→Pack
    Component B follows Pick→Ship.
    Should yield two variants with support = 1 each.
    """
    events = [
        _event("e1", "Pick", 1, ["o1", "o2"]),
        _event("e2", "Pack", 2, ["o1", "o2"]),
        _event("e3", "Pick", 3, ["o3", "o4"]),
        _event("e4", "Ship", 4, ["o3", "o4"]),
    ]
    objects = [_object(f"o{i}", "Box") for i in range(1, 5)]

    variants = find_object_variants_connected_component(make_ocel(events, objects))

    assert len(variants) == 2
    assert sorted(v.support for v in variants) == [1, 1]


def test_three_components_two_identical_one_different():
    """
    C1 and C2: Pick→Pack
    C3: Pick→Ship 
    Should yield two variants: one with support 2, one with support 1.
    """
    events = [
        _event("e1", "Pick", 1, ["o1", "o2"]),
        _event("e2", "Pack", 2, ["o1", "o2"]),
        _event("e3", "Pick", 3, ["o3", "o4"]),
        _event("e4", "Pack", 4, ["o3", "o4"]),
        _event("e5", "Pick", 5, ["o5", "o6"]),
        _event("e6", "Ship", 6, ["o5", "o6"]),
    ]
    objects = [_object(f"o{i}", "Box") for i in range(1, 7)]

    variants = find_object_variants_connected_component(make_ocel(events, objects))

    assert len(variants) == 2
    supports = sorted(v.support for v in variants)
    assert supports == [1, 2]
    # The Pick→Pack variant is the most frequent, therefore first
    assert variants[0].support == 2


def test_shared_object_results_in_one_component():
    """
    o_truck appears in both events
    Therefore should yield one connected component
    """
    events = [
        _event("e1", "Pick", 1, ["o1", "o_truck"]),
        _event("e2", "Pick", 2, ["o2", "o_truck"]),
    ]
    objects = [
        _object("o1",     "Box"),
        _object("o2",     "Box"),
        _object("o_truck","Truck"),
    ]

    variants = find_object_variants_connected_component(make_ocel(events, objects))

    assert len(variants) == 1
    assert variants[0].support == 1

    
def test_transitive_component_connection_results_in_one_component():
    """
    Components are transitively connected.
    Therefore should yield one connected component
    """
    events = [
        _event("e1", "Pick", 1, ["o1"]),
        _event("e2", "Connect_1_2", 2, ["o1", "o2"]),
        _event("e3", "Pick", 3, ["o2"]),
        _event("e4", "Connect_2_3", 4, ["o2", "o3"]),
        _event("e5", "Pick", 5, ["o3"]),
    ]

    objects = [
        _object("o1", "Box"),
        _object("o2", "Box"),
        _object("o3", "Box"),
    ]

    variants = find_object_variants_connected_component(make_ocel(events, objects))

    assert len(variants) == 1
    assert variants[0].support == 1


def test_isolated_node():
    """
    Isolated node, should result in own variant.
    Therefore should yield one connected component
    """
    events = [
        _event("e1", "Pick", 1, ["o1"]),
        _event("e2", "Connect_1_2", 2, ["o1", "o2"]),
        _event("e3", "Pick", 3, ["o4"]),
        _event("e4", "Connect_1_2", 4, ["o4", "o5"]),
        _event("e5", "Pick", 5, ["o3"]),
    ]

    objects = [
        _object("o1", "Box"),
        _object("o2", "Box"),
        _object("o3", "Box"),
        _object("o4", "Box"),
        _object("o5", "Box"),
    ]

    variants = find_object_variants_connected_component(make_ocel(events, objects))

    assert len(variants) == 2
    assert variants[0].support == 2
    assert variants[1].support == 1
    assert len(list(variants[1].graph.nodes)) == 1


def test_process_execution_contains_correct_events():
    """
    Check that the process Executions contain the correct events.
    """
    events = [
        _event("e1", "Pick", 1, ["o1", "o2"]),
        _event("e2", "Pack", 2, ["o1", "o2"]),
        _event("e3", "Pick", 3, ["o3", "o4"]),
        _event("e4", "Pack", 4, ["o3", "o4"]),
    ]
    objects = [_object(f"o{i}", "Box") for i in range(1, 5)]

    variants = find_object_variants_connected_component(make_ocel(events, objects))

    # One variant, two executions
    assert len(variants) == 1
    assert variants[0].support == 2

    all_execution_event_sets = [set(ex) for ex in variants[0].executions]
    assert {"e1", "e2"} in all_execution_event_sets
    assert {"e3", "e4"} in all_execution_event_sets



def test_bigger_example():
    """
    Test bigger example
    Should yield one variant with support = 2.
    """
    events = [
        # Component A
        _event("a1", "Collect",   1,  ["box1"]),
        _event("a2", "Load",      2,  ["box1", "truck1"]),
        _event("a3", "Transport", 3,  ["truck1"]),
        _event("a4", "Unload",    4,  ["box1", "truck1"]),
        _event("a5", "Deliver",   5,  ["box1"]),
        # Component B
        _event("b1", "Collect",   6,  ["box2"]),
        _event("b2", "Load",      7,  ["box2", "truck2"]),
        _event("b3", "Transport", 8,  ["truck2"]),
        _event("b4", "Unload",    9,  ["box2", "truck2"]),
        _event("b5", "Deliver",   10, ["box2"]),
    ]
    objects = [
        _object("box1",  "Box"),   _object("truck1", "Truck"),
        _object("box2",  "Box"),   _object("truck2", "Truck"),
    ]

    variants = find_object_variants_connected_component(make_ocel(events, objects))

    assert len(variants) == 1
    assert variants[0].support == 2


def test_bigger_example_two_variants():
    """
    Bigger example, that should yield two variants with support 1.
    """
    events = [
        _event("a1", "Collect",   1,  ["box1"]),
        _event("a2", "Load",      2,  ["box1", "truck1"]),
        _event("a3", "Transport", 3,  ["truck1"]),
        _event("a4", "Unload",    4,  ["box1", "truck1"]),
        _event("a5", "Deliver",   5,  ["box1"]),

        _event("b1", "Collect",   6,  ["box2"]),
        _event("b2", "Load",      7,  ["box2", "truck2"]),
        _event("b3", "Transport", 8,  ["truck2"]),
        _event("b4", "Unload",    9,  ["box2", "truck2"]),
        _event("b5", "Return",    10, ["box2"]),   # ← differs
    ]
    objects = [
        _object("box1",  "Box"),   _object("truck1", "Truck"),
        _object("box2",  "Box"),   _object("truck2", "Truck"),
    ]

    variants = find_object_variants_connected_component(make_ocel(events, objects))

    assert len(variants) == 2
    assert sorted(v.support for v in variants) == [1, 1]



def test_normalization():
    """
    Activities with underscore ('Pick_1', 'Pick_2') normalize
    to the same base label ('Pick')
    Should yield one variant with support = 2.
     """
    events = [
        _event("e1", "Pick_1", 1, ["o1", "o2"]),
        _event("e2", "Pack_1", 2, ["o1", "o2"]),
        _event("e3", "Pick_2", 3, ["o3", "o4"]),
        _event("e4", "Pack_2", 4, ["o3", "o4"]),
    ]
    objects = [_object(f"o{i}", "Box") for i in range(1, 5)]

    variants = find_object_variants_connected_component(make_ocel(events, objects))

    assert len(variants) == 1
    assert variants[0].support == 2