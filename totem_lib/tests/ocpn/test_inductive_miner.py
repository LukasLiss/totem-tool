"""Tests for the from-scratch inductive miner.

The discovered accepting Petri nets are validated semantically: a small
state-space exploration enumerates the visible language of the net (up to
a bounded trace length) and compares it against the expected behavior of
the input log.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, Set, Tuple

import pytest

from totem_lib.ocpn import (
    AcceptingPetriNet,
    Operator,
    discover_petri_net,
    discover_process_tree,
)


# ---------------------------------------------------------------------------
# Semantic helpers
# ---------------------------------------------------------------------------


def enumerate_language(
    net: AcceptingPetriNet, max_visible: int = 8
) -> Set[Tuple[str, ...]]:
    """All visible traces from the initial to the final marking with at
    most ``max_visible`` visible events (exhaustive state-space search)."""
    inputs = defaultdict(list)
    outputs = defaultdict(list)
    for source, target in net.arcs:
        if source in net.transitions:
            outputs[source].append(target)
        else:
            inputs[target].append(source)

    initial = ((net.source, 1),)
    final = ((net.sink, 1),)

    def fire(marking, transition):
        counts = dict(marking)
        for place in inputs[transition]:
            counts[place] = counts.get(place, 0) - 1
            if counts[place] < 0:
                return None
        for place in outputs[transition]:
            counts[place] = counts.get(place, 0) + 1
        return tuple(sorted((p, c) for p, c in counts.items() if c > 0))

    accepted: Set[Tuple[str, ...]] = set()
    seen = set()
    stack = [(initial, ())]
    while stack:
        marking, trace = stack.pop()
        if (marking, trace) in seen:
            continue
        seen.add((marking, trace))
        if marking == final:
            accepted.add(trace)
        for transition, label in net.transitions.items():
            new_marking = fire(marking, transition)
            if new_marking is None:
                continue
            new_trace = trace + (label,) if label is not None else trace
            if len(new_trace) <= max_visible:
                stack.append((new_marking, new_trace))
    return accepted


def assert_well_formed(net: AcceptingPetriNet) -> None:
    place_set = set(net.places)
    assert net.source in place_set
    assert net.sink in place_set
    assert len(place_set) == len(net.places)
    for source, target in net.arcs:
        source_is_place = source in place_set
        target_is_place = target in place_set
        assert source_is_place != target_is_place, "arcs must be bipartite"
        assert source_is_place or source in net.transitions
        assert target_is_place or target in net.transitions


# ---------------------------------------------------------------------------
# Base cases and operators
# ---------------------------------------------------------------------------


def test_single_activity():
    net = discover_petri_net({("a",): 5})
    assert_well_formed(net)
    assert enumerate_language(net, 3) == {("a",)}


def test_single_activity_repeated():
    net = discover_petri_net({("a",): 2, ("a", "a", "a"): 1})
    assert_well_formed(net)
    language = enumerate_language(net, 3)
    assert ("a",) in language
    assert ("a", "a", "a") in language
    assert () not in language  # the empty trace was never observed


def test_sequence():
    net = discover_petri_net({("a", "b", "c"): 10})
    assert_well_formed(net)
    assert enumerate_language(net, 5) == {("a", "b", "c")}


def test_exclusive_choice():
    net = discover_petri_net({("a",): 3, ("b",): 4})
    assert_well_formed(net)
    assert enumerate_language(net, 3) == {("a",), ("b",)}


def test_parallel():
    net = discover_petri_net({("a", "b"): 2, ("b", "a"): 3})
    assert_well_formed(net)
    assert enumerate_language(net, 4) == {("a", "b"), ("b", "a")}


def test_loop():
    log = {("a",): 5, ("a", "b", "a"): 3, ("a", "b", "a", "b", "a"): 1}
    net = discover_petri_net(log)
    assert_well_formed(net)
    language = enumerate_language(net, 5)
    for trace in log:
        assert trace in language
    # Everything accepted must stay within the a(ba)* pattern.
    for trace in language:
        assert trace[0] == "a" and trace[-1] == "a"
        assert all(
            act == ("a" if i % 2 == 0 else "b") for i, act in enumerate(trace)
        )


def test_skippable_activity():
    net = discover_petri_net({("a", "b"): 4, ("a",): 2})
    assert_well_formed(net)
    assert enumerate_language(net, 4) == {("a",), ("a", "b")}


def test_empty_trace_makes_model_skippable():
    net = discover_petri_net({("a", "b"): 4, (): 2})
    assert_well_formed(net)
    assert enumerate_language(net, 4) == {(), ("a", "b")}


def test_nested_sequence_with_parallel():
    log = {("a", "b", "c", "d"): 5, ("a", "c", "b", "d"): 5}
    net = discover_petri_net(log)
    assert_well_formed(net)
    assert enumerate_language(net, 6) == {
        ("a", "b", "c", "d"),
        ("a", "c", "b", "d"),
    }


def test_choice_of_sequences():
    log = {("a", "b"): 3, ("c", "d"): 2}
    net = discover_petri_net(log)
    assert_well_formed(net)
    assert enumerate_language(net, 4) == {("a", "b"), ("c", "d")}


def test_fallthrough_flower_still_fits():
    # No cut exists for this behavior; the flower fall-through must at
    # least keep the log fitting.
    log = {("a", "b", "c"): 1, ("b", "a", "b"): 1, ("c", "a"): 1, ("b",): 1}
    net = discover_petri_net(log)
    assert_well_formed(net)
    language = enumerate_language(net, 4)
    for trace in log:
        assert trace in language


def test_fitness_on_mixed_log():
    log = {
        ("register", "check", "pay", "ship"): 20,
        ("register", "pay", "check", "ship"): 10,
        ("register", "check", "reject"): 5,
    }
    net = discover_petri_net(log)
    assert_well_formed(net)
    language = enumerate_language(net, 6)
    for trace in log:
        assert trace in language


# ---------------------------------------------------------------------------
# Process tree structure
# ---------------------------------------------------------------------------


def test_tree_operators_for_known_patterns():
    tree = discover_process_tree({("a", "b", "c"): 1})
    assert tree.operator == Operator.SEQUENCE
    assert [child.label for child in tree.children] == ["a", "b", "c"]

    tree = discover_process_tree({("a",): 1, ("b",): 1})
    assert tree.operator == Operator.XOR

    tree = discover_process_tree({("a", "b"): 1, ("b", "a"): 1})
    assert tree.operator == Operator.PARALLEL

    tree = discover_process_tree({("a", "b", "a"): 1, ("a",): 1})
    assert tree.operator == Operator.LOOP


def test_deterministic_output():
    log = {
        ("a", "b", "c", "d"): 5,
        ("a", "c", "b", "d"): 5,
        ("a", "d"): 1,
        ("x", "y"): 2,
    }
    first = discover_petri_net(log)
    second = discover_petri_net(log)
    assert first.places == second.places
    assert first.transitions == second.transitions
    assert first.arcs == second.arcs


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------


def test_cancel_raises_timeout_error():
    with pytest.raises(TimeoutError):
        discover_process_tree({("a", "b"): 1}, should_cancel=lambda: True)
