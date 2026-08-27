"""
HTTP layer for the OCEL editor.

Every endpoint here is a thin wrapper around `totem_lib.ocel.editor.OcelEditor`
— parse/validate the request, open the session's working file, call exactly
one editor method, serialize the result. All OCEL logic lives in totem_lib.

Sessions are ephemeral working copies (see `OcelEditorSession`): they are
created from scratch, from an uploaded file or from an existing project's
event log, edited in place, and only become a real Project/EventLog when the
user explicitly saves. Unsaved sessions are deleted on discard or swept once
they go stale.
"""

import os
import tempfile
import threading
from contextlib import contextmanager
from datetime import timedelta

from django.core.files import File
from django.db import transaction
from django.http import FileResponse
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from totem_lib.ocel import OcelEditor, OcelEditorError
from totem_lib.ocel.editor import EXPORT_FORMATS

from .models import EventLog, OcelEditorSession, Project

# Editor sessions that were not touched for this long are considered
# abandoned (never saved) and are swept on the next session creation.
STALE_AFTER = timedelta(days=3)

UPLOAD_EXTENSIONS = (".sqlite", ".db", ".json", ".xml", ".csv", ".duckdb")

EXPORT_EXTENSIONS = {
    "duckdb": ".duckdb",
    "sqlite": ".sqlite",
    "json": ".json",
    "xml": ".xml",
}

# DuckDB allows only one read-write connection per file, so requests for the
# same session must be serialised. Same idea as the per-instance lock on
# `OcelDuckDB` used by views.py, keyed by session id here because editor
# sessions open and close their working copy per request.
_EDITOR_LOCKS: dict[str, threading.Lock] = {}
_EDITOR_LOCKS_GUARD = threading.Lock()


def _session_lock(session_id) -> threading.Lock:
    key = str(session_id)
    with _EDITOR_LOCKS_GUARD:
        return _EDITOR_LOCKS.setdefault(key, threading.Lock())


@contextmanager
def _with_editor(session: OcelEditorSession):
    """Open the session's working file with the per-session lock held."""
    with _session_lock(session.id):
        editor = OcelEditor(session.working_path)
        try:
            yield editor
        finally:
            editor.close()


def _get_session(request, session_id) -> OcelEditorSession:
    return OcelEditorSession.objects.get(pk=session_id, user=request.user)


def _touch(session: OcelEditorSession) -> None:
    session.save(update_fields=["updated_at"])


def _sweep_stale_sessions() -> None:
    cutoff = timezone.now() - STALE_AFTER
    # Instance-wise delete so the post_delete signal removes working files.
    for stale in OcelEditorSession.objects.filter(updated_at__lt=cutoff):
        stale.delete()


def _serialize_session(session: OcelEditorSession, summary: dict) -> dict:
    return {
        "id": str(session.id),
        "name": session.name,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
        "summary": summary,
    }


def _error(message, code=status.HTTP_400_BAD_REQUEST):
    return Response({"error": str(message)}, status=code)


