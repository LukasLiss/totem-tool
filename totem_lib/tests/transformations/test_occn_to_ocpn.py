from totem_lib import OCCausalNet, OCPetriNet, occn_to_ocpn
import networkx as nx
import re

def test_conversion_basic():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, 1), 0)],
            ],
            "omg": [
                [("END_order", "order", (1, 1), 0)],
            ],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    print("\n================TEST OCCN CONVERSION BASIC================")
    print("OCCN:")
    print(occn)
    ocpn = occn_to_ocpn(occn)
    print(ocpn)

    # Expected OCPN:

    # ---------------------------------------------------------------------
    # Places
    # ---------------------------------------------------------------------
    order_place_names = [
        "p_END_order_i_order",
        "p_END_order_o_order",
        "p_START_order_i_order",
        "p_START_order_o_order",
        "p_a_i_order",
        "p_a_o_order",
        "p_arc(START_order,a)_order",
        "p_arc(a,END_order)_order",
    ]

    binding_place_names = [
        "p_binding#END_order_input",
        "p_binding#START_order_output",
        "p_binding#a_input",
        "p_binding#a_output",
        "p_binding_global_input",
    ]

    places = {}
    for name in order_place_names:
        places[name] = OCPetriNet.Place(name, "order")
    for name in binding_place_names:
        places[name] = OCPetriNet.Place(name, "_binding")

    # ---------------------------------------------------------------------
    # Transitions
    # ---------------------------------------------------------------------
    transitions = {
        "END_order": OCPetriNet.Transition("END_order", "END_order"),
        "START_order": OCPetriNet.Transition("START_order", "START_order"),
        "a": OCPetriNet.Transition("a", "a"),
    }
    for n in [26, 29, 32, 35]:
        t_name = f"_silent#{n}"
        transitions[t_name] = OCPetriNet.Transition(t_name, None)

    # ---------------------------------------------------------------------
    # Arcs
    # ---------------------------------------------------------------------
    arcs = []

    # transition ➜ place ---------------------------------------------------
    connect(transitions["END_order"], places["p_END_order_o_order"], "order", arcs)
    connect(
        transitions["END_order"], places["p_binding_global_input"], "_binding", arcs
    )

    connect(
        transitions["START_order"], places["p_START_order_o_order"], "order", arcs
    )
    connect(
        transitions["START_order"],
        places["p_binding#START_order_output"],
        "_binding",
        arcs,
    )

    connect(transitions["_silent#26"], places["p_a_i_order"], "order", arcs)
    connect(
        transitions["_silent#26"], places["p_binding#a_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#29"], places["p_arc(a,END_order)_order"], "order", arcs
    )
    connect(
        transitions["_silent#29"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#32"],
        places["p_arc(START_order,a)_order"],
        "order",
        arcs,
    )
    connect(
        transitions["_silent#32"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(transitions["_silent#35"], places["p_END_order_i_order"], "order", arcs)
    connect(
        transitions["_silent#35"],
        places["p_binding#END_order_input"],
        "_binding",
        arcs,
    )

    connect(transitions["a"], places["p_a_o_order"], "order", arcs)
    connect(transitions["a"], places["p_binding#a_output"], "_binding", arcs)

    # place ➜ transition ---------------------------------------------------
    connect(places["p_END_order_i_order"], transitions["END_order"], "order", arcs)
    connect(
        places["p_START_order_i_order"], transitions["START_order"], "order", arcs
    )

    connect(
        places["p_START_order_o_order"], transitions["_silent#32"], "order", arcs
    )
    connect(places["p_a_i_order"], transitions["a"], "order", arcs)
    connect(places["p_a_o_order"], transitions["_silent#29"], "order", arcs)
    connect(
        places["p_arc(START_order,a)_order"],
        transitions["_silent#26"],
        "order",
        arcs,
    )
    connect(
        places["p_arc(a,END_order)_order"], transitions["_silent#35"], "order", arcs
    )

    connect(
        places["p_binding#END_order_input"],
        transitions["END_order"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#START_order_output"],
        transitions["_silent#32"],
        "_binding",
        arcs,
    )

    connect(places["p_binding#a_input"], transitions["a"], "_binding", arcs)
    connect(
        places["p_binding#a_output"], transitions["_silent#29"], "_binding", arcs
    )

    for tgt in ["START_order", "_silent#26", "_silent#35"]:
        connect(
            places["p_binding_global_input"], transitions[tgt], "_binding", arcs
        )

    # ---------------------------------------------------------------------
    # Assemble the net
    # ---------------------------------------------------------------------
    ocpn_expected = OCPetriNet(
        name="Expected OCPN Basic",
        places=list(places.values()),
        transitions=list(transitions.values()),
        arcs=arcs,
        initial_marking=None,
        final_marking=None,
    )

    print(ocpn_expected)
    assert (are_ocpn_equal_no_ids(ocpn, ocpn_expected))

def test_conversion_multi():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, -1), 0)],
            ],
            "omg": [
                [("END_order", "order", (1, -1), 0)],
            ],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, -1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    print("\nTEST OCCN CONVERSION MULTI")
    print(occn)
    ocpn = occn_to_ocpn(occn)
    print(ocpn)

    # Expected OCPN:
    # ---------------------------------------------------------------------
    # Places
    # ---------------------------------------------------------------------
    order_place_names = [
        "p_END_order_i_order",
        "p_END_order_o_order",
        "p_START_order_i_order",
        "p_START_order_o_order",
        "p_a_i_order",
        "p_a_o_order",
        "p_arc(START_order,a)_order",
        "p_arc(a,END_order)_order",
    ]

    binding_place_names = [
        "p_binding#END_order_input",
        "p_binding#START_order_output",
        "p_binding#a_input",
        "p_binding#a_output",
        "p_binding_global_input",
    ]

    places = {n: OCPetriNet.Place(n, "order") for n in order_place_names}
    places.update({n: OCPetriNet.Place(n, "_binding") for n in binding_place_names})

    # ---------------------------------------------------------------------
    # Transitions
    # ---------------------------------------------------------------------
    transitions = {
        "END_order": OCPetriNet.Transition("END_order", "END_order"),
        "START_order": OCPetriNet.Transition("START_order", "START_order"),
        "a": OCPetriNet.Transition("a", "a"),
    }
    for num in [143, 146, 149, 152]:
        t = f"_silent#{num}"
        transitions[t] = OCPetriNet.Transition(t, None)

    # ---------------------------------------------------------------------
    # Arcs
    # ---------------------------------------------------------------------
    arcs = []

    # transition ➜ place
    connect(
        transitions["END_order"],
        places["p_END_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["END_order"], places["p_binding_global_input"], "_binding", arcs
    )

    connect(
        transitions["START_order"],
        places["p_START_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["START_order"],
        places["p_binding#START_order_output"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#143"],
        places["p_a_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#143"], places["p_binding#a_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#146"],
        places["p_arc(a,END_order)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#146"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#149"],
        places["p_arc(START_order,a)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#149"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#152"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#152"],
        places["p_binding#END_order_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["a"], places["p_a_o_order"], "order", arcs, is_variable=True
    )
    connect(transitions["a"], places["p_binding#a_output"], "_binding", arcs)

    # place ➜ transition
    connect(
        places["p_END_order_i_order"],
        transitions["END_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_START_order_i_order"],
        transitions["START_order"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_START_order_o_order"],
        transitions["_silent#149"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_a_i_order"], transitions["a"], "order", arcs, is_variable=True
    )
    connect(
        places["p_a_o_order"],
        transitions["_silent#146"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_arc(START_order,a)_order"],
        transitions["_silent#143"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#152"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_binding#END_order_input"],
        transitions["END_order"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#START_order_output"],
        transitions["_silent#149"],
        "_binding",
        arcs,
    )
    connect(places["p_binding#a_input"], transitions["a"], "_binding", arcs)
    connect(
        places["p_binding#a_output"], transitions["_silent#146"], "_binding", arcs
    )

    for tgt in ["START_order", "_silent#143", "_silent#152"]:
        connect(
            places["p_binding_global_input"], transitions[tgt], "_binding", arcs
        )

    # ---------------------------------------------------------------------
    # Assemble the net
    # ---------------------------------------------------------------------
    ocpn_expected = OCPetriNet(
        name="Expected OCPN",
        places=list(places.values()),
        transitions=list(transitions.values()),
        arcs=arcs,
        initial_marking=None,
        final_marking=None,
    )

    print(ocpn_expected)
    assert (are_ocpn_equal_no_ids(ocpn, ocpn_expected))

def test_conversion_combined():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, 1), 0)],
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, 1), 0)],
            ],
            "omg": [
                [("END_order", "order", (1, 1), 0)],
            ],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, 1), 0)],
                [("a", "order", (1, -1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    print("\nTEST OCCN CONVERSION COMBINED")
    print(occn)
    ocpn = occn_to_ocpn(occn)
    print(ocpn)

    # Expected OCPN:
    # ---------------------------------------------------------------------
    # Places
    # ---------------------------------------------------------------------
    order_place_names = [
        "p_END_order_i_order",
        "p_END_order_o_order",
        "p_START_order_i_order",
        "p_START_order_o_order",
        "p_a_i_order",
        "p_a_o_order",
        "p_arc(START_order,a)_order",
        "p_arc(a,END_order)_order",
    ]

    binding_place_names = [
        "p_binding#END_order_input",
        "p_binding#START_order_output",
        "p_binding#a_input",
        "p_binding#a_output",
        "p_binding_global_input",
    ]

    places = {}
    for n in order_place_names:
        places[n] = OCPetriNet.Place(n, "order")
    for n in binding_place_names:
        places[n] = OCPetriNet.Place(n, "_binding")

    # ---------------------------------------------------------------------
    # Transitions
    # ---------------------------------------------------------------------
    transitions = {
        "END_order": OCPetriNet.Transition("END_order", "END_order"),
        "START_order": OCPetriNet.Transition("START_order", "START_order"),
        "a": OCPetriNet.Transition("a", "a"),
    }
    for num in [38, 41, 44, 47, 50, 53]:
        t = f"_silent#{num}"
        transitions[t] = OCPetriNet.Transition(t, None)

    # ---------------------------------------------------------------------
    # Arcs
    # ---------------------------------------------------------------------
    arcs = []

    # transition ➜ place
    connect(
        transitions["END_order"],
        places["p_END_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["END_order"], places["p_binding_global_input"], "_binding", arcs
    )

    connect(
        transitions["START_order"],
        places["p_START_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["START_order"],
        places["p_binding#START_order_output"],
        "_binding",
        arcs,
    )

    connect(transitions["_silent#38"], places["p_a_i_order"], "order", arcs)
    connect(
        transitions["_silent#38"], places["p_binding#a_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#41"], places["p_arc(a,END_order)_order"], "order", arcs
    )
    connect(
        transitions["_silent#41"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#44"],
        places["p_arc(START_order,a)_order"],
        "order",
        arcs,
    )
    connect(
        transitions["_silent#44"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#47"],
        places["p_arc(START_order,a)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#47"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(transitions["_silent#50"], places["p_END_order_i_order"], "order", arcs)
    connect(
        transitions["_silent#50"],
        places["p_binding#END_order_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#53"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#53"],
        places["p_binding#END_order_input"],
        "_binding",
        arcs,
    )

    connect(transitions["a"], places["p_a_o_order"], "order", arcs)
    connect(transitions["a"], places["p_binding#a_output"], "_binding", arcs)

    # place ➜ transition
    connect(
        places["p_END_order_i_order"],
        transitions["END_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_START_order_i_order"],
        transitions["START_order"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_START_order_o_order"], transitions["_silent#44"], "order", arcs
    )
    connect(
        places["p_START_order_o_order"],
        transitions["_silent#47"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(places["p_a_i_order"], transitions["a"], "order", arcs)
    connect(places["p_a_o_order"], transitions["_silent#41"], "order", arcs)

    connect(
        places["p_arc(START_order,a)_order"],
        transitions["_silent#38"],
        "order",
        arcs,
    )
    connect(
        places["p_arc(a,END_order)_order"], transitions["_silent#50"], "order", arcs
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#53"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_binding#END_order_input"],
        transitions["END_order"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#START_order_output"],
        transitions["_silent#44"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#START_order_output"],
        transitions["_silent#47"],
        "_binding",
        arcs,
    )

    connect(places["p_binding#a_input"], transitions["a"], "_binding", arcs)
    connect(
        places["p_binding#a_output"], transitions["_silent#41"], "_binding", arcs
    )

    for tgt in ["START_order", "_silent#38", "_silent#50", "_silent#53"]:
        connect(
            places["p_binding_global_input"], transitions[tgt], "_binding", arcs
        )

    # ---------------------------------------------------------------------
    # Assemble the net
    # ---------------------------------------------------------------------
    ocpn_expected = OCPetriNet(
        name="Expected OCPN",
        places=list(places.values()),
        transitions=list(transitions.values()),
        arcs=arcs,
        initial_marking=None,
        final_marking=None,
    )

    print(ocpn_expected)
    assert (are_ocpn_equal_no_ids(ocpn, ocpn_expected))

def test_conversion_multi_marker():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (2, 2), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                    ("b", "order", (1, 1), 0),
                ],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, 1), 0)],
                [("b", "order", (1, 1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    print("\nTEST OCCN CONVERSION MULTI MARKER")
    print(occn)
    ocpn = occn_to_ocpn(occn)
    print(ocpn)

    # Excpected OCPN:
    # ---------------------------------------------------------------------
    # Places
    # ---------------------------------------------------------------------
    order_place_names = [
        "p_END_order_i_order",
        "p_END_order_o_order",
        "p_START_order_i_order",
        "p_START_order_o_order",
        "p_a_i_order",
        "p_a_o_order",
        "p_arc(START_order,a)_order",
        "p_arc(a,END_order)_order",
        "p_arc(a,b)_order",
        "p_arc(b,END_order)_order",
        "p_b_i_order",
        "p_b_o_order",
    ]

    binding_place_names = [
        "p_binding#230_1",
        "p_binding#END_order_input",
        "p_binding#START_order_output",
        "p_binding#a_input",
        "p_binding#a_output",
        "p_binding#b_input",
        "p_binding#b_output",
        "p_binding_global_input",
    ]

    places = {n: OCPetriNet.Place(n, "order") for n in order_place_names}
    places.update({n: OCPetriNet.Place(n, "_binding") for n in binding_place_names})

    # ---------------------------------------------------------------------
    # Transitions
    # ---------------------------------------------------------------------
    transitions = {
        "END_order": OCPetriNet.Transition("END_order", "END_order"),
        "START_order": OCPetriNet.Transition("START_order", "START_order"),
        "a": OCPetriNet.Transition("a", "a"),
        "b": OCPetriNet.Transition("b", "b"),
    }

    for code in ["228", "231_1", "231_2", "232", "235", "238", "241", "244", "247"]:
        transitions[f"_silent#{code}"] = OCPetriNet.Transition(
            f"_silent#{code}", None
        )

    # ---------------------------------------------------------------------
    # Arcs
    # ---------------------------------------------------------------------
    arcs = []

    # transition ➜ place --------------------------------------------------
    connect(
        transitions["END_order"], places["p_END_order_o_order"], "order", arcs
    )  # non-variable
    connect(
        transitions["END_order"], places["p_binding_global_input"], "_binding", arcs
    )

    connect(
        transitions["START_order"],
        places["p_START_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["START_order"],
        places["p_binding#START_order_output"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#228"],
        places["p_a_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#228"], places["p_binding#a_input"], "_binding", arcs
    )

    connect(transitions["_silent#231_1"], places["p_a_o_order"], "order", arcs)
    connect(
        transitions["_silent#231_1"],
        places["p_arc(a,END_order)_order"],
        "order",
        arcs,
    )
    connect(
        transitions["_silent#231_1"], places["p_binding#230_1"], "_binding", arcs
    )

    connect(
        transitions["_silent#231_2"],
        places["p_arc(a,END_order)_order"],
        "order",
        arcs,
    )
    connect(
        transitions["_silent#231_2"], places["p_binding#230_1"], "_binding", arcs
    )

    connect(transitions["_silent#232"], places["p_arc(a,b)_order"], "order", arcs)
    connect(
        transitions["_silent#232"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(transitions["_silent#235"], places["p_b_i_order"], "order", arcs)
    connect(
        transitions["_silent#235"], places["p_binding#b_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#238"],
        places["p_arc(b,END_order)_order"],
        "order",
        arcs,
    )
    connect(
        transitions["_silent#238"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#241"],
        places["p_arc(START_order,a)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#241"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#244"], places["p_END_order_i_order"], "order", arcs
    )
    connect(
        transitions["_silent#244"],
        places["p_binding#END_order_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#247"], places["p_END_order_i_order"], "order", arcs
    )
    connect(
        transitions["_silent#247"],
        places["p_binding#END_order_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["a"], places["p_a_o_order"], "order", arcs, is_variable=True
    )
    connect(transitions["a"], places["p_binding#a_output"], "_binding", arcs)

    connect(transitions["b"], places["p_b_o_order"], "order", arcs)
    connect(transitions["b"], places["p_binding#b_output"], "_binding", arcs)

    # place ➜ transition ---------------------------------------------------
    connect(places["p_END_order_i_order"], transitions["END_order"], "order", arcs)
    connect(
        places["p_START_order_i_order"],
        transitions["START_order"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_START_order_o_order"],
        transitions["_silent#241"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_a_i_order"], transitions["a"], "order", arcs, is_variable=True
    )
    for t in ["_silent#231_1", "_silent#231_2", "_silent#232"]:
        connect(places["p_a_o_order"], transitions[t], "order", arcs)

    connect(
        places["p_arc(START_order,a)_order"],
        transitions["_silent#228"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#244"],
        "order",
        arcs,
    )
    connect(places["p_arc(a,b)_order"], transitions["_silent#235"], "order", arcs)
    connect(
        places["p_arc(b,END_order)_order"],
        transitions["_silent#247"],
        "order",
        arcs,
    )

    connect(places["p_b_i_order"], transitions["b"], "order", arcs)
    connect(places["p_b_o_order"], transitions["_silent#238"], "order", arcs)

    connect(places["p_binding#230_1"], transitions["_silent#232"], "_binding", arcs)
    connect(
        places["p_binding#END_order_input"],
        transitions["END_order"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#START_order_output"],
        transitions["_silent#241"],
        "_binding",
        arcs,
    )
    connect(places["p_binding#a_input"], transitions["a"], "_binding", arcs)
    for t in ["_silent#231_1", "_silent#231_2"]:
        connect(places["p_binding#a_output"], transitions[t], "_binding", arcs)

    connect(places["p_binding#b_input"], transitions["b"], "_binding", arcs)
    connect(
        places["p_binding#b_output"], transitions["_silent#238"], "_binding", arcs
    )

    for tgt in [
        "START_order",
        "_silent#228",
        "_silent#235",
        "_silent#244",
        "_silent#247",
    ]:
        connect(
            places["p_binding_global_input"], transitions[tgt], "_binding", arcs
        )

    # ---------------------------------------------------------------------
    # Assemble the net
    # ---------------------------------------------------------------------
    ocpn_expected = OCPetriNet(
        name="Expected OCPN",
        places=list(places.values()),
        transitions=list(transitions.values()),
        arcs=arcs,
        initial_marking=None,
        final_marking=None,
    )

    print(ocpn_expected)
    assert (are_ocpn_equal_no_ids(ocpn, ocpn_expected))

def test_conversion_multi_square_marker():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 0),
                    ("b", "order", (1, 1), 0),
                ],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, -1), 0), ("b", "order", (1, 1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    print("\nTEST OCCN CONVERSION MULTI SQUARE MARKER")
    print(occn)
    ocpn = occn_to_ocpn(occn)
    print(ocpn)

    # Expected OCPN:
    # ---------------------------------------------------------------------
    # Places
    # ---------------------------------------------------------------------
    place_specs = [
        # order places
        ("p_END_order_i_order", "order"),
        ("p_END_order_o_order", "order"),
        ("p_START_order_i_order", "order"),
        ("p_START_order_o_order", "order"),
        ("p_a_i_order", "order"),
        ("p_a_o_order", "order"),
        ("p_arc(START_order,a)_order", "order"),
        ("p_arc(a,END_order)_order", "order"),
        ("p_arc(a,b)_order", "order"),
        ("p_arc(b,END_order)_order", "order"),
        ("p_b_i_order", "order"),
        ("p_b_o_order", "order"),
        # _binding places
        ("p_binding#302_1", "_binding"),
        ("p_binding#315_1", "_binding"),
        ("p_binding#123123", "_binding"), # <-
        ("p_binding#END_order_input", "_binding"),
        ("p_binding#START_order_output", "_binding"),
        ("p_binding#a_input", "_binding"),
        ("p_binding#a_output", "_binding"),
        ("p_binding#b_input", "_binding"),
        ("p_binding#b_output", "_binding"),
        ("p_binding_global_input", "_binding"),
    ]

    places = {name: OCPetriNet.Place(name, ot) for (name, ot) in place_specs}

    # ---------------------------------------------------------------------
    # Transitions
    # ---------------------------------------------------------------------
    transition_specs = [
        ("END_order", "END_order"),
        ("START_order", "START_order"),
        ("_silent#300", None),
        ("_silent#303_1", None),
        ("_silent#303_2", None),
        ("_silent#304", None),
        ("_silent#307", None),
        ("_silent#310", None),
        ("_silent#313", None),
        ("_silent#316", None),
        ("_silent#317", None),
        ("_silent#123123", None), # <-
        ("a", "a"),
        ("b", "b"),
    ]

    transitions = {
        name: OCPetriNet.Transition(name, label)
        for (name, label) in transition_specs
    }

    # ---------------------------------------------------------------------
    # Arcs
    # ---------------------------------------------------------------------
    arcs = []

    # -- Transitions to places --
    connect(
        transitions["END_order"],
        places["p_END_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["END_order"], places["p_binding_global_input"], "_binding", arcs
    )
    connect(
        transitions["START_order"],
        places["p_START_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["START_order"],
        places["p_binding#START_order_output"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#300"],
        places["p_a_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#300"], places["p_binding#a_input"], "_binding", arcs
    )
    connect(transitions["_silent#303_1"], places["p_a_o_order"], "order", arcs)
    connect(transitions["_silent#303_1"], places["p_arc(a,b)_order"], "order", arcs)
    connect(
        transitions["_silent#303_1"], places["p_binding#302_1"], "_binding", arcs
    )
    connect(transitions["_silent#303_2"], places["p_arc(a,b)_order"], "order", arcs)
    connect(
        transitions["_silent#303_2"], places["p_binding#302_1"], "_binding", arcs
    )
    connect(
        transitions["_silent#304"],
        places["p_arc(a,END_order)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#304"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )
    connect(transitions["_silent#307"], places["p_b_i_order"], "order", arcs)
    connect(
        transitions["_silent#307"], places["p_binding#b_input"], "_binding", arcs
    )
    connect(
        transitions["_silent#310"],
        places["p_arc(b,END_order)_order"],
        "order",
        arcs,
    )
    connect(
        transitions["_silent#310"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#313"],
        places["p_arc(START_order,a)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#313"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#316"], places["p_END_order_i_order"], "order", arcs
    )
    connect(transitions["_silent#316"], places["p_binding#315_1"], "_binding", arcs)
    connect(
        transitions["_silent#317"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#123123"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_END_order_i_order"],
        transitions["_silent#317"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#317"],
        places["p_binding#123123"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#123123"],
        transitions["_silent#123123"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#123123"],
        places["p_binding#END_order_input"],
        "_binding",
        arcs,
    )
    connect(
        transitions["a"], places["p_a_o_order"], "order", arcs, is_variable=True
    )
    connect(transitions["a"], places["p_binding#a_output"], "_binding", arcs)
    connect(transitions["b"], places["p_b_o_order"], "order", arcs)
    connect(transitions["b"], places["p_binding#b_output"], "_binding", arcs)

    # -- Places to transitions --
    connect(
        places["p_END_order_i_order"],
        transitions["END_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_START_order_i_order"],
        transitions["START_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_START_order_o_order"],
        transitions["_silent#313"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_a_i_order"], transitions["a"], "order", arcs, is_variable=True
    )
    connect(places["p_a_o_order"], transitions["_silent#303_1"], "order", arcs)
    connect(places["p_a_o_order"], transitions["_silent#303_2"], "order", arcs)
    connect(
        places["p_a_o_order"],
        transitions["_silent#304"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(START_order,a)_order"],
        transitions["_silent#300"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#317"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#123123"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(places["p_arc(a,b)_order"], transitions["_silent#307"], "order", arcs)
    connect(
        places["p_arc(b,END_order)_order"],
        transitions["_silent#316"],
        "order",
        arcs,
    )
    connect(places["p_b_i_order"], transitions["b"], "order", arcs)
    connect(places["p_b_o_order"], transitions["_silent#310"], "order", arcs)
    connect(places["p_binding#302_1"], transitions["_silent#304"], "_binding", arcs)
    connect(places["p_binding#315_1"], transitions["_silent#317"], "_binding", arcs)
    connect(
        places["p_binding#END_order_input"],
        transitions["END_order"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#START_order_output"],
        transitions["_silent#313"],
        "_binding",
        arcs,
    )
    connect(places["p_binding#a_input"], transitions["a"], "_binding", arcs)
    connect(
        places["p_binding#a_output"], transitions["_silent#303_1"], "_binding", arcs
    )
    connect(
        places["p_binding#a_output"], transitions["_silent#303_2"], "_binding", arcs
    )
    connect(places["p_binding#b_input"], transitions["b"], "_binding", arcs)
    connect(
        places["p_binding#b_output"], transitions["_silent#310"], "_binding", arcs
    )
    connect(
        places["p_binding_global_input"],
        transitions["START_order"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding_global_input"],
        transitions["_silent#300"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding_global_input"],
        transitions["_silent#307"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding_global_input"],
        transitions["_silent#316"],
        "_binding",
        arcs,
    )

    # ---------------------------------------------------------------------
    # Assemble the net
    # ---------------------------------------------------------------------
    ocpn_expected = OCPetriNet(
        name="Expected OCPN",
        places=list(places.values()),
        transitions=list(transitions.values()),
        arcs=arcs,
        initial_marking=None,
        final_marking=None,
    )

    print(ocpn_expected)
    assert (are_ocpn_equal_no_ids(ocpn, ocpn_expected))

def test_conversion_triple_marker():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 0),
                    ("b", "order", (1, 1), 0),
                    ("c", "order", (1, -1), 0),
                ],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "c": {
            "img": [
                [("a", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [
                    ("a", "order", (1, -1), 0),
                    ("b", "order", (1, 1), 0),
                    ("c", "order", (1, -1), 0),
                ],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    print("\nTEST OCCN CONVERSION TRIPLE MARKER")
    print(occn)
    ocpn = occn_to_ocpn(occn)
    print(ocpn)

    # Expected OCPN:
    # ---------------------------------------------------------------------
    # Places
    # ---------------------------------------------------------------------
    order_place_names = [
        "p_END_order_i_order",
        "p_END_order_o_order",
        "p_START_order_i_order",
        "p_START_order_o_order",
        "p_a_i_order",
        "p_a_o_order",
        "p_arc(START_order,a)_order",
        "p_arc(a,END_order)_order",
        "p_arc(a,b)_order",
        "p_arc(a,c)_order",
        "p_arc(b,END_order)_order",
        "p_arc(c,END_order)_order",
        "p_b_i_order",
        "p_b_o_order",
        "p_c_i_order",
        "p_c_o_order",
    ]

    binding_place_names = [
        "p_binding#331_1",
        "p_binding#331_2",
        "p_binding#333",
        "p_binding#342_1",
        "p_binding#342_2",
        "p_binding#10",
        "p_binding#20",
        "p_binding#END_order_input",
        "p_binding#START_order_output",
        "p_binding#a_input",
        "p_binding#a_output",
        "p_binding#b_input",
        "p_binding#b_output",
        "p_binding#c_input",
        "p_binding#c_output",
        "p_binding_global_input",
    ]

    places = {n: OCPetriNet.Place(n, "order") for n in order_place_names}
    places.update({n: OCPetriNet.Place(n, "_binding") for n in binding_place_names})

    # ---------------------------------------------------------------------
    # Transitions
    # ---------------------------------------------------------------------
    transitions = {
        "END_order": OCPetriNet.Transition("END_order", "END_order"),
        "START_order": OCPetriNet.Transition("START_order", "START_order"),
        "a": OCPetriNet.Transition("a", "a"),
        "b": OCPetriNet.Transition("b", "b"),
        "c": OCPetriNet.Transition("c", "c"),
    }
    for code in [
        "320",
        "323",
        "326",
        "329",
        "332_1",
        "332_2",
        "333_1",
        "333_2",
        "334",
        "337",
        "340",
        "343",
        "344",
        "345",
        "1",
        "2",
    ]:
        transitions[f"_silent#{code}"] = OCPetriNet.Transition(
            f"_silent#{code}", None
        )

    # ---------------------------------------------------------------------
    # Arcs
    # ---------------------------------------------------------------------
    arcs = []

    # transition ➜ place --------------------------------------------------
    connect(
        transitions["END_order"],
        places["p_END_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["END_order"], places["p_binding_global_input"], "_binding", arcs
    )

    connect(
        transitions["START_order"],
        places["p_START_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["START_order"],
        places["p_binding#START_order_output"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#320"],
        places["p_arc(START_order,a)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#320"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#323"], places["p_binding#c_input"], "_binding", arcs
    )
    connect(
        transitions["_silent#323"],
        places["p_c_i_order"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        transitions["_silent#326"],
        places["p_arc(c,END_order)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#326"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#329"],
        places["p_a_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#329"], places["p_binding#a_input"], "_binding", arcs
    )

    connect(transitions["_silent#332_1"], places["p_a_o_order"], "order", arcs)
    connect(transitions["_silent#332_1"], places["p_arc(a,b)_order"], "order", arcs)
    connect(
        transitions["_silent#332_1"], places["p_binding#331_1"], "_binding", arcs
    )

    connect(transitions["_silent#332_2"], places["p_arc(a,b)_order"], "order", arcs)
    connect(
        transitions["_silent#332_2"], places["p_binding#331_1"], "_binding", arcs
    )

    connect(
        transitions["_silent#333_1"],
        places["p_a_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#333_1"],
        places["p_arc(a,END_order)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#333_1"], places["p_binding#333"], "_binding", arcs)

    connect(
        transitions["_silent#333_2"],
        places["p_arc(a,END_order)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#333_2"], places["p_binding#331_2"], "_binding", arcs
    )

    connect(
        transitions["_silent#334"],
        places["p_arc(a,c)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#334"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(transitions["_silent#337"], places["p_b_i_order"], "order", arcs)
    connect(
        transitions["_silent#337"], places["p_binding#b_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#340"],
        places["p_arc(b,END_order)_order"],
        "order",
        arcs,
    )
    connect(
        transitions["_silent#340"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#343"], places["p_END_order_i_order"], "order", arcs
    )
    connect(transitions["_silent#343"], places["p_binding#342_1"], "_binding", arcs)

    connect(
        transitions["_silent#344"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#344"], places["p_binding#342_2"], "_binding", arcs)
    connect(transitions["_silent#1"], places["p_binding#10"], "_binding", arcs)

    connect(
        transitions["_silent#345"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#2"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#345"],
        places["p_binding#20"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#2"],
        places["p_binding#END_order_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["a"], places["p_a_o_order"], "order", arcs, is_variable=True
    )
    connect(transitions["a"], places["p_binding#a_output"], "_binding", arcs)

    connect(transitions["b"], places["p_b_o_order"], "order", arcs)
    connect(transitions["b"], places["p_binding#b_output"], "_binding", arcs)

    connect(
        transitions["c"], places["p_c_o_order"], "order", arcs, is_variable=True
    )
    connect(transitions["c"], places["p_binding#c_output"], "_binding", arcs)

    # place ➜ transition ---------------------------------------------------
    connect(
        places["p_END_order_i_order"],
        transitions["END_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_START_order_i_order"],
        transitions["START_order"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_START_order_o_order"],
        transitions["_silent#320"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_a_i_order"], transitions["a"], "order", arcs, is_variable=True
    )

    for t in ["_silent#332_1", "_silent#332_2"]:
        connect(places["p_a_o_order"], transitions[t], "order", arcs)
    for t in ["_silent#333_1", "_silent#333_2", "_silent#334"]:
        connect(
            places["p_a_o_order"], transitions[t], "order", arcs, is_variable=True
        )

    connect(
        places["p_arc(START_order,a)_order"],
        transitions["_silent#329"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#344"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_END_order_i_order"],
        transitions["_silent#344"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#1"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#1"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(places["p_arc(a,b)_order"], transitions["_silent#337"], "order", arcs)
    connect(
        places["p_arc(a,c)_order"],
        transitions["_silent#323"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(b,END_order)_order"],
        transitions["_silent#343"],
        "order",
        arcs,
    )
    connect(
        places["p_arc(c,END_order)_order"],
        transitions["_silent#345"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_END_order_i_order"],
        transitions["_silent#345"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(c,END_order)_order"],
        transitions["_silent#2"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(places["p_b_i_order"], transitions["b"], "order", arcs)
    connect(places["p_b_o_order"], transitions["_silent#340"], "order", arcs)

    connect(
        places["p_c_i_order"], transitions["c"], "order", arcs, is_variable=True
    )
    connect(
        places["p_c_o_order"],
        transitions["_silent#326"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_binding#331_1"], transitions["_silent#333_1"], "_binding", arcs
    )
    connect(places["p_binding#331_2"], transitions["_silent#334"], "_binding", arcs)
    connect(places["p_binding#333"], transitions["_silent#333_2"], "_binding", arcs)
    connect(places["p_binding#342_1"], transitions["_silent#344"], "_binding", arcs)
    connect(places["p_binding#10"], transitions["_silent#345"], "_binding", arcs)
    connect(places["p_binding#20"], transitions["_silent#2"], "_binding", arcs)
    connect(places["p_binding#342_2"], transitions["_silent#1"], "_binding", arcs)

    connect(
        places["p_binding#END_order_input"],
        transitions["END_order"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#START_order_output"],
        transitions["_silent#320"],
        "_binding",
        arcs,
    )

    connect(places["p_binding#a_input"], transitions["a"], "_binding", arcs)
    for t in ["_silent#332_1", "_silent#332_2"]:
        connect(places["p_binding#a_output"], transitions[t], "_binding", arcs)

    connect(places["p_binding#b_input"], transitions["b"], "_binding", arcs)
    connect(
        places["p_binding#b_output"], transitions["_silent#340"], "_binding", arcs
    )

    connect(places["p_binding#c_input"], transitions["c"], "_binding", arcs)
    connect(
        places["p_binding#c_output"], transitions["_silent#326"], "_binding", arcs
    )

    for tgt in [
        "START_order",
        "_silent#323",
        "_silent#329",
        "_silent#337",
        "_silent#343",
    ]:
        connect(
            places["p_binding_global_input"], transitions[tgt], "_binding", arcs
        )

    # ---------------------------------------------------------------------
    # Assemble the net
    # ---------------------------------------------------------------------
    ocpn_expected = OCPetriNet(
        name="Expected OCPN",
        places=list(places.values()),
        transitions=list(transitions.values()),
        arcs=arcs,
        initial_marking=None,
        final_marking=None,
    )

    print(ocpn_expected)
    assert (are_ocpn_equal_no_ids(ocpn, ocpn_expected))

def test_conversion_key():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 1),
                    ("b", "order", (1, 1), 1),
                    ("c", "order", (1, -1), 1),
                ],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "c": {
            "img": [
                [("a", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [
                    ("a", "order", (1, -1), 0),
                    ("b", "order", (1, 1), 0),
                    ("c", "order", (1, -1), 0),
                ],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    print("\nTEST OCCN CONVERSION KEY")
    print(occn)
    ocpn = occn_to_ocpn(occn)
    print(ocpn)

    # Expected OCPN:
    # ---------------------------------------------------------------------
    # Places
    # ---------------------------------------------------------------------
    order_place_names = [
        "p_END_order_i_order",
        "p_END_order_o_order",
        "p_START_order_i_order",
        "p_START_order_o_order",
        "p_a_i_order",
        "p_a_o_order",
        "p_arc(START_order,a)_order",
        "p_arc(a,END_order)_order",
        "p_arc(a,b)_order",
        "p_arc(a,c)_order",
        "p_arc(b,END_order)_order",
        "p_arc(c,END_order)_order",
        "p_b_i_order",
        "p_b_o_order",
        "p_c_i_order",
        "p_c_o_order",
    ]

    binding_place_names = [
        "p_binding#10",
        "p_binding#20",
        "p_binding#68_1",
        "p_binding#68_2",
        "p_binding#79_1",
        "p_binding#79_2",
        "p_binding#END_order_input",
        "p_binding#START_order_output",
        "p_binding#a_input",
        "p_binding#a_output",
        "p_binding#b_input",
        "p_binding#b_output",
        "p_binding#c_input",
        "p_binding#c_output",
        "p_binding_global_input",
    ]

    places = {n: OCPetriNet.Place(n, "order") for n in order_place_names}
    places.update({n: OCPetriNet.Place(n, "_binding") for n in binding_place_names})

    # ---------------------------------------------------------------------
    # Transitions
    # ---------------------------------------------------------------------
    transitions = {
        "END_order": OCPetriNet.Transition("END_order", "END_order"),
        "START_order": OCPetriNet.Transition("START_order", "START_order"),
        "a": OCPetriNet.Transition("a", "a"),
        "b": OCPetriNet.Transition("b", "b"),
        "c": OCPetriNet.Transition("c", "c"),
    }
    for num in [56, 59, 62, 65, 69, 70, 71, 74, 77, 80, 81, 82, 1, 2]:
        transitions[f"_silent#{num}"] = OCPetriNet.Transition(
            f"_silent#{num}", None
        )

    # ---------------------------------------------------------------------
    # Arcs
    # ---------------------------------------------------------------------
    arcs = []

    # transition ➜ place ---------------------------------------------------
    connect(
        transitions["END_order"],
        places["p_END_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["END_order"], places["p_binding_global_input"], "_binding", arcs
    )

    connect(
        transitions["START_order"],
        places["p_START_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["START_order"],
        places["p_binding#START_order_output"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#56"],
        places["p_arc(START_order,a)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#56"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#59"],
        places["p_c_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#59"], places["p_binding#c_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#62"],
        places["p_arc(c,END_order)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#62"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#65"],
        places["p_a_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#65"], places["p_binding#a_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#69"],
        places["p_arc(a,END_order)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#69"], places["p_binding#68_1"], "_binding", arcs)

    connect(
        transitions["_silent#70"],
        places["p_arc(a,c)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#70"], places["p_binding#68_2"], "_binding", arcs)

    connect(
        transitions["_silent#71"], places["p_arc(a,b)_order"], "order", arcs
    )  # non-variable
    connect(
        transitions["_silent#71"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#74"], places["p_b_i_order"], "order", arcs
    )  # non-variable
    connect(
        transitions["_silent#74"], places["p_binding#b_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#77"], places["p_arc(b,END_order)_order"], "order", arcs
    )  # non-variable
    connect(
        transitions["_silent#77"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#80"], places["p_END_order_i_order"], "order", arcs
    )  # non-variable
    connect(transitions["_silent#80"], places["p_binding#79_1"], "_binding", arcs)

    connect(
        transitions["_silent#81"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#81"], places["p_binding#79_2"], "_binding", arcs)

    connect(
        transitions["_silent#1"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#1"], places["p_binding#10"], "_binding", arcs)

    connect(
        transitions["_silent#82"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#82"],
        places["p_binding#20"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#2"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#2"],
        places["p_binding#END_order_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["a"], places["p_a_o_order"], "order", arcs, is_variable=True
    )
    connect(transitions["a"], places["p_binding#a_output"], "_binding", arcs)

    connect(transitions["b"], places["p_b_o_order"], "order", arcs)  # non-variable
    connect(transitions["b"], places["p_binding#b_output"], "_binding", arcs)

    connect(
        transitions["c"], places["p_c_o_order"], "order", arcs, is_variable=True
    )
    connect(transitions["c"], places["p_binding#c_output"], "_binding", arcs)

    # place ➜ transition ---------------------------------------------------
    connect(
        places["p_END_order_i_order"],
        transitions["END_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_END_order_i_order"],
        transitions["_silent#81"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_END_order_i_order"],
        transitions["_silent#82"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_START_order_i_order"],
        transitions["START_order"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_START_order_o_order"],
        transitions["_silent#56"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_a_i_order"], transitions["a"], "order", arcs, is_variable=True
    )
    connect(
        places["p_a_o_order"],
        transitions["_silent#69"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_a_o_order"],
        transitions["_silent#70"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_a_o_order"], transitions["_silent#71"], "order", arcs
    )  # non-variable

    connect(
        places["p_arc(START_order,a)_order"],
        transitions["_silent#65"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#81"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#1"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,b)_order"], transitions["_silent#74"], "order", arcs
    )  # non-variable
    connect(
        places["p_arc(a,c)_order"],
        transitions["_silent#59"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(b,END_order)_order"], transitions["_silent#80"], "order", arcs
    )  # non-variable
    connect(
        places["p_arc(c,END_order)_order"],
        transitions["_silent#82"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(c,END_order)_order"],
        transitions["_silent#2"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(places["p_b_i_order"], transitions["b"], "order", arcs)  # non-variable
    connect(
        places["p_b_o_order"], transitions["_silent#77"], "order", arcs
    )  # non-variable

    connect(places["p_binding#10"], transitions["_silent#82"], "_binding", arcs)
    connect(places["p_binding#20"], transitions["_silent#2"], "_binding", arcs)
    connect(places["p_binding#68_1"], transitions["_silent#70"], "_binding", arcs)
    connect(places["p_binding#68_2"], transitions["_silent#71"], "_binding", arcs)
    connect(places["p_binding#79_1"], transitions["_silent#81"], "_binding", arcs)
    connect(places["p_binding#79_2"], transitions["_silent#1"], "_binding", arcs)

    connect(
        places["p_binding#END_order_input"],
        transitions["END_order"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#START_order_output"],
        transitions["_silent#56"],
        "_binding",
        arcs,
    )

    connect(places["p_binding#a_input"], transitions["a"], "_binding", arcs)
    connect(
        places["p_binding#a_output"], transitions["_silent#69"], "_binding", arcs
    )

    connect(places["p_binding#b_input"], transitions["b"], "_binding", arcs)
    connect(
        places["p_binding#b_output"], transitions["_silent#77"], "_binding", arcs
    )

    connect(places["p_binding#c_input"], transitions["c"], "_binding", arcs)
    connect(
        places["p_binding#c_output"], transitions["_silent#62"], "_binding", arcs
    )

    for tgt in [
        "START_order",
        "_silent#59",
        "_silent#65",
        "_silent#74",
        "_silent#80",
    ]:
        connect(
            places["p_binding_global_input"], transitions[tgt], "_binding", arcs
        )

    connect(
        places["p_c_i_order"], transitions["c"], "order", arcs, is_variable=True
    )
    connect(
        places["p_c_o_order"],
        transitions["_silent#62"],
        "order",
        arcs,
        is_variable=True,
    )

    # ---------------------------------------------------------------------
    # Assemble the net
    # ---------------------------------------------------------------------
    ocpn_expected = OCPetriNet(
        name="Expected OCPN",
        places=list(places.values()),
        transitions=list(transitions.values()),
        arcs=arcs,
        initial_marking=None,
        final_marking=None,
    )

    print(ocpn_expected)
    assert (are_ocpn_equal_no_ids(ocpn, ocpn_expected))

def test_conversion_key_input():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 1),
                    ("b", "order", (1, 1), 1),
                    ("c", "order", (1, -1), 1),
                ],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "c": {
            "img": [
                [("a", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [
                    ("a", "order", (1, -1), 1),
                    ("b", "order", (1, 1), 1),
                    ("c", "order", (1, -1), 1),
                ],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    print("\nTEST OCCN CONVERSION KEY INPUT")
    print(occn)
    ocpn = occn_to_ocpn(occn)
    print(ocpn)

    # Expected OCPN:
    # ---------------------------------------------------------------------
    # Places
    # ---------------------------------------------------------------------
    order_place_names = [
        "p_END_order_i_order",
        "p_END_order_o_order",
        "p_START_order_i_order",
        "p_START_order_o_order",
        "p_a_i_order",
        "p_a_o_order",
        "p_arc(START_order,a)_order",
        "p_arc(a,END_order)_order",
        "p_arc(a,b)_order",
        "p_arc(a,c)_order",
        "p_arc(b,END_order)_order",
        "p_arc(c,END_order)_order",
        "p_b_i_order",
        "p_b_o_order",
        "p_c_i_order",
        "p_c_o_order",
    ]

    binding_place_names = [
        "p_binding#108_1",
        "p_binding#108_2",
        "p_binding#97_1",
        "p_binding#97_2",
        "p_binding#10",
        "p_binding#20",
        "p_binding#END_order_input",
        "p_binding#START_order_output",
        "p_binding#a_input",
        "p_binding#a_output",
        "p_binding#b_input",
        "p_binding#b_output",
        "p_binding#c_input",
        "p_binding#c_output",
        "p_binding_global_input",
    ]

    places = {n: OCPetriNet.Place(n, "order") for n in order_place_names}
    places.update({n: OCPetriNet.Place(n, "_binding") for n in binding_place_names})

    # ---------------------------------------------------------------------
    # Transitions
    # ---------------------------------------------------------------------
    transitions = {
        "END_order": OCPetriNet.Transition("END_order", "END_order"),
        "START_order": OCPetriNet.Transition("START_order", "START_order"),
        "a": OCPetriNet.Transition("a", "a"),
        "b": OCPetriNet.Transition("b", "b"),
        "c": OCPetriNet.Transition("c", "c"),
    }

    for num in [85, 88, 91, 94, 98, 99, 100, 103, 106, 109, 110, 111, 1, 2]:
        transitions[f"_silent#{num}"] = OCPetriNet.Transition(
            f"_silent#{num}", None
        )

    # ---------------------------------------------------------------------
    # Arcs
    # ---------------------------------------------------------------------
    arcs = []

    # transition ➜ place ---------------------------------------------------
    connect(
        transitions["END_order"],
        places["p_END_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["END_order"], places["p_binding_global_input"], "_binding", arcs
    )

    connect(
        transitions["START_order"],
        places["p_START_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["START_order"],
        places["p_binding#START_order_output"],
        "_binding",
        arcs,
    )

    connect(transitions["_silent#100"], places["p_arc(a,b)_order"], "order", arcs)
    connect(
        transitions["_silent#100"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(transitions["_silent#103"], places["p_b_i_order"], "order", arcs)
    connect(
        transitions["_silent#103"], places["p_binding#b_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#106"],
        places["p_arc(b,END_order)_order"],
        "order",
        arcs,
    )
    connect(
        transitions["_silent#106"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#109"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_END_order_i_order"],
        transitions["_silent#109"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#109"], places["p_binding#108_2"], "_binding", arcs)
    connect(places["p_binding#108_1"], transitions["_silent#109"], "_binding", arcs)
    connect(places["p_binding#108_2"], transitions["_silent#1"], "_binding", arcs)

    connect(
        transitions["_silent#110"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#110"], places["p_binding#20"], "_binding", arcs)

    connect(
        transitions["_silent#111"], places["p_END_order_i_order"], "order", arcs
    )
    connect(
        transitions["_silent#2"],
        places["p_binding#END_order_input"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#2"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True
    )
    connect(
        places["p_arc(c,END_order)_order"],
        transitions["_silent#2"],
        "order",
        arcs,
        is_variable=True
    )
    connect(
        transitions["_silent#111"],
        places["p_binding#108_1"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#85"],
        places["p_arc(START_order,a)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#85"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#88"],
        places["p_c_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#88"], places["p_binding#c_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#91"],
        places["p_arc(c,END_order)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#91"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#94"],
        places["p_a_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#94"], places["p_binding#a_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#98"],
        places["p_arc(a,END_order)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#1"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#1"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#1"],
        places["p_binding#10"],
        "_binding",
        arcs,
    )
    connect(transitions["_silent#98"], places["p_binding#97_1"], "_binding", arcs)

    connect(
        transitions["_silent#99"],
        places["p_arc(a,c)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#99"], places["p_binding#97_2"], "_binding", arcs)

    connect(
        transitions["a"], places["p_a_o_order"], "order", arcs, is_variable=True
    )
    connect(transitions["a"], places["p_binding#a_output"], "_binding", arcs)

    connect(transitions["b"], places["p_b_o_order"], "order", arcs)
    connect(transitions["b"], places["p_binding#b_output"], "_binding", arcs)

    connect(
        transitions["c"], places["p_c_o_order"], "order", arcs, is_variable=True
    )
    connect(transitions["c"], places["p_binding#c_output"], "_binding", arcs)

    # place ➜ transition ---------------------------------------------------
    connect(
        places["p_END_order_i_order"],
        transitions["END_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_START_order_i_order"],
        transitions["START_order"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_START_order_o_order"],
        transitions["_silent#85"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_a_i_order"], transitions["a"], "order", arcs, is_variable=True
    )
    connect(places["p_a_o_order"], transitions["_silent#100"], "order", arcs)
    connect(
        places["p_a_o_order"],
        transitions["_silent#98"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_a_o_order"],
        transitions["_silent#99"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_arc(START_order,a)_order"],
        transitions["_silent#94"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#109"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(places["p_arc(a,b)_order"], transitions["_silent#103"], "order", arcs)
    connect(
        places["p_arc(a,c)_order"],
        transitions["_silent#88"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(b,END_order)_order"],
        transitions["_silent#111"],
        "order",
        arcs,
    )
    connect(
        places["p_arc(c,END_order)_order"],
        transitions["_silent#110"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_END_order_i_order"],
        transitions["_silent#110"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(places["p_b_i_order"], transitions["b"], "order", arcs)
    connect(places["p_b_o_order"], transitions["_silent#106"], "order", arcs)

    connect(places["p_binding#10"], transitions["_silent#110"], "_binding", arcs)
    connect(places["p_binding#108_2"], transitions["_silent#111"], "_binding", arcs)
    connect(places["p_binding#97_1"], transitions["_silent#99"], "_binding", arcs)
    connect(places["p_binding#97_2"], transitions["_silent#100"], "_binding", arcs)

    connect(
        places["p_binding#END_order_input"],
        transitions["END_order"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#START_order_output"],
        transitions["_silent#85"],
        "_binding",
        arcs,
    )

    connect(places["p_binding#a_input"], transitions["a"], "_binding", arcs)
    connect(
        places["p_binding#a_output"], transitions["_silent#98"], "_binding", arcs
    )

    connect(places["p_binding#b_input"], transitions["b"], "_binding", arcs)
    connect(
        places["p_binding#b_output"], transitions["_silent#106"], "_binding", arcs
    )

    connect(places["p_binding#c_input"], transitions["c"], "_binding", arcs)
    connect(
        places["p_binding#c_output"], transitions["_silent#91"], "_binding", arcs
    )

    for tgt in [
        "START_order",
        "_silent#103",
        "_silent#109",
        "_silent#88",
        "_silent#94",
    ]:
        connect(
            places["p_binding_global_input"], transitions[tgt], "_binding", arcs
        )

    connect(
        places["p_c_i_order"], transitions["c"], "order", arcs, is_variable=True
    )
    connect(
        places["p_c_o_order"],
        transitions["_silent#91"],
        "order",
        arcs,
        is_variable=True,
    )

    # ---------------------------------------------------------------------
    # Assemble the net
    # ---------------------------------------------------------------------
    ocpn_expected = OCPetriNet(
        name="Expected OCPN",
        places=list(places.values()),
        transitions=list(transitions.values()),
        arcs=arcs,
        initial_marking=None,
        final_marking=None,
    )

    print(ocpn_expected)
    assert (are_ocpn_equal_no_ids(ocpn, ocpn_expected))

def test_conversion_key_order():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 1),
                    ("b", "order", (1, 1), 0),
                    ("c", "order", (1, -1), 1),
                ],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "c": {
            "img": [
                [("a", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [
                    ("a", "order", (1, -1), 0),
                    ("b", "order", (1, 1), 0),
                    ("c", "order", (1, -1), 0),
                ],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    print("\nTEST OCCN CONVERSION KEY ORDER")
    print(occn)
    ocpn = occn_to_ocpn(occn)
    print(ocpn)

    # Expected OCPN:
    # ---------------------------------------------------------------------
    # Places
    # ---------------------------------------------------------------------
    order_place_names = [
        "p_END_order_i_order",
        "p_END_order_o_order",
        "p_START_order_i_order",
        "p_START_order_o_order",
        "p_a_i_order",
        "p_a_o_order",
        "p_arc(START_order,a)_order",
        "p_arc(a,END_order)_order",
        "p_arc(a,b)_order",
        "p_arc(a,c)_order",
        "p_arc(b,END_order)_order",
        "p_arc(c,END_order)_order",
        "p_b_i_order",
        "p_b_o_order",
        "p_c_i_order",
        "p_c_o_order",
    ]

    binding_place_names = [
        "p_binding#125_1",
        "p_binding#127_1",
        "p_binding#137_1",
        "p_binding#137_2",
        "p_binding#10",
        "p_binding#20",
        "p_binding#END_order_input",
        "p_binding#START_order_output",
        "p_binding#a_input",
        "p_binding#a_output",
        "p_binding#b_input",
        "p_binding#b_output",
        "p_binding#c_input",
        "p_binding#c_output",
        "p_binding_global_input",
    ]

    places = {n: OCPetriNet.Place(n, "order") for n in order_place_names}
    places.update({n: OCPetriNet.Place(n, "_binding") for n in binding_place_names})

    # ---------------------------------------------------------------------
    # Transitions
    # ---------------------------------------------------------------------
    transitions = {
        "END_order": OCPetriNet.Transition("END_order", "END_order"),
        "START_order": OCPetriNet.Transition("START_order", "START_order"),
        "a": OCPetriNet.Transition("a", "a"),
        "b": OCPetriNet.Transition("b", "b"),
        "c": OCPetriNet.Transition("c", "c"),
    }

    for code in [
        "114",
        "117",
        "120",
        "123",
        "126_1",
        "126_2",
        "128",
        "129",
        "132",
        "135",
        "138",
        "139",
        "140",
        "1",
        "2"
    ]:
        name = f"_silent#{code}"
        transitions[name] = OCPetriNet.Transition(name, None)

    # ---------------------------------------------------------------------
    # Arcs
    # ---------------------------------------------------------------------
    arcs = []

    # ---- transition ➜ place --------------------------------------------
    connect(
        transitions["END_order"],
        places["p_END_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["END_order"], places["p_binding_global_input"], "_binding", arcs
    )

    connect(
        transitions["START_order"],
        places["p_START_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["START_order"],
        places["p_binding#START_order_output"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#114"],
        places["p_arc(START_order,a)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#114"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#117"],
        places["p_c_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#117"], places["p_binding#c_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#120"],
        places["p_arc(c,END_order)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(c,END_order)_order"],
        transitions["_silent#2"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#120"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#123"],
        places["p_a_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#123"], places["p_binding#a_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#126_1"], places["p_a_o_order"], "order", arcs
    )  # non-variable
    connect(transitions["_silent#126_1"], places["p_arc(a,b)_order"], "order", arcs)
    connect(
        transitions["_silent#126_1"], places["p_binding#125_1"], "_binding", arcs
    )

    connect(transitions["_silent#126_2"], places["p_arc(a,b)_order"], "order", arcs)
    connect(
        transitions["_silent#126_2"], places["p_binding#125_1"], "_binding", arcs
    )

    connect(
        transitions["_silent#128"],
        places["p_arc(a,END_order)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#128"], places["p_binding#127_1"], "_binding", arcs)

    connect(
        transitions["_silent#129"],
        places["p_arc(a,c)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#129"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#132"], places["p_b_i_order"], "order", arcs
    )  # non-variable
    connect(
        transitions["_silent#132"], places["p_binding#b_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#135"],
        places["p_arc(b,END_order)_order"],
        "order",
        arcs,
    )  # non-variable
    connect(
        transitions["_silent#135"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#138"], places["p_END_order_i_order"], "order", arcs
    )  # non-variable
    connect(transitions["_silent#138"], places["p_binding#137_1"], "_binding", arcs)

    connect(
        transitions["_silent#139"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#1"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#2"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_END_order_i_order"],
        transitions["_silent#139"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#139"], places["p_binding#137_2"], "_binding", arcs)

    connect(
        transitions["_silent#140"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_END_order_i_order"],
        transitions["_silent#140"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#140"],
        places["p_binding#20"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#20"],
        transitions["_silent#2"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#2"],
        places["p_binding#END_order_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["a"], places["p_a_o_order"], "order", arcs, is_variable=True
    )
    connect(transitions["a"], places["p_binding#a_output"], "_binding", arcs)

    connect(transitions["b"], places["p_b_o_order"], "order", arcs)  # non-variable
    connect(transitions["b"], places["p_binding#b_output"], "_binding", arcs)

    connect(
        transitions["c"], places["p_c_o_order"], "order", arcs, is_variable=True
    )
    connect(transitions["c"], places["p_binding#c_output"], "_binding", arcs)

    # ---- place ➜ transition ---------------------------------------------
    connect(
        places["p_END_order_i_order"],
        transitions["END_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_START_order_i_order"],
        transitions["START_order"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_START_order_o_order"],
        transitions["_silent#114"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_a_i_order"], transitions["a"], "order", arcs, is_variable=True
    )
    connect(places["p_a_o_order"], transitions["_silent#126_1"], "order", arcs)
    connect(places["p_a_o_order"], transitions["_silent#126_2"], "order", arcs)
    connect(
        places["p_a_o_order"],
        transitions["_silent#128"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_a_o_order"],
        transitions["_silent#129"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_arc(START_order,a)_order"],
        transitions["_silent#123"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#139"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#1"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(places["p_arc(a,b)_order"], transitions["_silent#132"], "order", arcs)
    connect(
        places["p_arc(a,c)_order"],
        transitions["_silent#117"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(b,END_order)_order"],
        transitions["_silent#138"],
        "order",
        arcs,
    )
    connect(
        places["p_arc(c,END_order)_order"],
        transitions["_silent#140"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(places["p_b_i_order"], transitions["b"], "order", arcs)
    connect(places["p_b_o_order"], transitions["_silent#135"], "order", arcs)

    connect(places["p_binding#125_1"], transitions["_silent#128"], "_binding", arcs)
    connect(places["p_binding#127_1"], transitions["_silent#129"], "_binding", arcs)
    connect(places["p_binding#137_1"], transitions["_silent#139"], "_binding", arcs)
    connect(places["p_binding#137_2"], transitions["_silent#1"], "_binding", arcs)
    connect(places["p_binding#10"], transitions["_silent#140"], "_binding", arcs)
    connect(transitions["_silent#1"], places["p_binding#10"], "_binding", arcs)

    connect(
        places["p_binding#END_order_input"],
        transitions["END_order"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#START_order_output"],
        transitions["_silent#114"],
        "_binding",
        arcs,
    )

    connect(places["p_binding#a_input"], transitions["a"], "_binding", arcs)
    connect(
        places["p_binding#a_output"], transitions["_silent#126_1"], "_binding", arcs
    )
    connect(
        places["p_binding#a_output"], transitions["_silent#126_2"], "_binding", arcs
    )

    connect(places["p_binding#b_input"], transitions["b"], "_binding", arcs)
    connect(
        places["p_binding#b_output"], transitions["_silent#135"], "_binding", arcs
    )

    connect(places["p_binding#c_input"], transitions["c"], "_binding", arcs)
    connect(
        places["p_binding#c_output"], transitions["_silent#120"], "_binding", arcs
    )

    for tgt in [
        "START_order",
        "_silent#117",
        "_silent#123",
        "_silent#132",
        "_silent#138",
    ]:
        connect(
            places["p_binding_global_input"], transitions[tgt], "_binding", arcs
        )

    connect(
        places["p_c_i_order"], transitions["c"], "order", arcs, is_variable=True
    )
    connect(
        places["p_c_o_order"],
        transitions["_silent#120"],
        "order",
        arcs,
        is_variable=True,
    )

    # ---------------------------------------------------------------------
    # Assemble the net
    # ---------------------------------------------------------------------
    ocpn_expected = OCPetriNet(
        name="Expected OCPN",
        places=list(places.values()),
        transitions=list(transitions.values()),
        arcs=arcs,
        initial_marking=None,
        final_marking=None,
    )

    print(ocpn_expected)
    assert (are_ocpn_equal_no_ids(ocpn, ocpn_expected))

def test_conversion_multi_key():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 1),
                    ("b", "order", (1, 1), 1),
                    ("c", "order", (1, -1), 1),
                ],
                [
                    ("END_order", "order", (1, -1), 2),
                    ("b", "order", (1, 1), 2),
                ],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "c": {
            "img": [
                [("a", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [
                    ("a", "order", (1, -1), 0),
                    ("b", "order", (1, 1), 0),
                    ("c", "order", (1, -1), 0),
                ],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    print("\nTEST OCCN CONVERSION MULTI KEY")
    print(occn)
    ocpn = occn_to_ocpn(occn)
    print(ocpn)

    # Expected OCPN:
    # ---------------------------------------------------------------------
    # Places
    # ---------------------------------------------------------------------
    order_place_names = [
        "p_END_order_i_order",
        "p_END_order_o_order",
        "p_START_order_i_order",
        "p_START_order_o_order",
        "p_a_i_order",
        "p_a_o_order",
        "p_arc(START_order,a)_order",
        "p_arc(a,END_order)_order",
        "p_arc(a,b)_order",
        "p_arc(a,c)_order",
        "p_arc(b,END_order)_order",
        "p_arc(c,END_order)_order",
        "p_b_i_order",
        "p_b_o_order",
        "p_c_i_order",
        "p_c_o_order",
    ]

    binding_place_names = [
        "p_binding#167_1",
        "p_binding#167_2",
        "p_binding#173_1",
        "p_binding#183_1",
        "p_binding#183_2",
        "p_binding#10",
        "p_binding#20",
        "p_binding#END_order_input",
        "p_binding#START_order_output",
        "p_binding#a_input",
        "p_binding#a_output",
        "p_binding#b_input",
        "p_binding#b_output",
        "p_binding#c_input",
        "p_binding#c_output",
        "p_binding_global_input",
    ]

    places = {n: OCPetriNet.Place(n, "order") for n in order_place_names}
    places.update({n: OCPetriNet.Place(n, "_binding") for n in binding_place_names})

    # ---------------------------------------------------------------------
    # Transitions
    # ---------------------------------------------------------------------
    transitions = {
        "END_order": OCPetriNet.Transition("END_order", "END_order"),
        "START_order": OCPetriNet.Transition("START_order", "START_order"),
        "a": OCPetriNet.Transition("a", "a"),
        "b": OCPetriNet.Transition("b", "b"),
        "c": OCPetriNet.Transition("c", "c"),
    }
    for num in [
        155,
        158,
        161,
        164,
        168,
        169,
        170,
        174,
        175,
        178,
        181,
        184,
        185,
        186,
        1,
        2
    ]:
        t_name = f"_silent#{num}"
        transitions[t_name] = OCPetriNet.Transition(t_name, None)

    # ---------------------------------------------------------------------
    # Arcs  (using the `connect` helper defined earlier)
    # ---------------------------------------------------------------------
    arcs = []

    # ---- transition ➜ place --------------------------------------------
    connect(
        transitions["END_order"],
        places["p_END_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["END_order"], places["p_binding_global_input"], "_binding", arcs
    )

    connect(
        transitions["START_order"],
        places["p_START_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["START_order"],
        places["p_binding#START_order_output"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#155"],
        places["p_arc(START_order,a)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#155"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#158"],
        places["p_c_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#158"], places["p_binding#c_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#161"],
        places["p_arc(c,END_order)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(c,END_order)_order"],
        transitions["_silent#2"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#2"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#161"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#164"],
        places["p_a_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#164"], places["p_binding#a_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#168"],
        places["p_arc(a,END_order)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#168"], places["p_binding#167_1"], "_binding", arcs)

    connect(
        transitions["_silent#169"],
        places["p_arc(a,c)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#169"], places["p_binding#167_2"], "_binding", arcs)

    connect(
        transitions["_silent#170"], places["p_arc(a,b)_order"], "order", arcs
    )  # non-variable
    connect(
        transitions["_silent#170"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#174"],
        places["p_arc(a,END_order)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#174"], places["p_binding#173_1"], "_binding", arcs)

    connect(
        transitions["_silent#175"], places["p_arc(a,b)_order"], "order", arcs
    )  # non-variable
    connect(
        transitions["_silent#175"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#178"], places["p_b_i_order"], "order", arcs
    )  # non-variable
    connect(
        transitions["_silent#178"], places["p_binding#b_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#181"],
        places["p_arc(b,END_order)_order"],
        "order",
        arcs,
    )  # non-variable
    connect(
        transitions["_silent#181"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#184"], places["p_END_order_i_order"], "order", arcs
    )  # non-variable
    connect(transitions["_silent#184"], places["p_binding#183_1"], "_binding", arcs)

    connect(
        transitions["_silent#185"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_END_order_i_order"],
        transitions["_silent#185"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#185"], places["p_binding#183_2"], "_binding", arcs)

    connect(
        transitions["_silent#186"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_END_order_i_order"],
        transitions["_silent#186"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#186"],
        places["p_binding#20"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#2"],
        places["p_binding#END_order_input"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#20"],
        transitions["_silent#2"],
        "_binding",
        arcs,
    )

    connect(
        transitions["a"], places["p_a_o_order"], "order", arcs, is_variable=True
    )
    connect(transitions["a"], places["p_binding#a_output"], "_binding", arcs)

    connect(transitions["b"], places["p_b_o_order"], "order", arcs)
    connect(transitions["b"], places["p_binding#b_output"], "_binding", arcs)

    connect(
        transitions["c"], places["p_c_o_order"], "order", arcs, is_variable=True
    )
    connect(transitions["c"], places["p_binding#c_output"], "_binding", arcs)

    # ---- place ➜ transition ---------------------------------------------
    connect(
        places["p_END_order_i_order"],
        transitions["END_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_START_order_i_order"],
        transitions["START_order"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_START_order_o_order"],
        transitions["_silent#155"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_a_i_order"], transitions["a"], "order", arcs, is_variable=True
    )
    connect(
        places["p_a_o_order"],
        transitions["_silent#168"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_a_o_order"],
        transitions["_silent#169"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_a_o_order"], transitions["_silent#170"], "order", arcs
    )  # non-variable
    connect(
        places["p_a_o_order"],
        transitions["_silent#174"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_a_o_order"], transitions["_silent#175"], "order", arcs
    )  # non-variable

    connect(
        places["p_arc(START_order,a)_order"],
        transitions["_silent#164"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#185"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#1"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#1"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,b)_order"], transitions["_silent#178"], "order", arcs
    )  # non-variable
    connect(
        places["p_arc(a,c)_order"],
        transitions["_silent#158"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(b,END_order)_order"],
        transitions["_silent#184"],
        "order",
        arcs,
    )  # non-variable
    connect(
        places["p_arc(c,END_order)_order"],
        transitions["_silent#186"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(places["p_b_i_order"], transitions["b"], "order", arcs)
    connect(places["p_b_o_order"], transitions["_silent#181"], "order", arcs)

    connect(places["p_binding#167_1"], transitions["_silent#169"], "_binding", arcs)
    connect(places["p_binding#167_2"], transitions["_silent#170"], "_binding", arcs)
    connect(places["p_binding#173_1"], transitions["_silent#175"], "_binding", arcs)
    connect(places["p_binding#183_1"], transitions["_silent#185"], "_binding", arcs)
    connect(places["p_binding#183_2"], transitions["_silent#1"], "_binding", arcs)
    connect(transitions["_silent#1"], places["p_binding#10"], "_binding", arcs)
    connect(places["p_binding#10"], transitions["_silent#186"], "_binding", arcs)

    connect(
        places["p_binding#END_order_input"],
        transitions["END_order"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#START_order_output"],
        transitions["_silent#155"],
        "_binding",
        arcs,
    )

    connect(places["p_binding#a_input"], transitions["a"], "_binding", arcs)
    connect(
        places["p_binding#a_output"], transitions["_silent#168"], "_binding", arcs
    )
    connect(
        places["p_binding#a_output"], transitions["_silent#174"], "_binding", arcs
    )

    connect(places["p_binding#b_input"], transitions["b"], "_binding", arcs)
    connect(
        places["p_binding#b_output"], transitions["_silent#181"], "_binding", arcs
    )

    connect(places["p_binding#c_input"], transitions["c"], "_binding", arcs)
    connect(
        places["p_binding#c_output"], transitions["_silent#161"], "_binding", arcs
    )

    for tgt in [
        "START_order",
        "_silent#158",
        "_silent#164",
        "_silent#178",
        "_silent#184",
    ]:
        connect(
            places["p_binding_global_input"], transitions[tgt], "_binding", arcs
        )

    connect(
        places["p_c_i_order"], transitions["c"], "order", arcs, is_variable=True
    )
    connect(
        places["p_c_o_order"],
        transitions["_silent#161"],
        "order",
        arcs,
        is_variable=True,
    )

    # ---------------------------------------------------------------------
    # Assemble the net
    # ---------------------------------------------------------------------
    ocpn_expected = OCPetriNet(
        name="Expected OCPN",
        places=list(places.values()),
        transitions=list(transitions.values()),
        arcs=arcs,
        initial_marking=None,
        final_marking=None,
    )

    print(ocpn_expected)
    assert (are_ocpn_equal_no_ids(ocpn, ocpn_expected))

def test_conversion_multi_key_2():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 1),
                    ("b", "order", (1, 1), 2),
                    ("c", "order", (1, -1), 1),
                    ("d", "order", (1, 1), 2),
                ],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "c": {
            "img": [
                [("a", "order", (1, -1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, -1), 0),
                ],
            ],
        },
        "d": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [
                    ("a", "order", (1, -1), 0),
                    ("b", "order", (1, 1), 0),
                    ("c", "order", (1, -1), 0),
                    ("d", "order", (1, 1), 0),
                ],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    print("\nTEST OCCN CONVERSION MULTI KEY 2")
    print(occn)
    ocpn = occn_to_ocpn(occn)
    print(ocpn)

    # Expected OCPN:
    # ---------------------------------------------------------------------
    # Places
    # ---------------------------------------------------------------------
    order_place_names = [
        "p#201_X",
        "p_END_order_i_order",
        "p_END_order_o_order",
        "p_START_order_i_order",
        "p_START_order_o_order",
        "p_a_i_order",
        "p_a_o_order",
        "p_arc(START_order,a)_order",
        "p_arc(a,END_order)_order",
        "p_arc(a,b)_order",
        "p_arc(a,c)_order",
        "p_arc(a,d)_order",
        "p_arc(b,END_order)_order",
        "p_arc(c,END_order)_order",
        "p_arc(d,END_order)_order",
        "p_b_i_order",
        "p_b_o_order",
        "p_c_i_order",
        "p_c_o_order",
        "p_d_i_order",
        "p_d_o_order",
    ]

    binding_place_names = [
        "p_binding#200_1",
        "p_binding#201_alpha",
        "p_binding#201_beta",
        "p_binding#202_1",
        "p_binding#205_1",
        "p_binding#221_1",
        "p_binding#221_2",
        "p_binding#221_3",
        "p_binding#10",
        "p_binding#20",
        "p_binding#END_order_input",
        "p_binding#START_order_output",
        "p_binding#a_input",
        "p_binding#a_output",
        "p_binding#b_input",
        "p_binding#b_output",
        "p_binding#c_input",
        "p_binding#c_output",
        "p_binding#d_input",
        "p_binding#d_output",
        "p_binding_global_input",
    ]

    places = {n: OCPetriNet.Place(n, "order") for n in order_place_names}
    places.update({n: OCPetriNet.Place(n, "_binding") for n in binding_place_names})

    # ---------------------------------------------------------------------
    # Transitions
    # ---------------------------------------------------------------------
    transitions = {
        "END_order": OCPetriNet.Transition("END_order", "END_order"),
        "START_order": OCPetriNet.Transition("START_order", "START_order"),
        "a": OCPetriNet.Transition("a", "a"),
        "b": OCPetriNet.Transition("b", "b"),
        "c": OCPetriNet.Transition("c", "c"),
        "d": OCPetriNet.Transition("d", "d"),
    }

    for code in [
        "189",
        "192",
        "195",
        "198",
        "201_1",
        "201_2",
        "203",
        "204",
        "206",
        "207",
        "210",
        "213",
        "216",
        "219",
        "222",
        "223",
        "224",
        "225",
        "1",
        "2",
        "3",
    ]:
        transitions[f"_silent#{code}"] = OCPetriNet.Transition(
            f"_silent#{code}", None
        )

    # ---------------------------------------------------------------------
    # Arcs
    # ---------------------------------------------------------------------
    arcs = []

    # transition ➜ place --------------------------------------------------
    connect(
        transitions["END_order"],
        places["p_END_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["END_order"], places["p_binding_global_input"], "_binding", arcs
    )

    connect(
        transitions["START_order"],
        places["p_START_order_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["START_order"],
        places["p_binding#START_order_output"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#189"],
        places["p_arc(START_order,a)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#189"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#192"], places["p_binding#c_input"], "_binding", arcs
    )
    connect(
        transitions["_silent#192"],
        places["p_c_i_order"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        transitions["_silent#195"],
        places["p_arc(c,END_order)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(c,END_order)_order"],
        transitions["_silent#3"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#3"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#195"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#198"],
        places["p_a_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#198"], places["p_binding#a_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#201_1"],
        places["p#201_X"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#201_1"],
        places["p_a_o_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#201_1"],
        places["p_binding#201_alpha"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#201_2"],
        places["p#201_X"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#201_2"], places["p_binding#201_beta"], "_binding", arcs
    )

    connect(
        transitions["_silent#203"], places["p_arc(a,b)_order"], "order", arcs
    )  # non-variable
    connect(transitions["_silent#203"], places["p_binding#202_1"], "_binding", arcs)

    connect(
        transitions["_silent#204"], places["p_arc(a,d)_order"], "order", arcs
    )  # non-variable
    connect(transitions["_silent#204"], places["p_binding#200_1"], "_binding", arcs)

    connect(
        transitions["_silent#206"],
        places["p_arc(a,END_order)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#206"], places["p_binding#205_1"], "_binding", arcs)

    connect(
        transitions["_silent#207"],
        places["p_arc(a,c)_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#207"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#210"], places["p_binding#d_input"], "_binding", arcs
    )
    connect(
        transitions["_silent#210"], places["p_d_i_order"], "order", arcs
    )  # non-variable

    connect(
        transitions["_silent#213"],
        places["p_arc(d,END_order)_order"],
        "order",
        arcs,
    )  # non-variable
    connect(
        transitions["_silent#213"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#216"], places["p_b_i_order"], "order", arcs
    )  # non-variable
    connect(
        transitions["_silent#216"], places["p_binding#b_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#219"],
        places["p_arc(b,END_order)_order"],
        "order",
        arcs,
    )  # non-variable
    connect(
        transitions["_silent#219"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#222"], places["p_END_order_i_order"], "order", arcs
    )  # non-variable
    connect(transitions["_silent#222"], places["p_binding#221_1"], "_binding", arcs)

    connect(
        transitions["_silent#223"], places["p_END_order_i_order"], "order", arcs
    )  # non-variable
    connect(
        transitions["_silent#1"], places["p_END_order_i_order"], "order", arcs
    )  # non-variable
    connect(
        places["p_END_order_i_order"], 
        transitions["_silent#1"], 
        "order", arcs
    )  # non-variable
    
    connect(transitions["_silent#223"], places["p_binding#221_2"], "_binding", arcs)
    connect(transitions["_silent#1"], places["p_binding#221_2"], "_binding", arcs)

    connect(
        transitions["_silent#224"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_END_order_i_order"],
        transitions["_silent#224"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#224"], places["p_binding#221_3"], "_binding", arcs)

    connect(
        transitions["_silent#225"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_END_order_i_order"],
        transitions["_silent#225"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#225"],
        places["p_binding#20"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#20"],
        transitions["_silent#3"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#3"],
        places["p_binding#END_order_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["a"], places["p_a_o_order"], "order", arcs, is_variable=True
    )
    connect(transitions["a"], places["p_binding#a_output"], "_binding", arcs)

    connect(transitions["b"], places["p_b_o_order"], "order", arcs)
    connect(transitions["b"], places["p_binding#b_output"], "_binding", arcs)

    connect(
        transitions["c"], places["p_c_o_order"], "order", arcs, is_variable=True
    )
    connect(transitions["c"], places["p_binding#c_output"], "_binding", arcs)

    connect(transitions["d"], places["p_d_o_order"], "order", arcs)
    connect(transitions["d"], places["p_binding#d_output"], "_binding", arcs)

    # place ➜ transition ---------------------------------------------------
    connect(places["p#201_X"], transitions["_silent#203"], "order", arcs)
    connect(places["p#201_X"], transitions["_silent#204"], "order", arcs)

    connect(
        places["p_END_order_i_order"],
        transitions["END_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_START_order_i_order"],
        transitions["START_order"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_START_order_o_order"],
        transitions["_silent#189"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(
        places["p_a_i_order"], transitions["a"], "order", arcs, is_variable=True
    )
    for t in ["_silent#201_1", "_silent#201_2", "_silent#206", "_silent#207"]:
        connect(
            places["p_a_o_order"], transitions[t], "order", arcs, is_variable=True
        )

    connect(
        places["p_arc(START_order,a)_order"],
        transitions["_silent#198"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#224"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#2"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#2"],
        places["p_END_order_i_order"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(places["p_arc(a,b)_order"], transitions["_silent#216"], "order", arcs)
    connect(
        places["p_arc(a,c)_order"],
        transitions["_silent#192"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(places["p_arc(a,d)_order"], transitions["_silent#210"], "order", arcs)
    connect(
        places["p_arc(b,END_order)_order"],
        transitions["_silent#222"],
        "order",
        arcs,
    )
    connect(
        places["p_arc(c,END_order)_order"],
        transitions["_silent#225"],
        "order",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(d,END_order)_order"],
        transitions["_silent#223"],
        "order",
        arcs,
    )
    connect(
        places["p_arc(d,END_order)_order"],
        transitions["_silent#1"],
        "order",
        arcs,
    )

    connect(places["p_b_i_order"], transitions["b"], "order", arcs)
    connect(places["p_b_o_order"], transitions["_silent#219"], "order", arcs)

    connect(
        places["p_c_i_order"], transitions["c"], "order", arcs, is_variable=True
    )
    connect(
        places["p_c_o_order"],
        transitions["_silent#195"],
        "order",
        arcs,
        is_variable=True,
    )

    connect(places["p_d_i_order"], transitions["d"], "order", arcs)
    connect(places["p_d_o_order"], transitions["_silent#213"], "order", arcs)

    connect(places["p_binding#200_1"], transitions["_silent#206"], "_binding", arcs)
    connect(
        places["p_binding#201_alpha"],
        transitions["_silent#201_2"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#201_beta"], transitions["_silent#203"], "_binding", arcs
    )
    connect(places["p_binding#202_1"], transitions["_silent#204"], "_binding", arcs)
    connect(places["p_binding#205_1"], transitions["_silent#207"], "_binding", arcs)
    connect(places["p_binding#221_1"], transitions["_silent#223"], "_binding", arcs)
    connect(places["p_binding#221_1"], transitions["_silent#1"], "_binding", arcs)
    connect(places["p_binding#221_2"], transitions["_silent#224"], "_binding", arcs)
    connect(places["p_binding#221_3"], transitions["_silent#2"], "_binding", arcs)
    connect(transitions["_silent#2"], places["p_binding#10"], "_binding", arcs)
    connect(places["p_binding#10"], transitions["_silent#225"], "_binding", arcs)

    connect(
        places["p_binding#END_order_input"],
        transitions["END_order"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#START_order_output"],
        transitions["_silent#189"],
        "_binding",
        arcs,
    )

    connect(places["p_binding#a_input"], transitions["a"], "_binding", arcs)
    connect(
        places["p_binding#a_output"], transitions["_silent#201_1"], "_binding", arcs
    )

    connect(places["p_binding#b_input"], transitions["b"], "_binding", arcs)
    connect(
        places["p_binding#b_output"], transitions["_silent#219"], "_binding", arcs
    )

    connect(places["p_binding#c_input"], transitions["c"], "_binding", arcs)
    connect(
        places["p_binding#c_output"], transitions["_silent#195"], "_binding", arcs
    )

    connect(places["p_binding#d_input"], transitions["d"], "_binding", arcs)
    connect(
        places["p_binding#d_output"], transitions["_silent#213"], "_binding", arcs
    )

    for tgt in [
        "START_order",
        "_silent#192",
        "_silent#198",
        "_silent#210",
        "_silent#216",
        "_silent#222",
    ]:
        connect(
            places["p_binding_global_input"], transitions[tgt], "_binding", arcs
        )

    # ---------------------------------------------------------------------
    # Assemble the net
    # ---------------------------------------------------------------------
    ocpn_expected = OCPetriNet(
        name="Expected OCPN",
        places=list(places.values()),
        transitions=list(transitions.values()),
        arcs=arcs,
        initial_marking=None,
        final_marking=None,
    )

    print(ocpn_expected)
    assert (are_ocpn_equal_no_ids(ocpn, ocpn_expected))

def test_conversion_multi_ot():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "START_item": {
            "img": [],
            "omg": [
                [("a", "item", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [
                    ("START_order", "order", (1, 1), 0),
                    ("START_item", "item", (1, -1), 0),
                ],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                    ("END_item", "item", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ]
        },
        "END_item": {
            "img": [
                [("a", "item", (1, -1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    print("\nTEST OCCN CONVERSION MULTI OT")
    print(occn)
    ocpn = occn_to_ocpn(occn)
    print(ocpn)

    # Expected OCPN:
    # ---------------------------------------------------------------------
    # Places
    # ---------------------------------------------------------------------
    place_specs = [
        # item
        ("p_END_item_i_item", "item"),
        ("p_END_item_o_item", "item"),
        ("p_START_item_i_item", "item"),
        ("p_START_item_o_item", "item"),
        ("p_a_i_item", "item"),
        ("p_a_o_item", "item"),
        ("p_arc(START_item,a)_item", "item"),
        ("p_arc(a,END_item)_item", "item"),
        # order
        ("p_END_order_i_order", "order"),
        ("p_END_order_o_order", "order"),
        ("p_START_order_i_order", "order"),
        ("p_START_order_o_order", "order"),
        ("p_a_i_order", "order"),
        ("p_a_o_order", "order"),
        ("p_arc(START_order,a)_order", "order"),
        ("p_arc(a,END_order)_order", "order"),
        # _binding
        ("p_binding#251_1", "_binding"),
        ("p_binding#256_1", "_binding"),
        ("p_binding#END_item_input", "_binding"),
        ("p_binding#END_order_input", "_binding"),
        ("p_binding#START_item_output", "_binding"),
        ("p_binding#START_order_output", "_binding"),
        ("p_binding#a_input", "_binding"),
        ("p_binding#a_output", "_binding"),
        ("p_binding_global_input", "_binding"),
    ]

    places = {name: OCPetriNet.Place(name, ot) for (name, ot) in place_specs}

    # ---------------------------------------------------------------------
    # Transitions
    # ---------------------------------------------------------------------
    transition_specs = [
        ("END_item", "END_item"),
        ("END_order", "END_order"),
        ("START_item", "START_item"),
        ("START_order", "START_order"),
        ("_silent#250", None),
        ("_silent#253", None),
        ("_silent#255", None),
        ("_silent#258", None),
        ("_silent#260", None),
        ("_silent#263", None),
        ("_silent#266", None),
        ("_silent#269", None),
        ("a", "a"),
    ]

    transitions = {
        name: OCPetriNet.Transition(name, label)
        for (name, label) in transition_specs
    }

    # ---------------------------------------------------------------------
    # Arcs
    # ---------------------------------------------------------------------
    arcs = []

    # --- transitions to places ---
    connect(
        transitions["END_item"],
        places["p_END_item_o_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["END_item"], places["p_binding_global_input"], "_binding", arcs
    )
    connect(transitions["END_order"], places["p_END_order_o_order"], "order", arcs)
    connect(
        transitions["END_order"], places["p_binding_global_input"], "_binding", arcs
    )
    connect(
        transitions["START_item"],
        places["p_START_item_o_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["START_item"],
        places["p_binding#START_item_output"],
        "_binding",
        arcs,
    )
    connect(
        transitions["START_order"], places["p_START_order_o_order"], "order", arcs
    )
    connect(
        transitions["START_order"],
        places["p_binding#START_order_output"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#250"],
        places["p_arc(START_order,a)_order"],
        "order",
        arcs,
    )
    connect(
        transitions["_silent#250"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#253"],
        places["p_a_i_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#253"], places["p_binding#251_1"], "_binding", arcs)
    connect(transitions["_silent#255"], places["p_a_i_order"], "order", arcs)
    connect(
        transitions["_silent#255"], places["p_binding#a_input"], "_binding", arcs
    )
    connect(
        transitions["_silent#258"],
        places["p_arc(a,END_item)_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#258"], places["p_binding#256_1"], "_binding", arcs)
    connect(
        transitions["_silent#260"],
        places["p_arc(a,END_order)_order"],
        "order",
        arcs,
    )
    connect(
        transitions["_silent#260"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#263"],
        places["p_arc(START_item,a)_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#263"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#266"], places["p_END_order_i_order"], "order", arcs
    )
    connect(
        transitions["_silent#266"],
        places["p_binding#END_order_input"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#269"],
        places["p_END_item_i_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#269"],
        places["p_binding#END_item_input"],
        "_binding",
        arcs,
    )
    connect(transitions["a"], places["p_a_o_item"], "item", arcs, is_variable=True)
    connect(transitions["a"], places["p_a_o_order"], "order", arcs)
    connect(transitions["a"], places["p_binding#a_output"], "_binding", arcs)

    # --- places to transitions ---
    connect(
        places["p_END_item_i_item"],
        transitions["END_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(places["p_END_order_i_order"], transitions["END_order"], "order", arcs)
    connect(
        places["p_START_item_i_item"],
        transitions["START_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_START_item_o_item"],
        transitions["_silent#263"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_START_order_i_order"], transitions["START_order"], "order", arcs
    )
    connect(
        places["p_START_order_o_order"], transitions["_silent#250"], "order", arcs
    )
    connect(places["p_a_i_item"], transitions["a"], "item", arcs, is_variable=True)
    connect(places["p_a_i_order"], transitions["a"], "order", arcs)
    connect(
        places["p_a_o_item"],
        transitions["_silent#258"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(places["p_a_o_order"], transitions["_silent#260"], "order", arcs)
    connect(
        places["p_arc(START_item,a)_item"],
        transitions["_silent#253"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(START_order,a)_order"],
        transitions["_silent#255"],
        "order",
        arcs,
    )
    connect(
        places["p_arc(a,END_item)_item"],
        transitions["_silent#269"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#266"],
        "order",
        arcs,
    )
    connect(places["p_binding#251_1"], transitions["_silent#255"], "_binding", arcs)
    connect(places["p_binding#256_1"], transitions["_silent#260"], "_binding", arcs)
    connect(
        places["p_binding#END_item_input"],
        transitions["END_item"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#END_order_input"],
        transitions["END_order"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#START_item_output"],
        transitions["_silent#263"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#START_order_output"],
        transitions["_silent#250"],
        "_binding",
        arcs,
    )
    connect(places["p_binding#a_input"], transitions["a"], "_binding", arcs)
    connect(
        places["p_binding#a_output"], transitions["_silent#258"], "_binding", arcs
    )
    connect(
        places["p_binding_global_input"],
        transitions["START_item"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding_global_input"],
        transitions["START_order"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding_global_input"],
        transitions["_silent#253"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding_global_input"],
        transitions["_silent#266"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding_global_input"],
        transitions["_silent#269"],
        "_binding",
        arcs,
    )

    # ---------------------------------------------------------------------
    # Assemble the net
    # ---------------------------------------------------------------------
    ocpn_expected = OCPetriNet(
        name="Expected OCPN",
        places=list(places.values()),
        transitions=list(transitions.values()),
        arcs=arcs,
        initial_marking=None,
        final_marking=None,
    )

    print(ocpn_expected)
    assert (are_ocpn_equal_no_ids(ocpn, ocpn_expected))
    
def test_conversion_multi_ot_multi_arc():
    marker_groups = {
        "START_order": {
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "START_item": {
            "omg": [
                [("a", "item", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [
                    ("START_order", "order", (1, 1), 0),
                    ("START_item", "item", (1, -1), 0),
                ],
            ],
            "omg": [
                [
                    ("b", "order", (1, 1), 0),
                    ("b", "item", (1, -1), 0),
                ],
            ],
        },
        "b": {
            "img": [
                [
                    ("a", "order", (1, 1), 0),
                    ("a", "item", (1, -1), 0),
                ],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                    ("END_item", "item", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [("b", "order", (1, 1), 0)],
            ]
        },
        "END_item": {
            "img": [
                [("b", "item", (1, -1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    print("\nTEST OCCN CONVERSION MULTI OT MULTI ARC")
    print(occn)
    ocpn = occn_to_ocpn(occn)
    print(ocpn)

    # Expected OCPN:
    # ---------------------------------------------------------------------
    # Places
    # ---------------------------------------------------------------------
    place_specs = [
        # item
        ("p_END_item_i_item", "item"),
        ("p_END_item_o_item", "item"),
        ("p_START_item_i_item", "item"),
        ("p_START_item_o_item", "item"),
        ("p_a_i_item", "item"),
        ("p_a_o_item", "item"),
        ("p_b_i_item", "item"),
        ("p_b_o_item", "item"),
        ("p_arc(START_item,a)_item", "item"),
        ("p_arc(a,b)_item", "item"),
        ("p_arc(b,END_item)_item", "item"),
        # order
        ("p_END_order_i_order", "order"),
        ("p_END_order_o_order", "order"),
        ("p_START_order_i_order", "order"),
        ("p_START_order_o_order", "order"),
        ("p_a_i_order", "order"),
        ("p_a_o_order", "order"),
        ("p_b_i_order", "order"),
        ("p_b_o_order", "order"),
        ("p_arc(START_order,a)_order", "order"),
        ("p_arc(a,b)_order", "order"),
        ("p_arc(b,END_order)_order", "order"),
        # _binding
        ("p_binding#251_1", "_binding"),
        ("p_binding#256_1", "_binding"),
        ("p_binding#2512_1", "_binding"),
        ("p_binding#2562_1", "_binding"),
        ("p_binding#END_item_input", "_binding"),
        ("p_binding#END_order_input", "_binding"),
        ("p_binding#START_item_output", "_binding"),
        ("p_binding#START_order_output", "_binding"),
        ("p_binding#a_input", "_binding"),
        ("p_binding#a_output", "_binding"),
        ("p_binding#b_input", "_binding"),
        ("p_binding#b_output", "_binding"),
        ("p_binding_global_input", "_binding"),
    ]

    places = {name: OCPetriNet.Place(name, ot) for (name, ot) in place_specs}

    # ---------------------------------------------------------------------
    # Transitions
    # ---------------------------------------------------------------------
    transition_specs = [
        ("END_item", "END_item"),
        ("END_order", "END_order"),
        ("START_item", "START_item"),
        ("START_order", "START_order"),
        ("_silent#250", None), # arc START_order to a
        ("_silent#253", None), # p_a_i_item
        ("_silent#255", None), # p_a_i_order
        ("_silent#2532", None), # p_b_i_item
        ("_silent#2552", None), # p_b_i_order
        ("_silent#258", None), # p_arc(a,END_item)_item -> now b
        ("_silent#260", None), # p_arc(a,END_order)_order -> now b
        ("_silent#2582", None), # p_arc(b,END_item)_item
        ("_silent#2602", None), # p_arc(b,END_order)_order
        ("_silent#263", None), # p_arc(START_item,a)_item
        ("_silent#266", None), # p_END_order_i_order
        ("_silent#269", None), # p_END_item_i_item
        ("a", "a"),
        ("b", "b"),
    ]

    transitions = {
        name: OCPetriNet.Transition(name, label)
        for (name, label) in transition_specs
    }

    # ---------------------------------------------------------------------
    # Arcs
    # ---------------------------------------------------------------------
    arcs = []

    # --- transitions to places ---
    connect(
        transitions["END_item"],
        places["p_END_item_o_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["END_item"], places["p_binding_global_input"], "_binding", arcs
    )
    connect(transitions["END_order"], places["p_END_order_o_order"], "order", arcs)
    connect(
        transitions["END_order"], places["p_binding_global_input"], "_binding", arcs
    )
    connect(
        transitions["START_item"],
        places["p_START_item_o_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["START_item"],
        places["p_binding#START_item_output"],
        "_binding",
        arcs,
    )
    connect(
        transitions["START_order"], places["p_START_order_o_order"], "order", arcs
    )
    connect(
        transitions["START_order"],
        places["p_binding#START_order_output"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#250"],
        places["p_arc(START_order,a)_order"],
        "order",
        arcs,
    )
    connect(
        transitions["_silent#250"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#253"],
        places["p_a_i_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#2532"],
        places["p_b_i_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#253"], places["p_binding#251_1"], "_binding", arcs)
    connect(transitions["_silent#2532"], places["p_binding#2512_1"], "_binding", arcs)
    connect(transitions["_silent#255"], places["p_a_i_order"], "order", arcs)
    connect(transitions["_silent#2552"], places["p_b_i_order"], "order", arcs)
    connect(
        transitions["_silent#255"], places["p_binding#a_input"], "_binding", arcs
    )
    connect(
        transitions["_silent#2552"], places["p_binding#b_input"], "_binding", arcs
    )
    connect(
        transitions["_silent#258"],
        places["p_arc(a,b)_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#2582"],
        places["p_arc(b,END_item)_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#258"], places["p_binding#256_1"], "_binding", arcs)
    connect(transitions["_silent#2582"], places["p_binding#2562_1"], "_binding", arcs)
    connect(
        transitions["_silent#260"],
        places["p_arc(a,b)_order"],
        "order",
        arcs,
    )
    connect(
        transitions["_silent#2602"],
        places["p_arc(b,END_order)_order"],
        "order",
        arcs,
    )
    connect(
        transitions["_silent#260"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#2602"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#263"],
        places["p_arc(START_item,a)_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#263"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#266"], places["p_END_order_i_order"], "order", arcs
    )
    connect(
        transitions["_silent#266"],
        places["p_binding#END_order_input"],
        "_binding",
        arcs,
    )
    connect(
        transitions["_silent#269"],
        places["p_END_item_i_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#269"],
        places["p_binding#END_item_input"],
        "_binding",
        arcs,
    )
    connect(transitions["a"], places["p_a_o_item"], "item", arcs, is_variable=True)
    connect(transitions["a"], places["p_a_o_order"], "order", arcs)
    connect(transitions["a"], places["p_binding#a_output"], "_binding", arcs)
    connect(transitions["b"], places["p_b_o_item"], "item", arcs, is_variable=True)
    connect(transitions["b"], places["p_b_o_order"], "order", arcs)
    connect(transitions["b"], places["p_binding#b_output"], "_binding", arcs)

    # --- places to transitions ---
    connect(
        places["p_END_item_i_item"],
        transitions["END_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(places["p_END_order_i_order"], transitions["END_order"], "order", arcs)
    connect(
        places["p_START_item_i_item"],
        transitions["START_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_START_item_o_item"],
        transitions["_silent#263"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_START_order_i_order"], transitions["START_order"], "order", arcs
    )
    connect(
        places["p_START_order_o_order"], transitions["_silent#250"], "order", arcs
    )
    connect(places["p_a_i_item"], transitions["a"], "item", arcs, is_variable=True)
    connect(places["p_a_i_order"], transitions["a"], "order", arcs)
    connect(places["p_b_i_item"], transitions["b"], "item", arcs, is_variable=True)
    connect(places["p_b_i_order"], transitions["b"], "order", arcs)
    connect(
        places["p_a_o_item"],
        transitions["_silent#258"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(places["p_a_o_order"], transitions["_silent#260"], "order", arcs)
    connect(
        places["p_b_o_item"],
        transitions["_silent#2582"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(places["p_b_o_order"], transitions["_silent#2602"], "order", arcs)
    connect(
        places["p_arc(START_item,a)_item"],
        transitions["_silent#253"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(START_order,a)_order"],
        transitions["_silent#255"],
        "order",
        arcs,
    )
    connect(
        places["p_arc(a,b)_item"],
        transitions["_silent#2532"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(b,END_item)_item"],
        transitions["_silent#269"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,b)_order"],
        transitions["_silent#2552"],
        "order",
        arcs,
    )
    connect(
        places["p_arc(b,END_order)_order"],
        transitions["_silent#266"],
        "order",
        arcs,
    )
    connect(places["p_binding#251_1"], transitions["_silent#255"], "_binding", arcs)
    connect(places["p_binding#256_1"], transitions["_silent#260"], "_binding", arcs)
    connect(places["p_binding#2512_1"], transitions["_silent#2552"], "_binding", arcs)
    connect(places["p_binding#2562_1"], transitions["_silent#2602"], "_binding", arcs)
    connect(
        places["p_binding#END_item_input"],
        transitions["END_item"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#END_order_input"],
        transitions["END_order"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#START_item_output"],
        transitions["_silent#263"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#START_order_output"],
        transitions["_silent#250"],
        "_binding",
        arcs,
    )
    connect(places["p_binding#a_input"], transitions["a"], "_binding", arcs)
    connect(places["p_binding#b_input"], transitions["b"], "_binding", arcs)
    connect(
        places["p_binding#a_output"], transitions["_silent#258"], "_binding", arcs
    )
    connect(
        places["p_binding#b_output"], transitions["_silent#2582"], "_binding", arcs
    )
    connect(
        places["p_binding_global_input"],
        transitions["START_item"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding_global_input"],
        transitions["START_order"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding_global_input"],
        transitions["_silent#253"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding_global_input"],
        transitions["_silent#2532"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding_global_input"],
        transitions["_silent#266"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding_global_input"],
        transitions["_silent#269"],
        "_binding",
        arcs,
    )

    # ---------------------------------------------------------------------
    # Assemble the net
    # ---------------------------------------------------------------------
    ocpn_expected = OCPetriNet(
        name="Expected OCPN",
        places=list(places.values()),
        transitions=list(transitions.values()),
        arcs=arcs,
        initial_marking=None,
        final_marking=None,
    )

    print(ocpn_expected)
    assert (are_ocpn_equal_no_ids(ocpn, ocpn_expected))

def test_conversion_multi_ot_multi_marker():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "START_item": {
            "img": [],
            "omg": [
                [("a", "item", (1, -1), 0)],
            ],
        },
        "a": {
            "img": [
                [
                    ("START_order", "order", (1, 1), 0),
                    ("START_item", "item", (1, -1), 0),
                ],
                [
                    ("START_item", "item", (1, -1), 0),
                ],
            ],
            "omg": [
                [
                    ("END_order", "order", (1, 1), 0),
                    ("END_item", "item", (1, -1), 0),
                ],
                [
                    ("END_item", "item", (1, -1), 0),
                ],
            ],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ]
        },
        "END_item": {
            "img": [
                [("a", "item", (1, -1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    print("\nTEST OCCN CONVERSION MULTI OT MULTI MARKER")
    print(occn)
    ocpn = occn_to_ocpn(occn)
    print(ocpn)

    # Expected OCPN:
    # ---------------------------------------------------------------------
    # Places
    # ---------------------------------------------------------------------
    item_place_names = [
        "p_END_item_i_item",
        "p_END_item_o_item",
        "p_START_item_i_item",
        "p_START_item_o_item",
        "p_a_i_item",
        "p_a_o_item",
        "p_arc(START_item,a)_item",
        "p_arc(a,END_item)_item",
    ]

    order_place_names = [
        "p_END_order_i_order",
        "p_END_order_o_order",
        "p_START_order_i_order",
        "p_START_order_o_order",
        "p_a_i_order",
        "p_a_o_order",
        "p_arc(START_order,a)_order",
        "p_arc(a,END_order)_order",
    ]

    binding_place_names = [
        "p_binding#273_1",
        "p_binding#281_1",
        "p_binding#END_item_input",
        "p_binding#END_order_input",
        "p_binding#START_item_output",
        "p_binding#START_order_output",
        "p_binding#a_input",
        "p_binding#a_output",
        "p_binding_global_input",
    ]

    places = {n: OCPetriNet.Place(n, "item") for n in item_place_names}
    places.update({n: OCPetriNet.Place(n, "order") for n in order_place_names})
    places.update({n: OCPetriNet.Place(n, "_binding") for n in binding_place_names})

    # ---------------------------------------------------------------------
    # Transitions
    # ---------------------------------------------------------------------
    transitions = {
        "END_item": OCPetriNet.Transition("END_item", "END_item"),
        "END_order": OCPetriNet.Transition("END_order", "END_order"),
        "START_item": OCPetriNet.Transition("START_item", "START_item"),
        "START_order": OCPetriNet.Transition("START_order", "START_order"),
        "a": OCPetriNet.Transition("a", "a"),
    }

    for num in [272, 275, 277, 280, 283, 285, 288, 291, 294, 297]:
        transitions[f"_silent#{num}"] = OCPetriNet.Transition(
            f"_silent#{num}", None
        )

    # ---------------------------------------------------------------------
    # Arcs
    # ---------------------------------------------------------------------
    arcs = []

    # transition ➜ place --------------------------------------------------
    connect(
        transitions["END_item"],
        places["p_END_item_o_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["END_item"], places["p_binding_global_input"], "_binding", arcs
    )

    connect(transitions["END_order"], places["p_END_order_o_order"], "order", arcs)
    connect(
        transitions["END_order"], places["p_binding_global_input"], "_binding", arcs
    )

    connect(
        transitions["START_item"],
        places["p_START_item_o_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["START_item"],
        places["p_binding#START_item_output"],
        "_binding",
        arcs,
    )

    connect(
        transitions["START_order"], places["p_START_order_o_order"], "order", arcs
    )
    connect(
        transitions["START_order"],
        places["p_binding#START_order_output"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#272"],
        places["p_arc(START_order,a)_order"],
        "order",
        arcs,
    )
    connect(
        transitions["_silent#272"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#275"],
        places["p_a_i_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#275"], places["p_binding#273_1"], "_binding", arcs)

    connect(transitions["_silent#277"], places["p_a_i_order"], "order", arcs)
    connect(
        transitions["_silent#277"], places["p_binding#a_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#280"],
        places["p_a_i_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#280"], places["p_binding#a_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#283"],
        places["p_arc(a,END_item)_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(transitions["_silent#283"], places["p_binding#281_1"], "_binding", arcs)

    connect(
        transitions["_silent#285"],
        places["p_arc(a,END_order)_order"],
        "order",
        arcs,
    )
    connect(
        transitions["_silent#285"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#288"],
        places["p_arc(a,END_item)_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#288"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#291"],
        places["p_arc(START_item,a)_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#291"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#294"], places["p_END_order_i_order"], "order", arcs
    )
    connect(
        transitions["_silent#294"],
        places["p_binding#END_order_input"],
        "_binding",
        arcs,
    )

    connect(
        transitions["_silent#297"],
        places["p_END_item_i_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        transitions["_silent#297"],
        places["p_binding#END_item_input"],
        "_binding",
        arcs,
    )

    connect(transitions["a"], places["p_a_o_item"], "item", arcs, is_variable=True)
    connect(
        transitions["a"], places["p_a_o_order"], "order", arcs, is_variable=True
    )
    connect(transitions["a"], places["p_binding#a_output"], "_binding", arcs)

    # place ➜ transition ---------------------------------------------------
    connect(
        places["p_END_item_i_item"],
        transitions["END_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(places["p_END_order_i_order"], transitions["END_order"], "order", arcs)

    connect(
        places["p_START_item_i_item"],
        transitions["START_item"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_START_order_i_order"], transitions["START_order"], "order", arcs
    )

    connect(
        places["p_START_item_o_item"],
        transitions["_silent#291"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_START_order_o_order"], transitions["_silent#272"], "order", arcs
    )

    connect(places["p_a_i_item"], transitions["a"], "item", arcs, is_variable=True)
    connect(
        places["p_a_i_order"], transitions["a"], "order", arcs, is_variable=True
    )

    for t in ["_silent#283", "_silent#288"]:
        connect(
            places["p_a_o_item"], transitions[t], "item", arcs, is_variable=True
        )
    connect(places["p_a_o_order"], transitions["_silent#285"], "order", arcs)

    for t in ["_silent#275", "_silent#280"]:
        connect(
            places["p_arc(START_item,a)_item"],
            transitions[t],
            "item",
            arcs,
            is_variable=True,
        )
    connect(
        places["p_arc(START_order,a)_order"],
        transitions["_silent#277"],
        "order",
        arcs,
    )

    connect(
        places["p_arc(a,END_item)_item"],
        transitions["_silent#297"],
        "item",
        arcs,
        is_variable=True,
    )
    connect(
        places["p_arc(a,END_order)_order"],
        transitions["_silent#294"],
        "order",
        arcs,
    )

    connect(places["p_binding#273_1"], transitions["_silent#277"], "_binding", arcs)
    connect(places["p_binding#281_1"], transitions["_silent#285"], "_binding", arcs)

    connect(
        places["p_binding#END_item_input"],
        transitions["END_item"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#END_order_input"],
        transitions["END_order"],
        "_binding",
        arcs,
    )

    connect(
        places["p_binding#START_item_output"],
        transitions["_silent#291"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#START_order_output"],
        transitions["_silent#272"],
        "_binding",
        arcs,
    )

    connect(places["p_binding#a_input"], transitions["a"], "_binding", arcs)
    for t in ["_silent#283", "_silent#288"]:
        connect(places["p_binding#a_output"], transitions[t], "_binding", arcs)

    # p_binding_global_input feeds several transitions
    for tgt in [
        "START_item",
        "START_order",
        "_silent#275",
        "_silent#280",
        "_silent#294",
        "_silent#297",
    ]:
        connect(
            places["p_binding_global_input"], transitions[tgt], "_binding", arcs
        )

    # ---------------------------------------------------------------------
    # Assemble the net
    # ---------------------------------------------------------------------
    ocpn_expected = OCPetriNet(
        name="Expected OCPN",
        places=list(places.values()),
        transitions=list(transitions.values()),
        arcs=arcs,
        initial_marking=None,
        final_marking=None,
    )

    print(ocpn_expected)
    assert (are_ocpn_equal_no_ids(ocpn, ocpn_expected))

def test_conversion_ABC():
    marker_groups = {
        "START_order": {
            "img": [],
            "omg": [
                [("a", "order", (1, 1), 0)],
            ],
        },
        "a": {
            "img": [
                [("START_order", "order", (1, 1), 0)],
            ],
            "omg": [
                [("b", "order", (1, 1), 0)],
            ],
        },
        "b": {
            "img": [
                [("a", "order", (1, 1), 0)],
            ],
            "omg": [
                [("c", "order", (1, 1), 0)],
            ],
        },
        "c": {
            "img": [
                [("b", "order", (1, 1), 0)],
            ],
            "omg": [
                [("END_order", "order", (1, 1), 0)],
            ],
        },
        "END_order": {
            "img": [
                [("c", "order", (1, 1), 0)],
            ]
        },
    }

    occn = OCCausalNet.from_dict(marker_groups)
    print("\nTEST OCCN CONVERSION ABC")
    print(occn)
    ocpn = occn_to_ocpn(occn)
    print(ocpn)

    # Expected OCPN:
    # ---------------------------------------------------------------------
    # Places
    # ---------------------------------------------------------------------
    order_place_names = [
        "p_END_order_i_order",
        "p_END_order_o_order",
        "p_START_order_i_order",
        "p_START_order_o_order",
        "p_a_i_order",
        "p_a_o_order",
        "p_arc(START_order,a)_order",
        "p_arc(a,b)_order",
        "p_arc(b,c)_order",
        "p_arc(c,END_order)_order",
        "p_b_i_order",
        "p_b_o_order",
        "p_c_i_order",
        "p_c_o_order",
    ]

    binding_place_names = [
        "p_binding#END_order_input",
        "p_binding#START_order_output",
        "p_binding#a_input",
        "p_binding#a_output",
        "p_binding#b_input",
        "p_binding#b_output",
        "p_binding#c_input",
        "p_binding#c_output",
        "p_binding_global_input",
    ]

    places = {}

    for name in order_place_names:
        places[name] = OCPetriNet.Place(name, "order")

    for name in binding_place_names:
        places[name] = OCPetriNet.Place(name, "_binding")

    # ---------------------------------------------------------------------
    # Transitions
    # ---------------------------------------------------------------------
    transitions = {
        "END_order": OCPetriNet.Transition("END_order", "END_order"),
        "START_order": OCPetriNet.Transition("START_order", "START_order"),
        "a": OCPetriNet.Transition("a", "a"),
        "b": OCPetriNet.Transition("b", "b"),
        "c": OCPetriNet.Transition("c", "c"),
    }

    for n in [11, 14, 17, 2, 20, 23, 5, 8]:
        t_name = f"_silent#{n}"
        transitions[t_name] = OCPetriNet.Transition(t_name, None)

    # ---------------------------------------------------------------------
    # Arcs
    # ---------------------------------------------------------------------
    arcs = []

    # --- from transitions to places ------------------------------------------------
    connect(transitions["END_order"], places["p_END_order_o_order"], "order", arcs)
    connect(
        transitions["END_order"], places["p_binding_global_input"], "_binding", arcs
    )

    connect(
        transitions["START_order"], places["p_START_order_o_order"], "order", arcs
    )
    connect(
        transitions["START_order"],
        places["p_binding#START_order_output"],
        "_binding",
        arcs,
    )

    connect(transitions["_silent#11"], places["p_a_i_order"], "order", arcs)
    connect(
        transitions["_silent#11"], places["p_binding#a_input"], "_binding", arcs
    )

    connect(transitions["_silent#14"], places["p_arc(a,b)_order"], "order", arcs)
    connect(
        transitions["_silent#14"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(transitions["_silent#17"], places["p_b_i_order"], "order", arcs)
    connect(
        transitions["_silent#17"], places["p_binding#b_input"], "_binding", arcs
    )

    connect(
        transitions["_silent#2"],
        places["p_arc(START_order,a)_order"],
        "order",
        arcs,
    )
    connect(
        transitions["_silent#2"], places["p_binding_global_input"], "_binding", arcs
    )

    connect(transitions["_silent#20"], places["p_arc(b,c)_order"], "order", arcs)
    connect(
        transitions["_silent#20"],
        places["p_binding_global_input"],
        "_binding",
        arcs,
    )

    connect(transitions["_silent#23"], places["p_END_order_i_order"], "order", arcs)
    connect(
        transitions["_silent#23"],
        places["p_binding#END_order_input"],
        "_binding",
        arcs,
    )

    connect(transitions["_silent#5"], places["p_c_i_order"], "order", arcs)
    connect(transitions["_silent#5"], places["p_binding#c_input"], "_binding", arcs)

    connect(
        transitions["_silent#8"], places["p_arc(c,END_order)_order"], "order", arcs
    )
    connect(
        transitions["_silent#8"], places["p_binding_global_input"], "_binding", arcs
    )

    connect(transitions["a"], places["p_a_o_order"], "order", arcs)
    connect(transitions["a"], places["p_binding#a_output"], "_binding", arcs)

    connect(transitions["b"], places["p_b_o_order"], "order", arcs)
    connect(transitions["b"], places["p_binding#b_output"], "_binding", arcs)

    connect(transitions["c"], places["p_c_o_order"], "order", arcs)
    connect(transitions["c"], places["p_binding#c_output"], "_binding", arcs)

    # --- from places to transitions -------------------------------------------------
    connect(places["p_END_order_i_order"], transitions["END_order"], "order", arcs)
    connect(
        places["p_START_order_i_order"], transitions["START_order"], "order", arcs
    )

    connect(
        places["p_START_order_o_order"], transitions["_silent#2"], "order", arcs
    )
    connect(places["p_a_i_order"], transitions["a"], "order", arcs)
    connect(places["p_a_o_order"], transitions["_silent#14"], "order", arcs)

    connect(
        places["p_arc(START_order,a)_order"],
        transitions["_silent#11"],
        "order",
        arcs,
    )
    connect(places["p_arc(a,b)_order"], transitions["_silent#17"], "order", arcs)
    connect(places["p_arc(b,c)_order"], transitions["_silent#5"], "order", arcs)
    connect(
        places["p_arc(c,END_order)_order"], transitions["_silent#23"], "order", arcs
    )

    connect(places["p_b_i_order"], transitions["b"], "order", arcs)
    connect(places["p_b_o_order"], transitions["_silent#20"], "order", arcs)

    connect(
        places["p_binding#END_order_input"],
        transitions["END_order"],
        "_binding",
        arcs,
    )
    connect(
        places["p_binding#START_order_output"],
        transitions["_silent#2"],
        "_binding",
        arcs,
    )

    connect(places["p_binding#a_input"], transitions["a"], "_binding", arcs)
    connect(
        places["p_binding#a_output"], transitions["_silent#14"], "_binding", arcs
    )

    connect(places["p_binding#b_input"], transitions["b"], "_binding", arcs)
    connect(
        places["p_binding#b_output"], transitions["_silent#20"], "_binding", arcs
    )

    connect(places["p_binding#c_input"], transitions["c"], "_binding", arcs)
    connect(
        places["p_binding#c_output"], transitions["_silent#8"], "_binding", arcs
    )

    # p_binding_global_input produces tokens for several transitions
    for t in ["START_order", "_silent#11", "_silent#17", "_silent#23", "_silent#5"]:
        connect(places["p_binding_global_input"], transitions[t], "_binding", arcs)

    connect(places["p_c_i_order"], transitions["c"], "order", arcs)
    connect(places["p_c_o_order"], transitions["_silent#8"], "order", arcs)

    # ---------------------------------------------------------------------
    # Assemble the net
    # ---------------------------------------------------------------------
    ocpn_expected = OCPetriNet(
        name="Expected OCPN ABC",
        places=list(places.values()),
        transitions=list(transitions.values()),
        arcs=arcs,
        initial_marking=None,
        final_marking=None,
    )

    print(ocpn_expected)
    assert (are_ocpn_equal_no_ids(ocpn, ocpn_expected))

def test_conversion_isolated():
    arcs = dict()
    arcs["a"] = {}
    arcs["START_order"] = {}
    arcs["END_order"] = {}

    occn = OCCausalNet(
        nx.MultiDiGraph(arcs),
        {},
        {},
    )

    print("\nTEST OCCN CONVERSION ISOLATED")
    print(occn)
    ocpn = occn_to_ocpn(occn)
    print(ocpn)

    # Expected OCPN:
    # ---------------------------------------------------------------------
    # Places
    # ---------------------------------------------------------------------
    binding_place_names = [
        "p_binding#END_order_input",
        "p_binding#START_order_output",
        "p_binding#a_input",
        "p_binding#a_output",
        "p_binding_global_input",
    ]

    places = {n: OCPetriNet.Place(n, "_binding") for n in binding_place_names}

    # ---------------------------------------------------------------------
    # Transitions
    # ---------------------------------------------------------------------
    transitions = {
        "END_order": OCPetriNet.Transition("END_order", "END_order"),
        "START_order": OCPetriNet.Transition("START_order", "START_order"),
        "a": OCPetriNet.Transition("a", "a"),
    }

    # ---------------------------------------------------------------------
    # Arcs
    # ---------------------------------------------------------------------
    arcs = []

    # transition ➜ place
    connect(
        transitions["END_order"], places["p_binding_global_input"], "_binding", arcs
    )
    connect(
        transitions["START_order"],
        places["p_binding#START_order_output"],
        "_binding",
        arcs,
    )
    connect(transitions["a"], places["p_binding#a_output"], "_binding", arcs)

    # place ➜ transition
    connect(
        places["p_binding#END_order_input"],
        transitions["END_order"],
        "_binding",
        arcs,
    )
    connect(places["p_binding#a_input"], transitions["a"], "_binding", arcs)
    connect(
        places["p_binding_global_input"],
        transitions["START_order"],
        "_binding",
        arcs,
    )

    # ---------------------------------------------------------------------
    # Assemble the net
    # ---------------------------------------------------------------------
    ocpn_expected = OCPetriNet(
        name="Expected OCPN",
        places=list(places.values()),
        transitions=list(transitions.values()),
        arcs=arcs,
        initial_marking=None,
        final_marking=None,
    )

    print(ocpn_expected)
    assert (are_ocpn_equal_no_ids(ocpn, ocpn_expected))
        
        
def are_ocpn_equal_no_ids(ocpn1, ocpn2):
    """
    Compare two OCPNs without considering the IDs of the places, transitions and arcs.
    E.g., places with names "p_binding#79_1[_binding]" and "p_binding#12_2[_binding]" are considered equal if their arcs are the same.

    Ignores `properties` and `name` attributes of ocpns.

    Parameters
    ----------
    ocpn1 : OCPN
        The first OCPN to compare.
    ocpn2 : OCPN
        The second OCPN to compare.

    Returns
    -------
    bool
        True if the OCPNs are equal (ignoring IDs), False otherwise.
    """

    def are_names_equal_no_ids(name1, name2):
        """
        Compare two names without considering their IDs.

        If both names contain an id (format #n or #n_m where n,m are natural numbers),
        the ids are ignored for the comparison.
        """
        # Regex pattern to match #n or #n_m where n and m are natural numbers
        id_pattern = r"#\d+(?:_\d+)?"

        id1 = re.search(id_pattern, name1)
        id2 = re.search(id_pattern, name2)

        if not id1 and not id2:
            return name1 == name2

        if bool(id1) != bool(id2):
            return False

        # Remove the ID
        name1_cleaned = re.sub(id_pattern, "", name1)
        name2_cleaned = re.sub(id_pattern, "", name2)

        return name1_cleaned == name2_cleaned

    def are_places_equal(place1, place2):
        """
        Compare the name and object type of two places without considering their IDs.
        """
        if not are_names_equal_no_ids(place1.name, place2.name):
            return False

        if place1.object_type != place2.object_type:
            return False

        return True

    def are_transitions_equal(transition1, transition2):
        """
        Compare the name of two transitions without considering their IDs.
        """
        if not are_names_equal_no_ids(transition1.name, transition2.name):
            return False

        return True

    def are_arcs_equal(arc1, arc2):
        """
        Compare two arcs without considering IDs for their names and names of their source/target.
        Does not consider the `properties` attribute of the arcs.
        """

        def are_ocpn_elements_equal(el1, el2):
            """
            Compare two OCPetriNet elements (Place or Transition)
            """
            if type(el1) != type(el2):
                return False

            if isinstance(el1, OCPetriNet.Place):
                return are_places_equal(el1, el2)

            if isinstance(el1, OCPetriNet.Transition):
                return are_transitions_equal(el1, el2)

            return False

        # Compare source
        if not are_ocpn_elements_equal(arc1.source, arc2.source):
            return False

        # Compare target
        if not are_ocpn_elements_equal(arc1.target, arc2.target):
            return False

        if arc1.object_type != arc2.object_type:
            return False

        if arc1.is_variable != arc2.is_variable:
            return False

        return True

    def are_sets_equal(set1, set2, are_items_equal):
        """
        Compare two sets of items using the provided `are_items_equal` function.
        Assumes a bijection between items in each set if they are considered equal.

        Args:
            set1 (Iterable): First set of items.
            set2 (Iterable): Second set of items.
            are_items_equal (Callable): Function taking two arguments and returning True if they are equal.

        Returns:
            bool: True if sets are equal under the equality function, False otherwise.
        """
        if len(set1) != len(set2):
            return False

        # keep track of used items from set2; we will not reuse them as we assume a bijection
        used = set()
        for item1 in set1:
            found_match = False
            for item2 in set2:
                if item2 not in used and are_items_equal(item1, item2):
                    used.add(item2)
                    found_match = True
                    break
            if not found_match:
                return False
        return True

    if ocpn1.initial_marking != ocpn2.initial_marking:
        return False

    if ocpn1.final_marking != ocpn2.final_marking:
        return False

    # Check places
    # we do not need to check the arcs of the places here since we compare the arcs of the ocpns at the end
    if not are_sets_equal(ocpn1.places, ocpn2.places, are_places_equal):
        return False

    # Check transitions
    # we do not need to check the arcs of the transitions here since we compare the arcs of the ocpns at the end
    if not are_sets_equal(ocpn1.transitions, ocpn2.transitions, are_transitions_equal):
        return False

    # Check arcs
    if not are_sets_equal(ocpn1.arcs, ocpn2.arcs, are_arcs_equal):
        return False

    return True


def connect(source, target, object_type, arcs, *, is_variable=False):
    """
    Create an OCPetriNet.Arc, attach it to source/target, store it in `arcs`, and return it.
    """
    arc = OCPetriNet.Arc(source, target, object_type, is_variable=is_variable)
    source.add_out_arc(arc)
    target.add_in_arc(arc)
    arcs.append(arc)
    return arc
