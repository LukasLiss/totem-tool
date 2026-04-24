import copy
from totem_lib import OCPetriNet, OCMarking, OCPetriNetSemantics
from collections import Counter
from tests.assets.example_ocpns import ocpn_big, ocpn_multi_start, ocpn_muli_variable_2


def test_enabled():

    def assert_enabled_transitions(ocpn, marking, enabled_transitions):
        assert enabled_transitions == OCPetriNetSemantics.enabled_transitions(ocpn, marking)

    ocpn = ocpn_big()
    places = {p.name: p for p in ocpn.places}
    transitions = {t.name: t for t in ocpn.transitions}

    marking1 = OCMarking(
        {places["o1"]: Counter(["order1"]), places["i1"]: Counter(["item1", "item2"])}
    )
    enabled1 = {transitions["po"]}
    assert_enabled_transitions(ocpn, marking1, enabled1)

    marking2 = OCMarking({places["o1"]: Counter(["order1"])})
    enabled2 = {transitions["po"]}
    assert_enabled_transitions(ocpn, marking2, enabled2)

    marking3 = OCMarking({places["i1"]: Counter(["item1"])})
    enabled3 = set()
    assert_enabled_transitions(ocpn, marking3, enabled3)

    marking4 = OCMarking(
        {places["o3"]: Counter(["order1"]), places["i3"]: Counter(["item1", "item2"])}
    )
    enabled4 = {transitions["sr"], transitions["pa"], transitions["sh"]}
    assert_enabled_transitions(ocpn, marking4, enabled4)

    marking5 = OCMarking()
    enabled5 = set()
    assert_enabled_transitions(ocpn, marking5, enabled5)

    marking6 = OCMarking(
        {
            places["o1"]: Counter(["order1"]),
            places["o2"]: Counter(["order1"]),
            places["o3"]: Counter(["order1"]),
            places["o4"]: Counter(["order1"]),
            places["i1"]: Counter(["item1"]),
            places["i2"]: Counter(["item1"]),
            places["i3"]: Counter(["item1"]),
            places["i4"]: Counter(["item1"]),
        }
    )
    enabled6 = set(transitions.values())
    assert_enabled_transitions(ocpn, marking6, enabled6)
    
def test_fire():
    ocpn = ocpn_big()
    places = {p.name: p for p in ocpn.places}
    transitions = {t.name: t for t in ocpn.transitions}

    marking = OCMarking(
        {places["o1"]: Counter(["order1"]), places["i1"]: Counter(["item1", "item2"])}
    )
    objects = {"order": {"order1"}, "item": {"item1", "item2"}}
    new_marking = OCPetriNetSemantics.fire(ocpn, transitions["po"], marking, objects)
    assert new_marking[places["o2"]] == Counter(["order1"])
    assert new_marking[places["i2"]] == Counter(["item1", "item2"])

    marking = OCMarking(
        {places["o1"]: Counter({"order1": 2}), places["i1"]: Counter(["item1", "item2"])}
    )
    objects = {"order": {"order1"}, "item": {"item1", "item2"}}
    new_marking = OCPetriNetSemantics.fire(ocpn, transitions["po"], marking, objects)
    assert new_marking[places["o1"]] == Counter(["order1"])
    assert new_marking[places["o2"]] == Counter(["order1"])
    assert new_marking[places["i2"]] == Counter(["item1", "item2"])
    
    marking = OCMarking(
        {places["o1"]: Counter({"order1": 2}), places["i1"]: Counter(["item1", "item2"])}
    )
    objects = {"order": {"order1"}, "item": {"item1"}}
    new_marking = OCPetriNetSemantics.fire(ocpn, transitions["po"], marking, objects)
    assert new_marking[places["o1"]] == Counter(["order1"])
    assert new_marking[places["o2"]] == Counter(["order1"])
    assert new_marking[places["i1"]] == Counter(["item2"])
    assert new_marking[places["i2"]] == Counter(["item1"])

    marking = OCMarking(
        {places["o1"]: Counter({"order1": 2}), places["i1"]: Counter(["item1", "item2"]), places["i2"]: Counter(["item1"])}
    )
    objects = {"order": {"order1"}, "item": {"item1"}}
    new_marking = OCPetriNetSemantics.fire(ocpn, transitions["po"], marking, objects)
    assert new_marking[places["o1"]] == Counter(["order1"])
    assert new_marking[places["o2"]] == Counter(["order1"])
    assert new_marking[places["i1"]] == Counter(["item2"])
    assert new_marking[places["i2"]] == Counter({"item1": 2})
    
    marking = OCMarking(
        {places["o1"]: Counter(["order1"])}
    )
    objects = {"order": {"order1"}}
    new_marking = OCPetriNetSemantics.fire(ocpn, transitions["po"], marking, objects)
    assert new_marking[places["o1"]] == Counter()
    assert new_marking[places["o2"]] == Counter(["order1"])
    assert new_marking[places["i1"]] == Counter()
    assert new_marking[places["i2"]] == Counter()
    
