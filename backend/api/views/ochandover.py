"""Organizational mining endpoints: handover of work and resource profiling.

All three endpoints run on the process-local ``OcelDuckDB`` of the event log
(``_with_ocel_db``) and honour the global filter through ``_filter_shadow``,
like every other analysis endpoint. The algorithms themselves live in
``totem_lib.ochandover``; this module only parses parameters, resolves the
log, and serialises the result.
"""

import hashlib
import json
import traceback

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from totem_lib.ochandover import OCHANDOVER, ProfileMatrix

from ..cache_utils import get_cached_result, set_cached_result
from ..models import EventLog
from ._filters import _parse_filter_params, _should_use_cache
from ._ocel_db import _filter_shadow, _object_types, _with_ocel_db

VALID_NORMALIZATIONS = ("by_source", "by_target", "by_arcs_in_eog", "by_total_weight")
VALID_NORMALIZATION_SCOPES = ("global", "per_bo_type")
VALID_METHODS = ("oc", "flattened")
VALID_FEATURE_GROUPS = (
    "activity_fractions",
    "cooccurrence_fractions",
    "object_collaboration_fractions",
    "object_portfolio_fractions",
    "time_fractions",
    "weekday_fractions",
)
VALID_CLUSTER_METHODS = ("kmeans", "agglomerative", "hdbscan")
VALID_DISTANCE_METRICS = ("euclidean", "hellinger")

_TRUE_VALUES = ("true", "1", "yes")


class _BadRequest(Exception):
    """Raised while parsing parameters; the message becomes the 400 body."""


def _csv_list(raw) -> list:
    """A comma-separated query value (or a JSON list in a POST body) as a list."""
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        return [str(t).strip() for t in raw if str(t).strip()]
    return [t.strip() for t in str(raw).split(",") if t.strip()]


def _bool_param(params, key: str, default: bool = False) -> bool:
    raw = params.get(key)
    if raw is None:
        return default
    if isinstance(raw, bool):
        return raw
    return str(raw).lower() in _TRUE_VALUES


def _int_param(params, key: str, default=None, minimum=None):
    raw = params.get(key)
    if raw in (None, ""):
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise _BadRequest(f"Invalid {key} value")
    if minimum is not None and value < minimum:
        raise _BadRequest(f"{key} must be at least {minimum}")
    return value


def _resolve_event_log(request, file_id):
    """The caller's event log, or ``None`` when it does not exist / is not theirs.

    ``ValueError`` covers a non-numeric ``file_id``, which would otherwise
    escape as a 500.
    """
    try:
        return EventLog.objects.get(pk=file_id, project__users=request.user)
    except (EventLog.DoesNotExist, ValueError, TypeError):
        return None


def _filter_cache_params(fp: dict) -> dict:
    return {f"f_{k}": str(v) for k, v in sorted(fp.items())}


