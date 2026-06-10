"""Tests for the soft resource-constraint violation logic in simulation.py."""

import random

from totem_lib.simulation.simulation import (
    OCProcessAreaSimulationConfiguration,
    _allocate_single_type,
    _estimate_expected_constraint_slots,
    _make_violation_budget,
    _ViolationBudget,
)

DEFAULT_WEIGHTS = OCProcessAreaSimulationConfiguration().violation_cost_weights


def make_budget(units, slots, weights=None):
    return _ViolationBudget(units, slots, weights or DEFAULT_WEIGHTS)


def _subset(*refs):
    return ("subset", frozenset(refs))


def _disjoint(*refs):
    return ("disjoint", frozenset(refs))


def _same(*refs):
    return ("same_resource", frozenset(refs))


def _superset(*refs):
    return ("superset", frozenset(refs))


# --- _ViolationBudget ---


def test_budget_strict_never_allows_optional_violation():
    vb = make_budget(0, 5)
    # compliant option present -> never spend with an empty budget
    assert vb.try_spend(1.0, forced=False) is False


def test_budget_strict_forced_violation_is_infeasible():
    vb = make_budget(0, 5)
    # no compliant option and no budget -> allocation must fail
    assert vb.try_spend(1.0, forced=True) is None


def test_budget_cost_governs_affordability():
    # One unit of budget affords a unit-cost break but not a cost-2 one
    # (e.g. a same_resource break under the default weights).
    assert make_budget(1, 3).try_spend(1.0, forced=True) is True
    assert make_budget(1, 3).try_spend(2.0, forced=True) is None
    assert make_budget(2, 3).try_spend(2.0, forced=True) is True


def test_budget_and_slots_are_spent():
    vb = make_budget(2, 3)
    vb.try_spend(1.0, forced=True)
    assert vb.remaining_budget == 1
    assert vb.remaining_slots == 2
    assert vb.used == 1


def test_budget_compliant_pick_consumes_slot_without_charge():
    vb = make_budget(2, 3)
    assert vb.try_spend(0.0, forced=False) is False
    assert vb.remaining_budget == 2  # nothing charged
    assert vb.remaining_slots == 2  # but the slot is consumed


# --- _allocate_single_type ---


def test_alloc_strict_subset_picks_only_allowed():
    free = ["r1", "r2", "r3", "r4"]
    vb = make_budget(0, 2)
    result = _allocate_single_type(2, free, [_subset("r1", "r2")], vb, "FIFO")
    assert set(result) == {"r1", "r2"}


def test_alloc_strict_subset_infeasible_when_too_few_allowed():
    free = ["r1", "r2", "r3"]  # only r1 allowed but two needed, budget 0
    vb = make_budget(0, 2)
    assert _allocate_single_type(2, free, [_subset("r1")], vb, "FIFO") is None


def test_alloc_strict_disjoint_excludes_forbidden():
    free = ["r1", "r2", "r3"]
    vb = make_budget(0, 1)
    result = _allocate_single_type(1, free, [_disjoint("r1", "r2")], vb, "FIFO")
    assert result == ["r3"]


def test_alloc_soft_subset_allows_bounded_violation():
    free = ["r1", "r2", "r3", "r4"]
    vb = make_budget(1, 2)
    result = _allocate_single_type(2, free, [_subset("r1")], vb, "FIFO")
    assert result is not None and len(result) == 2
    assert "r1" in result  # the one allowed resource is always taken


def test_alloc_same_resource_strict_uses_exact_set():
    free = ["A", "B", "C"]
    vb = make_budget(0, 2)
    result = _allocate_single_type(2, free, [_same("A", "B")], vb, "FIFO")
    assert set(result) == {"A", "B"}


def test_alloc_same_resource_infeasible_when_member_missing_and_strict():
    free = ["A", "C"]  # B not available
    vb = make_budget(0, 2)
    assert _allocate_single_type(2, free, [_same("A", "B")], vb, "FIFO") is None


def test_alloc_must_use_included_when_available():
    free = ["m1", "x1", "x2"]
    vb = make_budget(0, 2)
    result = _allocate_single_type(2, free, [_superset("m1")], vb, "FIFO")
    assert "m1" in result and len(result) == 2


