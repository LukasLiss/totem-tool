"""Organizational mining endpoints: handover of work and resource profiling.

Carried over from the former monolithic ``api/views.py`` (branch
``oc-handover-demo``) when merging ``main``, which split the views into this
package.
"""

import os

from django.core.cache import cache
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import EventLog

def _build_ocel_from_path(path: str):
    from totem_lib.ocel.ocel import ObjectCentricEventLog
    from totem_lib.ocel.importer import (
        load_events_from_sqlite, load_objects_from_sqlite,
        load_events_from_json,   load_objects_from_json,
        load_events_from_xml,    load_objects_from_xml,
    )
    ext = os.path.splitext(path)[1].lower()
    if ext in (".sqlite", ".db"):
        log = ObjectCentricEventLog(events=load_events_from_sqlite(path), objects=load_objects_from_sqlite(path))
    elif ext == ".json":
        log = ObjectCentricEventLog(events=load_events_from_json(path), objects=load_objects_from_json(path))
    elif ext == ".xml":
        log = ObjectCentricEventLog(events=load_events_from_xml(path), objects=load_objects_from_xml(path))
    elif ext == ".duckdb":
        from totem_lib.ocel.importer_duckdb import (
            load_events_from_duckdb, load_objects_from_duckdb,
            load_object_attributes_from_duckdb,
        )
        log = ObjectCentricEventLog(
            events=load_events_from_duckdb(path),
            objects=load_objects_from_duckdb(path),
            object_attributes=load_object_attributes_from_duckdb(path),
        )
    else:
        raise ValueError(f"Unsupported file type: {ext}. Supported formats: .sqlite, .db, .json, .xml, .duckdb")
    return log


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def ochandover(request):
    from totem_lib.ochandover.ochandover import OCHANDOVER

    # Support GET (query params) for normal mode and POST (JSON body) for cluster mode
    p = request.data if request.method == "POST" else request.query_params

    file_id = p.get("file_id")
    if not file_id:
        return Response({"error": "Missing file_id"}, status=status.HTTP_400_BAD_REQUEST)

    method = p.get("method", "oc")

    cluster_map: dict | None = None
    if request.method == "POST":
        raw = request.data.get("cluster_map")
        if isinstance(raw, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in raw.items()):
            cluster_map = raw

    cluster_by_ot = p.get("cluster_by_ot", "false").lower() in ("true", "1", "yes")
    include_flows = p.get("include_flows", "false").lower() in ("true", "1", "yes")
    include_bindings = p.get("include_bindings", "false").lower() in ("true", "1", "yes")

    try:
        EventLog.objects.get(pk=file_id, project__users=request.user)
    except EventLog.DoesNotExist:
        return Response({"error": "File not found or access denied"}, status=status.HTTP_404_NOT_FOUND)

    cache_key = f"ocel_object_{file_id}"
    ocel = cache.get(cache_key)

    if not ocel:
        try:
            uf = EventLog.objects.get(pk=file_id)
            path = uf.file.path
            if not os.path.exists(path):
                return Response({"error": f"Path does not exist: {path}"}, status=status.HTTP_400_BAD_REQUEST)
            ocel = _build_ocel_from_path(path)
            cache.set(cache_key, ocel, timeout=3600)
        except EventLog.DoesNotExist:
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"error": f"Failed to load OCEL: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    try:
        if method == "flattened":
            case_type = p.get("case_type", "")
            resource_type = p.get("resource_type", "")
            if not case_type or not resource_type:
                return Response(
                    {"error": "Missing case_type or resource_type"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            max_gap_raw = p.get("max_gap")
            max_gap = int(max_gap_raw) if max_gap_raw is not None else None
            graph = OCHANDOVER.from_ocel_flattened(ocel, case_type=case_type, resource_type=resource_type, max_gap=max_gap)
        else:
            resource_types_raw = p.get("resource_types", "")
            businessobject_types_raw = p.get("businessobject_types", "")
            if not resource_types_raw or not businessobject_types_raw:
                return Response(
                    {"error": "Missing resource_types or businessobject_types"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            resource_types = [t.strip() for t in resource_types_raw.split(",") if t.strip()]
            businessobject_types = [t.strip() for t in businessobject_types_raw.split(",") if t.strip()]
            max_gap_raw = p.get("max_gap")
            max_gap = int(max_gap_raw) if max_gap_raw is not None else None
            normalization_raw = p.get("normalization", "by_arcs_in_eog")
            valid_normalizations = {"by_source", "by_target", "by_arcs_in_eog", "by_total_weight"}
            if normalization_raw not in valid_normalizations:
                return Response({"error": f"Invalid normalization: {normalization_raw}"}, status=status.HTTP_400_BAD_REQUEST)
            normalization_scope_raw = p.get("normalization_scope", "global")
            if normalization_scope_raw not in {"global", "per_bo_type"}:
                return Response({"error": f"Invalid normalization_scope: {normalization_scope_raw}"}, status=status.HTTP_400_BAD_REQUEST)
            parallel_threshold = None
            parallel_threshold_raw = p.get("parallel_threshold")
            if parallel_threshold_raw is not None:
                try:
                    parallel_threshold = float(parallel_threshold_raw)
                    if not (0.0 <= parallel_threshold <= 1.0):
                        return Response({"error": "parallel_threshold must be between 0 and 1"}, status=status.HTTP_400_BAD_REQUEST)
                except ValueError:
                    return Response({"error": "Invalid parallel_threshold value"}, status=status.HTTP_400_BAD_REQUEST)
            min_parallel_observations = 1
            min_parallel_observations_raw = p.get("min_parallel_observations")
            if min_parallel_observations_raw is not None:
                try:
                    min_parallel_observations = int(min_parallel_observations_raw)
                    if min_parallel_observations < 1:
                        return Response({"error": "min_parallel_observations must be at least 1"}, status=status.HTTP_400_BAD_REQUEST)
                except ValueError:
                    return Response({"error": "Invalid min_parallel_observations value"}, status=status.HTTP_400_BAD_REQUEST)
            graph = OCHANDOVER.from_ocel(ocel, resource_types=resource_types, businessobject_types=businessobject_types, max_gap=max_gap, normalization=normalization_raw, normalization_scope=normalization_scope_raw, parallel_threshold=parallel_threshold, min_parallel_observations=min_parallel_observations, cluster_map=cluster_map, cluster_by_ot=cluster_by_ot, include_flows=include_flows, include_bindings=include_bindings)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({"error": f"Handover computation failed: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    nodes = [
        {"id": node_id, "object_type": data.get("object_type", "unknown"), "event_count": data.get("event_count", 0)}
        for node_id, data in graph.nodes(data=True)
    ]
    edges = [
        {
            "source": u,
            "target": v,
            "businessobject_type": data.get("businessobject_type", "unknown"),
            "weight": round(data.get("weight", 0), 6),
            "raw_weight": int(data.get("raw_weight", 0)),
            "avg_time": data.get("avg_time"),
            "min_time": data.get("min_time"),
            "max_time": data.get("max_time"),
        }
        for u, v, data in graph.edges(data=True)
    ]

    response_data: dict = {"nodes": nodes, "edges": edges}
    if include_flows:
        animation_flows = graph.graph.get("animation_flows")
        if animation_flows:
            response_data["flows"] = animation_flows["flows"]
            response_data["timeline"] = animation_flows["timeline"]
        else:
            response_data["flows"] = []
            response_data["timeline"] = None

    if include_bindings:
        response_data["bindings"] = graph.graph.get("bindings", [])
        from collections import defaultdict
        raw_bindings = graph.graph.get("bindings", [])
        for direction in ["output", "input"]:
            print(f"\n=== {direction.upper()} BINDINGS ===")
            by_resource = defaultdict(list)
            for b in raw_bindings:
                if b["type"] == direction:
                    by_resource[b["resource"]].append(b)
            for resource in sorted(by_resource):
                print(f"  {resource}:")
                for b in by_resource[resource]:
                    bo_type = b["arcs"][0]["bo_type"]
                    arcs = {(a["other_resource"], a["mark"], "filled" if not a["is_gapped"] else "hollow") for a in b["arcs"]}
                    line = b["line_type"] or "solo"
                    print(f"    [{bo_type}]  {arcs}  [{line}]  ×{b['count']}")

        suppressed = [b for b in raw_bindings
                      if any(a["other_resource"] == b["resource"] for a in b["arcs"])
                      and any(a["other_resource"] != b["resource"] for a in b["arcs"])]
        if suppressed:
            print("\n=== SUPPRESSED (self-loop + regular arcs, connection not visualized) ===")
            for b in suppressed:
                bo_type = b["arcs"][0]["bo_type"]
                arcs = {(a["other_resource"], a["mark"], "filled" if not a["is_gapped"] else "hollow") for a in b["arcs"]}
                print(f"  [{b['type']}] {b['resource']}:  [{bo_type}]  {arcs}  [{b['line_type'] or 'solo'}]  ×{b['count']}")

    return Response(response_data, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def event_log_table(request):
    file_id = request.query_params.get("file_id")
    if not file_id:
        return Response({"error": "Missing ?file_id"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        EventLog.objects.get(pk=file_id, project__users=request.user)
    except EventLog.DoesNotExist:
        return Response({"error": "File not found or access denied"}, status=status.HTTP_404_NOT_FOUND)

    cache_key = f"ocel_object_{file_id}"
    ocel = cache.get(cache_key)
    if not ocel:
        try:
            uf = EventLog.objects.get(pk=file_id)
            ocel = _build_ocel_from_path(uf.file.path)
            cache.set(cache_key, ocel, timeout=3600)
        except Exception as e:
            return Response({"error": f"Failed to load OCEL: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    try:
        # Build object_id → object_type lookup
        obj_type_map = {}
        for obj_type in ocel.object_types:
            for obj_id in ocel.get_object_ids_by_type(obj_type):
                obj_type_map[obj_id] = obj_type

        events_df = (
            ocel.events
            .select(["_eventId", "_activity", "_timestampUnix", "_objects"])
            .sort("_timestampUnix")
        )

        events = []
        for row in events_df.to_dicts():
            objects_by_type: dict[str, list[str]] = {t: [] for t in ocel.object_types}
            for obj_id in (row["_objects"] or []):
                t = obj_type_map.get(obj_id)
                if t:
                    objects_by_type[t].append(obj_id)
            ts = row["_timestampUnix"]
            # Normalise to milliseconds for the frontend
            if isinstance(ts, (int, float)):
                ts_ms = int(ts) if ts > 1e12 else int(ts * 1000)
            else:
                ts_ms = str(ts)
            events.append({
                "event_id": row["_eventId"],
                "activity": row["_activity"],
                "timestamp": ts_ms,
                "objects": objects_by_type,
            })

        return Response({"object_types": ocel.object_types, "events": events}, status=status.HTTP_200_OK)
    except Exception as e:
        import traceback; traceback.print_exc()
        return Response({"error": f"Failed to build event log: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def profile_matrix(request):
    from totem_lib.ochandover.orgamining import ProfileMatrix

    file_id = request.query_params.get("file_id")
    if not file_id:
        return Response({"error": "Missing ?file_id"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        EventLog.objects.get(pk=file_id, project__users=request.user)
    except EventLog.DoesNotExist:
        return Response({"error": "File not found or access denied"}, status=status.HTTP_404_NOT_FOUND)

    cache_key = f"ocel_object_{file_id}"
    ocel = cache.get(cache_key)
    if not ocel:
        try:
            uf = EventLog.objects.get(pk=file_id)
            ocel = _build_ocel_from_path(uf.file.path)
            cache.set(cache_key, ocel, timeout=3600)
        except Exception as e:
            return Response({"error": f"Failed to load OCEL: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    resource_types_raw = request.query_params.get("resource_types", "")
    resource_types = [t.strip() for t in resource_types_raw.split(",") if t.strip()] or None

    business_object_types_raw = request.query_params.get("business_object_types", "")
    business_object_types = [t.strip() for t in business_object_types_raw.split(",") if t.strip()] or None

    VALID_FEATURE_GROUPS = {"activity_fractions", "cooccurrence_fractions", "object_collaboration_fractions", "object_portfolio_fractions", "time_fractions", "weekday_fractions"}
    feature_groups_raw = request.query_params.get("feature_groups", "activity_fractions")
    feature_groups = [g.strip() for g in feature_groups_raw.split(",") if g.strip() in VALID_FEATURE_GROUPS] or ["activity_fractions"]

    tooltip_only_raw = request.query_params.get("tooltip_feature_groups", "")
    tooltip_only = [g.strip() for g in tooltip_only_raw.split(",") if g.strip() in VALID_FEATURE_GROUPS and g.strip() not in feature_groups]

    width = height = None
    try:
        w_raw = request.query_params.get("width")
        h_raw = request.query_params.get("height")
        if w_raw and h_raw:
            width, height = int(w_raw), int(h_raw)
    except ValueError:
        return Response({"error": "Invalid width or height"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        n_clusters = max(1, int(request.query_params.get("n_clusters", 3)))
    except ValueError:
        n_clusters = 3

    cluster_method = request.query_params.get("cluster_method", "hdbscan")
    if cluster_method not in ("kmeans", "agglomerative", "hdbscan"):
        cluster_method = "hdbscan"

    try:
        min_cluster_size = max(2, int(request.query_params.get("min_cluster_size", 2)))
    except ValueError:
        min_cluster_size = 2

    compute_clusters = request.query_params.get("compute_clusters", "true").lower() != "false"

    distance_metric = request.query_params.get("distance_metric", "euclidean")
    if distance_metric not in ("euclidean", "hellinger"):
        distance_metric = "euclidean"

    try:
        pm = ProfileMatrix.from_ocel(
            ocel,
            resource_types=resource_types,
            feature_groups=feature_groups + tooltip_only,
            business_object_types=business_object_types,
            tooltip_only_groups=tooltip_only,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return Response({"error": f"Computation failed: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    group_weights = {g: 0.0 for g in tooltip_only} if tooltip_only else None

    return Response(
        pm.to_dict(
            width=width, height=height,
            n_clusters=n_clusters, cluster_method=cluster_method,
            compute_clusters=compute_clusters,
            min_cluster_size=min_cluster_size,
            distance_metric=distance_metric,
            group_weights=group_weights,
        ),
        status=status.HTTP_200_OK,
    )
