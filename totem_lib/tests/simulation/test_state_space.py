"""Unit tests for the advanced-simulation state space (``state_space.py`` plus the
``ObjectStructureVariant`` arrival units).

Organised to follow the generation pipeline, one ``# --- section ---`` per unit:

    connected-component extraction -> object-structure variants -> control-flow VMM
    -> stateful (object-conditioned) VMM -> state and backoff chain -> object
    participation -> participation signatures -> execution generator (invariants,
    incremental contract, relational selection) -> expected activity occurrences.

Determinism: sampling uses a seeded ``random.Random`` and the asserted effects are
structural, not fragile probabilistic margins.
"""

import random
from collections import Counter

import networkx as nx

from tests.assets.ocel_helpers import event as _event
from tests.assets.ocel_helpers import make_ocel
from tests.assets.ocel_helpers import obj as _object
from totem_lib.simulation.utils.state_space import (
    END,
    START,
    ControlFlowVMM,
    ObjectParticipationModel,
    ParticipationSignatureModel,
    StateConfig,
    StatefulActivityVMM,
    StateSpaceModel,
    _activity_projections,
    _summarize_state,
    extract_state_space_executions,
)
from totem_lib.variants.state_space_executions import find_object_structure_variants

# --- shared fixtures & helpers ---


def _rng(seed=0):
    return random.Random(seed)


def _order_items_ocel():
    """The canonical example: one component of an Order + two Items across
    Create/Pick/Pick/Ship."""
    events = [
        _event("e1", "Create", 1, ["o1"]),
        _event("e2", "Pick", 2, ["o1", "i1"]),
        _event("e3", "Pick", 3, ["o1", "i2"]),
        _event("e4", "Ship", 4, ["o1", "i1", "i2"]),
    ]
    objects = [
        _object("o1", "Order"),
        _object("i1", "Item"),
        _object("i2", "Item"),
    ]
    return make_ocel(events, objects)


def _deterministic_abc_ocel():
    """A single-object log with a deterministic A -> B -> C trace."""
    events = [
        _event("e1", "A", 1, ["o1"]),
        _event("e2", "B", 2, ["o1"]),
        _event("e3", "C", 3, ["o1"]),
    ]
    objects = [_object("o1", "Order")]
    return make_ocel(events, objects)


def _order_pool():
    """A concrete object pool matching ``_order_items_ocel``'s structure."""
    return {"Order_0": "Order", "Item_1": "Item", "Item_2": "Item"}


def _generate_over_structure(model, ocel, seed, structure_index=0):
    """Generate one execution over one of ``ocel``'s object-structure variants
    (by descending support). Replaces the old ``StateSpaceModel.sample_execution``:
    structures are now owned by the ``ObjectStructureVariant`` arrival units, the
    model only generates over a given cloned skeleton."""
    variant = find_object_structure_variants(ocel)[structure_index]
    return model.new_generator(variant.instantiate(seed), _rng(seed)).run()


# --- connected-component extraction ---


def test_extract_executions_splits_components_and_signatures():
    """Two disconnected object sets become two executions with the object-type
    multiset as their structure signature."""
    events = [
        _event("e1", "Create", 1, ["o1"]),
        _event("e2", "Pack", 2, ["o1", "i1"]),
        _event("e3", "Create", 3, ["o2"]),
    ]
    objects = [
        _object("o1", "Order"),
        _object("i1", "Item"),
        _object("o2", "Order"),
    ]
    executions = extract_state_space_executions(make_ocel(events, objects))

    signatures = sorted(ex.signature for ex in executions)
    assert signatures == [
        (("Item", 1), ("Order", 1)),
        (("Order", 1),),
    ]
    by_signature = {ex.signature: ex for ex in executions}
    assert by_signature[(("Item", 1), ("Order", 1))].activity_sequence == [
        "Create",
        "Pack",
    ]


def test_extract_executions_linearizes_by_timestamp():
    """Events of one component are ordered by timestamp regardless of input order."""
    events = [
        _event("e2", "Second", 20, ["o1"]),
        _event("e1", "First", 10, ["o1"]),
        _event("e3", "Third", 30, ["o1"]),
    ]
    objects = [_object("o1", "Order")]
    executions = extract_state_space_executions(make_ocel(events, objects))

    assert len(executions) == 1
    assert executions[0].activity_sequence == ["First", "Second", "Third"]


