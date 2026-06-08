"""
Congestion distance measures between two object-centric event logs.

Workload in a queueing system is governed by (a) the arrival rate of new
executions over time and (b) the time each execution stays in the system.
This module exposes three measures targeting these properties:

- CTD (Cycle Time Distribution) — distance between empirical distributions of
  execution cycle times.
- IATD (Inter-Arrival Time Distribution) — distance between empirical
  distributions of the gaps between consecutive execution arrivals.
- EAR (Execution Arrival Rate/Case Arrival Rate) — distance between time-binned execution
  arrivals.
- Variant Arrival Distribution — same idea, but evaluated per variant; the
  measure aggregates the per-variant distances weighted by support.

The ``*_count_distance`` variants are count-preserving (L1) complements to the
mass-normalized Wasserstein measures: where the Wasserstein distance captures
only *when* arrivals occur, the L1 variants also penalize a difference in *how
many* arrivals there are.

Reference:
    Chapela-Campa et al. "Can I Trust My Simulation Model?" BPM 2023.
"""

import statistics
from collections import Counter

from scipy.stats import wasserstein_distance

from totem_lib.simulation.evaluation._eval_utils import (
    execution_arrivals_and_cycles,
    l1_from_bins,
    variant_arrivals_by_signature,
    wd_from_bins,
)

SECONDS_PER_HOUR = 3600


def _interarrival_times(arrivals: list[int]) -> list[int]:
    """Gaps (seconds) between consecutive execution arrivals, sorted by time."""
    ordered = sorted(arrivals)
    return [b - a for a, b in zip(ordered, ordered[1:], strict=False)]


def cycle_time_distribution_distance(actual_ocel, simulated_ocel) -> float:
    """
    Cycle Time Distribution distance using the cycle times of process executions.

    Returns the 1-Wasserstein distance between empirical cycle-time
    distributions, measured in hours.
    """
    # Get cycle times for all executions in both logs
    _, actual_cycles = execution_arrivals_and_cycles(actual_ocel)
    _, sim_cycles = execution_arrivals_and_cycles(simulated_ocel)

    if not actual_cycles and not sim_cycles:
        return 0.0
    if not actual_cycles or not sim_cycles:
        return float("inf")

    # Convert to hours for better interpretability
    actual_hours = [c / SECONDS_PER_HOUR for c in actual_cycles]
    sim_hours = [c / SECONDS_PER_HOUR for c in sim_cycles]

    # Return Wasserstein distance in hours
    return float(wasserstein_distance(actual_hours, sim_hours))


def cycle_time_summary(ocel) -> dict:
    """
    Mean/std/min/max/count of the per-execution cycle times in seconds —
    useful for comparison with Benedikt Knopp et al. "Discovering Object-Centric Process Simulation Models", ICPM 2023.
    """
    _, cycles = execution_arrivals_and_cycles(ocel)
    if not cycles:
        return {"mean_s": 0.0, "std_s": 0.0, "min_s": 0, "max_s": 0, "count": 0}
    return {
        "mean_s": float(statistics.mean(cycles)),
        "std_s": float(statistics.stdev(cycles)) if len(cycles) > 1 else 0.0,
        "min_s": int(min(cycles)),
        "max_s": int(max(cycles)),
        "count": len(cycles),
    }


def interarrival_time_distribution_distance(actual_ocel, simulated_ocel) -> float:
    """
    Inter-Arrival Time Distribution (IATD) distance.

    Compares the empirical distributions of the gaps between consecutive
    execution arrivals (arrivals sorted by time) via the 1-Wasserstein distance,
    measured in hours.
    """
    actual_arrivals, _ = execution_arrivals_and_cycles(actual_ocel)
    sim_arrivals, _ = execution_arrivals_and_cycles(simulated_ocel)

    actual_gaps = [g / SECONDS_PER_HOUR for g in _interarrival_times(actual_arrivals)]
    sim_gaps = [g / SECONDS_PER_HOUR for g in _interarrival_times(sim_arrivals)]

    if not actual_gaps and not sim_gaps:
        return 0.0
    if not actual_gaps or not sim_gaps:
        return float("inf")

    return float(wasserstein_distance(actual_gaps, sim_gaps))


