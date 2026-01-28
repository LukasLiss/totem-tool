import pytest
from collections import Counter
from totem_lib import OCCausalNetSemantics, OCCausalNetState
from tests.assets.example_occns import (
    occn_basic,
    occn_basic_2,
    occn_multi,
    occn_multi_marker,
    occn_multi_ot_multi_min_0,
    occn_multi_ot_multi_arc,
    occn_multi_ot_multi_marker,
    occn_multi_ot_multi_marker_redundant_mg,
    occn_start_parallel,
)

# --- Helper Functions for Constructing Bindings & Sequences ---


def make_binding(act, cons=None, prod=None):
    """Helper to create an ExternalBinding tuple structure."""
    return (act, cons if cons else {}, prod if prod else {})


def make_flow(rel_act, ot, obj_ids):
    """Helper to create the nested dictionary flow structure."""
    return {rel_act: {ot: set(obj_ids)}} if obj_ids is not None else {}


def merge_flows(*flows):
    """Merges multiple flow dictionaries."""
    result = {}
    for f in flows:
        for rel_act, inner in f.items():
            if rel_act not in result:
                result[rel_act] = {}
            for ot, objs in inner.items():
                if ot not in result[rel_act]:
                    result[rel_act][ot] = set()
                result[rel_act][ot].update(objs)
    return result


def consumed_from_bindings(bindings):
    """
    Helper to extract consumed objects from a list of InternalBinding tuples.
    Returns a list of sets of consumed object IDs.
    """
    consumed_sets = []
    for b in bindings:
        _, cons, _ = b

        rel_grp = cons[0]
        ot_grp = rel_grp[1][0]
        objs = set(ot_grp[1])
        consumed_sets.append(objs)
    return consumed_sets


def produced_from_bindings(bindings):
    """
    Helper to extract produced objects from a list of InternalBinding tuples.
    Returns a list of sets of produced object IDs.
    """
    produced_sets = []
    for b in bindings:
        _, _, prod = b

        rel_grp = prod[0]
        ot_grp = rel_grp[1][0]
        objs = set(ot_grp[1])
        produced_sets.append(objs)
    return produced_sets


def extract_all_ids_from_flow(flow_tuple):
    """
    Helper to flatten all object IDs from an InternalFlow tuple into a single set.
    Handles multiple related activities and object types.
    """
    all_ids = set()
    if not flow_tuple:
        return all_ids
    for rel_act_group in flow_tuple:
        type_groups = rel_act_group[1]
        for ot_group in type_groups:
            all_ids.update(ot_group[1])
    return all_ids


# --- Test Data Setup ---

# Sequences for occn_basic
SEQ_BASIC_VALID = [
    make_binding("START_order", None, make_flow("a", "order", ["o1"])),
    make_binding("START_item", None, make_flow("a", "item", ["i1"])),
    make_binding(
        "a",
        merge_flows(
            make_flow("START_order", "order", ["o1"]),
            make_flow("START_item", "item", ["i1"]),
        ),
        merge_flows(
            make_flow("END_order", "order", ["o1"]),
            make_flow("END_item", "item", ["i1"]),
        ),
    ),
    make_binding("END_order", make_flow("a", "order", ["o1"]), None),
    make_binding("END_item", make_flow("a", "item", ["i1"]), None),
]

# Sequence omitting the final consumption (net not empty at end)
SEQ_BASIC_INCOMPLETE = SEQ_BASIC_VALID[:-1]

# Sequence with invalid object binding (consuming o2 instead of o1)
SEQ_BASIC_INVALID_OBJ = list(SEQ_BASIC_VALID)
SEQ_BASIC_INVALID_OBJ[2] = make_binding(
    "a",
    merge_flows(
        make_flow("START_order", "order", ["o2"]),  # o2 does not exist
        make_flow("START_item", "item", ["i1"]),
    ),
    merge_flows(
        make_flow("END_order", "order", ["o2"]), make_flow("END_item", "item", ["i1"])
    ),
)