# --- object-structure variants (the arrival units) ---


def test_structure_variants_cluster_by_isomorphism():
    """Isomorphic object structures cluster into one variant (support 2); a
    different structure is its own (support 1). Keys are structural, not type
    tuples."""
    events = [
        _event("e1", "Create", 1, ["o1", "i1"]),  # Order-Item component
        _event("e2", "Create", 2, ["o2", "i2"]),  # isomorphic Order-Item component
        _event("e3", "Create", 3, ["o3"]),  # lone Order
    ]
    objects = [
        _object("o1", "Order"),
        _object("i1", "Item"),
        _object("o2", "Order"),
        _object("i2", "Item"),
        _object("o3", "Order"),
    ]
    variants = find_object_structure_variants(make_ocel(events, objects))

    assert sorted(v.support for v in variants) == [1, 2]
    # A cloned skeleton of the two-object variant carries the Order-Item relation.
    two_object = max(variants, key=lambda v: v.support)
    skeleton = two_object.instantiate(instance_id=0)
    assert skeleton.number_of_nodes() == 2
    assert skeleton.number_of_edges() == 1
    assert set(nx.get_node_attributes(skeleton, "type").values()) == {"Order", "Item"}


def test_structure_variants_split_wl_hash_collisions():
    """Non-isomorphic structures with the same WL hash are separate variants.

    K_{3,3} and the triangular prism are both connected 3-regular graphs on six
    nodes, so 1-WL cannot distinguish them; only the exact isomorphism test can.
    """
    k33 = [(a, b) for a in "abc" for b in "def"]
    prism = [
        ("a", "b"),
        ("b", "c"),
        ("c", "a"),
        ("d", "e"),
        ("e", "f"),
        ("f", "d"),
        ("a", "d"),
        ("b", "e"),
        ("c", "f"),
    ]
    events, objects, t = [], [], 0
    for prefix, edges in (("x", k33), ("y", prism), ("z", prism)):
        objects += [_object(f"{prefix}{n}", "Order") for n in "abcdef"]
        for u, v in edges:
            t += 1
            events.append(_event(f"e{t}", "Link", t, [f"{prefix}{u}", f"{prefix}{v}"]))
    ocel = make_ocel(events, objects)
    executions = extract_state_space_executions(ocel)
    assert len({execution.structure_key for execution in executions}) == 1

    variants = find_object_structure_variants(ocel)

    assert sorted(v.support for v in variants) == [1, 2]
    assert len({v.id for v in variants}) == 2


def test_structure_variant_activity_occurrences_are_observed_means():
    """Activity occurrences of a structure are averaged over its observed
    executions."""
    events = [
        _event("e1", "Create", 1, ["o1"]),
        _event("e2", "Check", 2, ["o1"]),
        _event("e3", "Check", 3, ["o1"]),
        _event("e4", "Create", 4, ["o2"]),
    ]
    objects = [_object("o1", "Order"), _object("o2", "Order")]
    (variant,) = find_object_structure_variants(make_ocel(events, objects))

    assert variant.activity_occurrences == {"Create": 1.0, "Check": 1.0}


# --- control-flow VMM (flat suffix backoff, the M0 baseline) ---


def test_vmm_first_activity_from_start_context():
    """The START context gives the first-activity distribution, not the
    unconditional activity frequency."""
    vmm = ControlFlowVMM.build([["A", "B", "C"]])
    assert vmm.next_distribution([START]) == {"A": 1.0}


def test_vmm_deterministic_chain():
    """On a single A->B->C log every transition is deterministic and ends in END."""
    vmm = ControlFlowVMM.build([["A", "B", "C"]])
    assert vmm.next_distribution([START, "A"]) == {"B": 1.0}
    assert vmm.next_distribution([START, "A", "B"]) == {"C": 1.0}
    assert vmm.next_distribution([START, "A", "B", "C"]) == {END: 1.0}


def test_vmm_backoff_to_shorter_suffix():
    """An unseen long context backs off to its longest observed suffix."""
    vmm = ControlFlowVMM.build([["A", "B", "C"]])
    # ("Z", "A") was never observed -> back off to ("A",) -> B.
    assert vmm.next_distribution(["Z", "A"]) == {"B": 1.0}
    # A bare suffix (no START) still resolves.
    assert vmm.next_distribution(["A"]) == {"B": 1.0}