def test_alloc_summed_cost_of_multiple_broken_constraints():
    # r_bad sits outside the subset ref AND inside the disjoint ref -> it
    # breaks two constraints, so its cost is 2, not 1.
    constraints = [_subset("ok"), _disjoint("r_bad")]
    # Only r_bad is free and it must fill the single slot (forced violation).
    assert (
        _allocate_single_type(1, ["r_bad"], constraints, make_budget(1, 1), "F") is None
    )
    assert _allocate_single_type(1, ["r_bad"], constraints, make_budget(2, 1), "F") == [
        "r_bad"
    ]


def test_alloc_cheapest_violation_is_chosen():
    # No compliant option: "cheap" breaks only the subset (cost 1), "bad2"
    # breaks subset + disjoint (cost 2). The cheaper one must be picked.
    constraints = [_subset("ok"), _disjoint("bad2")]
    vb = make_budget(1, 1)
    result = _allocate_single_type(1, ["cheap", "bad2"], constraints, vb, "FIFO")
    assert result == ["cheap"]


def test_alloc_unconstrained_type_does_not_consume_budget_slots():
    # A resource type with no constraints must not touch the budget counter,
    # otherwise remaining_slots (sized to constrained slots only) drains early.
    vb = make_budget(0, 5)
    result = _allocate_single_type(2, ["a", "b", "c"], [], vb, "FIFO")
    assert result is not None and len(result) == 2
    assert vb.remaining_slots == 5  # untouched
    assert vb.remaining_budget == 0


def test_alloc_unconstrained_type_honours_strategy():
    free = ["a", "b", "c", "d"]
    assert _allocate_single_type(2, free, [], make_budget(0, 5), "FIFO") == ["a", "b"]
    assert _allocate_single_type(2, free, [], make_budget(0, 5), "LIFO") == ["d", "c"]


def test_alloc_unconstrained_type_infeasible_when_too_few_free():
    assert _allocate_single_type(3, ["a"], [], make_budget(0, 5), "FIFO") is None


# --- _estimate_expected_constraint_slots ---


def test_expected_slots_weighs_occurrences_by_demand():
    # Activity "A" occurs ~2x, needs mean 1.5 of a pooled type -> 3.0 slots.
    # Activity "B" occurs ~1x, needs mean 2 -> 2.0 slots. Total 5.0.
    occurrences = {"A": 2.0, "B": 1.0}
    demand = {
        "A": {"Truck": {"mean_count": 1.5}},
        "B": {"Truck": {"mean_count": 2.0}},
    }
    slots = _estimate_expected_constraint_slots(
        occurrences, {"A", "B"}, demand, {"Truck": ["t1"]}
    )
    assert slots == 5.0


def test_expected_slots_only_constrained_activities_count():
    occurrences = {"A": 2.0, "B": 5.0}
    demand = {
        "A": {"Truck": {"mean_count": 1.0}},
        "B": {"Truck": {"mean_count": 1.0}},
    }
    # Only A is constrained, so B's occurrences are ignored.
    slots = _estimate_expected_constraint_slots(
        occurrences, {"A"}, demand, {"Truck": ["t1"]}
    )
    assert slots == 2.0


def test_expected_slots_res_types_outside_pool_are_ignored():
    occurrences = {"A": 3.0}
    demand = {"A": {"Crane": {"mean_count": 4.0}}}
    slots = _estimate_expected_constraint_slots(
        occurrences, {"A"}, demand, {"Truck": ["t1"]}
    )
    assert slots == 0.0


# --- _make_violation_budget ---


def test_fractional_slots_round_in_expectation():
    # 2.5 expected slots, degree 1.0 -> raw budget 2.5; over many draws the
    # mean budget should land near 2.5 thanks to stochastic rounding.
    random.seed(7)
    cfg = OCProcessAreaSimulationConfiguration(resource_constraint_violation_degree=1.0)
    budgets = [_make_violation_budget(2.5, cfg).remaining_budget for _ in range(4000)]
    assert 2.4 < (sum(budgets) / len(budgets)) < 2.6


def test_zero_degree_yields_empty_budget():
    cfg = OCProcessAreaSimulationConfiguration(resource_constraint_violation_degree=0.0)
    vb = _make_violation_budget(10.0, cfg)
    assert vb.remaining_budget == 0
    assert vb.remaining_slots == 10