def test_fire_2():
    ocpn = ocpn_multi_start()
    places = {p.name: p for p in ocpn.places}
    transitions = {t.name: t for t in ocpn.transitions}
    
    marking = OCMarking(
        {places["o1"]: Counter(["order1"]), places["o3"]: Counter(["order1"])}
    )
    objects = {"order": {"order1"}}
    new_marking = OCPetriNetSemantics.fire(ocpn, transitions["a"], marking, objects)
    assert new_marking[places["o1"]] == Counter()
    assert new_marking[places["o3"]] == Counter()
    assert new_marking[places["o2"]] == Counter(["order1"])
    assert new_marking[places["o4"]] == Counter(["order1"])
    
    marking = OCMarking(
        {places["o1"]: Counter(["order1", "order2"]), places["o3"]: Counter(["order1"])}
    )
    objects = {"order": {"order1"}}
    new_marking = OCPetriNetSemantics.fire(ocpn, transitions["a"], marking, objects)
    assert new_marking[places["o1"]] == Counter(["order2"])
    assert new_marking[places["o3"]] == Counter()
    assert new_marking[places["o2"]] == Counter(["order1"])
    assert new_marking[places["o4"]] == Counter(["order1"])


def test_fire_3():
    ocpn = ocpn_muli_variable_2()
    places = {p.name: p for p in ocpn.places}
    transitions = {t.name: t for t in ocpn.transitions}
    
    
    marking = OCMarking(
        {places["p1"]: Counter(["order1", "order2"]), places["p4"]: Counter(["box1", "box2", "box3"])}
    )
    objects = {"order": {"order1", "order2"}, "box": {"box1", "box2"}}
    new_marking = OCPetriNetSemantics.fire(ocpn, transitions["a"], marking, objects)
    assert new_marking[places["p1"]] == Counter()
    assert new_marking[places["p4"]] == Counter(["box3"])
    assert new_marking[places["p2"]] == Counter(["order1", "order2"])
    assert new_marking[places["p5"]] == Counter(["box1", "box2"])
    assert new_marking[places["p6"]] == Counter(["box1", "box2"])

def test_fire_does_not_mutate_input_marking():
    ocpn = ocpn_big()
    places = {p.name: p for p in ocpn.places}
    transitions = {t.name: t for t in ocpn.transitions}
    marking = OCMarking(
        {places["o1"]: Counter(["order1"]), places["i1"]: Counter(["item1"])}
    )
    marking_before = OCMarking(
        {place: counter.copy() for place, counter in marking.items()}
    )

    OCPetriNetSemantics.fire(
        ocpn, transitions["po"], marking, {"order": {"order1"}, "item": {"item1"}}
    )

    assert marking == marking_before

def test_deepcopy_preserves_markings():
    ocpn = ocpn_big()
    copied = copy.deepcopy(ocpn)

    def to_name_counter(marking):
        return {place.name: counter for place, counter in marking.items()}

    assert copied.initial_marking is not None
    assert copied.final_marking is not None
    assert to_name_counter(copied.initial_marking) == to_name_counter(ocpn.initial_marking)
    assert to_name_counter(copied.final_marking) == to_name_counter(ocpn.final_marking)
    assert all(p in copied.places for p in copied.initial_marking.keys())
    assert all(p in copied.places for p in copied.final_marking.keys())
    
def assert_bindings_equal(possible_bindings_iter, expected_bindings):
        # Check that all iterator elements are in the expected bindings
        for binding in possible_bindings_iter:
            assert binding in expected_bindings
            expected_bindings.remove(binding)
        # Assert none are left
        assert len(expected_bindings) == 0

