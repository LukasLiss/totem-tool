"""Presentation and override helpers for sample-based simulation distributions.

``totem_lib`` discovers resource cooldowns and activity delays as raw samples
and the playout bootstraps from them. The frontend only needs a compact picture
of each distribution (an equal-width histogram to draw and to put a range
slider on), and it sends back nothing but the selected range. The conversion in
both directions lives here.
"""

COOLDOWN_HISTOGRAM_BINS = 20

# Bin edges are shipped rounded to 2 decimals, so a band the user placed on an
# outer edge may sit up to half a unit inside the sample it was rounded from.
_EDGE_TOLERANCE = 0.005


def build_cooldown_histogram(
    samples: list[float], n_bins: int = COOLDOWN_HISTOGRAM_BINS
) -> tuple[list[float], list[int]]:
    """Bin observed duration samples into an equal-width histogram for display.

    Args:
        samples: Observed durations in seconds (at least one).
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


def _histogram_entry(samples: list[float]) -> dict:
    """The frontend entry of one sample pool: histogram, range and size."""
    edges, counts = build_cooldown_histogram(samples)
    return {
        "bin_edges": [round(e, 2) for e in edges],
        "bin_counts": counts,
        "min_duration_s": round(float(min(samples)), 2),
        "max_duration_s": round(float(max(samples)), 2),
        "sample_count": len(samples),
    }


def _selected_band(override) -> tuple[float, float] | None:
    """The ``[select_min_s, select_max_s]`` band of an override entry.

    Returns:
        ``(lo, hi)`` widened by the edge rounding tolerance, or None when the
        entry carries no band (all samples are kept).
    """
    if not isinstance(override, dict):
        return None
    lo = override.get("select_min_s")
    hi = override.get("select_max_s")
    if lo is None and hi is None:
        return None
    lo = float("-inf") if lo is None else float(lo)
    hi = float("inf") if hi is None else float(hi)
    if hi < lo:
        lo, hi = hi, lo
    return lo - _EDGE_TOLERANCE, hi + _EDGE_TOLERANCE


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
    return {
        activity: {
            res_type: _histogram_entry(stats["samples"])
            for res_type, stats in type_stats.items()
        }
        for activity, type_stats in cooldown_dist.items()
    }


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
            band = _selected_band(override)
            if entry is None or band is None:
                continue
            lo, hi = band
            samples = [v for v in entry.get("samples") or [] if lo <= v <= hi]
            entry["samples"] = samples
            entry["sample_count"] = len(samples)
            entry["min_duration_s"] = min(samples) if samples else None
            entry["max_duration_s"] = max(samples) if samples else None


def serialize_activity_delays(activity_delays: dict) -> dict:
    """Turn the discovered activity delays into the frontend payload.

    Args:
        activity_delays: ``{activity: [delay_s, ...]}`` as returned by
            ``activity_delay_distribution``.

    Returns:
        ``{activity: {"bin_edges", "bin_counts", "min_duration_s",
        "max_duration_s", "sample_count"}}`` — the same entry shape as a
        cooldown. Activities without samples are left out.
    """
    return {
        activity: _histogram_entry(samples)
        for activity, samples in activity_delays.items()
        if samples
    }


def apply_activity_delay_selection(activity_delays: dict, overrides: dict) -> None:
    """Trim the discovered activity delays to the user's selected ranges.

    Works like ``apply_cooldown_selection``: the delays outside an activity's
    ``[select_min_s, select_max_s]`` band are dropped, so the duration model
    bootstraps from the remaining ones. An activity whose band keeps no sample
    fires without delay (minimum event spacing only). Overrides for activities
    without discovered delays are ignored.

    Args:
        activity_delays: The model's ``activity_delays`` (mutated).
        overrides: ``{activity: {...}}`` as sent by the frontend.
    """
    for activity, override in (overrides or {}).items():
        samples = activity_delays.get(activity)
        band = _selected_band(override)
        if samples is None or band is None:
            continue
        lo, hi = band
        activity_delays[activity] = [v for v in samples if lo <= v <= hi]
