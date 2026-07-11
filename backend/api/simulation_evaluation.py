"""
Backend-side aggregator that runs the evaluation metrics from totem_lib and
shapes the result into the JSON payload consumed by the frontend.

This belongs to the API layer (not to the library): it picks which metrics
to compute, decides which sub-statistics to drop, and adapts the result to
the frontend contract. The library only exposes the individual metric
functions.
"""
from __future__ import annotations
import math

from totem_lib.simulation.evaluation.counts import count_summary_distance
from totem_lib.simulation.evaluation.control_flow import (
    n_gram_distance_absolute,
    n_gram_distance_relative,
)
from totem_lib.simulation.evaluation.temporal import (
    absolute_event_distribution_distance,
    circadian_event_distribution_distance,
    relative_event_distribution_distance,
)
from totem_lib.simulation.evaluation.congestion import (
    cycle_time_distribution_distance,
    cycle_time_summary,
    interarrival_time_distribution_distance,
    execution_arrival_distribution_distance,
    execution_arrival_count_distance,
    variant_arrival_distribution_distance,
    variant_arrival_count_distance,
)
from totem_lib.simulation.evaluation.object_centric import (
    object_count_distance,
    cardinality_distribution_distance,
    object_lifecycle_distance,
    object_graph_edit_distance,
)
from totem_lib.simulation.evaluation.resources import (
    resource_distribution,
    resource_distribution_distance,
    resource_utilization_rate,
)


def _json_safe(value):
    """
    Replace non-JSON-compliant floats (NaN, +/-Inf) with None recursively.
    DRF's JSONRenderer runs json.dumps with allow_nan=False (STRICT_JSON), so
    leaking an inf from e.g. wasserstein_distance on an empty sample would
    crash the response.
    """
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [_json_safe(v) for v in value]
    return value


def compute_graph_edit_distance(actual_ocel, simulated_ocel, *, timeout_s: float = 1.0):
    """
    Object Graph Edit Distance between two logs, JSON-safe.

    Computed on its own (not part of ``build_evaluation_payload``) because it is
    expensive — tens of seconds — and is therefore fetched lazily by the
    frontend after the cheap metrics are already displayed.
    """
    value = object_graph_edit_distance(actual_ocel, simulated_ocel, timeout_s=timeout_s)
    return _json_safe(value)


