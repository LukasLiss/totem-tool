"""
Variant-mode tests with hand-verified expectations (port of the frontend's
variants.test.ts).

A variant is an isomorphism class of complete executions: executions
that differ only in the interleaving of independent events (events
sharing no object) or in the renaming of objects within a type are the
same variant. Events of the SAME object are always ordered, so two
parallel branches of one object still yield two variants — matching the
object-centric variant definition used in OCPM (per-object total order).
"""

import pytest

from totem_lib.playout import (
    PlayoutConfig,
    PlayoutEvent,
    create_occn_engine,
    create_ocpn_engine,
    run_playout,
)


def _config(default_limit, **overrides):
    params = dict(
        mode="variants",
        objects_per_type={},
        activity_limits={},
        default_activity_limit=default_limit,
        timeout_s=30.0,
        max_stored_variants=10_000,
        max_states=10_000_000,
    )
    params.update(overrides)
    return PlayoutConfig(**params)


def _ocpn(places, transitions, arcs, object_types):
    return {
        "format": "ocpn",
        "version": 1,
        "name": "test",
        "objectTypes": [{"name": name} for name in object_types],
        "places": places,
        "transitions": transitions,
        "arcs": [
            {
                "id": f"a{i}",
                "source": arc[0],
                "target": arc[1],
                **({"variable": True} if len(arc) > 2 and arc[2] else {}),
            }
            for i, arc in enumerate(arcs)
        ],
    }


# Marker groups in OCCausalNet.from_dict shape (mirrors the frontend's
# pythonParity fixtures).
OCCN_ABC = {
    "START_order": {"img": [], "omg": [[("a", "order", (1, 1), 0)]]},
    "a": {"img": [[("START_order", "order", (1, 1), 0)]], "omg": [[("b", "order", (1, 1), 0)]]},
    "b": {"img": [[("a", "order", (1, 1), 0)]], "omg": [[("c", "order", (1, 1), 0)]]},
    "c": {"img": [[("b", "order", (1, 1), 0)]], "omg": [[("END_order", "order", (1, 1), 0)]]},
    "END_order": {"img": [[("c", "order", (1, 1), 0)]]},
}

OCCN_MULTI = {
    "START_order": {"img": [], "omg": [[("a", "order", (1, -1), 0)]]},
    "a": {"img": [[("START_order", "order", (1, -1), 0)]], "omg": [[("END_order", "order", (1, -1), 0)]]},
    "END_order": {"img": [[("a", "order", (1, -1), 0)]]},
}

OCCN_BASIC = {
    "START_order": {"omg": [[("a", "order", (1, 1), 0)]]},
    "START_item": {"omg": [[("a", "item", (1, -1), 0)]]},
    "a": {
        "img": [[("START_order", "order", (1, 1), 0), ("START_item", "item", (1, -1), 0)]],
        "omg": [[("END_order", "order", (1, 1), 0), ("END_item", "item", (1, -1), 0)]],
    },
    "END_order": {"img": [[("a", "order", (1, 1), 0)]]},
    "END_item": {"img": [[("a", "item", (1, -1), 0)]]},
}

OCCN_START_PARALLEL = {
    "START_order": {
        "img": [],
        "omg": [
            [("a", "order", (1, 1), 0), ("b", "order", (1, 1), 0)],
            [("a", "order", (1, -1), 0)],
            [("b", "order", (1, -1), 0)],
        ],
    },
    "a": {"img": [[("START_order", "order", (1, 1), 0)]], "omg": [[("END_order", "order", (1, 1), 0)]]},
    "b": {"img": [[("START_order", "order", (1, 1), 0)]], "omg": [[("END_order", "order", (1, 1), 0)]]},
    "END_order": {
        "img": [
            [("a", "order", (1, 1), 0), ("b", "order", (1, 1), 0)],
            [("a", "order", (1, -1), 0)],
            [("b", "order", (1, -1), 0)],
        ]
    },
}


def _occn_engine(marker_groups, objects):
    return create_occn_engine(sorted(objects.keys()), marker_groups, objects)


# ---------------------------------------------------------------------------
# OCPN variants
# ---------------------------------------------------------------------------


