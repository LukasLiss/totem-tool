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

``POST /api/files/<pk>/process_area_variants/``
    The beginner-friendly default of the Variants Explorer: for every process
    area, project the log onto the area's object types and activities, take
    the connected components of that sub-log as process executions, group
    them into variants and (optionally) store both ids in two event columns.

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
    string_list,
)
from .jobs import JobCancelled, cancelled_response, job_scope
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
        with job_scope(request, "Process executions") as job, _with_ocel_db(user_file, job) as db:
            job.report(None, "Applying filters")
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
                    job.report(None, "Extracting process executions")
                    executions = extract_process_executions(db, **resolved.library_kwargs())
                    if settings["compute_variants"] and executions.execution_count:
                        variants = find_variants(
                            db,
                            **resolved.library_kwargs(),
                            iso=settings["iso"],
                            timeout_s=settings["timeout_s"],
                            verbose=False,
                            cases=executions.case_objects,
                            progress=job.report,
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
            job.report(None, "Storing event columns")
            written = _rewrite_ocel_db_file(
                user_file, lambda db_path: write_event_columns_to_file(db_path, columns)
            )
    except JobCancelled:
        return cancelled_response()
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


# ---------------------------------------------------------------------------
# Connected components per process area
# ---------------------------------------------------------------------------

DEFAULT_AREA_EXECUTION_COLUMN = "process-executions-cc-process-areas"
DEFAULT_AREA_VARIANT_COLUMN = "variant-cc-process-areas"
MAX_PROCESS_AREAS = 200


def _parse_area(raw, index):
    if not isinstance(raw, dict):
        raise VariantParamError(f"areas[{index}] must be an object.")
    object_types = string_list(raw, "object_types")
    if not object_types:
        raise VariantParamError(f"areas[{index}] needs at least one object type.")
    activities = string_list(raw, "activities")
    label = raw.get("label")
    if not isinstance(label, str) or not label.strip():
        label = " & ".join(object_types)
    return {
        "label": label.strip(),
        "key": "+".join(sorted(object_types)),
        "object_types": object_types,
        "activities": activities,
    }


def _parse_area_request(data):
    """Validate the process-area POST body; raises VariantParamError."""
    if not isinstance(data, dict):
        raise VariantParamError("Request body must be a JSON object.")
    raw_areas = data.get("areas")
    if not isinstance(raw_areas, list) or not raw_areas:
        raise VariantParamError("'areas' must be a non-empty list of process areas.")
    if len(raw_areas) > MAX_PROCESS_AREAS:
        raise VariantParamError(f"At most {MAX_PROCESS_AREAS} process areas are supported.")
    areas = [_parse_area(raw, i) for i, raw in enumerate(raw_areas)]

    store = bool(data.get("store", True))
    execution_column = variant_column = None
    if store:
        try:
            execution_column = validate_event_column_name(
                data.get("execution_column") or DEFAULT_AREA_EXECUTION_COLUMN
            )
            variant_column = validate_event_column_name(
                data.get("variant_column") or DEFAULT_AREA_VARIANT_COLUMN
            )
        except EventColumnError as exc:
            raise VariantParamError(str(exc)) from exc
        if execution_column == variant_column:
            raise VariantParamError(
                "The execution column and the variant column must differ."
            )
    return {
        "areas": areas,
        "store": store,
        "execution_column": execution_column,
        "variant_column": variant_column,
        "iso": parse_iso(data),
        "timeout_s": parse_timeout(data),
    }


def _area_filter(fp, area):
    """The global filter narrowed to one process area (``None`` = area is empty)."""
    object_types = area["object_types"]
    if "object_types" in fp:
        object_types = [t for t in object_types if t in fp["object_types"]]
    activities = area["activities"]
    if "activities" in fp:
        activities = [a for a in activities if a in fp["activities"]]
    if not object_types or not activities:
        return None
    return {**fp, "object_types": object_types, "activities": activities}


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def process_area_variants(request, pk):
    """
    Variants of the connected components of every process area.

    Body (JSON)::

        {
          "areas": [{"label": "order", "object_types": ["order"],
                     "activities": ["place order", ...]}, ...],
          "iso": "wl+vf2", "timeout_s": 10,
          "store": true,
          "execution_column": "process-executions-cc-process-areas",
          "variant_column": "variant-cc-process-areas"
        }

    For each area the log is projected onto the area's object types and
    activities (intersected with the global filter in the query string); every
    connected component of that projection is one process execution. Areas
    without activities have no executions and are reported as skipped.

    Execution ids are object ids and therefore unique across areas; variant
    ids are prefixed with the area's object types (``order+item/variant_0``)
    so the stored variant column distinguishes areas. Events claimed by more
    than one area -- only possible when areas share an activity -- are
    reported as ambiguous and left empty.
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

    try:
        settings = _parse_area_request(request.data)
    except VariantParamError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    if settings["store"] and not path.lower().endswith(".duckdb"):
        return Response(
            {"error": "Only DuckDB-backed event logs can store process executions."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    fp = _parse_filter_params(request)
    area_results = []
    all_case_events = {}
    case_variant = {}
    try:
        with job_scope(request, "Process area variants") as job, _with_ocel_db(user_file, job) as db:
            with _filter_shadow(db, fp):
                total_events = db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
                obj_types = _object_types(db)

            n_areas = len(settings["areas"])
            for index, area in enumerate(settings["areas"]):
                result = {
                    "label": area["label"],
                    "object_types": area["object_types"],
                    "activities": area["activities"],
                    "execution_count": 0,
                    "variant_count": 0,
                    "variants": [],
                    "skipped_reason": None,
                }
                area_results.append(result)
                area_fp = _area_filter(fp, area)
                if area_fp is None:
                    result["skipped_reason"] = (
                        "This process area has no activities."
                        if not area["activities"]
                        else "The filter removes every object type or activity of this area."
                    )
                    continue

                job.report(index / n_areas, f"Process area {index + 1}/{n_areas}: {area['label']}")
                with _filter_shadow(db, area_fp):
                    executions = extract_process_executions(db, extraction="connected")
                    if not executions.execution_count:
                        continue
                    variants = find_variants(
                        db,
                        extraction="connected",
                        iso=settings["iso"],
                        timeout_s=settings["timeout_s"],
                        verbose=False,
                        cases=executions.case_objects,
                    )
                    serialized = serialize_variants(variants, _layout_shim(db))

                prefix = f"{area['key']}/"
                for item in serialized:
                    item["id"] = prefix + item["id"]
                for variant in variants:
                    for case_id in variant.case_ids or ():
                        case_variant[case_id] = prefix + str(variant.id)
                all_case_events.update(executions.case_events)
                result["execution_count"] = executions.execution_count
                result["variant_count"] = len(serialized)
                result["variants"] = serialized

            partition = partition_events(all_case_events)
            written = {}
            if settings["store"]:
                variant_values = {
                    event_id: case_variant[case_id]
                    for event_id, case_id in partition.assignment.items()
                    if case_id in case_variant
                }
                columns = {
                    settings["execution_column"]: partition.assignment,
                    settings["variant_column"]: variant_values,
                }
                job.report(None, "Storing event columns")
                written = _rewrite_ocel_db_file(
                    user_file, lambda db_path: write_event_columns_to_file(db_path, columns)
                )
    except JobCancelled:
        return cancelled_response()
    except TimeoutError as exc:
        return Response(
            {
                "error": str(exc),
                "code": "timeout",
                "timeout_s": settings["timeout_s"],
                "hint": "Try a coarser iso strategy (db_signature / trace) in the advanced options.",
            },
            status=status.HTTP_408_REQUEST_TIMEOUT,
        )
    except Exception as exc:
        return Response(
            {"error": f"Computing process area variants failed: {exc}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    assigned = len(partition.assignment)
    ambiguous = len(partition.ambiguous_event_ids)
    return Response(
        {
            "file_id": user_file.pk,
            "stored": settings["store"],
            "execution_column": settings["execution_column"],
            "variant_column": settings["variant_column"],
            "execution_count": len(all_case_events),
            "variant_count": sum(a["variant_count"] for a in area_results),
            "total_event_count": int(total_events),
            "assigned_event_count": int(written.get(settings["execution_column"], assigned)),
            "ambiguous_event_count": ambiguous,
            "unassigned_event_count": int(total_events) - assigned - ambiguous,
            "areas": area_results,
            "object_types": obj_types,
        },
        status=status.HTTP_200_OK,
    )
