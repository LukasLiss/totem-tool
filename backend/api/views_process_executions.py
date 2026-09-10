"""
Process executions as stored event-log columns.

Two endpoints below the event-log resource:

``GET /api/files/<pk>/event_columns/``
    The non-fixed columns of the ``events`` table (event attributes and
    previously stored execution / variant columns) with their fill and
    distinct counts, so a UI can offer them as "process execution id" columns.

``POST /api/files/<pk>/process_executions/``
    Extract process executions with any of the variant extraction techniques,
    write their ids into a user-named events column, and optionally also
    group them into variants and store the variant id in a second column.

Computation is delegated to ``totem_lib`` (``extract_process_executions``,
``find_variants``, ``write_event_columns_to_file``); this module only parses
requests, guards the shared DuckDB connection and shapes responses. It is a
separate module on purpose -- ``views.py`` is large enough.
"""

from __future__ import annotations

import os

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from totem_lib.ocel.event_columns import (
    EventColumnError,
    event_column_summary,
    list_event_columns,
    validate_event_column_name,
    write_event_columns_to_file,
)
from totem_lib.variants import (
    extract_process_executions,
    find_variants,
    partition_events,
    variant_assignment,
)

from .models import EventLog
from .variant_params import (
    VariantParamError,
    parse_extraction_params,
    parse_iso,
    parse_timeout,
    resolve_extraction_params,
    serialize_variants,
)
from .views import (
    _activities_with_counts,
    _filter_shadow,
    _layout_shim,
    _object_types,
    _parse_filter_params,
    _rewrite_ocel_db_file,
    _with_ocel_db,
)


