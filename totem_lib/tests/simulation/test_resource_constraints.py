import networkx as nx
import pytest

from tests.assets.ocel_helpers import event as _event
from tests.assets.ocel_helpers import make_ocel as _make_ocel
from totem_lib.simulation.utils.resource_constraints import (
    generate_resource_constraints,
)
from totem_lib.variants.ocvariants import Variant, Variants


def _variant(executions):
    return Variant(
        vid="v0", support=len(executions), executions=executions, graph=nx.DiGraph()
    )


def _variants(*variant_list):
    return Variants(list(variant_list))


def test_same_resource_detected_and_symmetric():
    """
    Load and Unload always share the exact same resource set {r1, r2}.
    Expected: same_resource constraint present in both directions.
    """
    ocel = _make_ocel(
        [
            _event("e1", "Load", 1, [], ["r1", "r2"]),
            _event("e2", "Unload", 2, [], ["r1", "r2"]),
        ],
        [],
    )
    variant = _variant([["e1", "e2"]])

    result = generate_resource_constraints(
        ocel,
        _variants(variant),
        support_threshold_percentage=0.8,
        min_occurrences_within_execution=1,
        min_occurrences_across_executions=1,
    )

    constraints = result[variant]
    assert constraints["Load"]["Unload"] == "same_resource"
    assert constraints["Unload"]["Load"] == "same_resource"


def test_disjoint_detected_and_symmetric():
    """
    Scan uses {r1}, Check uses {r2} — no overlap.
    Expected: disjoint constraint present in both directions.
    """
    ocel = _make_ocel(
        [
            _event("e1", "Scan", 1, [], ["r1"]),
            _event("e2", "Check", 2, [], ["r2"]),
        ],
        [],
    )
    variant = _variant([["e1", "e2"]])

    result = generate_resource_constraints(
        ocel,
        _variants(variant),
        support_threshold_percentage=0.8,
        min_occurrences_within_execution=1,
        min_occurrences_across_executions=1,
    )

    constraints = result[variant]
    assert constraints["Scan"]["Check"] == "disjoint"
    assert constraints["Check"]["Scan"] == "disjoint"


def test_no_constraint_below_support_threshold():
    """
    Same resource in 1 of 3 executions, different in 2 of 3.
    Neither relation reaches the 80% threshold → no constraint.
    """
    ocel = _make_ocel(
        [
            # execution 0: same
            _event("e1", "A", 1, [], ["r1"]),
            _event("e2", "B", 2, [], ["r1"]),
            # execution 1: different
            _event("e3", "A", 3, [], ["r1"]),
            _event("e4", "B", 4, [], ["r2"]),
            # execution 2: different
            _event("e5", "A", 5, [], ["r1"]),
            _event("e6", "B", 6, [], ["r2"]),
        ],
        [],
    )
    variant = _variant([["e1", "e2"], ["e3", "e4"], ["e5", "e6"]])

    result = generate_resource_constraints(
        ocel,
        _variants(variant),
        support_threshold_percentage=0.8,
        min_occurrences_within_execution=1,
        min_occurrences_across_executions=1,
    )

    constraints = result[variant]
    assert len(constraints) == 0


def test_filtered_by_min_occurrences_within_execution():
    """
    The pair (A, B) only has 1 pair per execution, but min_occurrences_within_execution=5.
    The execution should be filtered out entirely → no constraint.
    """
    ocel = _make_ocel(
        [
            _event("e1", "A", 1, [], ["r1"]),
            _event("e2", "B", 2, [], ["r1"]),
        ],
        [],
    )
    variant = _variant([["e1", "e2"]])

    result = generate_resource_constraints(
        ocel,
        _variants(variant),
        support_threshold_percentage=0.8,
        min_occurrences_within_execution=5,
        min_occurrences_across_executions=1,
    )

    constraints = result[variant]
    assert len(constraints) == 0


def test_aggregation_across_executions():
    """
    Same_resource holds across 3 executions.
    Counts should be aggregated and the constraint detected.
    """
    ocel = _make_ocel(
        [
            _event("e1", "Load", 1, [], ["r1"]),
            _event("e2", "Unload", 2, [], ["r1"]),
            _event("e3", "Load", 3, [], ["r1"]),
            _event("e4", "Unload", 4, [], ["r1"]),
            _event("e5", "Load", 5, [], ["r1"]),
            _event("e6", "Unload", 6, [], ["r1"]),
        ],
        [],
    )
    variant = _variant([["e1", "e2"], ["e3", "e4"], ["e5", "e6"]])

    result = generate_resource_constraints(
        ocel,
        _variants(variant),
        support_threshold_percentage=0.8,
        min_occurrences_within_execution=1,
        min_occurrences_across_executions=1,
    )

    constraints = result[variant]
    assert constraints["Load"]["Unload"] == "same_resource"


def test_subset_detected():
    """
    A uses {r1}, B uses {r1, r2} → A is a strict subset of B.
    Expected: subset constraint for (A, B).
    """
    ocel = _make_ocel(
        [
            _event("e1", "A", 1, [], ["r1"]),
            _event("e2", "B", 2, [], ["r1", "r2"]),
        ],
        [],
    )
    variant = _variant([["e1", "e2"]])

    result = generate_resource_constraints(
        ocel,
        _variants(variant),
        support_threshold_percentage=0.8,
        min_occurrences_within_execution=1,
        min_occurrences_across_executions=1,
    )

    constraints = result[variant]
    assert constraints["A"]["B"] == "subset"