# Sequence with invalid activity (this should NOT raise an exception)
SEQ_BASIC_INVALID_ACTIVITY = list(SEQ_BASIC_VALID)
SEQ_BASIC_INVALID_ACTIVITY = (
    SEQ_BASIC_INVALID_ACTIVITY[:1]
    + [
        make_binding(
            "aa",
            merge_flows(
                make_flow("START_order", "order", ["o1"]),
                make_flow("START_item", "item", ["i1"]),
            ),
            merge_flows(
                make_flow("END_order", "order", ["o1"]),
                make_flow("END_item", "item", ["i1"]),
            ),
        ),
    ]
    + SEQ_BASIC_INVALID_ACTIVITY[2:]
)

# Duplicate binding
SEQ_BASIC_INVALID_DUPLICATE = (
    SEQ_BASIC_VALID[:1] + [SEQ_BASIC_VALID[1]] * 2 + SEQ_BASIC_VALID[2:]
)

# Omitting Prod
SEQ_BASIC_INVALID_PROD_OMIT = list(SEQ_BASIC_VALID)
SEQ_BASIC_INVALID_PROD_OMIT = (
    SEQ_BASIC_INVALID_PROD_OMIT[:1]
    + [
        make_binding(
            "a",
            merge_flows(
                make_flow("START_order", "order", ["o1"]),
                make_flow("START_item", "item", ["i1"]),
            ),
            merge_flows(
                make_flow("END_order", "order", None),
                make_flow("END_item", "item", ["i1"]),
            ),
        ),
    ]
    + SEQ_BASIC_INVALID_PROD_OMIT[2:]
)

# Omitting Cons
SEQ_BASIC_INVALID_CONS_OMIT = list(SEQ_BASIC_VALID)
SEQ_BASIC_INVALID_CONS_OMIT = (
    SEQ_BASIC_INVALID_CONS_OMIT[:1]
    + [
        make_binding(
            "a",
            merge_flows(
                make_flow("START_order", "order", [""]),
                make_flow("START_item", "item", ["i1"]),
            ),
            merge_flows(
                make_flow("END_order", "order", ["o1"]),
                make_flow("END_item", "item", ["i1"]),
            ),
        ),
    ]
    + SEQ_BASIC_INVALID_CONS_OMIT[2:]
)


# --- Tests ---