def test_vmm_branch_probabilities():
    """Transition probabilities are frequentist over the observed continuations."""
    vmm = ControlFlowVMM.build([["A", "B"], ["A", "B"], ["A", "C"]])
    dist = vmm.next_distribution([START, "A"])
    assert dist["B"] == 2 / 3
    assert dist["C"] == 1 / 3


def test_vmm_gating_masks_disallowed_activity():
    """A masked-out activity never appears in the next-activity distribution."""
    vmm = ControlFlowVMM.build([["A", "B"]])
    dist = vmm.next_distribution([START, "A"], allowed={"C"})
    assert "B" not in dist  # B is not allowed
    # END is always allowed, so the case can still terminate.
    assert END in dist


def test_vmm_sampling_reproducible_and_terminates():
    """Sampling with a seeded rng reproduces and eventually hits END."""
    vmm = ControlFlowVMM.build([["A", "B"], ["A", "C"]])

    def sample(seed):
        rng = _rng(seed)
        context = [START]
        out = []
        while True:
            nxt = vmm.sample_next(context, allowed=None, rng=rng)
            if nxt == END:
                break
            out.append(nxt)
            context.append(nxt)
        return out

    assert sample(1) == sample(1)
    assert sample(1)[0] == "A"


# --- stateful activity VMM (conditioned on object state) ---


def test_stateful_vmm_conditions_on_object_state():
    """The next activity depends on the object state, not just the suffix: after
    picking one of two items another Pick follows; after both, Ship. With a length-1
    suffix the pure-suffix context ("Pick",) is ambiguous, so distinguishing Pick
    from Ship requires the remaining/active object state."""
    model = StateSpaceModel.build(
        _order_items_ocel(), config=StateConfig(suffix_length=1, min_support=1)
    )
    gen = model.new_generator(_order_pool(), _rng(0))

    assert gen.step()[0] == "Create"
    assert gen.step()[0] == "Pick"
    # One item still to pick -> the next activity is Pick, never Ship yet.
    after_one = model.activity_model.next_distribution(gen._state(), gen.allowed)
    assert after_one == {"Pick": 1.0}

    assert gen.step()[0] == "Pick"
    # Both items picked -> Ship.
    after_two = model.activity_model.next_distribution(gen._state(), gen.allowed)
    assert after_two == {"Ship": 1.0}


def test_stateful_vmm_flat_config_ignores_object_state():
    """With the history only (length 1) the model cannot tell the two post-Pick
    states apart, so the ("Pick",) context mixes Pick and Ship."""
    model = StateSpaceModel.build(
        _order_items_ocel(), config=StateConfig.history_only(suffix_length=1)
    )
    gen = model.new_generator(_order_pool(), _rng(0))
    gen.step()  # Create
    gen.step()  # Pick
    after_one = model.activity_model.next_distribution(gen._state(), gen.allowed)
    assert {"Pick", "Ship"} <= set(after_one)  # ambiguous without object state


def test_stateful_vmm_support_counts_only_admissible_continuations():
    """min_support is checked on the admissible observations; a level with enough
    observations in total but too few admissible ones is skipped."""
    config = StateConfig.history_only(suffix_length=1, min_support=3)
    counts = {
        ("H", ("A",)): Counter({"B": 2, "C": 1}),
        ("L", ("A",)): Counter({"B": 2, "C": 1}),
        ("*",): Counter({"C": 3, "D": 3}),
    }
    vmm = StatefulActivityVMM(counts, config)
    state = _summarize_state([START, "A"], Counter(), config)

    assert vmm.next_distribution(state) == {"B": 2 / 3, "C": 1 / 3}
    # Only one admissible observation (C) on ("A",) -> back off to "*".
    assert vmm.next_distribution(state, admissible={"C", "D"}) == {"C": 0.5, "D": 0.5}


def test_stateful_vmm_last_level_needs_no_min_support():
    """The global level is used with fewer than min_support admissible
    observations; without any admissible observation the model returns END."""
    config = StateConfig.history_only(suffix_length=1, min_support=3)
    counts = {("H", ("A",)): Counter({END: 5}), ("*",): Counter({"B": 1, END: 5})}
    vmm = StatefulActivityVMM(counts, config)
    state = _summarize_state([START, "A"], Counter(), config)

    assert vmm.next_distribution(state, admissible={"B"}) == {"B": 1.0}
    assert vmm.next_distribution(state, admissible={"C"}) == {END: 1.0}


