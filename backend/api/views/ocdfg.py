"""New OC-DFG endpoint."""

import json
import traceback
from hashlib import sha1

import networkx as nx
from django.core.cache import cache
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from totem_lib.dfg import NewOCDFGDb
from totem_lib.ocpn import discover_process_trees_db

from ..jobs import JobCancelled, cancelled_response, job_scope
from ..models import EventLog
from ._ocel_db import _filter_shadow, _with_ocel_db
from ._filters import _parse_filter_params


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
    # A caller may put its own object-type selection directly in the URL (the
    # TOTeM process-area drill-down does, one area at a time) while the global
    # filter store also injects `object_types` onto every "data endpoint"
    # request. Both land on the same query-string
    # key, so reconcile them explicitly instead of letting one silently
    # shadow the other: intersect so the drill-down can never re-introduce a
    # type the user filtered out globally.
    if "object_types" in fp:
        global_types = set(fp["object_types"])
        object_type_filter = (
            sorted(set(object_type_filter) & global_types)
            if object_type_filter
            else sorted(global_types)
        ) or None

    try:
        with job_scope(request, "Object-centric DFG") as job:
            with _with_ocel_db(user_file, job) as db:
                job.report(None, "Applying filters")
                with _filter_shadow(db, fp_non_types):
                    # Delegate all process-mining logic to totem-lib.
                    # Returns the annotated graph and per-type variant counts for sliders.
                    ocdfg, variant_counts = NewOCDFGDb.from_ocel_db_with_variant_ranks(
                        db, object_types=object_type_filter, progress=job.report
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

    except JobCancelled:
        return cancelled_response()
    except Exception as e:
        traceback.print_exc()
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# Bounds of the inductive-miner budget (seconds), as for OCPN discovery.
_BLOCK_STRUCTURE_MIN_TIMEOUT_S = 1.0
_BLOCK_STRUCTURE_MAX_TIMEOUT_S = 300.0


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def OCDFGBlockStructureView(request):
    """
    Block structure of every object type for the OC-DFG layout lab.

    Runs the inductive miner of totem-lib on each object type's flattened
    log (the miner splits the log after every cut) and returns the process
    trees: ``{"trees": {object_type: tree}}`` where a tree is
    ``{"operator": "sequence"|"xor"|"parallel"|"loop"|null, "label", "children"}``.

    Query params: ``file_id`` (required), ``object_types`` (comma-separated,
    optional), ``timeout_s`` (default 30, clamped to 1..300) and the usual
    filter params. A timeout answers 408 with ``code: "timeout"``.
    """
    file_id = request.query_params.get("file_id")
    if not file_id:
        return Response(
            {"error": "Missing ?file_id parameter"}, status=status.HTTP_400_BAD_REQUEST
        )
    try:
        user_file = EventLog.objects.get(id=file_id, project__users=request.user)
    except (EventLog.DoesNotExist, ValueError):
        return Response(
            {"error": "File not found or access denied"},
            status=status.HTTP_404_NOT_FOUND,
        )

    try:
        timeout_s = float(request.query_params.get("timeout_s", "30"))
        if timeout_s != timeout_s:  # NaN
            raise ValueError
    except (TypeError, ValueError):
        timeout_s = 30.0
    timeout_s = min(max(timeout_s, _BLOCK_STRUCTURE_MIN_TIMEOUT_S), _BLOCK_STRUCTURE_MAX_TIMEOUT_S)

    raw_object_types = request.query_params.get("object_types")
    object_type_filter = None
    if raw_object_types:
        object_type_filter = (
            sorted(t.strip() for t in raw_object_types.split(",") if t.strip()) or None
        )
    fp = _parse_filter_params(request)
    if "object_types" in fp:
        global_types = set(fp["object_types"])
        object_type_filter = (
            sorted(set(object_type_filter) & global_types)
            if object_type_filter
            else sorted(global_types)
        ) or None
    fp_non_types = {k: v for k, v in fp.items() if k != "object_types"}

    # The trees depend on the log, the object types and the filter only.
    key_material = json.dumps(
        {"types": object_type_filter, "filter": fp_non_types}, sort_keys=True, default=str
    )
    cache_key = f"ocdfg_block_structure_{user_file.pk}_{sha1(key_material.encode()).hexdigest()}"
    cached = cache.get(cache_key)
    if cached is not None:
        return Response(cached, status=status.HTTP_200_OK)

    try:
        with job_scope(request, "Inductive miner (block structure)") as job:
            with _with_ocel_db(user_file, job) as db:
                job.report(None, "Applying filters")
                with _filter_shadow(db, fp_non_types):
                    trees = discover_process_trees_db(
                        db,
                        object_types=object_type_filter,
                        timeout_s=timeout_s,
                        progress=job.report,
                    )
    except JobCancelled:
        return cancelled_response()
    except TimeoutError as e:
        return Response(
            {
                "error": str(e),
                "code": "timeout",
                "timeout_s": timeout_s,
                "hint": "Use the light cut detection or restrict the object types.",
            },
            status=status.HTTP_408_REQUEST_TIMEOUT,
        )
    except Exception as e:
        traceback.print_exc()
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    result = {"trees": trees}
    cache.set(cache_key, result, timeout=3600)
    return Response(result, status=status.HTTP_200_OK)
