"""Unit tests for the advanced-simulation state space (``state_space.py`` plus the
``ObjectStructureVariant`` arrival units).

Organised to follow the generation pipeline, one ``# --- section ---`` per unit:

    connected-component extraction -> object-structure variants -> control-flow VMM
    -> stateful (object-conditioned) VMM -> graph-signature level -> object
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
    StateSpaceModel,
    _activity_projections,
    _summarize_state,
    _wl_hash_window,
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
        _order_items_ocel(), config=StateConfig.m3(suffix_length=1, min_support=1)
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
    """At M0 (suffix only, length 1) the model cannot tell the two post-Pick states
    apart, so the ("Pick",) context mixes Pick and Ship."""
    model = StateSpaceModel.build(
        _order_items_ocel(), config=StateConfig.m0(suffix_length=1)
    )
    gen = model.new_generator(_order_pool(), _rng(0))
    gen.step()  # Create
    gen.step()  # Pick
    after_one = model.activity_model.next_distribution(gen._state(), gen.allowed)
    assert {"Pick", "Ship"} <= set(after_one)  # ambiguous without object state


# --- graph-signature conditioning level (advisor decision 2026-07-28) ---


def _order_state(config):
    """State after Create+Pick over an Order + two Items pool."""
    events = [("Create", ["o1"]), ("Pick", ["o1", "i1"])]
    object_types = {"o1": "Order", "i1": "Item"}
    return _summarize_state(
        [START, "Create", "Pick"],
        {"o1": "Pick", "i1": "Pick"},
        object_types,
        Counter({"Order": 1, "Item": 2}),
        {"Order", "Item"},
        config,
        events,
    )


def test_graph_signature_window_is_id_invariant_and_structure_sensitive():
    """The prefix-subgraph signature ignores object ids but captures structure —
    including per-event object multiplicity (1 vs 2 items in a pack event)."""
    w1 = [("Create", ["o1"]), ("Pack", ["o1", "i1"])]
    ot1 = {"o1": "Order", "i1": "Item"}
    # same structure, different object ids -> identical hash
    w2 = [("Create", ["oX"]), ("Pack", ["oX", "iX"])]
    ot2 = {"oX": "Order", "iX": "Item"}
    assert _wl_hash_window(w1, ot1) == _wl_hash_window(w2, ot2)
    # two items in the pack event -> different structure -> different hash
    w3 = [("Create", ["o1"]), ("Pack", ["o1", "i1", "i2"])]
    ot3 = {"o1": "Order", "i1": "Item", "i2": "Item"}
    assert _wl_hash_window(w3, ot3) != _wl_hash_window(w1, ot1)
    # empty prefix -> empty signature
    assert _wl_hash_window([], {}) == ""


def test_graph_signature_is_richest_backoff_level():
    """With graph signatures on, the chain leads with a ('G', ...) level; the M0
    ablation (signatures off) has none."""
    config = StateConfig()  # use_graph_signature=True by default
    keys = _activity_projections(_order_state(config), config)
    assert keys[0][0] == "G"

    m0 = StateConfig.m0()
    assert all(key[0] != "G" for key in _activity_projections(_order_state(m0), m0))


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
    model = StateSpaceModel.build(ocel)
    for seed in range(10):
        graph, _ = _generate_over_structure(model, ocel, seed)
        assert graph.number_of_nodes() >= 1
        assert nx.is_weakly_connected(graph)


def test_generator_case_covers_all_objects():
    """Every object of the arriving structure appears in at least one event."""
    ocel = _order_items_ocel()
    model = StateSpaceModel.build(ocel)
    for seed in range(10):
        graph, object_type_map = _generate_over_structure(model, ocel, seed)
        covered = set()
        for _, data in graph.nodes(data=True):
            covered.update(data["objects"])
        assert covered == set(object_type_map)


def test_generator_case_is_reproducible():
    """The same seed and structure reproduce the identical case graph."""
    model = StateSpaceModel.build(_order_items_ocel())
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


def test_generator_graph_signatures_produce_valid_executions():
    """The full model (graph signatures on) still generates connected, fully
    covered executions across seeds."""
    ocel = _order_items_ocel()
    model = StateSpaceModel.build(ocel)  # default: signatures on
    for seed in range(8):
        graph, otm = _generate_over_structure(model, ocel, seed)
        covered = set()
        for _, data in graph.nodes(data=True):
            covered.update(data["objects"])
        assert covered == set(otm)
        assert nx.is_weakly_connected(graph)


def test_generator_ablation_configs_produce_valid_executions():
    """Every ablation level M0-M3 still generates connected, fully covered
    executions."""
    ocel = _order_items_ocel()
    for config in (
        StateConfig.m0(),
        StateConfig.m1(),
        StateConfig.m2(),
        StateConfig.m3(),
    ):
        model = StateSpaceModel.build(ocel, config=config)
        for seed in range(5):
            graph, otm = _generate_over_structure(model, ocel, seed)
            covered = set()
            for _, data in graph.nodes(data=True):
                covered.update(data["objects"])
            assert covered == set(otm)
            assert nx.is_weakly_connected(graph)


# --- execution generator: incremental step()/run() contract ---


def test_generator_step_loop_matches_run():
    """Driving ``step()`` to exhaustion yields the same execution as ``run()`` —
    there is a single generation path."""
    model = StateSpaceModel.build(_order_items_ocel())

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
    model = StateSpaceModel.build(_order_items_ocel())
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