# --- state and backoff chain ---


def test_state_caps_groups_and_keeps_unused_objects():
    """G_j counts every group, unused objects under (type, START), capped at
    group_cap; the history keeps the last suffix_length elements incl. START."""
    config = StateConfig(suffix_length=4, group_cap=3)
    groups = Counter({("Item", START): 5, ("Order", "Create"): 1, ("Item", "Pick"): 0})
    state = _summarize_state([START, "Create"], groups, config)

    assert state.history == (START, "Create")
    assert state.groups == ((("Item", START), 3), (("Order", "Create"), 1))


def test_backoff_chain_order():
    """(h, G) -> G -> h -> last(h) -> *, and the ablations keep their levels."""
    state = _summarize_state(
        [START, "Create", "Pick"], Counter({("Order", "Pick"): 1}), StateConfig()
    )

    def tags(config):
        return [key[0] for key in _activity_projections(state, config)]

    assert tags(StateConfig()) == ["HG", "G", "H", "L", "*"]
    assert tags(StateConfig.history_only()) == ["H", "L", "*"]
    assert tags(StateConfig.groups_only()) == ["G", "*"]
    assert _activity_projections(state, StateConfig())[3] == ("L", ("Pick",))


# --- object participation model (mandatory-type gating + count distribution) ---


def test_object_participation_mandatory_types():
    """A type present in every occurrence of an activity is mandatory; a
    sometimes-present type is not."""
    events = [
        _event("e1", "Create", 1, ["o1"]),
        _event("e2", "Pack", 2, ["o1", "i1"]),
        _event("e3", "Create", 3, ["o2"]),
        _event("e4", "Pack", 4, ["o2"]),
    ]
    objects = [
        _object("o1", "Order"),
        _object("i1", "Item"),
        _object("o2", "Order"),
    ]
    executions = extract_state_space_executions(make_ocel(events, objects))
    model = ObjectParticipationModel.build(executions)

    assert model.mandatory_types["Create"] == frozenset({"Order"})
    # Item appears in only one of two Pack occurrences -> not mandatory.
    assert model.mandatory_types["Pack"] == frozenset({"Order"})
    assert "Item" not in model.mandatory_types["Pack"]


def test_object_participation_count_distribution():
    """The per-type count distribution reflects observed multiplicities."""
    events = [
        _event("e1", "Ship", 1, ["o1", "i1", "i2"]),
    ]
    objects = [
        _object("o1", "Order"),
        _object("i1", "Item"),
        _object("i2", "Item"),
    ]
    executions = extract_state_space_executions(make_ocel(events, objects))
    model = ObjectParticipationModel.build(executions)

    assert model.count_distribution["Ship"]["Item"] == {2: 1.0}
    assert model.count_distribution["Ship"]["Order"] == {1: 1.0}


# --- participation signature model (joint participant counts) ---


def test_participation_signature_is_joint():
    """The participant signature is drawn jointly, preserving multi-object
    dependencies (Ship always takes 1 Order + 2 Items together)."""
    events = [_event("e1", "Ship", 1, ["o1", "i1", "i2"])]
    objects = [_object("o1", "Order"), _object("i1", "Item"), _object("i2", "Item")]
    executions = extract_state_space_executions(make_ocel(events, objects))
    model = ParticipationSignatureModel.build(executions)

    available = Counter({("Order", START): 1, ("Item", START): 2})
    signature = dict(
        model.sample_signature("Ship", available, require_active=False, rng=_rng(0))
    )
    assert signature[("Order", START)] == 1
    assert signature[("Item", START)] == 2


def test_participation_signature_respects_availability():
    """A signature is only drawn if the pool can realize it; otherwise None."""
    events = [_event("e1", "Ship", 1, ["o1", "i1", "i2"])]
    objects = [_object("o1", "Order"), _object("i1", "Item"), _object("i2", "Item")]
    executions = extract_state_space_executions(make_ocel(events, objects))
    model = ParticipationSignatureModel.build(executions)

    # Only one Item available -> the "1 Order + 2 Items" signature is not realizable.
    available = Counter({("Order", START): 1, ("Item", START): 1})
    assert (
        model.sample_signature("Ship", available, require_active=False, rng=_rng(0))
        is None
    )


# --- execution generator: invariants (connectivity, coverage, determinism) ---