def test_ocpn_sequential_net_one_variant():
    model = _ocpn(
        [
            {"id": "p1", "objectType": "order", "initial": True},
            {"id": "p2", "objectType": "order", "final": True},
        ],
        [{"id": "t1", "label": "place order"}],
        [("p1", "t1"), ("t1", "p2")],
        ["order"],
    )
    result = run_playout(create_ocpn_engine(model, {"order": 1}), _config(1))
    assert result.exhaustive is True
    assert result.variant_count == 1
    assert result.variants[0].events == [
        PlayoutEvent(activity="place order", visible=True, objects={"order": ["order_1"]})
    ]


def test_ocpn_xor_split_two_variants():
    model = _ocpn(
        [
            {"id": "p1", "objectType": "order", "initial": True},
            {"id": "p2", "objectType": "order", "final": True},
        ],
        [{"id": "tA", "label": "A"}, {"id": "tB", "label": "B"}],
        [("p1", "tA"), ("tA", "p2"), ("p1", "tB"), ("tB", "p2")],
        ["order"],
    )
    result = run_playout(create_ocpn_engine(model, {"order": 1}), _config(1))
    assert result.variant_count == 2


def test_ocpn_parallel_branches_of_same_object_two_variants():
    # Per-object order matters: A and B touch the same object.
    model = _ocpn(
        [
            {"id": "p0", "objectType": "order", "initial": True},
            {"id": "pa", "objectType": "order"},
            {"id": "pb", "objectType": "order"},
            {"id": "qa", "objectType": "order"},
            {"id": "qb", "objectType": "order"},
            {"id": "pf", "objectType": "order", "final": True},
        ],
        [
            {"id": "ts", "label": "split"},
            {"id": "tA", "label": "A"},
            {"id": "tB", "label": "B"},
            {"id": "tj", "label": "join"},
        ],
        [
            ("p0", "ts"),
            ("ts", "pa"),
            ("ts", "pb"),
            ("pa", "tA"),
            ("tA", "qa"),
            ("pb", "tB"),
            ("tB", "qb"),
            ("qa", "tj"),
            ("qb", "tj"),
            ("tj", "pf"),
        ],
        ["order"],
    )
    result = run_playout(create_ocpn_engine(model, {"order": 1}), _config(1))
    assert result.exhaustive is True
    assert result.variant_count == 2


def test_ocpn_variable_arc_batching():
    model = _ocpn(
        [
            {"id": "i1", "objectType": "item", "initial": True},
            {"id": "i2", "objectType": "item", "final": True},
        ],
        [{"id": "tp", "label": "pack"}],
        [("i1", "tp", True), ("tp", "i2", True)],
        ["item"],
    )
    # pack twice allowed: {i1,i2} in one event, or one event per item
    # (the two one-by-one interleavings and object renamings collapse).
    two = run_playout(create_ocpn_engine(model, {"item": 2}), _config(2))
    assert two.exhaustive is True
    assert two.variant_count == 2
    # pack once: only the batched execution completes.
    once = run_playout(create_ocpn_engine(model, {"item": 2}), _config(1))
    assert once.variant_count == 1
    assert once.variants[0].events == [
        PlayoutEvent(activity="pack", visible=True, objects={"item": ["item_1", "item_2"]})
    ]
    # raw mode: 3 complete sequences ({both}, i1;i2, i2;i1).
    raw = run_playout(create_ocpn_engine(model, {"item": 2}), _config(2, mode="raw"))
    assert raw.completed_runs == 3


def test_ocpn_transition_binding_one_order_and_a_set_of_items():
    model = _ocpn(
        [
            {"id": "op", "objectType": "order", "initial": True},
            {"id": "oq", "objectType": "order", "final": True},
            {"id": "ip", "objectType": "item", "initial": True},
            {"id": "iq", "objectType": "item", "final": True},
        ],
        [{"id": "ts", "label": "ship"}],
        [("op", "ts"), ("ts", "oq"), ("ip", "ts", True), ("ts", "iq", True)],
        ["order", "item"],
    )
    # The order can only ship once, so all items must ship together.
    result = run_playout(create_ocpn_engine(model, {"order": 1, "item": 2}), _config(2))
    assert result.exhaustive is True
    assert result.variant_count == 1
    assert result.variants[0].events == [
        PlayoutEvent(
            activity="ship",
            visible=True,
            objects={"item": ["item_1", "item_2"], "order": ["order_1"]},
        )
    ]


