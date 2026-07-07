"""From-scratch implementation of the inductive miner.

Discovers a process tree (and from it a sound accepting workflow net) from
a weighted set of trace variants, following the inductive mining framework
of Leemans et al.: recursively detect an exclusive-choice, sequence,
parallel, or loop cut on the directly-follows graph, split the log
accordingly, and fall back to a flower model when no cut exists.

The miner works on *variants* (a mapping from activity tuples to their
frequency) instead of raw event data, so that the expensive flattening and
grouping of large logs can happen elsewhere (e.g. inside DuckDB via SQL)
and only the compact variant representation is processed in Python.
"""

from __future__ import annotations

from typing import Callable, Dict, FrozenSet, List, Mapping, Optional, Set, Tuple

import networkx as nx

from .petri_net import AcceptingPetriNet, tree_to_petri_net
from .process_tree import Operator, ProcessTree, leaf, tau

Variants = Mapping[Tuple[str, ...], int]
CancelCheck = Optional[Callable[[], bool]]


def discover_process_tree(
    variants: Variants, should_cancel: CancelCheck = None
) -> ProcessTree:
    """Discover a process tree from weighted trace variants.

    Parameters
    ----------
    variants:
        Mapping from a trace (tuple of activity names) to the number of
        times it occurs in the log.
    should_cancel:
        Optional callable checked during the recursion; when it returns
        True a ``TimeoutError`` is raised.
    """
    log = {tuple(trace): int(count) for trace, count in variants.items() if count > 0}
    return _im(log, should_cancel)


def discover_petri_net(
    variants: Variants, should_cancel: CancelCheck = None
) -> AcceptingPetriNet:
    """Discover a sound accepting workflow net from weighted trace variants."""
    tree = discover_process_tree(variants, should_cancel)
    return tree_to_petri_net(tree)


# ---------------------------------------------------------------------------
# Recursion
# ---------------------------------------------------------------------------


def _im(log: Dict[Tuple[str, ...], int], should_cancel: CancelCheck) -> ProcessTree:
    if should_cancel is not None and should_cancel():
        raise TimeoutError("inductive miner cancelled (timeout)")

    if not log:
        return tau()

    nonempty = {trace: count for trace, count in log.items() if trace}
    if not nonempty:
        return tau()
    if len(nonempty) < len(log):
        # The empty trace is part of the log: the rest is optional.
        return ProcessTree(Operator.XOR, children=[tau(), _im(nonempty, should_cancel)])
    log = nonempty

    alphabet = {act for trace in log for act in trace}
    if len(alphabet) == 1:
        activity = next(iter(alphabet))
        if all(trace == (activity,) for trace in log):
            return leaf(activity)
        # Traces repeat the single activity (e.g. <a, a>): a+ via loop.
        return ProcessTree(Operator.LOOP, children=[leaf(activity), tau()])

    dfg, start_acts, end_acts = _build_dfg(log)

    parts = _xor_cut(alphabet, dfg)
    if parts is not None:
        sublogs = _split_xor(log, parts)
        return ProcessTree(
            Operator.XOR, children=[_im(s, should_cancel) for s in sublogs]
        )

    parts = _sequence_cut(alphabet, dfg)
    if parts is not None:
        sublogs = _split_projection(log, parts)
        return ProcessTree(
            Operator.SEQUENCE, children=[_im(s, should_cancel) for s in sublogs]
        )

    parts = _parallel_cut(alphabet, dfg, start_acts, end_acts)
    if parts is not None:
        sublogs = _split_projection(log, parts)
        return ProcessTree(
            Operator.PARALLEL, children=[_im(s, should_cancel) for s in sublogs]
        )

    parts = _loop_cut(alphabet, dfg, start_acts, end_acts)
    if parts is not None:
        sublogs = _split_loop(log, parts)
        return ProcessTree(
            Operator.LOOP, children=[_im(s, should_cancel) for s in sublogs]
        )

    # Fall-through: flower model (any sequence over the alphabet).
    return ProcessTree(
        Operator.LOOP,
        children=[tau()] + [leaf(act) for act in sorted(alphabet)],
    )


