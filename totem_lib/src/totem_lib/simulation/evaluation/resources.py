"""
Resource-oriented evaluation measures.

- ``resource_distribution`` — per resource type: number of distinct resources
  used and the count of event participations per individual resource.
- ``resource_distribution_distance`` — per-type participation-count 1WD.
- ``resource_utilization_rate`` — busy-time / available-time per resource and
  per type.
"""

import json
import statistics
from collections import defaultdict

from scipy.stats import wasserstein_distance


def _events_with_resources(ocel, obj_type_map: dict | None = None) -> list[dict]:
    """
    Returns a list of {timestamp, activity, resources: [(rid, rtype), ...]}
    dicts, one per event.

    Resources are read from the ``process_area_resources`` attribute when
    present.
    """
    if obj_type_map is None:
        obj_type_map = ocel.obj_type_map
    out = []

    rows = ocel.events.select(["_timestampUnix", "_activity", "_attributes"]).iter_rows(
        named=True
    )

    for row in rows:
        ts = row["_timestampUnix"]
        if ts is None:
            continue
        attrs = row["_attributes"]
        resource_ids: list[str] | None = None
        if attrs:
            try:
                resource_ids = json.loads(attrs).get("process_area_resources")
            except json.JSONDecodeError:
                resource_ids = None

        if resource_ids is None:
            resource_ids = []

        resources = [(rid, obj_type_map.get(rid)) for rid in resource_ids]
        out.append(
            {
                "timestamp": int(ts),
                "activity": row["_activity"],
                "resources": resources,
            }
        )
    return out


def resource_distribution(ocel, obj_type_map: dict | None = None) -> dict[str, dict]:
    """
    Per resource type, the number of distinct resources used and the
    participation count per individual resource.

    Args:
        ocel:         log to evaluate.
        obj_type_map: optional resource-id -> type map (see
                      ``_events_with_resources``); defaults to
                      ``ocel.obj_type_map``.

    Returns:
        ``{res_type: {
            "n_resources":             int,                # distinct rids
            "n_event_participations":  int,                # total events
            "events_per_resource":     {rid: count},
        }}``.
    """
    events = _events_with_resources(ocel, obj_type_map)

    per_type_rids: dict[str, set] = defaultdict(set)
    per_type_event_count: dict[str, int] = defaultdict(int)
    per_resource_event_count: dict[str, int] = defaultdict(int)

    for ev in events:
        for rid, rtype in ev["resources"]:
            if rtype is None:
                continue
            per_type_rids[rtype].add(rid)
            per_type_event_count[rtype] += 1
            per_resource_event_count[rid] += 1

    result = {}
    for rtype in sorted(per_type_rids):
        result[rtype] = {
            "n_resources": len(per_type_rids[rtype]),
            "n_event_participations": per_type_event_count[rtype],
            "events_per_resource": {
                rid: per_resource_event_count[rid] for rid in per_type_rids[rtype]
            },
        }
    return result


def resource_distribution_distance(
    actual_ocel,
    simulated_ocel,
    actual_obj_type_map: dict | None = None,
    simulated_obj_type_map: dict | None = None,
) -> dict[str, dict]:
    """
    Per resource type, compares the distribution of "events per resource"
    between actual and simulated log via 1-Wasserstein distance

    Args:
        actual_ocel:            reference log.
        simulated_ocel:         simulated log.
        actual_obj_type_map:    optional resource-id -> type map for the actual
                                log; defaults to ``actual_ocel.obj_type_map``.
        simulated_obj_type_map: optional resource-id -> type map for the
                                simulated log; defaults to
                                ``simulated_ocel.obj_type_map``.

    Returns:
        ``{res_type: {
            "n_resources_actual":      int,
            "n_resources_simulated":   int,
            "events_per_resource_1wd": float,
        }}``.
    """
    actual_dist = resource_distribution(actual_ocel, actual_obj_type_map)
    sim_dist = resource_distribution(simulated_ocel, simulated_obj_type_map)

    result = {}
    for rtype in sorted(set(actual_dist) | set(sim_dist)):
        a = actual_dist.get(rtype, {})
        s = sim_dist.get(rtype, {})
        a_counts = list((a.get("events_per_resource") or {}).values())
        s_counts = list((s.get("events_per_resource") or {}).values())
        result[rtype] = {
            "n_resources_actual": a.get("n_resources", 0),
            "n_resources_simulated": s.get("n_resources", 0),
            "events_per_resource_1wd": (
                0.0
                if not a_counts and not s_counts
                else (
                    float("inf")
                    if not a_counts or not s_counts
                    else float(wasserstein_distance(a_counts, s_counts))
                )
            ),
        }
    return result


def resource_utilization_rate(
    ocel,
    cooldown_distribution: dict | None = None,
    observation_window_s: int | None = None,
    obj_type_map: dict | None = None,
) -> dict:
    """
    Resource utilization = (busy time) / (observation window).
    Busy time is taken from the cooldown distribution when available, otherwise only counts event participations
    Args:
        ocel:                  log to evaluate.
        cooldown_distribution: optional, dict of dicts of dicts with mean cooldown durations
        observation_window_s:  optional window length in seconds
        obj_type_map:          optional resource-id -> type map (see
                               ``_events_with_resources``); defaults to
                               ``ocel.obj_type_map``.

    Returns:
        ``{
            "observation_window_s": int,
            "per_resource":  {rid: {"busy_s": float, "utilization": float,
                                    "n_events": int, "type": str}},
            "per_type":      {res_type: {"mean_utilization": float,
                                          "n_resources": int}},
        }``
    """
    events = _events_with_resources(ocel, obj_type_map)
    if not events:
        return {"observation_window_s": 0, "per_resource": {}, "per_type": {}}

    if observation_window_s is None:
        ts_min = min(ev["timestamp"] for ev in events)
        ts_max = max(ev["timestamp"] for ev in events)
        observation_window_s = max(1, ts_max - ts_min)

    busy_per_resource: dict[str, float] = defaultdict(float)
    events_per_resource: dict[str, int] = defaultdict(int)
    type_of_resource: dict[str, str] = {}

    for ev in events:
        activity = ev["activity"]
        for rid, rtype in ev["resources"]:
            if rtype is None:
                continue
            type_of_resource[rid] = rtype
            events_per_resource[rid] += 1
            if cooldown_distribution:
                mean_cd = (
                    cooldown_distribution.get(activity, {})
                    .get(rtype, {})
                    .get("mean_duration_s", 0.0)
                )
                busy_per_resource[rid] += float(mean_cd)

    per_resource = {
        rid: {
            "type": type_of_resource[rid],
            "n_events": events_per_resource[rid],
            "busy_s": busy_per_resource[rid],
            "utilization": busy_per_resource[rid] / observation_window_s,
        }
        for rid in events_per_resource
    }

    per_type_util: dict[str, list[float]] = defaultdict(list)
    for info in per_resource.values():
        per_type_util[info["type"]].append(info["utilization"])

    per_type = {
        rtype: {
            "mean_utilization": float(statistics.mean(utils)) if utils else 0.0,
            "n_resources": len(utils),
        }
        for rtype, utils in per_type_util.items()
    }

    return {
        "observation_window_s": observation_window_s,
        "per_resource": per_resource,
        "per_type": per_type,
    }