def build_evaluation_payload(
    actual_ocel,
    simulated_ocel,
    *,
    cooldown_distribution: dict | None = None,
    actual_obj_type_map: dict | None = None,
    simulated_obj_type_map: dict | None = None,
    include_graph_edit_distance: bool = False,
    graph_edit_timeout_s: float = 5.0,
) -> dict:
    """
    Runs the configured set of metrics against actual vs simulated OCEL and
    returns the JSON-serializable payload expected by the frontend.

    GED is off by default — it is expensive and only useful as a reference
    number in paper-style runs.

    The resource metrics resolve resource ids to types via the object type map.
    """
    # ── Counts & sizes ──
    counts = count_summary_distance(actual_ocel, simulated_ocel)
    counts_list = [
        {
            "metric": metric,
            "actual": v["actual"],
            "simulated": v["simulated"],
            "abs_diff": v["abs_diff"],
            "rel_diff": v["rel_diff"],
        }
        for metric, v in counts.items()
    ]

    # ── Control flow ──
    ngda = n_gram_distance_absolute(actual_ocel, simulated_ocel, n=2)
    ngdr = n_gram_distance_relative(actual_ocel, simulated_ocel, n=2)

    # ── Temporal ──
    aed = absolute_event_distribution_distance(actual_ocel, simulated_ocel)
    ced = circadian_event_distribution_distance(actual_ocel, simulated_ocel)
    red = relative_event_distribution_distance(actual_ocel, simulated_ocel)

    # ── Congestion ──
    ctd = cycle_time_distribution_distance(actual_ocel, simulated_ocel)
    iatd = interarrival_time_distribution_distance(actual_ocel, simulated_ocel)
    ear = execution_arrival_distribution_distance(actual_ocel, simulated_ocel)
    ear_count = execution_arrival_count_distance(actual_ocel, simulated_ocel)
    var_arr = variant_arrival_distribution_distance(actual_ocel, simulated_ocel)
    var_arr_count = variant_arrival_count_distance(actual_ocel, simulated_ocel)
    ct_actual = cycle_time_summary(actual_ocel)
    ct_sim = cycle_time_summary(simulated_ocel)

    # ── Object-centric ──
    obj_counts = object_count_distance(actual_ocel, simulated_ocel)
    object_counts_list = [
        {"type": ot, "actual": v["actual"], "simulated": v["simulated"], "abs_diff": v["abs_diff"]}
        for ot, v in obj_counts.items()
    ]

    cardinality = cardinality_distribution_distance(actual_ocel, simulated_ocel)
    cardinality_list = sorted(
        (
            {"anchor": anchor, "related": related, "emd": emd}
            for (anchor, related), emd in cardinality.items()
            if emd > 0
        ),
        key=lambda d: d["emd"],
        reverse=True,
    )

    lifecycle = object_lifecycle_distance(actual_ocel, simulated_ocel)
    lifecycle_list = [
        {"type": ot, "length_emd": v["length_1wd"], "time_s_emd": v["time_s_1wd"]}
        for ot, v in lifecycle.items()
    ]

    ged_value = (
        object_graph_edit_distance(actual_ocel, simulated_ocel, timeout_s=graph_edit_timeout_s)
        if include_graph_edit_distance
        else None
    )

    # ── Resources ──
    res_dist_actual = resource_distribution(actual_ocel, obj_type_map=actual_obj_type_map)
    res_dist_sim = resource_distribution(simulated_ocel, obj_type_map=simulated_obj_type_map)
    res_dist_diff = resource_distribution_distance(
        actual_ocel,
        simulated_ocel,
        actual_obj_type_map=actual_obj_type_map,
        simulated_obj_type_map=simulated_obj_type_map,
    )
    util_actual = resource_utilization_rate(
        actual_ocel,
        cooldown_distribution=cooldown_distribution,
        obj_type_map=actual_obj_type_map,
    )
    util_sim = resource_utilization_rate(
        simulated_ocel,
        cooldown_distribution=cooldown_distribution,
        obj_type_map=simulated_obj_type_map,
    )

    resource_rows = []
    for rt in sorted(set(res_dist_diff)):
        d = res_dist_diff[rt]
        ua = util_actual["per_type"].get(rt, {})
        us = util_sim["per_type"].get(rt, {})
        resource_rows.append({
            "type": rt,
            "n_actual": d["n_resources_actual"],
            "n_simulated": d["n_resources_simulated"],
            "events_actual": res_dist_actual.get(rt, {}).get("n_event_participations", 0),
            "events_simulated": res_dist_sim.get(rt, {}).get("n_event_participations", 0),
            "events_per_resource_emd": d["events_per_resource_1wd"],
            "mean_utilization_actual": ua.get("mean_utilization"),
            "mean_utilization_simulated": us.get("mean_utilization"),
        })

    return _json_safe({
        "counts": counts_list,
        "control_flow": {
            "n_gram_distance_absolute": ngda,
            "n_gram_distance_relative": ngdr,
        },
        "temporal": {
            "absolute_event_distribution": aed,
            "circadian_event_distribution": ced,
            "relative_event_distribution": red,
        },
        "congestion": {
            "cycle_time_distribution": ctd,
            "interarrival_time_distribution": iatd,
            "execution_arrival_rate": ear,
            "execution_arrival_count": ear_count,
            "variant_arrival_distribution": var_arr,
            "variant_arrival_count": var_arr_count,
            "cycle_time_actual": ct_actual,
            "cycle_time_simulated": ct_sim,
        },
        "object_centric": {
            "object_counts": object_counts_list,
            "cardinality": cardinality_list,
            "lifecycle": lifecycle_list,
            "graph_edit_distance": ged_value,
        },
        "resources": {
            "per_type": resource_rows,
            "observation_window_actual_s": util_actual["observation_window_s"],
            "observation_window_simulated_s": util_sim["observation_window_s"],
        },
    })