def test_possible_bindings():
    ocpn = ocpn_big()
    places = {p.name: p for p in ocpn.places}
    transitions = {t.name: t for t in ocpn.transitions}
    
    marking = OCMarking(
        {places["o1"]: Counter(["o1", "o2"]), places["i1"]: Counter(["i1", "i2"])}
    )
    
    possible_bindings_iter = OCPetriNetSemantics.get_possible_bindings(ocpn, transitions["po"], marking)
    expected_bindings = [
        {
            "order": {"o1"},
        },
        {
            "order": {"o2"},
        },
        {
            "order": {"o1"},
            "item": {"i1"}
        },
        {
            "order": {"o2"},
            "item": {"i1"}
        },
        {
            "order": {"o1"},
            "item": {"i2"}
        },
        {
            "order": {"o2"},
            "item": {"i2"}
        },
        {
            "order": {"o1"},
            "item": {"i1", "i2"}
        },
        {
            "order": {"o2"},
            "item": {"i1", "i2"}
        }]
    
    
    assert_bindings_equal(possible_bindings_iter, expected_bindings)
    
    
    marking = OCMarking(
        {places["i1"]: Counter(["i1", "i2"])}
    )
    possible_bindings_iter = OCPetriNetSemantics.get_possible_bindings(ocpn, transitions["po"], marking)
    expected_bindings = []
    assert_bindings_equal(possible_bindings_iter, expected_bindings)
    
    
    marking = OCMarking(
        {places["o1"]: Counter(["o1", "o2"])}
    )
    possible_bindings_iter = OCPetriNetSemantics.get_possible_bindings(ocpn, transitions["po"], marking)
    expected_bindings = [
        {
            "order": {"o1"},
        },
        {
            "order": {"o2"},
        },]
    assert_bindings_equal(possible_bindings_iter, expected_bindings)
    
    marking = OCMarking(
        {places["o1"]: Counter(["o1", "o2"])}
    )
    possible_bindings_iter = OCPetriNetSemantics.get_possible_bindings(ocpn, transitions["si"], marking)
    expected_bindings = []
    assert_bindings_equal(possible_bindings_iter, expected_bindings)
    
    
    marking = OCMarking(
        {places["o2"]: Counter(["o1"]), places["o3"]: Counter(["o1", "o2"])}
    )
    possible_bindings_iter = OCPetriNetSemantics.get_possible_bindings(ocpn, transitions["si"], marking)
    expected_bindings = [
        {
            "order": {"o1"},
        }]
    assert_bindings_equal(possible_bindings_iter, expected_bindings)
    
    
    
    
    
    
    
    
def test_possible_bindings_2():
    ocpn = ocpn_muli_variable_2()
    places = {p.name: p for p in ocpn.places}
    transitions = {t.name: t for t in ocpn.transitions}
    
    marking = OCMarking(
        {places["p1"]: Counter(["o1"]), places["p4"]: Counter(["b1", "b2"])}
    )
    possible_bindings_iter = OCPetriNetSemantics.get_possible_bindings(ocpn, transitions["a"], marking)
    expected_bindings = [
        {
            "box": {"b1"},
        },
        {
            "box": {"b2"},
        },
        {
            "box": {"b1", "b2"},
        },
        {
            "order": {"o1"},
        },
        {
            "order": {"o1"},
            "box": {"b1"},
        },
        {
            "order": {"o1"},
            "box": {"b2"},
        },
        {
            "order": {"o1"},
            "box": {"b1", "b2"},
        },
        ]
    assert_bindings_equal(possible_bindings_iter, expected_bindings)
    
    
def test_possible_bindings_3():
    ocpn = ocpn_multi_start()
    places = {p.name: p for p in ocpn.places}
    transitions = {t.name: t for t in ocpn.transitions}
    
    marking = OCMarking(
        {places["o1"]: Counter(["o1"])}
    )
    possible_bindings_iter = OCPetriNetSemantics.get_possible_bindings(ocpn, transitions["a"], marking)
    expected_bindings = [
    ]
    assert_bindings_equal(possible_bindings_iter, expected_bindings)
    
    
    marking = OCMarking(
        {places["o1"]: Counter(["o1"]), places["o3"]: Counter(["o2"])}
    )
    possible_bindings_iter = OCPetriNetSemantics.get_possible_bindings(ocpn, transitions["a"], marking)
    expected_bindings = [
    ]
    assert_bindings_equal(possible_bindings_iter, expected_bindings)
    
    marking = OCMarking(
        {places["o1"]: Counter(["o1"]), places["o3"]: Counter(["o1", "o2"])}
    )
    possible_bindings_iter = OCPetriNetSemantics.get_possible_bindings(ocpn, transitions["a"], marking)
    expected_bindings = [
        {
            "order": {"o1"}
        }
    ]
    assert_bindings_equal(possible_bindings_iter, expected_bindings)
    
    marking = OCMarking(
        {places["o1"]: Counter(["o1", "o2"]), places["o3"]: Counter(["o1", "o2"])}
    )
    possible_bindings_iter = OCPetriNetSemantics.get_possible_bindings(ocpn, transitions["a"], marking)
    expected_bindings = [
        {
            "order": {"o1"}
        },
        {
            "order": {"o2"}
        }
    ]
    assert_bindings_equal(possible_bindings_iter, expected_bindings)