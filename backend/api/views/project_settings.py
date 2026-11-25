"""Per-project view settings (e.g. the layout of the analysis OC-DFG)."""

import re

from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from ..models import Project
from ..view_preferences import preferences_error

_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def project_view_settings(request, project_id, key):
    """
    Read or replace one entry of a project's view settings.

    GET returns ``{"key", "value"}`` with ``value: null`` when nothing is
    stored. PUT takes ``{"value": object | null}``; null removes the entry, so
    the view uses its defaults again. The frontend owns the format of a value
    and validates it on read.
    """
    if not _KEY_RE.match(key):
        return Response(
            {"error": "key must be 1-64 characters of a-z, 0-9, '-' and '_'"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if request.method == "GET":
        try:
            project = Project.objects.get(pk=project_id, users=request.user)
        except Project.DoesNotExist:
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        settings = project.view_settings if isinstance(project.view_settings, dict) else {}
        return Response({"key": key, "value": settings.get(key)})

    if "value" not in request.data:
        return Response(
            {"error": "value is required (null removes the entry)"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    value = request.data.get("value")
    error = preferences_error(value)
    if error:
        return Response({"error": f"value {error}"}, status=status.HTTP_400_BAD_REQUEST)

    # Read-modify-write of the whole JSON object: lock the row so concurrent
    # writes of different keys do not drop each other.
    with transaction.atomic():
        try:
            project = Project.objects.select_for_update().get(pk=project_id, users=request.user)
        except Project.DoesNotExist:
            return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)
        settings = dict(project.view_settings) if isinstance(project.view_settings, dict) else {}
        if value is None:
            settings.pop(key, None)
        else:
            settings[key] = value
        project.view_settings = settings
        project.save(update_fields=["view_settings"])
    return Response({"key": key, "value": value})
