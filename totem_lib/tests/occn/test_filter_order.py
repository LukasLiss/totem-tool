"""
Marker-group filtering (``filter4`` / ``apply_relative_occurrence_threshold``)
must not depend on the order in which marker groups are stored: a net that is
reordered, or saved as JSON and reloaded, has to filter to the same groups.
"""

import random
from pathlib import Path

import networkx as nx
import pytest

from totem_lib import OCCausalNet, import_ocel
from totem_lib.occn.discover import discover_occn
from totem_lib.occn.serialization import occn_from_dict, occn_to_dict

THRESHOLDS = [0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.8]
RUNNING_EXAMPLE = Path(__file__).resolve().parents[2] / "test_data" / "small" / "runningexample.json"

Marker = OCCausalNet.Marker
MarkerGroup = OCCausalNet.MarkerGroup


def canonical(occn):
    """Order-insensitive view of an OCCN's marker groups."""

    def side(groups):
        return {
            act: sorted(
                (
                    tuple(
                        sorted(
                            (m.related_activity, m.object_type, m.min_count, m.max_count, m.marker_key)
                            for m in g.markers
                        )
                    ),
                    g.support_count,
                )
                for g in gs
            )
            for act, gs in groups.items()
        }

    return side(occn.input_marker_groups), side(occn.output_marker_groups)


def reorder(occn, reorder_fn):
    return OCCausalNet(
        dependency_graph=occn.dependency_graph,
        input_marker_groups={a: reorder_fn(list(gs)) for a, gs in occn.input_marker_groups.items()},
        output_marker_groups={a: reorder_fn(list(gs)) for a, gs in occn.output_marker_groups.items()},
        activity_count=occn.activity_count,
        relative_occurrence_threshold=occn.relative_occurrence_threshold,
    )


@pytest.fixture(scope="module")
def discovered():
    return discover_occn(import_ocel(str(RUNNING_EXAMPLE)), 0)


@pytest.mark.parametrize("threshold", THRESHOLDS)
def test_reversed_group_order_filters_identically(discovered, threshold):
    rev = reorder(discovered, lambda gs: list(reversed(gs)))
    assert canonical(rev) == canonical(discovered)
    assert canonical(rev.apply_relative_occurrence_threshold(threshold)) == canonical(
        discovered.apply_relative_occurrence_threshold(threshold)
    )


@pytest.mark.parametrize("seed", range(5))
@pytest.mark.parametrize("threshold", THRESHOLDS)
def test_shuffled_group_order_filters_identically(discovered, threshold, seed):
    rng = random.Random(seed)
    shuffled = reorder(discovered, lambda gs: rng.sample(gs, len(gs)))
    assert canonical(shuffled.apply_relative_occurrence_threshold(threshold)) == canonical(
        discovered.apply_relative_occurrence_threshold(threshold)
    )


@pytest.mark.parametrize("threshold", THRESHOLDS)
def test_json_round_trip_filters_identically(discovered, threshold):
    reloaded = occn_from_dict(occn_to_dict(discovered))
    assert canonical(reloaded) == canonical(discovered)
    assert canonical(reloaded.apply_relative_occurrence_threshold(threshold)) == canonical(
        discovered.apply_relative_occurrence_threshold(threshold)
    )


@pytest.mark.parametrize("threshold", THRESHOLDS)
def test_constructor_threshold_is_order_independent(discovered, threshold):
    """Filtering in the constructor (not only via apply_...) is order independent."""

    def build(reorder_fn):
        return OCCausalNet(
            dependency_graph=discovered.dependency_graph,
            input_marker_groups={a: reorder_fn(list(gs)) for a, gs in discovered.input_marker_groups.items()},
            output_marker_groups={a: reorder_fn(list(gs)) for a, gs in discovered.output_marker_groups.items()},
            activity_count=discovered.activity_count,
            relative_occurrence_threshold=threshold,
        )

    assert canonical(build(lambda gs: gs)) == canonical(build(lambda gs: list(reversed(gs))))


def _tie_net(order):
    """
    A -> B over object type o. B has two equally frequent (support 1 of 10)
    input groups; at threshold 0.5 only A's output group survives, so one of
    B's input groups must be added back to keep the net connected.
    """
    g = nx.DiGraph()
    g.add_edges_from([("START_o", "A"), ("A", "B"), ("B", "END_o")])
    b_inputs = [
        MarkerGroup([Marker("A", "o", (1, 2), 1)], support_count=1),
        MarkerGroup([Marker("A", "o", (1, 1), 1)], support_count=1),
    ]
    if order == "reversed":
        b_inputs.reverse()
    return OCCausalNet(
        dependency_graph=g,
        input_marker_groups={
            "A": [MarkerGroup([Marker("START_o", "o", (1, 1), 1)], support_count=10)],
            "B": b_inputs,
            "END_o": [MarkerGroup([Marker("B", "o", (1, 1), 1)], support_count=10)],
        },
        output_marker_groups={
            "START_o": [MarkerGroup([Marker("A", "o", (1, 1), 1)], support_count=10)],
            "A": [MarkerGroup([Marker("B", "o", (1, 1), 1)], support_count=10)],
            "B": [MarkerGroup([Marker("END_o", "o", (1, 1), 1)], support_count=10)],
        },
        activity_count={"START_o": 10, "A": 10, "B": 10, "END_o": 10},
    )


@pytest.mark.parametrize("order", ["given", "reversed"])
def test_tie_break_is_canonical(order):
    filtered = _tie_net(order).apply_relative_occurrence_threshold(0.5)
    (b_group,) = filtered.input_marker_groups["B"]
    # Equal support and size: the lexicographically smaller cardinality wins.
    assert [m.count_range for m in b_group.markers] == [(1, 1)]
