"""
Object-centric specific evaluation measures.

These measures target properties that are unique to object-centric event logs
and that are not covered by the control-flow / temporal / congestion measures
of Chapela-Campa et al. 

Implemented measures:
- ``object_count`` / ``object_count_distance`` — number of objects generated
  per type.
- ``cardinality_distribution`` / ``cardinality_distribution_distance`` —
  distribution of "how many objects of type T participate in one execution".
- ``object_graph_edit_distance`` — support-weighted graph edit distance between
  the variant representative graphs of two logs.
- ``object_lifecycle_distribution`` / ``object_lifecycle_distance`` —
  per-object lifecycle length (#events) and lifecycle time (last-first).
"""
from collections import Counter, defaultdict

import networkx as nx
from scipy.stats import wasserstein_distance

from totem_lib.simulation.evaluation._eval_utils import (
    get_variants,
    wd_from_bins,
)



def object_count(ocel) -> dict[str, int]:
    """
    Number of generated objects per object type.

    Returns:
        Dict mapping object type to count.
    """
    rows = ocel.objects.group_by("_objType").len().sort("_objType").iter_rows()
    return {ot: int(n) for ot, n in rows}


def object_count_distance(actual_ocel, simulated_ocel) -> dict[str, dict]:
    """
    Per-type comparison of object counts.

    Returns:
        Dict ``{obj_type: {"actual": int, "simulated": int, "abs_diff": int,
        "rel_diff": float}}``. ``rel_diff`` is the absolute difference divided
        by the actual count (NaN if the actual count is 0).
    """
    actual = object_count(actual_ocel)
    sim = object_count(simulated_ocel)

    result = {}
    for ot in sorted(set(actual) | set(sim)):
        a = actual.get(ot, 0)
        s = sim.get(ot, 0)
        rel = abs(a - s) / a if a > 0 else float("nan")
        result[ot] = {"actual": a, "simulated": s, "abs_diff": abs(a - s), "rel_diff": rel}
    return result

def cardinality_distribution(ocel) -> dict[tuple[str, str], dict[int, int]]:
    """
    Per-execution cardinality distribution per (anchor_type, related_type).

    For every process execution and every pair of object types
    (anchor_type, related_type), counts how many ``related_type`` objects
    appear together with each ``anchor_type`` object in that execution.

    Missing related types are recorded as 0 observations

    Example: in an order-picking execution with 1 order and 5 packages,
    ``("Order", "Package")`` gets one observation of value 5; ``("Package",
    "Order")`` gets five observations of value 1 each.

    Returns:
        ``{(anchor_type, related_type): {count: frequency}}``.
    """
    variants = get_variants(ocel)
    obj_type_map = ocel.obj_type_map
    object_types = sorted(set(obj_type_map.values()))
    result: dict[tuple[str, str], Counter] = defaultdict(Counter)

    for variant in variants:
        for execution in variant.executions:
            # Collect the set of objects involved in this execution.
            execution_objs: set[str] = set()
            for eid in execution:
                execution_objs.update(ocel.get_event_objectIDs(eid))

            by_type: dict[str, list[str]] = defaultdict(list)
            for oid in execution_objs:
                ot = obj_type_map.get(oid)
                if ot:
                    by_type[ot].append(oid)

            # Iterate over present anchor types × ALL object types so missing
            # related types contribute a count of 0 instead of being skipped.
            for anchor_type, anchor_objs in by_type.items():
                for related_type in object_types:
                    related_objs = by_type.get(related_type, [])
                    related_count = (
                        len(related_objs) - 1
                        if anchor_type == related_type
                        else len(related_objs)
                    )
                    for _ in anchor_objs:
                        result[(anchor_type, related_type)][related_count] += 1

    return {k: dict(v) for k, v in result.items()}


def cardinality_distribution_distance(actual_ocel, simulated_ocel) -> dict[tuple[str, str], float]:
    """
    Per (anchor_type, related_type) pair, the weighted 1-Wasserstein distance
    between the two cardinality histograms. The cardinality values themselves
    (number of related objects) are used as support points, so the distance
    reflects the true difference in counts (e.g. 1 vs 10 contributes 9, not 1).
    """
    actual_card = cardinality_distribution(actual_ocel)
    sim_card = cardinality_distribution(simulated_ocel)

    result = {}
    for key in sorted(set(actual_card) | set(sim_card)):
        a = actual_card.get(key, {})
        s = sim_card.get(key, {})
        result[key] = wd_from_bins(Counter(a), Counter(s))
    return result


