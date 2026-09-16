"""OCCN discovery endpoint plus the shared threshold-0 base-net cache."""

import threading
from collections import OrderedDict

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from totem_lib import discover_occn, serialize_occn
from totem_lib.ocel.pm4py_adapter import convert_ocel_duckdb_to_pm4py

from ..models import EventLog
from ._ocel_db import _filter_shadow, _with_ocel_db
from ._filters import _parse_filter_params


# OCCN discovery dominates request time (seconds to ~1 min per log) while
# thresholding is a cheap marker filter, so cache the threshold-0 base net per
# (file, object-type filter) and apply the requested threshold per request.
_OCCN_CACHE_MAX_ENTRIES = 4
_occn_base_cache = OrderedDict()
_occn_cache_lock = threading.Lock()
_occn_inflight = {}


def _get_or_discover_base_occn(user_file, object_type_filter):
    """Return the threshold-0 base OCCN for a log, via `_occn_base_cache`.

    Single-flight per cache key: concurrent callers for the same
    (file, object types) wait on the primary discovery instead of mining the
    same net twice. Returns None when discovery failed to produce a net.
    """
    parameters = (
        {"object_types": object_type_filter} if object_type_filter else None
    )
    cache_key = (
        user_file.id,
        tuple(object_type_filter) if object_type_filter else None,
    )

    with _occn_cache_lock:
        base_occn = _occn_base_cache.get(cache_key)
        if base_occn is not None:
            _occn_base_cache.move_to_end(cache_key)

    if base_occn is None:
        event = None
        is_primary = False
        with _occn_cache_lock:
            base_occn = _occn_base_cache.get(cache_key)
            if base_occn is None:
                event = _occn_inflight.get(cache_key)
                if event is None:
                    event = threading.Event()
                    _occn_inflight[cache_key] = event
                    is_primary = True

        if not is_primary and base_occn is None and event is not None:
            event.wait(timeout=120)
            with _occn_cache_lock:
                base_occn = _occn_base_cache.get(cache_key)

        if is_primary:
            try:
                with _with_ocel_db(user_file) as db:
                    ocel_pm4py = convert_ocel_duckdb_to_pm4py(db)
                base_occn = discover_occn(
                    ocel_pm4py, relativeOccuranceThreshold=0.0, parameters=parameters
                )
                with _occn_cache_lock:
                    _occn_base_cache[cache_key] = base_occn
                    _occn_base_cache.move_to_end(cache_key)
                    while len(_occn_base_cache) > _OCCN_CACHE_MAX_ENTRIES:
                        _occn_base_cache.popitem(last=False)
            finally:
                with _occn_cache_lock:
                    _occn_inflight.pop(cache_key, None)
                event.set()

    return base_occn


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def OCCNViewSet(request):
    """
    Discover and return a serialized OCCN for the given event log file.

    Query params:
        file_id (required)         — ID of the EventLog to mine
        object_types (optional)    — comma-separated object type filter
        relativeOccuranceThreshold — float in [0, 1], default 0.0
    """
    file_id = request.query_params.get("file_id")
    if not file_id:
        return Response(
            {"error": "Missing ?file_id parameter"}, status=status.HTTP_400_BAD_REQUEST
        )

    # Parse optional comma-separated object type filter.
    raw_object_types = request.query_params.get("object_types")
    object_type_filter = None
    if raw_object_types:
        object_type_filter = [
            t.strip() for t in raw_object_types.split(",") if t.strip()
        ] or None

    # Parse and validate threshold.
    raw_threshold = request.query_params.get("relativeOccuranceThreshold", "0.0")
    try:
        threshold = float(raw_threshold)
        if not (0.0 <= threshold <= 1.0):
            return Response(
                {"error": "relativeOccuranceThreshold must be a float in [0, 1]"},
                status=status.HTTP_400_BAD_REQUEST,
            )
    except (TypeError, ValueError):
        return Response(
            {"error": "relativeOccuranceThreshold must be a float"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Scope the lookup to the caller's projects: an id alone must not grant
    # access to another user's log. ValueError covers a non-numeric ?file_id,
    # which would otherwise escape as a 500.
    try:
        user_file = EventLog.objects.get(id=file_id, project__users=request.user)
    except (EventLog.DoesNotExist, ValueError):
        return Response(
            {"error": "File not found or access denied"},
            status=status.HTTP_404_NOT_FOUND,
        )

    try:
        fp = _parse_filter_params(request)
        has_event_filter = any(k in fp for k in ("after", "before", "activities"))

        if has_event_filter:
            # Filter active — skip the shared cache and mine a fresh net over
            # the filtered log; cached nets are keyed only by file/object types.
            fp_no_types = {k: v for k, v in fp.items() if k != "object_types"}
            parameters = (
                {"object_types": object_type_filter} if object_type_filter else None
            )
            with _with_ocel_db(user_file) as db:
                with _filter_shadow(db, fp_no_types):
                    ocel_pm4py = convert_ocel_duckdb_to_pm4py(db)
            base_occn = discover_occn(
                ocel_pm4py, relativeOccuranceThreshold=0.0, parameters=parameters
            )
        else:
            base_occn = _get_or_discover_base_occn(user_file, object_type_filter)

        if base_occn is None:
            return Response({"error": "Failed to discover OCCN"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        occn = (
            base_occn.apply_relative_occurrence_threshold(threshold)
            if threshold > 0
            else base_occn
        )

        result = serialize_occn(occn)
        return Response(result, status=status.HTTP_200_OK)

    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
