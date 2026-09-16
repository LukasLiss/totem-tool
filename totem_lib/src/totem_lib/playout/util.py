"""Small combinatorics helpers shared by the playout engines."""

import itertools
from typing import List, Sequence, TypeVar

T = TypeVar("T")


def combinations(seq: Sequence[T], k: int) -> List[List[T]]:
    """k-combinations of seq, in lexicographic index order."""
    if k > len(seq):
        return []
    return [list(combo) for combo in itertools.combinations(seq, k)]


def non_empty_subsets(seq: Sequence[T]) -> List[List[T]]:
    """All non-empty subsets of seq (2^n - 1 of them; n stays small)."""
    result: List[List[T]] = []
    for k in range(1, len(seq) + 1):
        result.extend(combinations(seq, k))
    return result
