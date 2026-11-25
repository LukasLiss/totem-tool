"""Unit tests for the Heuristics Miner used inside OCCN discovery.

Expected values are worked out by hand from the measures in the module
docstring of ``totem_lib.occn.heuristics``.
"""

import pandas as pd
import pytest

from totem_lib.occn.heuristics import discover_heuristics_net


def _log(*traces):
    """One row per event; timestamps increase along each trace."""
    rows = []
    for case, trace in enumerate(traces):
        for position, activity in enumerate(trace.split()):
            rows.append((f"c{case}", activity, pd.Timestamp(position, unit="s")))
    return pd.DataFrame(rows, columns=["case", "activity", "time"])


def _mine(log, **kwargs):
    return discover_heuristics_net(log, "case", "activity", "time", **kwargs)


def test_sequence():
    net = _mine(_log("A B C", "A B C", "A B C"))

    assert sorted(net.activities) == ["A", "B", "C"]
    assert net.start_activities == {"A": 3}
    assert net.end_activities == {"C": 3}
    # |A>B| = 3, |B>A| = 0 -> 3 / 4
    assert net.dependencies == {("A", "B"): 0.75, ("B", "C"): 0.75}
    assert net.dfg_window_2 == {("A", "C"): 3}


def test_dependency_threshold_filters_arcs():
    # A>B twice, B>A once: (2 - 1) / (2 + 1 + 1) = 0.25 in one direction only.
    net = _mine(_log("A B", "A B", "B A"), loop_two_threshold=1.0)
    assert net.dependencies == {}

    net = _mine(_log("A B", "A B", "B A"), dependency_threshold=0.2)
    assert net.dependencies == {("A", "B"): 0.25}


def test_self_loop():
    # |A>A| = 1 -> 1 / 2, which clears the default threshold of 0.5.
    net = _mine(_log("A A B"))
    assert net.dependencies[("A", "A")] == pytest.approx(0.5)


def test_pure_length_two_loop_is_connected():
    # A B A B: dependency (2 - 1) / 4 = 0.25 and (1 - 2) / 4 < 0, so no arc
    # clears the threshold. A B A and B A B each occur once: 2 / 3 >= 0.5.
    net = _mine(_log("A B A B"))
    assert net.dependencies == {("A", "B"): 0.0, ("B", "A"): 0.0}


def test_length_two_loop_next_to_regular_arcs():
    net = _mine(_log("S A B A B E"))
    assert net.dependencies == {
        ("S", "A"): 0.5,
        ("B", "E"): 0.5,
        ("A", "B"): 0.0,
        ("B", "A"): 0.0,
    }


def test_loop_two_threshold_can_disable_loops():
    net = _mine(_log("A B A B"), loop_two_threshold=1.0)
    assert net.dependencies == {}


def test_rare_pair_is_noise():
    # B>A occurs once against 100 occurrences of A>B, the strongest pair at
    # both A and B, so it is dropped before the dependency is computed:
    # 100 / 101 instead of (100 - 1) / (100 + 1 + 1).
    log = _log(*(["A B"] * 100 + ["B A"]))
    net = _mine(log)
    assert net.dependencies == {("A", "B"): pytest.approx(100 / 101)}

    net = _mine(log, noise_threshold=0.0)
    assert net.dependencies == {("A", "B"): pytest.approx(99 / 102)}


def test_equal_timestamps_keep_row_order():
    log = pd.DataFrame(
        {
            "case": ["c", "c", "c"],
            "activity": ["X", "Y", "Z"],
            "time": [pd.Timestamp(0, unit="s")] * 3,
        }
    )
    net = _mine(log)
    assert net.start_activities == {"X": 1}
    assert net.end_activities == {"Z": 1}
    assert set(net.dependencies) == {("X", "Y"), ("Y", "Z")}


def test_rows_are_ordered_by_case_and_time():
    log = _log("A B C", "A B C").sample(frac=1, random_state=0)
    net = _mine(log)
    assert net.start_activities == {"A": 2}
    assert set(net.dependencies) == {("A", "B"), ("B", "C")}


def test_empty_log():
    net = _mine(_log())
    assert net.activities == []
    assert net.start_activities == {}
    assert net.end_activities == {}
    assert net.dependencies == {}
    assert net.dfg_window_2 == {}
