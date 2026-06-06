"""
Congestion distance measures between two object-centric event logs.

Workload in a queueing system is governed by (a) the arrival rate of new
executions over time and (b) the time each execution stays in the system.
This module exposes three measures targeting these properties:

- CTD (Cycle Time Distribution) — distance between empirical distributions of
  execution cycle times.
- EAR (Execution Arrival Rate/Case Arrival Rate) — distance between time-binned execution
  arrivals. 
- Variant Arrival Distribution — same idea, but evaluated per variant; the
  measure aggregates the per-variant distances weighted by support.

Reference:
    Chapela-Campa et al. "Can I Trust My Simulation Model?" BPM 2023.
"""
from collections import Counter
import statistics

from totem_lib.simulation.evaluation._eval_utils import (
    execution_arrivals_and_cycles,
    variant_arrivals_by_signature,
    wd_from_bins,
)

SECONDS_PER_HOUR = 3600


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