class TestOCCausalNetSemantics:

    @pytest.mark.parametrize(
        "occn_factory, sequence, expected_result",
        [
            (occn_basic, SEQ_BASIC_VALID, True),
            (occn_basic, SEQ_BASIC_INCOMPLETE, False),
            (occn_basic, SEQ_BASIC_INVALID_OBJ, False),
            (occn_basic, SEQ_BASIC_INVALID_ACTIVITY, False),
            (occn_basic, SEQ_BASIC_INVALID_DUPLICATE, False),
            (occn_basic, SEQ_BASIC_INVALID_PROD_OMIT, False),
            (occn_basic, SEQ_BASIC_INVALID_CONS_OMIT, False),
            # Case: Empty Sequence
            (occn_basic, [], True),
            # occn_multi
            (
                occn_multi,
                [
                    make_binding(
                        "START_order", None, make_flow("a", "order", ["o1", "o2"])
                    ),
                    make_binding(
                        "a",
                        make_flow("START_order", "order", ["o1", "o2"]),
                        make_flow("END_order", "order", ["o1", "o2"]),
                    ),
                    make_binding(
                        "END_order", make_flow("a", "order", ["o1", "o2"]), None
                    ),
                ],
                True,
            ),
            # occn_multi (Consuming only 1 when produced 2, leftover in state)
            (
                occn_multi,
                [
                    make_binding(
                        "START_order", None, make_flow("a", "order", ["o1", "o2"])
                    ),
                    make_binding(
                        "a",
                        make_flow("START_order", "order", ["o1"]),
                        make_flow("END_order", "order", ["o1"]),
                    ),
                    make_binding("END_order", make_flow("a", "order", ["o1"]), None),
                ],
                False,
            ),
        ],
    )
    def test_replay(self, occn_factory, sequence, expected_result):
        """
        Tests the replay function with various valid and invalid sequences.
        """
        occn = occn_factory()
        assert OCCausalNetSemantics.replay(occn, sequence) == expected_result

    def test_bind_activity_valid(self):
        """
        Tests executing a valid binding on a state.
        """
        state = OCCausalNetState({"a": Counter([("START_order", "o1", "order")])})

        binding = make_binding(
            "a",
            make_flow("START_order", "order", ["o1"]),
            make_flow("END_order", "order", ["o1"]),
        )

        new_state = OCCausalNetSemantics.bind_activity(binding, state)

        # Assertions
        assert new_state["a"] == Counter()  # Consumed
        assert new_state["END_order"] == Counter([("a", "o1", "order")])  # Produced

    @pytest.mark.parametrize(
        "occn_factory, initial_state, expected_activities",
        [
            (occn_basic, OCCausalNetState(), set()),
            (
                occn_basic,
                OCCausalNetState(
                    {
                        "a": Counter(
                            [
                                ("START_order", "o1", "order"),
                                ("START_item", "i1", "item"),
                            ]
                        )
                    }
                ),
                {"a"},
            ),
            (
                occn_basic,
                OCCausalNetState({"a": Counter([("START_order", "o1", "order")])}),
                set(),
            ),
            (
                occn_basic,
                OCCausalNetState({"END_order": Counter([("a", "o1", "order")])}),
                {"END_order"},
            ),
        ],
    )
    def test_enabled_activities(self, occn_factory, initial_state, expected_activities):
        """
        Tests detection of enabled activities based on state.
        """
        occn = occn_factory()
        enabled = OCCausalNetSemantics.enabled_activities(
            occn, initial_state, include_start_activities=False
        )
        assert enabled == expected_activities

    # Same but with START activities
    @pytest.mark.parametrize(
        "occn_factory, initial_state, expected_activities",
        [
            # Empty State -> Start activities enabled
            (occn_basic, OCCausalNetState(), {"START_order", "START_item"}),
            # State with obligations for 'a' -> 'a' and Start activities enabled
            (
                occn_basic,
                OCCausalNetState(
                    {
                        "a": Counter(
                            [
                                ("START_order", "o1", "order"),
                                ("START_item", "i1", "item"),
                            ]
                        )
                    }
                ),
                {"START_order", "START_item", "a"},
            ),
            # State missing one requirement for 'a' (needs order AND item) -> 'a' NOT enabled
            (
                occn_basic,
                OCCausalNetState({"a": Counter([("START_order", "o1", "order")])}),
                {"START_order", "START_item"},
            ),
            # State ready for END -> END enabled
            (
                occn_basic,
                OCCausalNetState({"END_order": Counter([("a", "o1", "order")])}),
                {"START_order", "START_item", "END_order"},
            ),
        ],
    )
    def test_enabled_activities_with_START(
        self, occn_factory, initial_state, expected_activities
    ):
        """
        Tests detection of enabled activities based on state.
        """
        occn = occn_factory()
        enabled = OCCausalNetSemantics.enabled_activities(
            occn, initial_state, include_start_activities=True
        )
        assert enabled == expected_activities

    def test_enabled_activities_with_indices(self):
        """
        Tests enabled_activities when using integer indices instead of strings.
        """
        occn = occn_basic()
        # Mapping: START_order->0, START_item->1, a->2, END_order->3, END_item->4
        # Object Types: order->10, item->11
        act_to_idx = {
            "START_order": 0,
            "START_item": 1,
            "a": 2,
            "END_order": 3,
            "END_item": 4,
        }
        ot_to_idx = {"order": 10, "item": 11}

        # State using indices: 'a'(2) has obligation from 'START_order'(0) for obj 'o1' type 'order'(10)
        state_idx = OCCausalNetState({2: Counter([(0, "o1", 10), (1, "i1", 11)])})

        # Should enable 'a'
        enabled = OCCausalNetSemantics.enabled_activities(
            occn,
            state_idx,
            include_start_activities=False,
            act_to_idx=act_to_idx,
            ot_to_idx=ot_to_idx,
        )
        assert "a" in enabled
        assert len(enabled) == 1

    @pytest.mark.parametrize(
        "available_count, should_be_enabled",
        [
            (0, False),
            (1, False),
            (2, True),
            (3, True),
        ],
    )
    def test_is_enabled_cardinality(self, available_count, should_be_enabled):
        """
        Tests is_enabled logic regarding marker counts.
        Using occn_multi_marker where 'a' requires 2 orders from START.
        """
        occn = occn_multi_marker()

        # Construct state
        obligations = []
        for i in range(available_count):
            obligations.append(("START_order", f"o{i}", "order"))

        state = OCCausalNetState({"a": Counter(obligations)})

        assert OCCausalNetSemantics.is_enabled(occn, "a", state) == should_be_enabled

    def test_is_binding_enabled(self):
        """
        Tests checking if a specific binding structure is enabled in the current state.
        """
        occn = occn_basic()
        state = OCCausalNetState(
            {
                "a": Counter(
                    [("START_order", "o1", "order"), ("START_item", "i1", "item")]
                )
            }
        )

        # Valid Binding
        binding_valid = make_binding(
            "a",
            merge_flows(
                make_flow("START_order", "order", ["o1"]),
                make_flow("START_item", "item", ["i1"]),
            ),
            merge_flows(
                make_flow("END_order", "order", ["o1"]),
                make_flow("END_item", "item", ["i1"]),
            ),
        )
        assert (
            OCCausalNetSemantics.is_binding_enabled(occn, binding_valid, state)
            is not None
        )

        # Invalid Binding (Object not in state)
        binding_invalid_obj = make_binding(
            "a",
            merge_flows(
                make_flow("START_order", "order", ["o99"]),
                make_flow("START_item", "item", ["i1"]),
            ),
            make_flow("END_order", "order", ["o99"]),
        )
        assert (
            OCCausalNetSemantics.is_binding_enabled(occn, binding_invalid_obj, state)
            is None
        )

        # Invalid Binding (Producing wrong object type)
        binding_invalid_prod = make_binding(
            "a",
            merge_flows(
                make_flow("START_order", "order", ["o1"]),
                make_flow("START_item", "item", ["i1"]),
            ),
            make_flow("END_order", "item", ["o1"]),  # Wrong type produced
        )
        assert (
            OCCausalNetSemantics.is_binding_enabled(occn, binding_invalid_prod, state)
            is None
        )

        # Invalid Binding (Invalid activity) should NOT raise an exception
        binding_invalid_act = make_binding(
            "aa",
            merge_flows(
                make_flow("START_order", "order", ["o1"]),
                make_flow("START_item", "item", ["i1"]),
            ),
            merge_flows(
                make_flow("END_order", "order", ["o1"]),
                make_flow("END_item", "item", ["i1"]),
            ),
        )
        assert (
            OCCausalNetSemantics.is_binding_enabled(occn, binding_invalid_act, state)
            is None
        )

        # Invalid Binding (predecessor does not exist)
        binding_invalid_pred = make_binding(
            "END_order", make_flow("b", "order", ["o1"]), None  # 'b' does not exist
        )
        assert (
            OCCausalNetSemantics.is_binding_enabled(occn, binding_invalid_pred, state)
            is None
        )

    @pytest.mark.parametrize(
        "occn_factory, activity, state_dict, expected_pairs",
        [
            # Case 1: occn_multi (1..-1) - Standard single type cardinality
            (
                occn_multi,
                "a",
                {"a": [("START_order", "o1", "order"), ("START_order", "o2", "order")]},
                [({"o1"}, {"o1"}), ({"o2"}, {"o2"}), ({"o1", "o2"}, {"o1", "o2"})],
            ),
            # Case 2: occn_basic (1..1) - Multi-object type (Order + Item)
            # Must consume both and produce both
            (
                occn_basic,
                "a",
                {"a": [("START_order", "o1", "order"), ("START_item", "i1", "item")]},
                [({"o1", "i1"}, {"o1", "i1"})],
            ),
            # Case 3: occn_multi_ot_multi_min_0 (Optional item)
            # Subcase 3a: Only Order available. Should enable binding consuming only order.
            (
                occn_multi_ot_multi_min_0,
                "a",
                {"a": [("START_order", "o1", "order")]},
                [({"o1"}, {"o1"})],
            ),
            # Subcase 3b: Order and Item available.
            # Should enable two bindings: one consuming both, one consuming only order (item is optional).
            (
                occn_multi_ot_multi_min_0,
                "a",
                {"a": [("START_order", "o1", "order"), ("START_item", "i1", "item")]},
                [
                    ({"o1", "i1"}, {"o1", "i1"}),  # Consume both
                    ({"o1"}, {"o1"}),  # Consume only order
                ],
            ),
            # Empty state
            (
                occn_multi_ot_multi_min_0,
                "a",
                {},
                [
                    # No enabled bindings
                ],
            ),
            # occn_basic_2
            (
                occn_basic_2,
                "s",
                {
                    "s": [
                        ("e", "c1", "container"),
                        ("b", "o1", "order"),
                        ("b", "o2", "order"),
                        ("d", "b1", "box"),
                    ]
                },
                [
                    ({"c1", "o1"}, {"c1", "o1"}),
                    ({"b1", "o1"}, {"b1", "o1"}),
                    ({"b1", "o2"}, {"b1", "o2"}),
                    ({"c1", "o2"}, {"c1", "o2"}),
                    ({"c1", "o1", "o2"}, {"c1", "o1", "o2"}),
                ],
            ),
        ],
    )
    def test_enabled_bindings_combinatorics(
        self, occn_factory, activity, state_dict, expected_pairs
    ):
        """
        Tests the generation of all enabled bindings (combinatorics) by verifying
        that the produced bindings match the expected pairs of (consumed_ids, produced_ids).
        """
        occn = occn_factory()

        # Construct state from simpler list-of-tuples format
        state_data = {act: Counter(obligs) for act, obligs in state_dict.items()}
        state = OCCausalNetState(state_data)

        bindings = OCCausalNetSemantics.enabled_bindings(occn, activity, state)

        # Verify count
        assert len(bindings) == len(expected_pairs)

        # Extract actual pairs
        actual_pairs = []
        for b in bindings:
            _, cons_internal, prod_internal = b
            c_set = extract_all_ids_from_flow(cons_internal)
            p_set = extract_all_ids_from_flow(prod_internal)
            actual_pairs.append((c_set, p_set))

        # Verify contents (order independent)
        # We assume expected_pairs contains unique scenarios
        for exp_cons, exp_prod in expected_pairs:
            match_found = False
            for act_cons, act_prod in actual_pairs:
                if act_cons == exp_cons and act_prod == exp_prod:
                    match_found = True
                    break
            assert (
                match_found
            ), f"Expected pair ({exp_cons}, {exp_prod}) not found in actual bindings: {actual_pairs}"

    def test_enabled_bindings_multi_arc(self):
        """
        Uses occn_multi_ot_multi_arc.
        """
        occn = occn_multi_ot_multi_arc()

        state = OCCausalNetState()
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert enabled_bindings == ()

        state = OCCausalNetState({"a": Counter([("START_order", "o1", "order")])})
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert len(enabled_bindings) == 0

        state = OCCausalNetState(
            {
                "a": Counter(
                    [("START_order", "o1", "order"), ("START_item", "i1", "item")]
                )
            }
        )
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert len(enabled_bindings) == 1

        state = OCCausalNetState(
            {
                "a": Counter(
                    [
                        ("START_order", "o1", "order"),
                        ("START_item", "i1", "item"),
                        ("START_item", "i2", "item"),
                    ]
                )
            }
        )
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert len(enabled_bindings) == 3

    def test_enabled_bindings_multi_min_0(self):
        """
        Uses occn_multi_ot_multi_min_0 (item consumption optional 0..-1).
        """
        occn = occn_multi_ot_multi_min_0()

        state = OCCausalNetState()
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert enabled_bindings == ()

        state = OCCausalNetState({"a": Counter([("START_order", "o1", "order")])})
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert len(enabled_bindings) == 1

        state = OCCausalNetState(
            {
                "a": Counter(
                    [("START_order", "o1", "order"), ("START_item", "i1", "item")]
                )
            }
        )
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert len(enabled_bindings) == 2

        state = OCCausalNetState(
            {
                "a": Counter(
                    [
                        ("START_order", "o1", "order"),
                        ("START_item", "i1", "item"),
                        ("START_item", "i2", "item"),
                    ]
                )
            }
        )
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert len(enabled_bindings) == 4

    def test_enabled_bindings_indices(self):
        """
        Tests usage of IDs/Indices.
        """
        act_to_idx = {
            "START_order": 0,
            "START_item": 1,
            "a": 2,
            "b": 3,
            "END_order": 4,
            "END_item": 5,
        }

        ot_to_idx = {"order": 0, "item": 1}

        occn = occn_multi_ot_multi_min_0()

        state = OCCausalNetState()
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert enabled_bindings == ()

        # State using indices: Act 2 ('a') has obligation from Act 0 ('START_order')
        state = OCCausalNetState({2: Counter([(0, "o1", 0)])})
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(
            occn, "a", state, act_to_idx, ot_to_idx
        )
        assert len(enabled_bindings) == 1

        state = OCCausalNetState({2: Counter([(0, "o1", 0), (1, "i1", 1)])})
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(
            occn, "a", state, act_to_idx, ot_to_idx
        )
        assert len(enabled_bindings) == 2

        state = OCCausalNetState(
            {2: Counter([(0, "o1", 0), (1, "i1", 1), (1, "i2", 1)])}
        )
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(
            occn, "a", state, act_to_idx, ot_to_idx
        )
        assert len(enabled_bindings) == 4

    def test_enabled_bindings_multi_marker(self):
        """
        Uses occn_multi_ot_multi_marker.
        """
        occn = occn_multi_ot_multi_marker()

        state = OCCausalNetState()
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert enabled_bindings == ()

        state = OCCausalNetState({"a": Counter([("START_order", "o1", "order")])})
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert enabled_bindings == ()

        state = OCCausalNetState(
            {
                "a": Counter(
                    [("START_order", "o1", "order"), ("START_item", "i1", "item")]
                )
            }
        )
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert len(enabled_bindings) == 2

        state = OCCausalNetState({"a": Counter([("START_item", "i1", "item")])})
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert len(enabled_bindings) == 1

        state = OCCausalNetState(
            {
                "a": Counter(
                    [
                        ("START_order", "o1", "order"),
                        ("START_item", "i1", "item"),
                        ("START_item", "i1", "item"),
                    ]
                )
            }
        )
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert len(enabled_bindings) == 2

        state = OCCausalNetState(
            {
                "a": Counter(
                    [
                        ("START_order", "o1", "order"),
                        ("START_item", "i1", "item"),
                        ("START_item", "i2", "item"),
                    ]
                )
            }
        )
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert len(enabled_bindings) == 6

    def test_enabled_bindings_redundant_mg(self):
        """
        Uses occn_multi_ot_multi_marker_redundant_mg.
        """
        occn = occn_multi_ot_multi_marker_redundant_mg()

        state = OCCausalNetState()
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert enabled_bindings == ()

        state = OCCausalNetState({"a": Counter([("START_order", "o1", "order")])})
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert enabled_bindings == ()

        state = OCCausalNetState(
            {
                "a": Counter(
                    [("START_order", "o1", "order"), ("START_item", "i1", "item")]
                )
            }
        )
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert len(enabled_bindings) == 2

        state = OCCausalNetState({"a": Counter([("START_item", "i1", "item")])})
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert len(enabled_bindings) == 1

        state = OCCausalNetState(
            {
                "a": Counter(
                    [
                        ("START_order", "o1", "order"),
                        ("START_item", "i1", "item"),
                        ("START_item", "i1", "item"),
                    ]
                )
            }
        )
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert len(enabled_bindings) == 2

        state = OCCausalNetState(
            {
                "a": Counter(
                    [
                        ("START_order", "o1", "order"),
                        ("START_item", "i1", "item"),
                        ("START_item", "i2", "item"),
                    ]
                )
            }
        )
        enabled_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert len(enabled_bindings) == 6


    @pytest.mark.parametrize(
        "occn_factory, activity, object_type, objects, expected_produced_sets",
        [
            (occn_basic, "START_order", "order", {"o1", "o2"}, [{"o1"}, {"o2"}]),
            (
                occn_multi,
                "START_order",
                "order",
                {"o1", "o2"},
                [{"o1"}, {"o2"}, {"o1", "o2"}],
            ),
        ],
    )
    def test_enabled_bindings_start_activity(
        self, occn_factory, activity, object_type, objects, expected_produced_sets
    ):
        """
        Tests generation of bindings for a START activity.
        Should generate powerset of given objects (min 1).
        """
        occn = occn_factory()

        bindings = OCCausalNetSemantics.enabled_bindings_start_activity(
            occn, activity, object_type, objects
        )

        assert len(bindings) == len(expected_produced_sets)
        produced_sets = produced_from_bindings(bindings)
        for expected_set in expected_produced_sets:
            assert expected_set in produced_sets

    def test_enabled_start_bindings_parallel(self):
        """
        Uses occn_start_parallel.
        """
        occn = occn_start_parallel()

        enabled_bindings = OCCausalNetSemantics.enabled_bindings_start_activity(
            occn, "START_order", "order", set()
        )
        assert len(enabled_bindings) == 0

        enabled_bindings = OCCausalNetSemantics.enabled_bindings_start_activity(
            occn, "START_order", "order", {"o1"}
        )
        assert len(enabled_bindings) == 3

        enabled_bindings = OCCausalNetSemantics.enabled_bindings_start_activity(
            occn, "START_order", "order", {"o1", "o2"}
        )
        # Combinations logic:
        # o1 only (3 bindings), o2 only (3 bindings)
        # {o1, o2} (4 bindings):
        #   OMG2(a): {a: {o1,o2}} (1)
        #   OMG3(b): {b: {o1,o2}} (1)
        #   OMG1(a,b): {a:{o1}, b:{o2}} and {a:{o2}, b:{o1}} (2)
        # Total = 10
        assert len(enabled_bindings) == 10

        for binding in enabled_bindings:
            # Internal Binding structure is (act, cons, prod)
            # We reconstruct prod to External dictionary format to verify validity
            _, _, prod_tuple = binding

            prod_dict = {}
            if prod_tuple:
                for succ, obj_per_ot in prod_tuple:
                    prod_dict[succ] = {}
                    for ot, objects in obj_per_ot:
                        prod_dict[succ][ot] = set(objects)

            assert (
                OCCausalNetSemantics.is_binding_enabled(
                    occn, ("START_order", None, prod_dict), OCCausalNetState()
                )
                is not None
            )

    def test_zero_cardinality_consumption(self):
        """
        Tests handling of min_count=0 (optional consumption).
        """
        occn = occn_multi_ot_multi_min_0()
        # 'a' takes START_order(1,1) AND START_item(0,-1).

        # Only Order available. Should be enabled (item is optional).
        state_only_order = OCCausalNetState(
            {"a": Counter([("START_order", "o1", "order")])}
        )
        assert OCCausalNetSemantics.is_enabled(occn, "a", state_only_order)

        # Order and Item available. Should be enabled.
        state_both = OCCausalNetState(
            {
                "a": Counter(
                    [("START_order", "o1", "order"), ("START_item", "i1", "item")]
                )
            }
        )
        assert OCCausalNetSemantics.is_enabled(occn, "a", state_both)

        # Only Item available. Should NOT be enabled (Order is mandatory).
        state_only_item = OCCausalNetState(
            {"a": Counter([("START_item", "i1", "item")])}
        )
        assert not OCCausalNetSemantics.is_enabled(occn, "a", state_only_item)

    def test_internal_external_binding_conversion(self):
        """
        Tests the private method _internal_binding_to_external indirectly
        or ensuring public methods handle both formats if applicable.
        """
        occn = occn_basic()
        state = OCCausalNetState(
            {
                "a": Counter(
                    [("START_order", "o1", "order"), ("START_item", "i1", "item")]
                )
            }
        )

        internal_bindings = OCCausalNetSemantics.enabled_bindings(occn, "a", state)
        assert len(internal_bindings) > 0
        internal_b = internal_bindings[0]

        # This acts as a test for _get_external_binding / _internal_binding_to_external
        try:
            OCCausalNetSemantics.bind_activity(internal_b, state)
        except TypeError:
            pytest.fail("bind_activity failed to accept/convert InternalBinding tuple")