def test_ocpn_silent_transitions_fire_but_stay_invisible():
    model = _ocpn(
        [
            {"id": "p1", "objectType": "order", "initial": True},
            {"id": "p2", "objectType": "order"},
            {"id": "p3", "objectType": "order", "final": True},
        ],
        [
            {"id": "t1", "label": "place order"},
            {"id": "tau", "label": None, "silent": True},
        ],
        [("p1", "t1"), ("t1", "p2"), ("p2", "tau"), ("tau", "p3")],
        ["order"],
    )
    result = run_playout(create_ocpn_engine(model, {"order": 1}), _config(1))
    assert result.variant_count == 1
    assert result.variants[0].events == [
        PlayoutEvent(activity="place order", visible=True, objects={"order": ["order_1"]})
    ]


# ---------------------------------------------------------------------------
# OCCN variants
# ---------------------------------------------------------------------------


def test_occn_abc_all_interleavings_and_renamings_collapse_to_one_variant():
    result = run_playout(_occn_engine(OCCN_ABC, {"order": 2}), _config(3))
    assert result.exhaustive is True
    # Raw playout has 252 sequences; they are all the same variant.
    assert result.variant_count == 1
    assert len(result.variants[0].events) == 6
    # Interleaving + symmetry pruning must cut the search drastically.
    assert result.completed_runs < 252


def test_occn_multi_batching_structures_are_set_partitions_by_size():
    # 2 orders: a{o1,o2} or a{o1};a{o2} -> 2 variants.
    two = run_playout(_occn_engine(OCCN_MULTI, {"order": 2}), _config(3))
    assert two.exhaustive is True
    assert two.variant_count == 2
    # 3 orders: batch sizes {3}, {2,1}, {1,1,1} -> 3 variants.
    three = run_playout(_occn_engine(OCCN_MULTI, {"order": 3}), _config(4))
    assert three.exhaustive is True
    assert three.variant_count == 3


def test_occn_basic_64_raw_sequences_are_a_single_variant():
    result = run_playout(_occn_engine(OCCN_BASIC, {"order": 1, "item": 2}), _config(3))
    assert result.exhaustive is True
    assert result.variant_count == 1
    assert result.variants[0].events == [
        PlayoutEvent(
            activity="a",
            visible=True,
            objects={"item": ["item_1", "item_2"], "order": ["order_1"]},
        )
    ]


def test_occn_start_parallel_xor_and_start_bindings_give_4_variants():
    # {a and b} in both orders (same object => ordered), {a}, {b}.
    result = run_playout(_occn_engine(OCCN_START_PARALLEL, {"order": 1}), _config(3))
    assert result.exhaustive is True
    assert result.variant_count == 4


@pytest.mark.parametrize(
    "marker_groups",
    [
        "not a dict",
        {"a": "not bindings"},
        {"a": {"img": "not a list", "omg": []}},
        {"a": {"img": [[[]]], "omg": []}},  # empty marker
        {"a": {"img": [[["b", "order", [1], 0]]], "omg": []}},  # short count range
        {"a": {"img": [[["b", "order", [1, 1]]]], "omg": []}},  # missing key
        {"a": {"img": [[["b", "order", "1..1", 0]]], "omg": []}},  # range not a pair
        {"a": {"img": [["oops"]], "omg": []}},  # marker is a string
        {"a": {"img": [[["b", 7, [1, 1], 0]]], "omg": []}},  # object type not a string
    ],
)
def test_occn_malformed_marker_groups_raise_value_error(marker_groups):
    # Malformed models must surface as invalid input (the backend maps
    # ValueError to a 400), never as IndexError/TypeError.
    with pytest.raises(ValueError):
        create_occn_engine(["order"], marker_groups, {"order": 1})


def test_occn_none_bindings_for_an_activity_are_tolerated():
    engine = create_occn_engine(["order"], {"a": None}, {"order": 0})
    assert run_playout(engine, _config(1)).variant_count == 1  # empty execution
