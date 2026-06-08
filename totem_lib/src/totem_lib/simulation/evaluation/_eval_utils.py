"""
Shared utilities used by the evaluation metrics.
"""
from collections import Counter, defaultdict

from scipy.stats import wasserstein_distance

from totem_lib.variants.ocvariants import (
    find_object_variants_connected_component,
    Variants,
)


# ────────────────────────── OCEL extraction ──────────────────────────

def event_timestamps(ocel) -> list[int]:
    """All event timestamps in the log (unix seconds, unsorted)."""
    return ocel.events.select("_timestampUnix").to_series().drop_nulls().to_list()


def get_variants(ocel) -> Variants:
    """Discover the object-centric variants (connected components) of an OCEL."""
    return find_object_variants_connected_component(ocel)


def execution_arrivals_and_cycles(
    ocel, variants: Variants | None = None
) -> tuple[list[int], list[int]]:
    """
    For every process execution, return its arrival time (min event timestamp)
    and its cycle time (max - min, in seconds).

    Returns:
        (arrivals, cycle_times) — two parallel lists, one entry per execution.
    """
    if variants is None:
        variants = get_variants(ocel)

    arrivals, cycles = [], []
    for variant in variants:
        for execution in variant.executions:
            ts = [
                ocel.get_event_timestamp(eid)
                for eid in execution
                if ocel.get_event_timestamp(eid) is not None
            ]
            if not ts:
                continue
            arrivals.append(min(ts))
            cycles.append(max(ts) - min(ts))

    return arrivals, cycles

def normalize_label(label: str) -> str:
    head, sep, tail = label.rpartition("_")
    if sep and tail.isdigit():
        return head
    return label

def variant_signature(variant) -> str:
    """
    Stable structural signature for a variant.

    Derived from its representative event-object graph (normalized activity
    labels + typed edges), matching the signature scheme used during variant
    discovery. 
    """
    G = variant.graph
    normalize = lambda label: normalize_label(label)
    node_labels = sorted(normalize(d["label"]) for _, d in G.nodes(data=True))
    edge_tuples = sorted(
        (normalize(G.nodes[u]["label"]),
         normalize(G.nodes[v]["label"]),
         d.get("type", ""))
        for u, v, d in G.edges(data=True)
    )
    return f"nodes:{'|'.join(node_labels)};edges:{'|'.join(map(str, edge_tuples))}"



def variant_arrivals_by_signature(
    ocel, variants: Variants | None = None
) -> dict[str, list[int]]:
    """
    Returns, per stable variant signature, the list of arrival timestamps
    (execution-start time) of all executions of that variant.
    """
    if variants is None:
        variants = get_variants(ocel)

    result: dict[str, list[int]] = defaultdict(list)
    for variant in variants:
        sig = variant_signature(variant)
        for execution in variant.executions:
            ts = [
                ocel.get_event_timestamp(eid)
                for eid in execution
                if ocel.get_event_timestamp(eid) is not None
            ]
            if ts:
                result[sig].append(min(ts))
    return dict(result)


def event_timestamps_per_execution(
    ocel, variants: Variants | None = None
) -> list[list[int]]:
    """Per execution, return the list of event timestamps (unsorted)."""
    if variants is None:
        variants = get_variants(ocel)

    per_execution = []
    for variant in variants:
        for execution in variant.executions:
            ts = [
                ocel.get_event_timestamp(eid)
                for eid in execution
                if ocel.get_event_timestamp(eid) is not None
            ]
            if ts:
                per_execution.append(ts)
    return per_execution


# ─────────────────────────── Distance helpers ────────────────────────

def wd_from_bins(bins_a: Counter, bins_s: Counter) -> float:
    """
    Wasserstein on two Counters, using the keys as support
    points and the counts as weights.
    """
    if not bins_a and not bins_s:
        return 0.0
    if not bins_a or not bins_s:
        return float("inf")
    keys_a = list(bins_a.keys())
    keys_s = list(bins_s.keys())
    return float(wasserstein_distance(
        keys_a, keys_s,
        u_weights=[bins_a[k] for k in keys_a],
        v_weights=[bins_s[k] for k in keys_s],
    ))


def l1_from_bins(bins_a: Counter, bins_s: Counter) -> float:
    """
    Total absolute count difference between two Counters (L1 / Manhattan).
    """
    keys = set(bins_a) | set(bins_s)
    return float(sum(abs(bins_a.get(k, 0) - bins_s.get(k, 0)) for k in keys))