def test_subset_emits_inverse_superset():
    """
    A uses {r1}, B uses {r1, r2} → A ⊆ B, hence B ⊇ A.
    Expected: subset for (A, B) AND superset for the inverse (B, A) so the
    must_use path in the simulator is reachable regardless of firing order.
    """
    ocel = _make_ocel(
        [
            _event("e1", "A", 1, [], ["r1"]),
            _event("e2", "B", 2, [], ["r1", "r2"]),
        ],
        [],
    )
    variant = _variant([["e1", "e2"]])

    result = generate_resource_constraints(
        ocel,
        _variants(variant),
        support_threshold_percentage=0.8,
        min_occurrences_within_execution=1,
        min_occurrences_across_executions=1,
    )

    constraints = result[variant]
    assert constraints["A"]["B"] == "subset"
    assert constraints["B"]["A"] == "superset"


def test_empty_resources_treated_as_empty_set():
    """
    Events with no resources: both activities have empty resource sets → same_resource.
    """
    ocel = _make_ocel(
        [
            _event("e1", "A", 1, []),
            _event("e2", "B", 2, []),
        ],
        [],
    )
    variant = _variant([["e1", "e2"]])

    result = generate_resource_constraints(
        ocel,
        _variants(variant),
        support_threshold_percentage=0.8,
        min_occurrences_within_execution=1,
        min_occurrences_across_executions=1,
    )

    constraints = result[variant]
    assert constraints["A"]["B"] == "same_resource"


def test_same_activity_same_resource_within_execution():
    """
    Load appears twice in one execution, both times with {r1}.
    Expected: same_resource constraint for ("Load", "Load").
    """
    ocel = _make_ocel(
        [
            _event("e1", "Load", 1, [], ["r1"]),
            _event("e2", "Load", 2, [], ["r1"]),
        ],
        [],
    )
    variant = _variant([["e1", "e2"]])

    result = generate_resource_constraints(
        ocel,
        _variants(variant),
        support_threshold_percentage=0.8,
        min_occurrences_within_execution=1,
        min_occurrences_across_executions=1,
    )

    constraints = result[variant]
    assert constraints["Load"]["Load"] == "same_resource"


def test_same_activity_different_resource_within_execution():
    """
    Load appears twice in one execution with different resources: {r1} and {r2}.
    Expected: disjoint constraint for ("Load", "Load").
    """
    ocel = _make_ocel(
        [
            _event("e1", "Load", 1, [], ["r1"]),
            _event("e2", "Load", 2, [], ["r2"]),
        ],
        [],
    )
    variant = _variant([["e1", "e2"]])

    result = generate_resource_constraints(
        ocel,
        _variants(variant),
        support_threshold_percentage=0.8,
        min_occurrences_within_execution=1,
        min_occurrences_across_executions=1,
    )

    constraints = result[variant]
    assert constraints["Load"]["Load"] == "disjoint"


_BOUNDARY_CASES = [
    pytest.param(
        ["r1"],
        ["r1", "r2"],
        ["r1"],
        "same_resource",
        "same_resource",
        id="same_resource",
    ),
    pytest.param(["r2"], ["r1", "r3"], ["r1"], "disjoint", "disjoint", id="disjoint"),
    pytest.param(
        ["r1"], ["r1", "r4"], ["r1", "r2", "r3"], "subset", "superset", id="subset"
    ),
]


def _boundary_constraints(a_sat, a_neither, b_set, n_sat, n_neither):
    events, ids = [], []
    ts = 0
    for kind, res, count in (("sat", a_sat, n_sat), ("nei", a_neither, n_neither)):
        for _ in range(count):
            ts += 1
            eid = f"a_{kind}{ts}"
            events.append(_event(eid, "A", ts, [], list(res)))
            ids.append(eid)
    ts += 1
    events.append(_event("b", "B", ts, [], list(b_set)))
    ids.append("b")

    variant = _variant([ids])
    result = generate_resource_constraints(
        _make_ocel(events, []),
        _variants(variant),
        support_threshold_percentage=0.8,
        min_occurrences_within_execution=1,
        min_occurrences_across_executions=1,
    )
    return result[variant]


@pytest.mark.parametrize(
    "a_sat, a_neither, b_set, expected_fwd, expected_inv", _BOUNDARY_CASES
)
def test_constraint_kept_at_support_threshold(
    a_sat, a_neither, b_set, expected_fwd, expected_inv
):
    # 4 of 5 pairs satisfy the relation -> support exactly 0.8 -> kept.
    constraints = _boundary_constraints(a_sat, a_neither, b_set, n_sat=4, n_neither=1)
    assert constraints["A"]["B"] == expected_fwd
    assert constraints["B"]["A"] == expected_inv


@pytest.mark.parametrize(
    "a_sat, a_neither, b_set, expected_fwd, expected_inv", _BOUNDARY_CASES
)
def test_constraint_dropped_below_support_threshold(
    a_sat, a_neither, b_set, expected_fwd, expected_inv
):
    # 3 of 4 pairs satisfy the relation -> support 0.75 < 0.8 -> nothing emitted.
    # This pins the support *fraction* for every variant; the earlier subset
    # operator-precedence bug would have wrongly kept the relation here.
    constraints = _boundary_constraints(a_sat, a_neither, b_set, n_sat=3, n_neither=1)
    assert "B" not in constraints.get("A", {})
    assert "A" not in constraints.get("B", {})