def _user_event_log(request, pk):
    try:
        return EventLog.objects.get(pk=pk, project__users=request.user), None
    except (EventLog.DoesNotExist, ValueError):
        return None, Response(
            {"error": "File not found or access denied"},
            status=status.HTTP_404_NOT_FOUND,
        )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def event_columns(request, pk):
    """List the attribute / derived columns of the events table."""
    user_file, error = _user_event_log(request, pk)
    if error is not None:
        return error
    try:
        with _with_ocel_db(user_file) as db:
            columns = [
                event_column_summary(db.conn, name)
                for name in list_event_columns(db.conn)
            ]
    except Exception as exc:
        return Response(
            {"error": f"Failed to read event columns: {exc}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    return Response(columns, status=status.HTTP_200_OK)


def _parse_store_request(data):
    """Validate the POST body; returns a dict of settings or raises VariantParamError."""
    if not isinstance(data, dict):
        raise VariantParamError("Request body must be a JSON object.")

    params = parse_extraction_params(data)

    try:
        execution_column = validate_event_column_name(data.get("execution_column"))
    except EventColumnError as exc:
        raise VariantParamError(f"execution_column: {exc}") from exc

    compute_variants = bool(data.get("compute_variants", True))
    variant_column = data.get("variant_column") or None
    if variant_column is not None:
        if not compute_variants:
            raise VariantParamError(
                "A variant column can only be stored when variants are computed."
            )
        try:
            variant_column = validate_event_column_name(variant_column)
        except EventColumnError as exc:
            raise VariantParamError(f"variant_column: {exc}") from exc
        if variant_column == execution_column:
            raise VariantParamError(
                "The execution column and the variant column must differ."
            )

    return {
        "params": params,
        "execution_column": execution_column,
        "compute_variants": compute_variants,
        "variant_column": variant_column,
        "iso": parse_iso(data) if compute_variants else None,
        "timeout_s": parse_timeout(data),
    }


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def process_executions(request, pk):
    """
    Materialise process executions (and optionally variants) into the log.

    Body (JSON)::

        {
          "extraction": "resource_aware" | "connected" | "leading_1hop" | "leading_bfs",
          "leading_type": "...",                 # leading_* only
          "business_object_types": ["order"],    # resource_aware only
          "business_activities": ["place order"],# resource_aware only, optional
          "execution_column": "process execution",
          "compute_variants": true,
          "iso": "wl+vf2", "timeout_s": 10,      # when computing variants
          "variant_column": "variant"            # optional, needs compute_variants
        }

    The global filter query parameters (``object_types``, ``activities``,
    ``after``, ``before``) apply exactly as for ``/api/variants/``: executions
    are computed on the filtered log and events outside the filter get no id.

    Every event of exactly one execution receives that execution's id. Events
    in several executions (possible with the leading-object techniques) are
    reported as ambiguous and left empty, so an id always identifies one
    execution. Events in no execution stay empty as well.
    """
    user_file, error = _user_event_log(request, pk)
    if error is not None:
        return error
    path = user_file.file.path
    if not os.path.exists(path):
        return Response(
            {"error": f"Path does not exist: {path}"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not path.lower().endswith(".duckdb"):
        return Response(
            {"error": "Only DuckDB-backed event logs can store process executions."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        settings = _parse_store_request(request.data)
    except VariantParamError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    fp = _parse_filter_params(request)
    try:
        with _with_ocel_db(user_file) as db:
            with _filter_shadow(db, fp):
                obj_types = _object_types(db)
                activities = [a["name"] for a in _activities_with_counts(db)]
                try:
                    resolved = resolve_extraction_params(settings["params"], obj_types, activities)
                except VariantParamError as exc:
                    return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
                total_events = db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]

                executions = None
                variants = None
                serialized_variants = None
                if resolved is not None:
                    executions = extract_process_executions(db, **resolved.library_kwargs())
                    if settings["compute_variants"] and executions.execution_count:
                        variants = find_variants(
                            db,
                            **resolved.library_kwargs(),
                            iso=settings["iso"],
                            timeout_s=settings["timeout_s"],
                            verbose=False,
                            cases=executions.case_objects,
                        )
                        serialized_variants = serialize_variants(variants, _layout_shim(db))
                    elif settings["compute_variants"]:
                        serialized_variants = []

            # The shadow is torn down here; write to the real file while the
            # per-file lock is still held so no reader sees a half-written log.
            case_events = executions.case_events if executions is not None else {}
            partition = partition_events(case_events)
            columns = {settings["execution_column"]: partition.assignment}
            if settings["variant_column"] is not None:
                columns[settings["variant_column"]] = (
                    variant_assignment(partition, variants) if variants is not None else {}
                )
            written = _rewrite_ocel_db_file(
                user_file, lambda db_path: write_event_columns_to_file(db_path, columns)
            )
    except TimeoutError as exc:
        return Response(
            {
                "error": str(exc),
                "code": "timeout",
                "timeout_s": settings["timeout_s"],
                "hint": "Try a coarser iso strategy (db_signature / trace), "
                "a different extraction, or skip the variant computation.",
            },
            status=status.HTTP_408_REQUEST_TIMEOUT,
        )
    except Exception as exc:
        return Response(
            {"error": f"Storing process executions failed: {exc}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    assigned = written.get(settings["execution_column"], 0)
    ambiguous = len(partition.ambiguous_event_ids)
    return Response(
        {
            "file_id": user_file.pk,
            "extraction": resolved.extraction if resolved else settings["params"].extraction,
            "leading_type": resolved.leading_type if resolved else None,
            "business_object_types": list(resolved.business_object_types) if resolved else [],
            "business_activities": (
                None if resolved is None or resolved.business_activities is None
                else list(resolved.business_activities)
            ),
            "execution_column": settings["execution_column"],
            "variant_column": settings["variant_column"],
            "execution_count": len(case_events),
            "total_event_count": int(total_events),
            "assigned_event_count": int(assigned),
            "ambiguous_event_count": ambiguous,
            "unassigned_event_count": int(total_events) - int(assigned) - ambiguous,
            "variant_count": None if serialized_variants is None else len(serialized_variants),
            "variants": serialized_variants,
            "object_types": obj_types,
        },
        status=status.HTTP_200_OK,
    )
