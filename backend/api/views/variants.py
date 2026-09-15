"""Object-centric variant discovery endpoint."""

import os
import traceback
from hashlib import sha1
from types import SimpleNamespace

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from totem_lib.variants import find_variants

from ..models import EventLog
from ..cache_utils import get_cached_result, set_cached_result
from ..variant_params import (
    VariantParamError,
    parse_extraction_params,
    parse_iso,
    parse_timeout,
    resolve_extraction_params,
    serialize_variants,
)
from ._ocel_db import (
    OcelDuckDB,
    _activities_with_counts,
    _filter_shadow,
    _object_types,
    _with_ocel_db,
)
from ._filters import _parse_filter_params, _should_use_cache
# Bounds for the client-supplied discovery watchdog (seconds).
MIN_TIMEOUT_S = 1.0
MAX_TIMEOUT_S = 300.0



def _layout_shim(db: OcelDuckDB):
    """
    `calculate_layout` (in `ocvariants.py`) reads `ocel.obj_type_map` to label
    swim-lanes. The polars OCEL exposes that as a `cached_property` on the
    log object; the DuckDB OCEL doesn't. We materialise the same dict here
    and wrap it in a `SimpleNamespace` so the existing layout function
    works unchanged.
    """
    obj_type_map = dict(
        db.conn.execute("SELECT obj_id, obj_type FROM objects").fetchall()
    )
    return SimpleNamespace(obj_type_map=obj_type_map)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def variants(request):

    file_id = request.query_params.get("file_id")
    if not file_id:
        return Response(
            {"error": "Missing ?file_id"}, status=status.HTTP_400_BAD_REQUEST
        )

    # Verify user has access to this file
    try:
        user_file = EventLog.objects.get(pk=int(file_id), project__users=request.user)
    except (ValueError, TypeError):
        return Response(
            {"error": "file_id must be an integer"}, status=status.HTTP_400_BAD_REQUEST
        )
    except EventLog.DoesNotExist:
        return Response(
            {"error": "File not found or access denied"},
            status=status.HTTP_404_NOT_FOUND,
        )

    if not os.path.exists(user_file.file.path):
        return Response(
            {"error": f"Path does not exist: {user_file.file.path}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # --- Advanced settings (query params, all optional with sane defaults) ---
    # Parsing is shared with the process-execution endpoint (variant_params);
    # parse_timeout clamps to [MIN_TIMEOUT_S, MAX_TIMEOUT_S] server-side.
    try:
        params = parse_extraction_params(request.query_params)
        iso = parse_iso(request.query_params)
    except VariantParamError as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    timeout_s = parse_timeout(request.query_params)

    fp = _parse_filter_params(request)

    # --- Cache lookup (#72 / #74) ---
    # The filter params are part of the key: without them a filtered and an
    # unfiltered run would share one entry and serve each other's results.
    cache_params = {**params.cache_params(), "iso": iso, "timeout_s": timeout_s}
    if fp:
        cache_params.update({f"f_{k}": str(v) for k, v in sorted(fp.items())})
    if _should_use_cache(request):
        cached = get_cached_result(user_file, "variants", cache_params)
        if cached is not None:
            return Response(cached, status=status.HTTP_200_OK)

    try:
        with _with_ocel_db(user_file) as db:
            with _filter_shadow(db, fp):
                # Resolve the parameters *inside* the shadow: the filter may
                # have removed the type the client last asked for, and falling
                # back to a type that no longer exists yields an empty result
                # instead of a sensible default.
                obj_types = _object_types(db)
                activities = [a["name"] for a in _activities_with_counts(db)]
                try:
                    resolved = resolve_extraction_params(params, obj_types, activities)
                except VariantParamError as e:
                    return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
                if resolved is None:
                    return Response(
                        {"variants": [], "object_types": []},
                        status=status.HTTP_200_OK,
                    )

                # The default iso strategy ("wl+vf2") is sound and exact.
                # `find_variants` creates connection-scoped TEMP TABLEs — the
                # per-file lock from `_with_ocel_db` makes that safe under
                # concurrent requests. `timeout_s` arms a watchdog that
                # interrupts long SQL and raises TimeoutError.
                mined = find_variants(
                    db,
                    **resolved.library_kwargs(),
                    iso=iso,
                    timeout_s=timeout_s,
                    verbose=False,
                )
                # `calculate_layout` only reads `ocel.obj_type_map` — give it a
                # tiny shim backed by a SELECT against the DuckDB.
                layout_ocel = _layout_shim(db)
    except TimeoutError as e:
        return Response(
            {
                "error": str(e),
                "code": "timeout",
                "timeout_s": timeout_s,
                "hint": "Try a coarser iso strategy (db_signature / trace) "
                "or a different extraction.",
            },
            status=status.HTTP_408_REQUEST_TIMEOUT,
        )
    except Exception as e:
        print(f"ERROR in find_variants: {e}")
        traceback.print_exc()
        return Response(
            {"error": f"Variant computation failed: {e}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    result = {
        "variants": serialize_variants(mined, layout_ocel),
        "object_types": obj_types,
        "extraction": resolved.extraction,
        "leading_type": resolved.leading_type,
        "business_object_types": list(resolved.business_object_types),
        "business_activities": (
            None if resolved.business_activities is None
            else list(resolved.business_activities)
        ),
    }
    set_cached_result(user_file, "variants", result, cache_params)
    return Response(result, status=status.HTTP_200_OK)