def _list_params(request) -> dict:
    """Shared pagination/sort/filter query params for the list endpoints."""
    params = {
        "page": request.query_params.get("page", 1),
        "page_size": request.query_params.get("page_size", 50),
        "sort_by": request.query_params.get("sort_by") or "",
        "sort_dir": request.query_params.get("sort_dir") or "asc",
        "search": request.query_params.get("search") or None,
    }
    try:
        params["page"] = int(params["page"])
        params["page_size"] = int(params["page_size"])
    except (TypeError, ValueError):
        raise OcelEditorError("page and page_size must be integers.")
    return params


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
@parser_classes([JSONParser, MultiPartParser, FormParser])
def sessions(request):
    """
    GET  — list the caller's open editor sessions (newest first).
    POST — create a session; `mode` is one of:
      - "empty":   new log from scratch
      - "upload":  multipart body with an OCEL `file`
      - "project": copy of an existing event log (`file_id`)
    """
    if request.method == "GET":
        result = []
        for session in OcelEditorSession.objects.filter(user=request.user).order_by(
            "-updated_at"
        ):
            result.append(
                {
                    "id": str(session.id),
                    "name": session.name,
                    "created_at": session.created_at,
                    "updated_at": session.updated_at,
                }
            )
        return Response(result)

    _sweep_stale_sessions()

    mode = request.data.get("mode", "empty")
    name = (request.data.get("name") or "").strip()

    session = OcelEditorSession(user=request.user)
    os.makedirs(session.working_dir, exist_ok=True)

    try:
        if mode == "empty":
            session.name = name or "New event log"
            editor = OcelEditor.create_empty(session.working_path)
        elif mode == "upload":
            upload = request.FILES.get("file")
            if upload is None:
                return _error("Missing uploaded file.")
            ext = os.path.splitext(upload.name)[1].lower()
            if ext not in UPLOAD_EXTENSIONS:
                return _error(
                    f"Unsupported file type '{ext}'. "
                    f"Supported: {', '.join(UPLOAD_EXTENSIONS)}"
                )
            session.name = name or os.path.splitext(os.path.basename(upload.name))[0]
            with tempfile.NamedTemporaryFile(
                suffix=ext, dir=session.working_dir, delete=False
            ) as tmp:
                for chunk in upload.chunks():
                    tmp.write(chunk)
                tmp_path = tmp.name
            try:
                editor = OcelEditor.from_source(tmp_path, session.working_path)
            finally:
                os.remove(tmp_path)
        elif mode == "project":
            file_id = request.data.get("file_id")
            try:
                event_log = EventLog.objects.get(
                    pk=file_id, project__users=request.user
                )
            except (EventLog.DoesNotExist, ValueError, TypeError):
                return _error("Event log not found.", status.HTTP_404_NOT_FOUND)
            base = os.path.splitext(os.path.basename(event_log.file.name))[0]
            session.name = name or f"{base} (copy)"
            editor = OcelEditor.from_source(event_log.file.path, session.working_path)
        else:
            return _error(f"Unknown mode '{mode}'. Use empty, upload or project.")
    except OcelEditorError as e:
        return _error(e)
    except Exception as e:
        return _error(f"Failed to create editor session: {e}",
                      status.HTTP_500_INTERNAL_SERVER_ERROR)

    try:
        summary = editor.summary()
    finally:
        editor.close()
    session.save()
    return Response(_serialize_session(session, summary), status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def session_detail(request, session_id):
    try:
        session = _get_session(request, session_id)
    except OcelEditorSession.DoesNotExist:
        return _error("Editor session not found.", status.HTTP_404_NOT_FOUND)

    if request.method == "DELETE":
        session.delete()  # post_delete signal removes the working files
        return Response(status=status.HTTP_204_NO_CONTENT)

    if request.method == "PATCH":
        name = (request.data.get("name") or "").strip()
        if not name:
            return _error("Name must not be empty.")
        session.name = name[:100]
        session.save(update_fields=["name", "updated_at"])

    try:
        with _with_editor(session) as editor:
            summary = editor.summary()
    except OcelEditorError as e:
        return _error(e)
    return Response(_serialize_session(session, summary))


# ---------------------------------------------------------------------------
# Events (E2O table)
# ---------------------------------------------------------------------------


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def events(request, session_id):
    try:
        session = _get_session(request, session_id)
    except OcelEditorSession.DoesNotExist:
        return _error("Editor session not found.", status.HTTP_404_NOT_FOUND)

    try:
        with _with_editor(session) as editor:
            if request.method == "GET":
                params = _list_params(request)
                params["sort_by"] = params["sort_by"] or "timestamp"
                return Response(
                    editor.list_events(
                        **params,
                        activity=request.query_params.get("activity") or None,
                        object_type=request.query_params.get("object_type") or None,
                        object_id=request.query_params.get("object_id") or None,
                    )
                )
            created = editor.create_event(
                event_id=request.data.get("id"),
                activity=request.data.get("activity"),
                timestamp=request.data.get("timestamp"),
                attributes=request.data.get("attributes") or {},
                objects=request.data.get("objects") or [],
            )
        _touch(session)
        return Response(created, status=status.HTTP_201_CREATED)
    except OcelEditorError as e:
        return _error(e)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def event_detail(request, session_id):
    """Event ids may contain any character, so they travel in the body/query
    (`event_id`) instead of the URL path."""
    try:
        session = _get_session(request, session_id)
    except OcelEditorSession.DoesNotExist:
        return _error("Editor session not found.", status.HTTP_404_NOT_FOUND)

    try:
        with _with_editor(session) as editor:
            if request.method == "DELETE":
                event_id = request.query_params.get("event_id")
                if not event_id:
                    return _error("Missing ?event_id")
                editor.delete_event(event_id)
                result = None
            else:
                event_id = request.data.get("event_id")
                if not event_id:
                    return _error("Missing 'event_id' in body.")
                result = editor.update_event(
                    event_id,
                    new_event_id=request.data.get("id"),
                    activity=request.data.get("activity"),
                    timestamp=request.data.get("timestamp"),
                    attributes=request.data.get("attributes"),
                    objects=request.data.get("objects"),
                )
        _touch(session)
        if result is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(result)
    except OcelEditorError as e:
        return _error(e)


# ---------------------------------------------------------------------------
# Objects (attributes + O2O)
# ---------------------------------------------------------------------------


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def objects(request, session_id):
    try:
        session = _get_session(request, session_id)
    except OcelEditorSession.DoesNotExist:
        return _error("Editor session not found.", status.HTTP_404_NOT_FOUND)

    try:
        with _with_editor(session) as editor:
            if request.method == "GET":
                params = _list_params(request)
                params["sort_by"] = params["sort_by"] or "id"
                return Response(
                    editor.list_objects(
                        **params,
                        object_type=request.query_params.get("object_type") or None,
                    )
                )
            created = editor.create_object(
                obj_id=request.data.get("id"),
                obj_type=request.data.get("type"),
                attributes=request.data.get("attributes") or {},
                relations=request.data.get("relations") or [],
            )
        _touch(session)
        return Response(created, status=status.HTTP_201_CREATED)
    except OcelEditorError as e:
        return _error(e)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def object_detail(request, session_id):
    try:
        session = _get_session(request, session_id)
    except OcelEditorSession.DoesNotExist:
        return _error("Editor session not found.", status.HTTP_404_NOT_FOUND)

    try:
        with _with_editor(session) as editor:
            if request.method == "DELETE":
                obj_id = request.query_params.get("object_id")
                if not obj_id:
                    return _error("Missing ?object_id")
                editor.delete_object(obj_id)
                result = None
            else:
                obj_id = request.data.get("object_id")
                if not obj_id:
                    return _error("Missing 'object_id' in body.")
                result = editor.update_object(
                    obj_id,
                    new_obj_id=request.data.get("id"),
                    obj_type=request.data.get("type"),
                    attributes=request.data.get("attributes"),
                    relations=request.data.get("relations"),
                )
        _touch(session)
        if result is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(result)
    except OcelEditorError as e:
        return _error(e)


# ---------------------------------------------------------------------------
# O2O relations table
# ---------------------------------------------------------------------------


@api_view(["GET", "POST", "DELETE"])
@permission_classes([IsAuthenticated])
def relations(request, session_id):
    try:
        session = _get_session(request, session_id)
    except OcelEditorSession.DoesNotExist:
        return _error("Editor session not found.", status.HTTP_404_NOT_FOUND)

    try:
        with _with_editor(session) as editor:
            if request.method == "GET":
                params = _list_params(request)
                params["sort_by"] = params["sort_by"] or "source"
                return Response(editor.list_relations(**params))
            if request.method == "POST":
                result = editor.set_relation(
                    source=request.data.get("source"),
                    target=request.data.get("target"),
                    qualifier=request.data.get("qualifier") or None,
                )
                _touch(session)
                return Response(result, status=status.HTTP_201_CREATED)
            source = request.query_params.get("source")
            target = request.query_params.get("target")
            if not source or not target:
                return _error("Missing ?source and ?target")
            editor.delete_relation(source, target)
        _touch(session)
        return Response(status=status.HTTP_204_NO_CONTENT)
    except OcelEditorError as e:
        return _error(e)


# ---------------------------------------------------------------------------
# Exports
# ---------------------------------------------------------------------------


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def latex(request, session_id):
    try:
        session = _get_session(request, session_id)
    except OcelEditorSession.DoesNotExist:
        return _error("Editor session not found.", status.HTTP_404_NOT_FOUND)

    table = request.query_params.get("table", "e2o")
    try:
        with _with_editor(session) as editor:
            if table == "e2o":
                result = editor.latex_e2o(
                    search=request.query_params.get("search") or None,
                    activity=request.query_params.get("activity") or None,
                    object_type=request.query_params.get("object_type") or None,
                    sort_by=request.query_params.get("sort_by") or "timestamp",
                    sort_dir=request.query_params.get("sort_dir") or "asc",
                )
            elif table == "o2o":
                result = editor.latex_o2o(
                    search=request.query_params.get("search") or None,
                    sort_by=request.query_params.get("sort_by") or "source",
                    sort_dir=request.query_params.get("sort_dir") or "asc",
                )
            else:
                return _error("Unknown table. Use ?table=e2o or ?table=o2o.")
        return Response(result)
    except OcelEditorError as e:
        return _error(e)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def export(request, session_id):
    try:
        session = _get_session(request, session_id)
    except OcelEditorSession.DoesNotExist:
        return _error("Editor session not found.", status.HTTP_404_NOT_FOUND)

    # Named `fmt`, not `format` — DRF reserves the `format` query parameter
    # for response content negotiation and 404s on unknown values.
    fmt = (request.query_params.get("fmt") or "duckdb").lower()
    if fmt not in EXPORT_FORMATS:
        return _error(
            f"Unsupported format '{fmt}'. Supported: {', '.join(EXPORT_FORMATS)}"
        )
    extension = EXPORT_EXTENSIONS[fmt]
    dest = session.export_path(extension)
    try:
        with _with_editor(session) as editor:
            editor.export(dest, fmt)
    except OcelEditorError as e:
        return _error(e)
    except Exception as e:
        return _error(f"Export failed: {e}", status.HTTP_500_INTERNAL_SERVER_ERROR)

    filename = f"{slugify(session.name) or 'ocel'}{extension}"
    return FileResponse(open(dest, "rb"), as_attachment=True, filename=filename)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def save_as_project(request, session_id):
    """Persist the working copy as a new Project + EventLog (DuckDB format)."""
    try:
        session = _get_session(request, session_id)
    except OcelEditorSession.DoesNotExist:
        return _error("Editor session not found.", status.HTTP_404_NOT_FOUND)

    name = (request.data.get("name") or session.name or "").strip()
    if not name:
        return _error("Project name must not be empty.")

    dest = session.export_path(".duckdb")
    try:
        with _with_editor(session) as editor:
            editor.export(dest, "duckdb")
    except OcelEditorError as e:
        return _error(e)

    base = slugify(name) or "ocel"
    # Same naming convention as the upload flow (EventLogViewSet.perform_create),
    # truncated to the Project.name column length.
    project_name = f"{base}_{request.user.username}"[:30]
    try:
        with transaction.atomic():
            project = Project.objects.create(name=project_name)
            project.users.add(request.user)
            with open(dest, "rb") as f:
                event_log = EventLog.objects.create(
                    project=project, file=File(f, name=f"{base}.duckdb")
                )
    finally:
        if os.path.exists(dest):
            os.remove(dest)

    _touch(session)
    return Response(
        {
            "project_id": project.id,
            "project_name": project.name,
            "file_id": event_log.id,
            "file": event_log.file.name,
        },
        status=status.HTTP_201_CREATED,
    )