def _build_dfg(
    log: Dict[Tuple[str, ...], int]
) -> Tuple[Set[Tuple[str, str]], Set[str], Set[str]]:
    dfg: Set[Tuple[str, str]] = set()
    start_acts: Set[str] = set()
    end_acts: Set[str] = set()
    for trace in log:
        start_acts.add(trace[0])
        end_acts.add(trace[-1])
        for a, b in zip(trace, trace[1:]):
            dfg.add((a, b))
    return dfg, start_acts, end_acts


# ---------------------------------------------------------------------------
# Cut detection
# ---------------------------------------------------------------------------


def _xor_cut(
    alphabet: Set[str], dfg: Set[Tuple[str, str]]
) -> Optional[List[Set[str]]]:
    """Connected components of the undirected DFG form an exclusive choice."""
    graph = nx.Graph()
    graph.add_nodes_from(sorted(alphabet))
    graph.add_edges_from(sorted(dfg))
    components = [set(c) for c in nx.connected_components(graph)]
    if len(components) < 2:
        return None
    return sorted(components, key=min)


def _sequence_cut(
    alphabet: Set[str], dfg: Set[Tuple[str, str]]
) -> Optional[List[Set[str]]]:
    """Strict sequence cut based on the condensation of the DFG.

    Strongly connected components are collapsed; components that cannot
    reach each other in either direction are merged (they are unordered and
    must stay in the same part). The remaining groups are totally ordered
    by reachability.
    """
    digraph = nx.DiGraph()
    digraph.add_nodes_from(sorted(alphabet))
    digraph.add_edges_from(sorted(dfg))
    condensation = nx.condensation(digraph)
    scc_ids = list(condensation.nodes)
    if len(scc_ids) < 2:
        return None
    reachable: Dict[int, Set[int]] = {
        n: set(nx.descendants(condensation, n)) for n in scc_ids
    }

    # Union-find merging mutually unreachable SCCs.
    parent = {n: n for n in scc_ids}

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for i, a in enumerate(scc_ids):
        for b in scc_ids[i + 1 :]:
            if b not in reachable[a] and a not in reachable[b]:
                union(a, b)

    groups: Dict[int, Set[int]] = {}
    for n in scc_ids:
        groups.setdefault(find(n), set()).add(n)
    if len(groups) < 2:
        return None

    # Total order: a group precedes another if any of its SCCs reaches it.
    def downstream_count(members: Set[int]) -> int:
        reached = set()
        for m in members:
            reached |= reachable[m]
        return len(reached - members)

    ordered = sorted(groups.values(), key=downstream_count, reverse=True)
    return [
        {act for scc in members for act in condensation.nodes[scc]["members"]}
        for members in ordered
    ]


def _parallel_cut(
    alphabet: Set[str],
    dfg: Set[Tuple[str, str]],
    start_acts: Set[str],
    end_acts: Set[str],
) -> Optional[List[Set[str]]]:
    """Parallel cut: components of the negated concurrency graph.

    Two activities belong to the same part unless they follow each other in
    both directions. Every part must contain at least one start and one end
    activity; deficient components are merged into a part that has both.
    """
    graph = nx.Graph()
    graph.add_nodes_from(sorted(alphabet))
    for a in alphabet:
        for b in alphabet:
            if a < b and not ((a, b) in dfg and (b, a) in dfg):
                graph.add_edge(a, b)
    components = sorted((set(c) for c in nx.connected_components(graph)), key=min)
    if len(components) < 2:
        return None
    good = [c for c in components if c & start_acts and c & end_acts]
    if len(good) < 2:
        return None
    deficient = [c for c in components if not (c & start_acts and c & end_acts)]
    for c in deficient:
        good[0] |= c
    return good


