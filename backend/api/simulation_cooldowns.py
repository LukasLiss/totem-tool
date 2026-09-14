"""Presentation and override helpers for resource cooldown distributions.

``totem_lib`` discovers cooldowns as raw samples and the playout bootstraps
from them. The frontend only needs a compact picture of each distribution (an
equal-width histogram to draw and to put a range slider on), and it sends back
nothing but the selected range. The conversion in both directions lives here.
"""

COOLDOWN_HISTOGRAM_BINS = 20


def build_cooldown_histogram(
    samples: list[float], n_bins: int = COOLDOWN_HISTOGRAM_BINS
) -> tuple[list[float], list[int]]:
    """Bin observed cooldown samples into an equal-width histogram for display.

    Args:
        samples: Observed cooldown durations in seconds (at least one).
        n_bins: Maximum number of equal-width bins.

    Returns:
        ``(bin_edges, bin_counts)`` with ``len(bin_edges) == len(bin_counts) + 1``.
        A degenerate range (all samples equal) yields a single zero-width bin
        ``([v, v], [n])``.
    """
    low = float(min(samples))
    high = float(max(samples))
    if high <= low:
        return [low, low], [len(samples)]
    n = max(1, min(n_bins, len(samples)))
    width = (high - low) / n
    edges = [low + i * width for i in range(n + 1)]
    counts = [0] * n
    for d in samples:
        idx = int((d - low) / width)
        if idx >= n:  # d == high falls into the last bin
            idx = n - 1
        counts[idx] += 1
    return edges, counts


def serialize_cooldowns(cooldown_dist: dict) -> dict:
    """Turn a discovered cooldown distribution into the frontend payload.

    Args:
        cooldown_dist: ``{activity: {resource_type: {"samples": [...], ...}}}``
            as returned by ``resource_cooldown_distribution``.

    Returns:
        ``{activity: {resource_type: {"bin_edges", "bin_counts",
        "min_duration_s", "max_duration_s", "sample_count"}}}`` — the samples
        themselves are not shipped.
    """
    serialized = {}
    for activity, type_stats in cooldown_dist.items():
        serialized[activity] = {}
        for res_type, stats in type_stats.items():
            edges, counts = build_cooldown_histogram(stats["samples"])
            serialized[activity][res_type] = {
                "bin_edges": [round(e, 2) for e in edges],
                "bin_counts": counts,
                "min_duration_s": round(stats["min_duration_s"], 2),
                "max_duration_s": round(stats["max_duration_s"], 2),
                "sample_count": stats["sample_count"],
            }
    return serialized


def apply_cooldown_selection(cooldown_dist: dict, overrides: dict) -> None:
    """Trim a discovered cooldown distribution to the user's selected ranges.

    Only ``select_min_s`` / ``select_max_s`` are read from the overrides; the
    samples outside that band are dropped from the model's entry so the playout
    bootstraps from the remaining ones (values are excluded, not capped). An
    entry without a band keeps all its samples. Overrides for (activity, type)
    pairs that were not discovered are ignored.

    Args:
        cooldown_dist: The model's ``resource_cooldown_distribution`` (mutated).
        overrides: ``{activity: {resource_type: {...}}}`` as sent by the frontend.
    """
    for activity, type_overrides in (overrides or {}).items():
        discovered_types = cooldown_dist.get(activity)
        if not discovered_types or not isinstance(type_overrides, dict):
            continue
        for res_type, override in type_overrides.items():
            entry = discovered_types.get(res_type)
            if entry is None or not isinstance(override, dict):
                continue
            lo = override.get("select_min_s")
            hi = override.get("select_max_s")
            if lo is None and hi is None:
                continue
            lo = float("-inf") if lo is None else float(lo)
            hi = float("inf") if hi is None else float(hi)
            if hi < lo:
                lo, hi = hi, lo
            samples = [v for v in entry.get("samples") or [] if lo <= v <= hi]
            entry["samples"] = samples
            entry["sample_count"] = len(samples)
            entry["min_duration_s"] = min(samples) if samples else None
            entry["max_duration_s"] = max(samples) if samples else None