def _serialize_handover(graph: OCHANDOVER, include_flows: bool, include_bindings: bool) -> dict:
    nodes = [
        {
            "id": node_id,
            "object_type": data.get("object_type", "unknown"),
            "event_count": data.get("event_count", 0),
        }
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
    result: dict = {"nodes": nodes, "edges": edges}
    if include_flows:
        animation_flows = graph.graph.get("animation_flows")
        if animation_flows:
            result["flows"] = animation_flows["flows"]
            result["timeline"] = animation_flows["timeline"]
        else:
            result["flows"] = []
            result["timeline"] = None
    if include_bindings:
        result["bindings"] = graph.graph.get("bindings", [])
    return result


def _parse_handover_params(p, cluster_map) -> dict:
    """Validate the handover query into the keyword arguments of the lib call.

    Returns ``{"method": ..., "kwargs": {...}}``; raises ``_BadRequest``.
    """
    method = p.get("method", "oc")
    if method not in VALID_METHODS:
        raise _BadRequest(f"Invalid method: {method}. Allowed: {list(VALID_METHODS)}")

    max_gap = _int_param(p, "max_gap", default=None, minimum=0)

    if method == "flattened":
        case_type = p.get("case_type", "")
        resource_type = p.get("resource_type", "")
        if not case_type or not resource_type:
            raise _BadRequest("Missing case_type or resource_type")
        return {
            "method": method,
            "kwargs": {"case_type": case_type, "resource_type": resource_type, "max_gap": max_gap},
        }

    resource_types = _csv_list(p.get("resource_types"))
    businessobject_types = _csv_list(p.get("businessobject_types"))
    if not resource_types or not businessobject_types:
        raise _BadRequest("Missing resource_types or businessobject_types")

    normalization = p.get("normalization", "by_arcs_in_eog")
    if normalization not in VALID_NORMALIZATIONS:
        raise _BadRequest(f"Invalid normalization: {normalization}")
    normalization_scope = p.get("normalization_scope", "global")
    if normalization_scope not in VALID_NORMALIZATION_SCOPES:
        raise _BadRequest(f"Invalid normalization_scope: {normalization_scope}")

    parallel_threshold = None
    raw_threshold = p.get("parallel_threshold")
    if raw_threshold not in (None, ""):
        try:
            parallel_threshold = float(raw_threshold)
        except (TypeError, ValueError):
            raise _BadRequest("Invalid parallel_threshold value")
        if not (0.0 <= parallel_threshold <= 1.0):
            raise _BadRequest("parallel_threshold must be between 0 and 1")

    min_parallel_observations = _int_param(p, "min_parallel_observations", default=1, minimum=1)

    return {
        "method": method,
        "kwargs": {
            "resource_types": resource_types,
            "businessobject_types": businessobject_types,
            "max_gap": max_gap,
            "normalization": normalization,
            "normalization_scope": normalization_scope,
            "parallel_threshold": parallel_threshold,
            "min_parallel_observations": min_parallel_observations,
            "cluster_map": cluster_map,
            "cluster_by_ot": _bool_param(p, "cluster_by_ot"),
            "include_flows": _bool_param(p, "include_flows"),
            "include_bindings": _bool_param(p, "include_bindings"),
        },
    }


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def ochandover(request):
    """Object-centric handover-of-work graph for an event log.

    ``GET`` takes its parameters from the query string; ``POST`` additionally
    accepts a JSON ``cluster_map`` (``{resource id: cluster name}``) in the
    body, which collapses resources into organizational units before the
    handovers are counted. Global filter parameters are always read from the
    query string, where the frontend interceptor puts them.
    """
    p = request.data if request.method == "POST" else request.query_params

    file_id = p.get("file_id")
    if not file_id:
        return Response({"error": "Missing file_id"}, status=status.HTTP_400_BAD_REQUEST)

    cluster_map = None
    if request.method == "POST":
        raw = request.data.get("cluster_map")
        if isinstance(raw, dict) and all(
            isinstance(k, str) and isinstance(v, str) for k, v in raw.items()
        ):
            cluster_map = raw

    try:
        parsed = _parse_handover_params(p, cluster_map)
    except _BadRequest as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    user_file = _resolve_event_log(request, file_id)
    if user_file is None:
        return Response({"error": "File not found or access denied"}, status=status.HTTP_404_NOT_FOUND)

    method, kwargs = parsed["method"], parsed["kwargs"]
    fp = _parse_filter_params(request)

    # Results are deterministic in (log version, parameters, filter); the
    # cluster map can be large, so it enters the key as a digest.
    cache_params = {
        "method": method,
        **{k: v for k, v in kwargs.items() if k != "cluster_map"},
        **_filter_cache_params(fp),
    }
    if cluster_map:
        cache_params["cluster_map"] = hashlib.sha256(
            json.dumps(cluster_map, sort_keys=True).encode()
        ).hexdigest()

    if _should_use_cache(request):
        cached = get_cached_result(user_file, "handover", cache_params)
        if cached is not None:
            return Response(cached, status=status.HTTP_200_OK)

    try:
        with _with_ocel_db(user_file) as db:
            with _filter_shadow(db, fp):
                if method == "flattened":
                    graph = OCHANDOVER.from_ocel_db_flattened(db, **kwargs)
                else:
                    graph = OCHANDOVER.from_ocel_db(db, **kwargs)
    except Exception as exc:
        traceback.print_exc()
        return Response(
            {"error": f"Handover computation failed: {exc}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    result = _serialize_handover(
        graph,
        include_flows=kwargs.get("include_flows", False),
        include_bindings=kwargs.get("include_bindings", False),
    )
    set_cached_result(user_file, "handover", result, cache_params)
    return Response(result, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def profile_matrix(request):
    """Resource profiles (feature vectors, clusters, MDS layout) for an event log."""
    q = request.query_params
    file_id = q.get("file_id")
    if not file_id:
        return Response({"error": "Missing ?file_id"}, status=status.HTTP_400_BAD_REQUEST)

    user_file = _resolve_event_log(request, file_id)
    if user_file is None:
        return Response({"error": "File not found or access denied"}, status=status.HTTP_404_NOT_FOUND)

    resource_types = _csv_list(q.get("resource_types")) or None
    business_object_types = _csv_list(q.get("business_object_types")) or None

    feature_groups = [g for g in _csv_list(q.get("feature_groups", "activity_fractions")) if g in VALID_FEATURE_GROUPS]
    if not feature_groups:
        feature_groups = ["activity_fractions"]
    tooltip_only = [
        g for g in _csv_list(q.get("tooltip_feature_groups"))
        if g in VALID_FEATURE_GROUPS and g not in feature_groups
    ]

    try:
        width = _int_param(q, "width", default=None, minimum=1)
        height = _int_param(q, "height", default=None, minimum=1)
    except _BadRequest:
        return Response({"error": "Invalid width or height"}, status=status.HTTP_400_BAD_REQUEST)
    if (width is None) != (height is None):
        width = height = None

    try:
        n_clusters = _int_param(q, "n_clusters", default=3, minimum=1)
        min_cluster_size = _int_param(q, "min_cluster_size", default=2, minimum=2)
    except _BadRequest:
        n_clusters, min_cluster_size = 3, 2

    cluster_method = q.get("cluster_method", "hdbscan")
    if cluster_method not in VALID_CLUSTER_METHODS:
        cluster_method = "hdbscan"
    distance_metric = q.get("distance_metric", "euclidean")
    if distance_metric not in VALID_DISTANCE_METRICS:
        distance_metric = "euclidean"
    compute_clusters = _bool_param(q, "compute_clusters", default=True)

    fp = _parse_filter_params(request)
    cache_params = {
        "resource_types": resource_types,
        "business_object_types": business_object_types,
        "feature_groups": feature_groups,
        "tooltip_only": tooltip_only,
        "width": width,
        "height": height,
        "n_clusters": n_clusters,
        "min_cluster_size": min_cluster_size,
        "cluster_method": cluster_method,
        "distance_metric": distance_metric,
        "compute_clusters": compute_clusters,
        **_filter_cache_params(fp),
    }
    if _should_use_cache(request):
        cached = get_cached_result(user_file, "profile_matrix", cache_params)
        if cached is not None:
            return Response(cached, status=status.HTTP_200_OK)

    try:
        with _with_ocel_db(user_file) as db:
            with _filter_shadow(db, fp):
                pm = ProfileMatrix.from_ocel_db(
                    db,
                    resource_types=resource_types,
                    feature_groups=feature_groups + tooltip_only,
                    business_object_types=business_object_types,
                    tooltip_only_groups=tooltip_only,
                )
        group_weights = {g: 0.0 for g in tooltip_only} if tooltip_only else None
        result = pm.to_dict(
            width=width,
            height=height,
            n_clusters=n_clusters,
            cluster_method=cluster_method,
            compute_clusters=compute_clusters,
            min_cluster_size=min_cluster_size,
            distance_metric=distance_metric,
            group_weights=group_weights,
        )
    except Exception as exc:
        traceback.print_exc()
        return Response({"error": f"Computation failed: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    set_cached_result(user_file, "profile_matrix", result, cache_params)
    return Response(result, status=status.HTTP_200_OK)


_EVENT_LOG_TABLE_SQL = """
    SELECT e.event_id,
           e.activity,
           e.timestamp_unix,
           list(o.obj_type ORDER BY eo.obj_id) FILTER (WHERE o.obj_id IS NOT NULL) AS obj_types,
           list(eo.obj_id  ORDER BY eo.obj_id) FILTER (WHERE o.obj_id IS NOT NULL) AS obj_ids
    FROM events e
    LEFT JOIN event_object eo ON eo.event_id = e.event_id
    LEFT JOIN objects o       ON o.obj_id    = eo.obj_id
    GROUP BY e.event_id, e.activity, e.timestamp_unix
    ORDER BY e.timestamp_unix, e.event_id
"""


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def event_log_table(request):
    """The (filtered) event log as a flat table: one row per event with its
    objects grouped by object type. Timestamps are Unix milliseconds.

    ``?limit=N`` truncates to the first N events by time; ``total_events``
    always reports the full count so a client can show what was cut.
    """
    q = request.query_params
    file_id = q.get("file_id")
    if not file_id:
        return Response({"error": "Missing ?file_id"}, status=status.HTTP_400_BAD_REQUEST)

    user_file = _resolve_event_log(request, file_id)
    if user_file is None:
        return Response({"error": "File not found or access denied"}, status=status.HTTP_404_NOT_FOUND)

    try:
        limit = _int_param(q, "limit", default=None, minimum=1)
    except _BadRequest as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    fp = _parse_filter_params(request)
    try:
        with _with_ocel_db(user_file) as db:
            with _filter_shadow(db, fp):
                object_types = _object_types(db)
                sql = _EVENT_LOG_TABLE_SQL + (f" LIMIT {int(limit)}" if limit else "")
                rows = db.conn.execute(sql).fetchall()
                total_events = db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    except Exception as exc:
        traceback.print_exc()
        return Response({"error": f"Failed to build event log: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    events = []
    for event_id, activity, ts, obj_types, obj_ids in rows:
        objects_by_type: dict = {t: [] for t in object_types}
        for obj_type, obj_id in zip(obj_types or [], obj_ids or []):
            objects_by_type.setdefault(obj_type, []).append(obj_id)
        events.append({
            "event_id": event_id,
            "activity": activity,
            # DuckDB stores Unix seconds; the table renders milliseconds.
            "timestamp": int(ts) if ts is not None and ts > 1e12 else int((ts or 0) * 1000),
            "objects": objects_by_type,
        })

    return Response(
        {"object_types": object_types, "events": events, "total_events": total_events},
        status=status.HTTP_200_OK,
    )
