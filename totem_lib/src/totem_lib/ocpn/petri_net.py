"""Petri net data structure and process-tree-to-Petri-net conversion.

The nets produced here are accepting workflow nets: a single source place
(initial marking) and a single sink place (final marking). The conversion
from a process tree follows the standard recursive construction, so the
resulting net is sound by construction. A language-preserving reduction
removes superfluous silent transitions afterwards.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from .process_tree import Operator, ProcessTree


@dataclass
class AcceptingPetriNet:
    """A labeled Petri net with a single source and sink place.

    ``transitions`` maps transition ids to their activity label
    (``None`` for silent transitions). ``arcs`` contains (source id,
    target id) pairs between places and transitions.
    """

    places: List[str] = field(default_factory=list)
    transitions: Dict[str, Optional[str]] = field(default_factory=dict)
    arcs: Set[Tuple[str, str]] = field(default_factory=set)
    source: str = ""
    sink: str = ""


class _NetBuilder:
    def __init__(self):
        self.net = AcceptingPetriNet()
        self._place_count = 0
        self._transition_count = 0

    def add_place(self) -> str:
        pid = f"p{self._place_count}"
        self._place_count += 1
        self.net.places.append(pid)
        return pid

    def add_transition(self, label: Optional[str]) -> str:
        tid = f"t{self._transition_count}"
        self._transition_count += 1
        self.net.transitions[tid] = label
        return tid

    def add_arc(self, source: str, target: str) -> None:
        self.net.arcs.add((source, target))


def tree_to_petri_net(tree: ProcessTree, reduce_net: bool = True) -> AcceptingPetriNet:
    """Convert a process tree into an accepting workflow net."""
    builder = _NetBuilder()
    source = builder.add_place()
    sink = builder.add_place()
    builder.net.source = source
    builder.net.sink = sink
    _build(builder, tree, source, sink)
    if reduce_net:
        _reduce_silent_transitions(builder.net)
    return builder.net


def _build(builder: _NetBuilder, node: ProcessTree, p_in: str, p_out: str) -> None:
    if node.is_leaf:
        t = builder.add_transition(node.label)
        builder.add_arc(p_in, t)
        builder.add_arc(t, p_out)
        return

    if node.operator == Operator.SEQUENCE:
        boundaries = [p_in]
        for _ in range(len(node.children) - 1):
            boundaries.append(builder.add_place())
        boundaries.append(p_out)
        for child, c_in, c_out in zip(node.children, boundaries, boundaries[1:]):
            _build(builder, child, c_in, c_out)
        return

    if node.operator == Operator.XOR:
        for child in node.children:
            _build(builder, child, p_in, p_out)
        return

    if node.operator == Operator.PARALLEL:
        t_split = builder.add_transition(None)
        t_join = builder.add_transition(None)
        builder.add_arc(p_in, t_split)
        builder.add_arc(t_join, p_out)
        for child in node.children:
            c_in = builder.add_place()
            c_out = builder.add_place()
            builder.add_arc(t_split, c_in)
            builder.add_arc(c_out, t_join)
            _build(builder, child, c_in, c_out)
        return

    if node.operator == Operator.LOOP:
        # Dedicated entry/exit places guarded by silent transitions keep the
        # loop's token flow isolated from sibling constructs sharing
        # p_in/p_out (e.g. a loop inside an XOR). The reduction pass removes
        # the guards again whenever that is safe.
        p_body_in = builder.add_place()
        p_body_out = builder.add_place()
        t_enter = builder.add_transition(None)
        t_exit = builder.add_transition(None)
        builder.add_arc(p_in, t_enter)
        builder.add_arc(t_enter, p_body_in)
        builder.add_arc(p_body_out, t_exit)
        builder.add_arc(t_exit, p_out)
        body, redos = node.children[0], node.children[1:]
        _build(builder, body, p_body_in, p_body_out)
        for redo in redos:
            _build(builder, redo, p_body_out, p_body_in)
        return

    raise ValueError(f"unknown process tree operator: {node.operator}")


def _reduce_silent_transitions(net: AcceptingPetriNet) -> None:
    """Remove superfluous silent transitions (language-preserving).

    A silent transition with a single input place p and single output place
    q can be dropped by fusing p and q if either p's only consumer is t or
    q's only producer is t. Applied until a fixpoint is reached.
    """
    changed = True
    while changed:
        changed = False
        place_out: Dict[str, Set[str]] = {p: set() for p in net.places}
        place_in: Dict[str, Set[str]] = {p: set() for p in net.places}
        trans_in: Dict[str, Set[str]] = {t: set() for t in net.transitions}
        trans_out: Dict[str, Set[str]] = {t: set() for t in net.transitions}
        for src, tgt in net.arcs:
            if src in net.transitions:
                trans_out[src].add(tgt)
                place_in[tgt].add(src)
            else:
                place_out[src].add(tgt)
                trans_in[tgt].add(src)

        for t, label in list(net.transitions.items()):
            if label is not None:
                continue
            if len(trans_in[t]) != 1 or len(trans_out[t]) != 1:
                continue
            p = next(iter(trans_in[t]))
            q = next(iter(trans_out[t]))
            if p == q:
                continue
            if (
                place_out[p] == {t}
                and p != net.sink
                and not any((producer, q) in net.arcs for producer in place_in[p])
            ):
                # Fuse p into q: everything that produced into p now
                # produces into q directly.
                net.arcs.discard((p, t))
                net.arcs.discard((t, q))
                for producer in place_in[p]:
                    net.arcs.discard((producer, p))
                    net.arcs.add((producer, q))
                net.places.remove(p)
                del net.transitions[t]
                if net.source == p:
                    net.source = q
                changed = True
                break
            if (
                place_in[q] == {t}
                and q != net.source
                and not any((p, consumer) in net.arcs for consumer in place_out[q])
            ):
                # Fuse q into p: everything q fed is now fed by p directly.
                net.arcs.discard((p, t))
                net.arcs.discard((t, q))
                for consumer in place_out[q]:
                    net.arcs.discard((q, consumer))
                    net.arcs.add((p, consumer))
                net.places.remove(q)
                del net.transitions[t]
                if net.sink == q:
                    net.sink = p
                changed = True
                break
