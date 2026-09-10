"""OC-DFG and New OC-DFG endpoints."""

import traceback

import networkx as nx
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from totem_lib.dfg import OCDFGDb, NewOCDFGDb

from ..models import EventLog
from ..cache_utils import get_cached_result, set_cached_result
from ._ocel_db import _filter_shadow, _object_types, _with_ocel_db
from ._filters import _parse_filter_params, _should_use_cache


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def OCDFGViewSet(request):
    """OC-DFG endpoint.

    Returns the full OC-DFG plus, when ``object_types`` is given, an
    object-type-filtered graph, along with per-object-type trace variants.
    """

    file_id = request.query_params.get("file_id")
    if not file_id:
        return Response(
            {"error": "Missing ?file_id parameter"}, status=status.HTTP_400_BAD_REQUEST
        )

    # Optional object-type filter (comma-separated)
    raw_object_types = request.query_params.get("object_types")
    object_type_filter = None
    if raw_object_types:
        object_type_filter = set(
            [t.strip() for t in raw_object_types.split(",") if t.strip()]
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

    # Global filter (time window / activity set). `object_types` is already
    # handled by the library param above, so the shadow only carries the
    # event-level predicates — same split as the new-ocdfg endpoint.
    fp = _parse_filter_params(request)
    fp_non_types = {k: v for k, v in fp.items() if k != "object_types"}
    # The global filter may also narrow the object types; intersect it with
    # the per-area selection so the drill-down cannot re-introduce a type the
    # user filtered out globally.
    if "object_types" in fp:
        global_types = set(fp["object_types"])
        object_type_filter = (
            (object_type_filter & global_types) if object_type_filter else global_types
        )

    # --- Cache lookup (#72 / #74) ---
    # Filter params belong in the key: without them a filtered and an
    # unfiltered run would share one entry and serve each other's results.
    ocdfg_cache_params = {
        "object_types": sorted(object_type_filter) if object_type_filter else [],
    }
    if fp_non_types:
        ocdfg_cache_params.update(
            {f"f_{k}": str(v) for k, v in sorted(fp_non_types.items())}
        )
    if _should_use_cache(request):
        cached = get_cached_result(user_file, "ocdfg", ocdfg_cache_params)
        if cached is not None:
            return Response(cached, status=status.HTTP_200_OK)

    try:
        with _with_ocel_db(user_file) as db:
            with _filter_shadow(db, fp_non_types):
                # Full OCDFG (unfiltered) for register.
                # edges="links" preserves the pre-NetworkX-3.4 key name the
                # frontend expects.
                ocdfg_full = OCDFGDb.from_ocel_db(db)
                dfg_json_full = nx.node_link_data(ocdfg_full, edges="links")
                all_nodes = [
                    {
                        "id": n.get("id"),
                        "types": n.get("types", []),
                        "role": n.get("role"),
                        "object_type": n.get("object_type"),
                    }
                    for n in dfg_json_full.get("nodes", [])
                ]

                # Filtered OCDFG if object types specified. `OCDFGDb.from_ocel_db`
                # pushes the type filter into SQL itself — no separate OCEL
                # subsetting step is needed.
                filter_error = None
                trace_variants = None
                if object_type_filter:
                    try:
                        ocdfg_filtered = OCDFGDb.from_ocel_db(
                            db, object_types=sorted(object_type_filter)
                        )
                        if len(ocdfg_filtered.nodes) == 0:
                            dfg_json = {
                                "directed": True,
                                "multigraph": False,
                                "graph": {"kind": "ocdfg"},
                                "nodes": [],
                                "links": [],
                            }
                        else:
                            dfg_json = nx.node_link_data(ocdfg_filtered, edges="links")

                        # Per-object-type trace variants for the filtered types.
                        trace_variants = NewOCDFGDb.compute_variants(
                            db, object_types=list(object_type_filter)
                        )
                    except Exception as e:
                        # Gracefully fall back to unfiltered graph to avoid
                        # frontend breakage, but surface warning.
                        filter_error = f"Failed to compute filtered OCDFG: {e}"
                        dfg_json = dfg_json_full
                else:
                    dfg_json = dfg_json_full

                # Always compute trace_variants if not already computed — use
                # all object types from the OCEL when no filter is specified.
                if trace_variants is None:
                    try:
                        all_object_types = _object_types(db)
                        if all_object_types:
                            trace_variants = NewOCDFGDb.compute_variants(
                                db, object_types=all_object_types
                            )
                    except Exception as e:
                        print(f"[OCDFG] Failed to compute trace variants: {e}")

        response_payload = {"dfg": dfg_json, "all_nodes": all_nodes}
        if filter_error:
            response_payload["filter_error"] = filter_error
        if trace_variants:
            response_payload["trace_variants"] = trace_variants

        set_cached_result(user_file, "ocdfg", response_payload, ocdfg_cache_params)
        return Response(response_payload, status=status.HTTP_200_OK)

    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def NewOCDFGViewSet(request):
    """
    Thin routing layer for the New OC-DFG endpoint.

    Delegates all computation to ``NewOCDFGDb.from_ocel_db_with_variant_ranks``
    in totem-lib.  The only Django-layer responsibilities are:
      1. Parse / validate query params.
      2. Resolve the EventLog → open OcelDuckDB.
      3. Call the lib method.
      4. Serialize the NetworkX graph to JSON and return.

    Variant filtering is now done **entirely on the frontend** using the
    ``variant_rank`` attribute annotated on every edge by the lib.  No
    ``trace_limits`` query parameter is accepted or processed here.
    """
    file_id = request.query_params.get("file_id")
    if not file_id:
        return Response(
            {"error": "Missing ?file_id parameter"}, status=status.HTTP_400_BAD_REQUEST
        )

    # Optional object-type filter (comma-separated)
    raw_object_types = request.query_params.get("object_types")
    object_type_filter = None
    if raw_object_types:
        object_type_filter = (
            sorted(t.strip() for t in raw_object_types.split(",") if t.strip()) or None
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

    fp = _parse_filter_params(request)
    # object_types is already handled by the library param; shadow only time/activity.
    fp_non_types = {k: v for k, v in fp.items() if k != "object_types"}

    try:
        with _with_ocel_db(user_file) as db:
            with _filter_shadow(db, fp_non_types):
                # Delegate all process-mining logic to totem-lib.
                # Returns the annotated graph and per-type variant counts for sliders.
                ocdfg, variant_counts = NewOCDFGDb.from_ocel_db_with_variant_ranks(
                    db, object_types=object_type_filter
                )

            if len(ocdfg.nodes) == 0:
                dfg_json = {
                    "directed": True,
                    "multigraph": True,
                    "graph": {"kind": "new_ocdfg"},
                    "nodes": [],
                    "links": [],
                }
            else:
                dfg_json = nx.node_link_data(ocdfg, edges="links")

            all_nodes = [
                {
                    "id": n.get("id"),
                    "types": n.get("types", []),
                    "role": n.get("role"),
                    "object_type": n.get("object_type"),
                    "metrics": n.get("metrics"),
                }
                for n in dfg_json.get("nodes", [])
            ]

        return Response(
            {
                "dfg": dfg_json,
                "all_nodes": all_nodes,
                "variant_counts": variant_counts,
            },
            status=status.HTTP_200_OK,
        )

    except Exception as e:
        traceback.print_exc()
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