def object_lifecycle_distribution(ocel) -> dict[str, dict[str, list]]:
    """
    Per object type, the empirical distribution of:
    - lifecycle **length** (number of events the object participates in)
    - lifecycle **time** in seconds (last event timestamp - first event timestamp)

    Returns:
        ``{obj_type: {"lengths": [int, ...], "times_s": [int, ...]}}``.
    """
    obj_type_map = ocel.obj_type_map
    per_object_ts: dict[str, list[int]] = defaultdict(list)

    for row in ocel.events.select(["_timestampUnix", "_objects"]).iter_rows(named=True):
        ts = row["_timestampUnix"]
        if ts is None:
            continue
        for oid in row["_objects"] or []:
            per_object_ts[oid].append(int(ts))

    by_type: dict[str, dict[str, list]] = defaultdict(lambda: {"lengths": [], "times_s": []})
    for oid, ts_list in per_object_ts.items():
        ot = obj_type_map.get(oid)
        if ot is None:
            continue
        by_type[ot]["lengths"].append(len(ts_list))
        by_type[ot]["times_s"].append(max(ts_list) - min(ts_list))

    return dict(by_type)


def object_lifecycle_distance(actual_ocel, simulated_ocel) -> dict[str, dict[str, float]]:
    """
    Per object type, the 1WD between actual and simulated lifecycle-length and
    lifecycle-time distributions.

    Returns:
        ``{obj_type: {"length_1wd": float, "time_s_1wd": float}}``.
    """
    actual = object_lifecycle_distribution(actual_ocel)
    sim = object_lifecycle_distribution(simulated_ocel)

    def _wd(u, v):
        if not u and not v:
            return 0.0
        if not u or not v:
            return float("inf")
        return float(wasserstein_distance(u, v))

    result = {}
    for ot in sorted(set(actual) | set(sim)):
        a = actual.get(ot, {"lengths": [], "times_s": []})
        s = sim.get(ot, {"lengths": [], "times_s": []})
        result[ot] = {
            "length_1wd": _wd(a["lengths"], s["lengths"]),
            "time_s_1wd": _wd(a["times_s"], s["times_s"]),
        }
    return result

def _variant_graph_edit_distance(g1: nx.DiGraph, g2: nx.DiGraph, timeout_s: float) -> float:
    """
    Approximate GED between two variant representative graphs, matching node
    labels (activity name) and edge labels (object types).
    """
    try:
        dist = nx.graph_edit_distance(
            g1,
            g2,
            node_match=lambda n1, n2: n1.get("label") == n2.get("label"),
            edge_match=lambda e1, e2: e1.get("type") == e2.get("type"),
            timeout=timeout_s,
        )

        if dist is None:
            return float(
                abs(g1.number_of_nodes() - g2.number_of_nodes())
                + abs(g1.number_of_edges() - g2.number_of_edges())
            )

        return float(dist)

    except Exception:
        return float(
            abs(g1.number_of_nodes() - g2.number_of_nodes())
            + abs(g1.number_of_edges() - g2.number_of_edges())
        )


def _directed_ged_coverage(source_variants, target_variants, timeout_s: float) -> float:
    """
    Support-weighted, directional GED coverage: for every variant in
    ``source_variants``, find the closest variant in ``target_variants``
    (minimum GED) and average those minima weighted by source support.

    Returns 0 if the source is empty. If the target is empty, falls back to
    the source variants' own (nodes + edges) size as the "delete everything"
    cost — gives a meaningful number instead of inf.
    """
    if not source_variants:
        return 0.0
    if not target_variants:
        total_support = sum(v.support for v in source_variants)
        return (
            sum(
                (v.graph.number_of_nodes() + v.graph.number_of_edges()) * v.support
                for v in source_variants
            ) / total_support
            if total_support > 0 else 0.0
        )

    weighted_sum, total_weight = 0.0, 0.0
    for sv in source_variants:
        best = min(
            _variant_graph_edit_distance(sv.graph, tv.graph, timeout_s)
            for tv in target_variants
        )
        weighted_sum += best * sv.support
        total_weight += sv.support

    return weighted_sum / total_weight if total_weight > 0 else 0.0


def object_graph_edit_distance(
    actual_ocel, simulated_ocel, timeout_s: float = 10.0
) -> float:
    """
    Symmetric, support-weighted graph edit distance between the variant
    representative graphs of two logs.

    Computes the directed GED coverage in both directions and averages:
    - actual → simulated: penalizes actual variants the simulator misses
    - simulated → actual: penalizes spurious variants the simulator invents

    Averaging the two prevents the metric from being "free" when the
    simulator over-produces variants (a one-sided actual→simulated check
    would not see those extras).

    NOTE: ``nx.graph_edit_distance`` is NP-hard in general — ``timeout_s`` is
    passed to networkx to cap computation per pair. Use only as a reference.

    Args:
        timeout_s: per-pair timeout forwarded to networkx.
    """
    actual_variants = list(get_variants(actual_ocel))
    sim_variants = list(get_variants(simulated_ocel))

    actual_to_sim = _directed_ged_coverage(actual_variants, sim_variants, timeout_s)
    sim_to_actual = _directed_ged_coverage(sim_variants, actual_variants, timeout_s)

    return 0.5 * (actual_to_sim + sim_to_actual)
