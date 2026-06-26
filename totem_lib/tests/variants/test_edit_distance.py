"""
Tests for `process_execution_edit_distance`.

Covers default-cost behaviour, custom cost overrides, symmetry, and a smoke
test against real variants extracted from `test_data/small/ocel2-p2p.duckdb`.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import networkx as nx
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.ocel.ocel_duckdb import OcelDuckDB
from totem_lib.variants import find_variants
from totem_lib.variants.edit_distance import (
    Edit,
    EditCosts,
    process_execution_edit_distance,
)

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"
P2P_DB = TEST_DATA / "ocel2-p2p.duckdb"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_graph(nodes_with_labels, edges_with_objects):
    """Tiny helper to construct a process-execution-shaped DiGraph.

    nodes_with_labels: list of (event_id, label)
    edges_with_objects: list of (src, tgt, [obj_ids])
    """
    g = nx.DiGraph()
    for eid, label in nodes_with_labels:
        g.add_node(eid, label=label, timestamp=0)
    for src, tgt, objs in edges_with_objects:
        g.add_edge(src, tgt, type="|".join(sorted({"t"})), objects=sorted(objs))
    return g


def _edits_sum(edits):
    return sum(e.cost for e in edits)


# ---------------------------------------------------------------------------
# Self-distance and empty-graph baselines
# ---------------------------------------------------------------------------


class TestBaselines:
    def test_self_distance_zero(self):
        g = _make_graph(
            [("e1", "A"), ("e2", "B"), ("e3", "C")],
            [("e1", "e2", ["o1"]), ("e2", "e3", ["o1", "o2"])],
        )
        cost, edits = process_execution_edit_distance(g, g)
        assert cost == 0.0
        assert edits == []

    def test_empty_to_graph_is_insert_sum(self):
        empty = nx.DiGraph()
        g = _make_graph(
            [("e1", "A"), ("e2", "B"), ("e3", "C")],
            [("e1", "e2", ["o1"]), ("e2", "e3", ["o1", "o2"])],
        )
        # Per-event involved objects:
        #   e1: {o1}        -> 1
        #   e2: {o1, o2}    -> 2
        #   e3: {o1, o2}    -> 2
        cost, edits = process_execution_edit_distance(empty, g)
        assert cost == 5.0
        assert {e.op for e in edits} == {"add_event"}
        assert sum(1 for e in edits if e.op == "add_event") == 3
        assert math.isclose(_edits_sum(edits), cost)

    def test_graph_to_empty_is_delete_sum(self):
        empty = nx.DiGraph()
        g = _make_graph(
            [("e1", "A"), ("e2", "B"), ("e3", "C")],
            [("e1", "e2", ["o1"]), ("e2", "e3", ["o1", "o2"])],
        )
        cost, edits = process_execution_edit_distance(g, empty)
        assert cost == 5.0
        assert {e.op for e in edits} == {"delete_event"}
        assert sum(1 for e in edits if e.op == "delete_event") == 3
        assert math.isclose(_edits_sum(edits), cost)


# ---------------------------------------------------------------------------
# Custom costs
# ---------------------------------------------------------------------------


class TestCustomCosts:
    def test_constant_costs(self):
        empty = nx.DiGraph()
        g = _make_graph(
            [("e1", "A"), ("e2", "B")],
            [("e1", "e2", ["o1"])],
        )
        costs = EditCosts.from_constants(add_event=10, delete_event=7)
        cost_add, _ = process_execution_edit_distance(empty, g, costs=costs)
        cost_del, _ = process_execution_edit_distance(g, empty, costs=costs)
        assert cost_add == 20.0  # 2 events x 10
        assert cost_del == 14.0  # 2 events x 7

    def test_callable_costs_override(self):
        # Penalise deletes proportional to the SQUARE of object count.
        costs = EditCosts(delete_event=lambda objs: float(len(list(objs)) ** 2))
        g = _make_graph(
            [("e1", "A"), ("e2", "B")],
            [("e1", "e2", ["o1", "o2"])],
        )
        # Each event has 2 involved objects -> 2*2 = 4 per event, 8 total.
        cost, _ = process_execution_edit_distance(g, nx.DiGraph(), costs=costs)
        assert cost == 8.0


# ---------------------------------------------------------------------------
# Substitution semantics
# ---------------------------------------------------------------------------


class TestSubstitution:
    def test_label_change_is_move(self):
        a = _make_graph(
            [("e1", "A"), ("e2", "B")],
            [("e1", "e2", ["o1", "o2"])],
        )
        b = _make_graph(
            [("e1", "A"), ("e2", "X")],  # e2's label changed
            [("e1", "e2", ["o1", "o2"])],
        )
        cost, edits = process_execution_edit_distance(a, b)
        # Default move cost = |union of objects on e2| = |{o1, o2}| = 2
        assert cost == 2.0
        moves = [e for e in edits if e.op == "move_event"]
        assert len(moves) == 1
        assert moves[0].source_event == "e2"
        assert moves[0].target_event == "e2"
        assert moves[0].cost == 2.0

    def test_objects_added_and_removed(self):
        a = _make_graph(
            [("e1", "A"), ("e2", "B")],
            [("e1", "e2", ["o1", "o2"])],
        )
        b = _make_graph(
            [("e1", "A"), ("e2", "B")],
            [("e1", "e2", ["o1", "o3"])],  # o2 removed, o3 added
        )
        cost, edits = process_execution_edit_distance(a, b)
        ops = sorted(e.op for e in edits)
        # On both e1 and e2: same {o2 removed, o3 added} -> 4 operations total.
        assert ops == ["add_objects", "add_objects", "remove_objects", "remove_objects"]
        # Each op has cost 1; total = 4.
        assert cost == 4.0
        assert math.isclose(_edits_sum(edits), cost)


# ---------------------------------------------------------------------------
# Symmetry
# ---------------------------------------------------------------------------


class TestSymmetry:
    def test_symmetric_under_default_costs(self):
        a = _make_graph(
            [("e1", "A"), ("e2", "B"), ("e3", "C")],
            [("e1", "e2", ["o1"]), ("e2", "e3", ["o1", "o2"])],
        )
        b = _make_graph(
            [("e1", "A"), ("e2", "X"), ("e3", "C")],
            [("e1", "e2", ["o1", "o3"]), ("e2", "e3", ["o3"])],
        )
        cost_ab, _ = process_execution_edit_distance(a, b)
        cost_ba, _ = process_execution_edit_distance(b, a)
        assert math.isclose(cost_ab, cost_ba)


# ---------------------------------------------------------------------------
# Edit cost decomposition invariant
# ---------------------------------------------------------------------------


class TestInvariants:
    def test_edits_sum_equals_total_cost(self):
        a = _make_graph(
            [("e1", "A"), ("e2", "B"), ("e3", "C"), ("e4", "D")],
            [("e1", "e2", ["o1"]), ("e2", "e3", ["o1", "o2"]), ("e3", "e4", ["o2"])],
        )
        b = _make_graph(
            [("e1", "A"), ("e2", "X"), ("e3", "C")],  # 1 fewer event, label change
            [("e1", "e2", ["o1", "o3"]), ("e2", "e3", ["o3"])],
        )
        cost, edits = process_execution_edit_distance(a, b)
        assert math.isclose(_edits_sum(edits), cost), (
            f"edits sum {_edits_sum(edits)} != total cost {cost}"
        )


# ---------------------------------------------------------------------------
# Variant input acceptance
# ---------------------------------------------------------------------------


class TestVariantInput:
    def test_accepts_variant_objects(self):
        if not P2P_DB.exists():
            pytest.skip(f"{P2P_DB} not present")
        db = OcelDuckDB.load(str(P2P_DB))
        try:
            variants = find_variants(
                db,
                extraction="leading_1hop",
                leading_type="purchase_requisition",
                iso="wl+vf2",
                verbose=False,
            )
            assert len(variants) >= 2
            cost_g, edits_g = process_execution_edit_distance(
                variants[0].graph, variants[1].graph
            )
            cost_v, edits_v = process_execution_edit_distance(
                variants[0], variants[1]
            )
            assert cost_g == cost_v
            assert len(edits_g) == len(edits_v)
        finally:
            db.close()


# ---------------------------------------------------------------------------
# Real-data smoke test
# ---------------------------------------------------------------------------


class TestSmokeOnP2P:
    def test_top_two_variants(self):
        if not P2P_DB.exists():
            pytest.skip(f"{P2P_DB} not present")
        db = OcelDuckDB.load(str(P2P_DB))
        try:
            variants = find_variants(
                db,
                extraction="leading_1hop",
                leading_type="purchase_requisition",
                iso="wl+vf2",
                verbose=False,
            )
            assert len(variants) >= 2
            cost, edits = process_execution_edit_distance(
                variants[0], variants[1], ocel_db=db
            )
            assert cost >= 0
            assert all(isinstance(e, Edit) for e in edits)
            assert all(e.cost >= 0 for e in edits)
            assert math.isclose(_edits_sum(edits), cost)
            # Distinct variants should not be identical.
            assert cost > 0
        finally:
            db.close()

    def test_compare_v0_v5_when_available(self):
        if not P2P_DB.exists():
            pytest.skip(f"{P2P_DB} not present")
        db = OcelDuckDB.load(str(P2P_DB))
        try:
            variants = find_variants(
                db,
                extraction="leading_1hop",
                leading_type="purchase_requisition",
                iso="wl+vf2",
                verbose=False,
            )
            if len(variants) < 6:
                pytest.skip(f"only {len(variants)} variants in {P2P_DB.name}")
            cost, edits = process_execution_edit_distance(
                variants[0], variants[5], ocel_db=db
            )
            assert cost > 0
            assert math.isclose(_edits_sum(edits), cost)
        finally:
            db.close()