def execution_arrival_distribution_distance(actual_ocel, simulated_ocel) -> float:
    """
    Execution Arrival Rate (EAR) distance.

    Bins the execution-arrival timestamps of both logs into 1-hour bins on
    the absolute timeline and returns the weighted 1-Wasserstein distance
    using the bin indices as support points.
    Differences in total count of arrivals are not penalized directly
    """
    # Get execution arrival timestamps for both logs
    actual_arrivals, _ = execution_arrivals_and_cycles(actual_ocel)
    sim_arrivals, _ = execution_arrivals_and_cycles(simulated_ocel)

    # Bin arrivals into hours
    actual_bins = Counter(t // SECONDS_PER_HOUR for t in actual_arrivals)
    sim_bins = Counter(t // SECONDS_PER_HOUR for t in sim_arrivals)

    # Compute Wasserstein distance
    return wd_from_bins(actual_bins, sim_bins)


def variant_arrival_distribution_distance(
    actual_ocel,
    simulated_ocel,
    *,
    missing_variant_penalty_hours: float = 24.0,
) -> float:
    """
    Variant Arrival Distribution distance.

    For every variant present in either log, compares its hourly arrival
    histogram between the two logs and aggregates the per-variant distances
    by support.

    Variant matching:
        Variants are matched by stable structural signature (activity labels
        + typed edges of the representative graph).

    Missing variants:
        A variant present in only one log contributes a finite penalty of
        ``missing_variant_penalty_hours``

    Aggregation weight:
        ``max(len(actual), len(simulated))`` per variant — over-production
        (variant simulated too often) and under-production (variant rarely
        simulated) both contribute proportionally.
    """
    # Get variant arrival timestamps for both logs
    actual = variant_arrivals_by_signature(actual_ocel)
    sim = variant_arrivals_by_signature(simulated_ocel)

    # Collect all signatures present in either log
    all_sigs = set(actual) | set(sim)
    if not all_sigs:
        return 0.0

    # Compute weighted average of per-variant Wasserstein distances
    weighted_sum, total_weight = 0.0, 0.0
    for sig in all_sigs:
        a = actual.get(sig, [])
        s = sim.get(sig, [])

        if a and s:
            a_bins = Counter(t // SECONDS_PER_HOUR for t in a)
            s_bins = Counter(t // SECONDS_PER_HOUR for t in s)
            wd = wd_from_bins(a_bins, s_bins)
        else:
            wd = missing_variant_penalty_hours

        weight = float(max(len(a), len(s)))
        weighted_sum += wd * weight
        total_weight += weight

    return weighted_sum / total_weight if total_weight > 0 else 0.0


def execution_arrival_count_distance(actual_ocel, simulated_ocel) -> float:
    """
    Count-preserving (L1) complement to ``execution_arrival_distribution_distance``.
    """
    actual_arrivals, _ = execution_arrivals_and_cycles(actual_ocel)
    sim_arrivals, _ = execution_arrivals_and_cycles(simulated_ocel)

    actual_bins = Counter(t // SECONDS_PER_HOUR for t in actual_arrivals)
    sim_bins = Counter(t // SECONDS_PER_HOUR for t in sim_arrivals)
    return l1_from_bins(actual_bins, sim_bins)


def variant_arrival_count_distance(actual_ocel, simulated_ocel) -> float:
    """
    Count-preserving (L1) complement to ``variant_arrival_distribution_distance``.
    """
    actual = variant_arrivals_by_signature(actual_ocel)
    sim = variant_arrivals_by_signature(simulated_ocel)

    total = 0.0
    for sig in set(actual) | set(sim):
        a_bins = Counter(t // SECONDS_PER_HOUR for t in actual.get(sig, []))
        s_bins = Counter(t // SECONDS_PER_HOUR for t in sim.get(sig, []))
        total += l1_from_bins(a_bins, s_bins)
    return total
