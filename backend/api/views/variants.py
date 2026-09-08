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
from totem_lib.variants.ocvariants import calculate_layout

from ..models import EventLog
from ..cache_utils import get_cached_result, set_cached_result
from ._ocel_db import OcelDuckDB, _filter_shadow, _object_types, _with_ocel_db
from ._filters import _parse_filter_params, _should_use_cache


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


# Accepted enums for the advanced-settings query params on the variants
# endpoint. Keep in sync with totem_lib.variants.ocvariants_db.{Extraction,IsoStrategy}.
_VALID_EXTRACTIONS = {"leading_1hop", "leading_bfs", "connected"}
_VALID_ISOS = {"db_signature", "trace", "signature", "wl", "wl+vf2", "exact"}


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
        user_file = EventLog.objects.get(pk=file_id, project__users=request.user)
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
    extraction = request.query_params.get("extraction") or "leading_1hop"
    iso = request.query_params.get("iso") or "wl+vf2"
    if extraction not in _VALID_EXTRACTIONS:
        return Response(
            {
                "error": f"Invalid extraction '{extraction}'. "
                f"Allowed: {sorted(_VALID_EXTRACTIONS)}"
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    if iso not in _VALID_ISOS:
        return Response(
            {"error": f"Invalid iso '{iso}'. Allowed: {sorted(_VALID_ISOS)}"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        timeout_s = float(request.query_params.get("timeout_s", "10.0"))
        if timeout_s <= 0:
            timeout_s = None  # disable
    except (TypeError, ValueError):
        timeout_s = 10.0

    fp = _parse_filter_params(request)
    leading_object_type = request.query_params.get("leading_type")

    # --- Cache lookup (#72 / #74) ---
    # The filter params are part of the key: without them a filtered and an
    # unfiltered run would share one entry and serve each other's results.
    cache_params = {
        "leading_type": leading_object_type or "",
        "extraction": extraction,
        "iso": iso,
        "timeout_s": timeout_s,
    }
    if fp:
        cache_params.update({f"f_{k}": str(v) for k, v in sorted(fp.items())})
    if _should_use_cache(request):
        cached = get_cached_result(user_file, "variants", cache_params)
        if cached is not None:
            return Response(cached, status=status.HTTP_200_OK)

    try:
        with _with_ocel_db(user_file) as db:
            with _filter_shadow(db, fp):
                # Resolve the leading type *inside* the shadow: the filter may
                # have removed the type the client last asked for, and falling
                # back to a type that no longer exists yields an empty result
                # instead of a sensible default.
                obj_types = _object_types(db)

                # Leading type is only needed for the leading_* extractions.
                # For "connected" we skip the default-to-first-alphabetical
                # fallback entirely — the param is ignored downstream anyway.
                if extraction.startswith("leading"):
                    if not leading_object_type or leading_object_type not in obj_types:
                        if not obj_types:
                            return Response(
                                {
                                    "variants": [],
                                    "object_types": [],
                                },
                                status=status.HTTP_200_OK,
                            )
                        leading_object_type = obj_types[0]
                else:
                    leading_object_type = None

                # The default iso strategy ("wl+vf2") is sound and exact.
                # `find_variants` creates connection-scoped TEMP TABLEs — the
                # per-file lock from `_with_ocel_db` makes that safe under
                # concurrent requests. `timeout_s` arms a watchdog that
                # interrupts long SQL and raises TimeoutError.
                mined = find_variants(
                    db,
                    extraction=extraction,
                    leading_type=leading_object_type,
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

    out = []
    for var in mined:
        layout_data = calculate_layout(var, layout_ocel)

        signature = " → ".join(
            node_data["label"]
            for _, node_data in sorted(
                var.graph.nodes(data=True), key=lambda x: x[1]["timestamp"]
            )
        )
        signature_hash = sha1(signature.encode("utf-8")).hexdigest()[:8]

        final_nodes = []
        for node in layout_data["nodes"]:
            final_nodes.append(
                {
                    "id": node["id"],
                    "activity": node["activity"],
                    "x": node["x"],
                    "y_lane": node["y_lane"],
                    "y_lanes": node["y_lanes"],
                    "objectIds": [f"type::{t}" for t in node["types"]],
                    "types": node["types"],
                }
            )

        out.append(
            {
                "id": str(var.id),
                "support": int(var.support),
                "signature": signature_hash,
                "signature_hash": signature_hash,
                "graph": {
                    "nodes": final_nodes,
                    "edges": layout_data["edges"],
                    "objects": layout_data["objects"],
                },
            }
        )

    result = {
        "variants": out,
        "object_types": obj_types,
    }
    # Update cache_params with the resolved leading_type
    cache_params["leading_type"] = leading_object_type or ""
    set_cached_result(user_file, "variants", result, cache_params)
    return Response(result, status=status.HTTP_200_OK)
