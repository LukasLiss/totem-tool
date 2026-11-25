"""
Dependency-graph discovery with the Heuristics Miner, for one case notion.

OCCN discovery flattens the log once per object type and mines each flattened
log with the Heuristics Miner. It only consumes the dependency graph (which
activity pairs are causally related, and how strongly), the start/end
activity counts, and how often one activity follows another two steps later.
That is all this module computes; the AND/XOR split semantics of a full
heuristics net are not needed and not built.

The measures follow the published algorithm:

    A.J.M.M. Weijters, W.M.P. van der Aalst, A.K. Alves de Medeiros (2006).
    Process Mining with the HeuristicsMiner Algorithm.
    BETA Working Paper Series, WP 166, Eindhoven University of Technology.

    A.J.M.M. Weijters, J.T.S. Ribeiro (2011). Flexible Heuristics Miner (FHM).
    IEEE CIDM 2011. https://doi.org/10.1109/CIDM.2011.5949453

with |a>b| the number of times b directly follows a within a case, and
|a>>b| the number of times the pattern a b a occurs:

    dependency      a => b  = (|a>b| - |b>a|) / (|a>b| + |b>a| + 1)    (a != b)
    self loop       a => a  = |a>a| / (|a>a| + 1)
    length-2 loop   a =>2 b = (|a>>b| + |b>>a|) / (|a>>b| + |b>>a| + 1)
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd

DEFAULT_DEPENDENCY_THRESHOLD = 0.5
DEFAULT_LOOP_TWO_THRESHOLD = 0.5
# Directly-follows pairs rarer than this fraction of the strongest pair at
# both of their activities are treated as noise before any measure is taken.
DEFAULT_NOISE_THRESHOLD = 0.05

ActivityPair = Tuple[str, str]


@dataclass
class HeuristicsNet:
    """The parts of a heuristics net that OCCN discovery reads."""

    #: Every activity that occurs in the log.
    activities: List[str]
    #: How many cases start / end with each activity.
    start_activities: Dict[str, int]
    end_activities: Dict[str, int]
    #: Arcs of the dependency graph, mapped to their dependency value. Arcs
    #: added for a length-2 loop carry the value 0.
    dependencies: Dict[ActivityPair, float]
    #: How often the second activity occurs exactly two steps after the
    #: first one within a case.
    dfg_window_2: Dict[ActivityPair, int]


def discover_heuristics_net(
    log: pd.DataFrame,
    case_column: str,
    activity_column: str,
    timestamp_column: str,
    dependency_threshold: float = DEFAULT_DEPENDENCY_THRESHOLD,
    loop_two_threshold: float = DEFAULT_LOOP_TWO_THRESHOLD,
    noise_threshold: float = DEFAULT_NOISE_THRESHOLD,
) -> HeuristicsNet:
    """
    Mine the dependency graph of a flat event log.

    Parameters
    -----------
    log
        One row per event, with a case, an activity and a timestamp column.
        Within a case, rows with equal timestamps keep their order in ``log``.
    case_column, activity_column, timestamp_column
        Names of those columns.
    dependency_threshold
        Minimum dependency value for an arc to enter the graph.
    loop_two_threshold
        Minimum length-2 loop value for a pair ``a``/``b`` to be connected in
        both directions although neither direction clears
        ``dependency_threshold`` on its own.
    noise_threshold
        A directly-follows pair ``a -> b`` is ignored when it occurs less often
        than this fraction of the most frequent pair at ``a`` and of the most
        frequent pair at ``b`` (incoming or outgoing).

    Returns
    --------
    HeuristicsNet
    """
    traces = log.sort_values([case_column, timestamp_column], kind="stable")
    cases = traces[case_column].to_numpy()
    acts = traces[activity_column].to_numpy()

    activities = list(dict.fromkeys(acts.tolist()))

    first_of_case = _case_boundaries(cases, first=True)
    last_of_case = _case_boundaries(cases, first=False)
    start_activities = dict(Counter(acts[first_of_case].tolist()))
    end_activities = dict(Counter(acts[last_of_case].tolist()))

    # Successive events of the same case. Rows are grouped by case, so equal
    # cases at both ends of a window mean the whole window is one case.
    same_case_1 = cases[1:] == cases[:-1]
    follows = Counter(zip(acts[:-1][same_case_1].tolist(), acts[1:][same_case_1].tolist()))

    same_case_2 = cases[2:] == cases[:-2]
    dfg_window_2 = dict(
        Counter(zip(acts[:-2][same_case_2].tolist(), acts[2:][same_case_2].tolist()))
    )

    # a b a patterns, keyed by (a, b); a b b and a a a are not loops of length 2.
    aba = same_case_2 & (acts[:-2] == acts[2:]) & (acts[:-2] != acts[1:-1])
    loop_two_counts = Counter(zip(acts[:-2][aba].tolist(), acts[1:-1][aba].tolist()))

    follows = _drop_noise(follows, noise_threshold)

    dependencies: Dict[ActivityPair, float] = {}
    for (a, b), count in follows.items():
        if a == b:
            value = count / (count + 1)
        else:
            reverse = follows.get((b, a), 0)
            value = (count - reverse) / (count + reverse + 1)
        if value >= dependency_threshold:
            dependencies[(a, b)] = value

    loop_arcs = _length_two_loop_arcs(
        activities, follows, dependencies, loop_two_counts, loop_two_threshold
    )
    for arc in loop_arcs:
        dependencies.setdefault(arc, 0.0)

    return HeuristicsNet(
        activities=activities,
        start_activities=start_activities,
        end_activities=end_activities,
        dependencies=dependencies,
        dfg_window_2=dfg_window_2,
    )


def _case_boundaries(cases, first: bool):
    """Boolean mask of the first (or last) row of every case in grouped rows."""
    mask = np.ones(len(cases), dtype=bool)
    if len(cases) > 1:
        if first:
            mask[1:] = cases[1:] != cases[:-1]
        else:
            mask[:-1] = cases[:-1] != cases[1:]
    return mask


def _drop_noise(follows: Counter, noise_threshold: float) -> Dict[ActivityPair, int]:
    """Remove directly-follows pairs that are rare at both of their activities."""
    strongest: Dict[str, int] = {}
    for (a, b), count in follows.items():
        strongest[a] = max(strongest.get(a, 0), count)
        strongest[b] = max(strongest.get(b, 0), count)
    return {
        (a, b): count
        for (a, b), count in follows.items()
        if count >= noise_threshold * min(strongest[a], strongest[b])
    }


def _length_two_loop_arcs(
    activities: List[str],
    follows: Dict[ActivityPair, int],
    dependencies: Dict[ActivityPair, float],
    loop_two_counts: Counter,
    loop_two_threshold: float,
) -> set:
    """
    Arcs connecting the pairs that form a loop of length 2.

    In ``a b a b`` both arcs between ``a`` and ``b`` score a low dependency,
    because each direction cancels the other out, so the loop is detected
    from the a b a patterns instead and both arcs are added.

    Normally only activities already connected by the dependency graph are
    examined, and only pairs that survived the noise filter and are not
    already an arc in either direction. When the dependency graph has no arc
    at all (a log whose control flow *is* a length-2 loop), every activity
    is examined instead, otherwise such a log yields isolated activities that
    leave binding discovery nothing to work from.
    """
    partners: Dict[str, List[str]] = {}
    for a, b in loop_two_counts:
        partners.setdefault(a, []).append(b)

    if dependencies:
        candidates = list(dict.fromkeys(act for arc in dependencies for act in arc))
    else:
        candidates = activities

    arcs = set()
    for a in candidates:
        for b in partners.get(a, ()):
            occurrences = loop_two_counts[(a, b)] + loop_two_counts.get((b, a), 0)
            if occurrences / (occurrences + 1) < loop_two_threshold:
                continue
            if dependencies and (
                (a, b) not in follows
                or (a, b) in dependencies
                or (b, a) in dependencies
            ):
                continue
            arcs.add((a, b))
            arcs.add((b, a))
    return arcs