def _loop_cut(
    alphabet: Set[str],
    dfg: Set[Tuple[str, str]],
    start_acts: Set[str],
    end_acts: Set[str],
) -> Optional[List[Set[str]]]:
    """Loop cut: body contains all start/end activities, redo parts are
    components of the remaining activities that are entered only from end
    activities and left only into start activities."""
    boundary = start_acts | end_acts
    candidates_nodes = alphabet - boundary
    if not candidates_nodes:
        return None

    graph = nx.Graph()
    graph.add_nodes_from(sorted(candidates_nodes))
    for a, b in sorted(dfg):
        if a in candidates_nodes and b in candidates_nodes:
            graph.add_edge(a, b)

    body = set(boundary)
    redos: List[Set[str]] = []
    for comp in sorted((set(c) for c in nx.connected_components(graph)), key=min):
        entries: Set[str] = set()
        exits: Set[str] = set()
        valid = True
        for a, b in dfg:
            if a in comp and b not in comp:
                # Leaving the redo part must lead back to a start activity.
                if b not in start_acts:
                    valid = False
                    break
                exits.add(a)
            elif b in comp and a not in comp:
                # Entering the redo part must come from an end activity.
                if a not in end_acts:
                    valid = False
                    break
                entries.add(b)
        if valid and entries and exits:
            # Every end activity must be able to enter the redo part at each
            # entry point and every exit must reach every start activity;
            # otherwise the loop body cannot be re-entered consistently.
            valid = all(
                (e, b) in dfg for b in entries for e in end_acts
            ) and all((a, s) in dfg for a in exits for s in start_acts)
        else:
            valid = False
        if valid:
            redos.append(comp)
        else:
            body |= comp

    if not redos:
        return None
    return [body] + redos


# ---------------------------------------------------------------------------
# Log splitting
# ---------------------------------------------------------------------------


def _split_xor(
    log: Dict[Tuple[str, ...], int], parts: List[Set[str]]
) -> List[Dict[Tuple[str, ...], int]]:
    index_of = {act: i for i, part in enumerate(parts) for act in part}
    sublogs: List[Dict[Tuple[str, ...], int]] = [{} for _ in parts]
    for trace, count in log.items():
        target = sublogs[index_of[trace[0]]]
        target[trace] = target.get(trace, 0) + count
    return sublogs


def _split_projection(
    log: Dict[Tuple[str, ...], int], parts: List[Set[str]]
) -> List[Dict[Tuple[str, ...], int]]:
    """Project every trace onto each part's alphabet.

    For a valid sequence cut the activity part-indices are non-decreasing
    within a trace, so the projection equals splitting the trace at the
    part boundaries; for a parallel cut projection is the definition.
    """
    index_of = {act: i for i, part in enumerate(parts) for act in part}
    sublogs: List[Dict[Tuple[str, ...], int]] = [{} for _ in parts]
    for trace, count in log.items():
        pieces: List[List[str]] = [[] for _ in parts]
        for act in trace:
            pieces[index_of[act]].append(act)
        for i, piece in enumerate(pieces):
            key = tuple(piece)
            sublogs[i][key] = sublogs[i].get(key, 0) + count
    return sublogs


def _split_loop(
    log: Dict[Tuple[str, ...], int], parts: List[Set[str]]
) -> List[Dict[Tuple[str, ...], int]]:
    """Split traces into body segments and redo segments.

    The first part is the loop body. Whenever a trace does not start/end
    with a body segment, or two redo segments are adjacent, an empty body
    trace is recorded so that the body becomes optional in the recursion.
    """
    index_of = {act: i for i, part in enumerate(parts) for act in part}
    sublogs: List[Dict[Tuple[str, ...], int]] = [{} for _ in parts]

    def add(part_index: int, piece: Tuple[str, ...], count: int) -> None:
        sublogs[part_index][piece] = sublogs[part_index].get(piece, 0) + count

    for trace, count in log.items():
        segments: List[Tuple[int, Tuple[str, ...]]] = []
        current_part = index_of[trace[0]]
        segment: List[str] = []
        for act in trace:
            part = index_of[act]
            if part != current_part:
                segments.append((current_part, tuple(segment)))
                segment = []
                current_part = part
            segment.append(act)
        segments.append((current_part, tuple(segment)))

        previous_part: Optional[int] = None
        for part, piece in segments:
            if part != 0 and previous_part != 0:
                # Trace starts inside a redo, or two redo segments are
                # back-to-back: the body was executed silently in between.
                add(0, (), count)
            add(part, piece, count)
            previous_part = part
        if previous_part != 0:
            # Trace ends inside a redo: body executed silently afterwards.
            add(0, (), count)
    return sublogs