def test_generator_case_is_connected():
    """Every generated case graph is weakly connected across seeds."""
    ocel = _order_items_ocel()
    model = StateSpaceModel.build(ocel, config=StateConfig(min_support=1))
    for seed in range(10):
        graph, _ = _generate_over_structure(model, ocel, seed)
        assert graph.number_of_nodes() >= 1
        assert nx.is_weakly_connected(graph)


def test_generator_case_covers_all_objects():
    """Every object of the arriving structure appears in at least one event."""
    ocel = _order_items_ocel()
    model = StateSpaceModel.build(ocel, config=StateConfig(min_support=1))
    for seed in range(10):
        graph, object_type_map = _generate_over_structure(model, ocel, seed)
        covered = set()
        for _, data in graph.nodes(data=True):
            covered.update(data["objects"])
        assert covered == set(object_type_map)


def test_generator_case_is_reproducible():
    """The same seed and structure reproduce the identical case graph."""
    model = StateSpaceModel.build(
        _order_items_ocel(), config=StateConfig(min_support=1)
    )
    pool = _order_pool()

    def fingerprint(graph):
        nodes = sorted(
            (n, d["label"], tuple(d["objects"])) for n, d in graph.nodes(data=True)
        )
        edges = sorted(
            (u, v, d["type"], tuple(d["objects"])) for u, v, d in graph.edges(data=True)
        )
        return nodes, edges

    g1, _ = model.new_generator(pool, _rng(3)).run()
    g2, _ = model.new_generator(pool, _rng(3)).run()
    assert fingerprint(g1) == fingerprint(g2)


def test_generator_reproduces_deterministic_trace():
    """A deterministic single-object log regenerates its exact activity order."""
    # min_support=1: a single-observation log must reproduce exactly (the
    # production default of 3 would back off a one-off state to the unconditional).
    ocel = _deterministic_abc_ocel()
    model = StateSpaceModel.build(ocel, config=StateConfig(min_support=1))

    graph, _ = _generate_over_structure(model, ocel, 0)
    labels = [
        graph.nodes[n]["label"] for n in sorted(graph.nodes, key=lambda x: int(x[1:]))
    ]
    assert labels == ["A", "B", "C"]


def test_generator_ablation_configs_produce_valid_executions():
    """The full state and both ablations generate connected, fully covered
    executions."""
    ocel = _order_items_ocel()
    for config in (
        StateConfig(min_support=1),
        StateConfig.history_only(min_support=1),
        StateConfig.groups_only(min_support=1),
    ):
        model = StateSpaceModel.build(ocel, config=config)
        for seed in range(5):
            graph, otm = _generate_over_structure(model, ocel, seed)
            covered = set()
            for _, data in graph.nodes(data=True):
                covered.update(data["objects"])
            assert covered == set(otm)
            assert nx.is_weakly_connected(graph)


def test_generator_end_not_admissible_while_objects_unused():
    """END is not drawn while an object is unused and an activity is allowed,
    although the history alone observed END after Create."""
    events = [
        _event("e1", "Create", 1, ["o1"]),
        _event("e2", "Create", 2, ["o2"]),
        _event("e3", "Pick", 3, ["o2", "i2"]),
    ]
    objects = [_object("o1", "Order"), _object("o2", "Order"), _object("i2", "Item")]
    model = StateSpaceModel.build(
        make_ocel(events, objects),
        config=StateConfig.history_only(min_support=1),
    )
    for seed in range(10):
        graph, _ = model.new_generator({"O": "Order", "I": "Item"}, _rng(seed)).run()
        labels = sorted(d["label"] for _, d in graph.nodes(data=True))
        assert labels == ["Create", "Pick"]


def test_generator_end_admissible_when_no_unused_object_can_join():
    """END may be drawn although an Item is unused, because no allowed activity
    has a realizable signature that takes it (Pick needs a confirmed Order)."""
    events = [
        _event("e1", "Create", 1, ["o1"]),
        _event("e2", "Pay", 2, ["o1"]),
        _event("e3", "Create", 3, ["o2"]),
        _event("e4", "Confirm", 4, ["o2"]),
        _event("e5", "Pick", 5, ["o2", "i2"]),
        _event("e6", "Create", 6, ["o3"]),
    ]
    objects = [
        _object("o1", "Order"),
        _object("o2", "Order"),
        _object("o3", "Order"),
        _object("i2", "Item"),
    ]
    model = StateSpaceModel.build(
        make_ocel(events, objects),
        config=StateConfig.history_only(min_support=1),
    )
    runs = []
    for seed in range(30):
        graph, _ = model.new_generator({"O": "Order", "I": "Item"}, _rng(seed)).run()
        runs.append([d["label"] for _, d in graph.nodes(data=True)])
    assert ["Create"] in runs
    assert ["Create", "Pay"] in runs


