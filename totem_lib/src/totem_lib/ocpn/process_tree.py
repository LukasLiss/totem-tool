"""Process tree model used by the from-scratch inductive miner.

A process tree is a block-structured process model. Leaves are activities
(or the silent activity tau); inner nodes are operators combining the
languages of their children:

- ``SEQUENCE``: children are executed in order.
- ``XOR``: exactly one child is executed.
- ``PARALLEL``: all children are executed, interleaved arbitrarily.
- ``LOOP``: the first child (the "body") is executed, then zero or more
  times one of the remaining children (a "redo") followed by the body again.
"""

from __future__ import annotations

from typing import List, Optional


class Operator:
    SEQUENCE = "sequence"
    XOR = "xor"
    PARALLEL = "parallel"
    LOOP = "loop"


class ProcessTree:
    """A node of a process tree.

    A node is either a leaf (``operator is None``) with a ``label`` that is
    an activity name or ``None`` for the silent activity tau, or an operator
    node with ``children``.
    """

    __slots__ = ("operator", "label", "children")

    def __init__(
        self,
        operator: Optional[str] = None,
        label: Optional[str] = None,
        children: Optional[List["ProcessTree"]] = None,
    ):
        if operator is not None and label is not None:
            raise ValueError("an operator node cannot carry an activity label")
        self.operator = operator
        self.label = label
        self.children = children if children is not None else []

    @property
    def is_leaf(self) -> bool:
        return self.operator is None

    @property
    def is_tau(self) -> bool:
        return self.operator is None and self.label is None

    def __repr__(self) -> str:
        if self.is_leaf:
            return self.label if self.label is not None else "tau"
        symbol = {
            Operator.SEQUENCE: "->",
            Operator.XOR: "X",
            Operator.PARALLEL: "+",
            Operator.LOOP: "*",
        }[self.operator]
        return f"{symbol}({', '.join(repr(c) for c in self.children)})"


def tau() -> ProcessTree:
    return ProcessTree()


def leaf(activity: str) -> ProcessTree:
    return ProcessTree(label=activity)
