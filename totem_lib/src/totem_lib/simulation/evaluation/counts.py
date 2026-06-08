"""
Count- and size-based summary measures of OCELs.

- ``count_summary`` — totals (executions / events / variants) and average sizes
  (events per execution, events & executions per variant) of a single log.
- ``count_summary_distance`` — absolute / relative differences of the summary
  counts above between two logs.
"""

import statistics

from totem_lib.simulation.evaluation._eval_utils import get_variants


def count_summary(ocel) -> dict:
    """
    Totals and average sizes of a single log.

    Returns:
        ``{
            "n_executions":               int,    # total process executions
            "n_events":                   int,    # total events in the log
            "n_variants":                 int,    # distinct variants
            "avg_events_per_execution":   float,  # mean #events over executions
            "avg_events_per_variant":     float,  # mean #events over variants
            "avg_executions_per_variant": float,  # mean support over variants
        }``

    ``avg_events_per_execution`` is execution-weighted (frequent variants count
    once per execution), whereas ``avg_events_per_variant`` weights every
    variant equally regardless of how often it occurs.
    """
    variants = get_variants(ocel)

    n_executions = 0
    execution_sizes: list[int] = []  # #events per execution
    variant_event_sizes: list[int] = []  # #events per variant representative
    variant_execution_counts: list[int] = []  # #executions per variant

    n_variants = 0
    for variant in variants:
        n_variants += 1
        variant_execution_counts.append(len(variant.executions))
        variant_event_sizes.append(variant.graph.number_of_nodes())
        for execution in variant.executions:
            n_executions += 1
            execution_sizes.append(len(execution))

    mean = lambda xs: float(statistics.mean(xs)) if xs else 0.0

    return {
        "n_executions": n_executions,
        "n_events": int(ocel.events.height),
        "n_variants": n_variants,
        "avg_events_per_execution": mean(execution_sizes),
        "avg_events_per_variant": mean(variant_event_sizes),
        "avg_executions_per_variant": mean(variant_execution_counts),
    }


def count_summary_distance(actual_ocel, simulated_ocel) -> dict:
    """
    Per-metric comparison of the ``count_summary`` figures of two logs.

    Returns:
        ``{metric: {"actual": x, "simulated": y, "abs_diff": |x-y|,
        "rel_diff": |x-y| / x}}`` for every key of ``count_summary``.
        ``rel_diff`` is NaN when the actual value is 0.
    """
    actual = count_summary(actual_ocel)
    simulated = count_summary(simulated_ocel)

    result = {}
    for metric, a in actual.items():
        s = simulated[metric]
        rel = abs(a - s) / a if a else float("nan")
        result[metric] = {
            "actual": a,
            "simulated": s,
            "abs_diff": abs(a - s),
            "rel_diff": rel,
        }
    return result