def test_generator_omits_unused_objects():
    """At a dead end unused objects are left out instead of being attached to an
    existing event."""
    events = [
        _event("e1", "Create", 1, ["o1"]),
        _event("e2", "Pick", 2, ["o1", "i1"]),
        _event("e3", "Ship", 3, ["o1", "i1"]),
    ]
    objects = [_object("o1", "Order"), _object("i1", "Item")]
    model = StateSpaceModel.build(
        make_ocel(events, objects), config=StateConfig(min_support=1)
    )
    pool = {"O": "Order", "I1": "Item", "I2": "Item"}
    graph, object_type_map = model.new_generator(pool, _rng(0)).run()

    covered = set()
    for _, data in graph.nodes(data=True):
        covered.update(data["objects"])
    assert len(covered) == 2
    assert set(object_type_map) == covered


# --- execution generator: incremental step()/run() contract ---


def test_generator_step_loop_matches_run():
    """Driving ``step()`` to exhaustion yields the same execution as ``run()`` —
    there is a single generation path."""
    model = StateSpaceModel.build(
        _order_items_ocel(), config=StateConfig(min_support=1)
    )

    stepped = model.new_generator(_order_pool(), _rng(5))
    events = []
    while True:
        event = stepped.step()
        if event is None:
            break
        events.append(event)
    g_step, _ = stepped.to_graph()

    g_run, _ = model.new_generator(_order_pool(), _rng(5)).run()

    def labels(graph):
        return [
            graph.nodes[n]["label"]
            for n in sorted(graph.nodes, key=lambda x: int(x[1:]))
        ]

    assert events
    assert labels(g_step) == labels(g_run)


def test_generator_step_accepts_runtime_context():
    """The ``runtime_context`` seam is accepted and (currently) ignored."""
    model = StateSpaceModel.build(
        _order_items_ocel(), config=StateConfig(min_support=1)
    )
    gen = model.new_generator(_order_pool(), _rng(0))
    assert gen.step(runtime_context={"load": 0.5}) is not None


# --- execution generator: relational participant selection ---


def test_generator_pick_related_prefers_related_objects():
    """Participant selection prefers objects related (adjacent) to the anchors, so
    an event keeps an Order with *its own* Items, not another cluster's."""
    graph = nx.Graph()
    for node, otype in [
        ("O1", "Order"),
        ("O2", "Order"),
        ("I1", "Item"),
        ("I2", "Item"),
    ]:
        graph.add_node(node, type=otype)
    graph.add_edges_from([("O1", "I1"), ("O2", "I2"), ("O1", "O2")])

    gen = StateSpaceModel.build(_order_items_ocel()).new_generator(graph, _rng(0))
    # I1 belongs to O1, I2 to O2 -> anchored on O1 we pick I1, on O2 we pick I2.
    assert gen._pick_related(["I1", "I2"], ["O1"], 1) == ["I1"]
    assert gen._pick_related(["I1", "I2"], ["O2"], 1) == ["I2"]
    # No anchor -> unconstrained, but still returns the requested count.
    assert len(gen._pick_related(["I1", "I2"], [], 1)) == 1


# --- expected activity occurrences (violation-budget input) ---


def test_expected_activity_occurrences_on_deterministic_log():
    """Monte-Carlo expectation equals the exact counts of a deterministic log."""
    ocel = _deterministic_abc_ocel()
    model = StateSpaceModel.build(ocel, config=StateConfig(min_support=1))
    variant = find_object_structure_variants(ocel)[0]

    n_samples = 20
    totals = Counter()
    for i in range(n_samples):
        graph, _ = model.new_generator(variant.instantiate(i), _rng(i)).run()
        for _, data in graph.nodes(data=True):
            totals[data["label"]] += 1
    expected = {activity: count / n_samples for activity, count in totals.items()}
    assert expected == {"A": 1.0, "B": 1.0, "C": 1.0}
