"""Small standalone endpoints: health, greeting, bulk delete, cache, settings."""

from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from django.conf import settings

from .. import jobs
from ..models import Project, ProjectComponentFilter, UserSettings


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def greeting(request):

    return Response({"message": "Hello, greetings from the backend!"})


@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(request):
    return Response({"status": "ok", "message": "Backend is running."})


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_user_data(request):
    confirm = request.data.get("confirm")
    if confirm != "DELETE":
        return Response(
            {"error": "Please confirm by sending {'confirm': 'DELETE'}"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = request.user
    deleted_count = 0
    left_count = 0
    for project in Project.objects.filter(users=user):
        if project.users.exclude(pk=user.pk).exists():
            # Shared project: other members keep their logs, dashboards and
            # assets — only this user's membership is removed.
            project.users.remove(user)
            left_count += 1
        else:
            project.delete()
            deleted_count += 1
    UserSettings.objects.filter(user=user).delete()

    return Response(
        {
            "detail": (
                f"Deleted {deleted_count} project(s) and related data for user "
                f"'{user.username}'; left {left_count} shared project(s)."
            ),
            "deleted_projects": deleted_count,
            "left_shared_projects": left_count,
        },
        status=status.HTTP_200_OK,
    )


# ---------------------------------------------------------------------------


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def cache_stats(request):
    """Return current cache statistics."""
    from ..cache_utils import get_cache_stats

    return Response(get_cache_stats())


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cache_clear(request):
    """Clear the entire results cache.

    The cache is shared by every user of this server, so on a hosted
    deployment only staff may wipe it. In LOCAL_MODE (the desktop app) the
    single Guest user owns the whole installation and may always clear it.
    """
    from django.conf import settings

    from ..cache_utils import clear_all_cache

    if not settings.LOCAL_MODE and not request.user.is_staff:
        return Response(
            {"error": "Only staff users may clear the shared results cache."},
            status=status.HTTP_403_FORBIDDEN,
        )

    clear_all_cache()
    return Response({"status": "cleared"})


# ---------------------------------------------------------------------------


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def user_settings(request):
    """Read or update the current user's settings.

    GET returns the settings (creating a default row on first access).
    PATCH updates individual fields — currently only ``bypass_cache``.
    """
    settings_obj, _ = UserSettings.objects.get_or_create(user=request.user)

    if request.method == "PATCH":
        if "bypass_cache" in request.data:
            # Coerce via DRF's BooleanField so string payloads like "false"/"0"
            # are parsed correctly (bool("false") would wrongly be True). Invalid
            # values raise ValidationError -> 400.
            settings_obj.bypass_cache = serializers.BooleanField().to_internal_value(
                request.data["bypass_cache"]
            )
            settings_obj.save(update_fields=["bypass_cache"])

    return Response({"bypass_cache": settings_obj.bypass_cache})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def upload_limits(request):
    """The limits the upload page checks up front; null means no limit."""
    return Response(
        {
            "max_upload_bytes": settings.MAX_UPLOAD_BYTES,
            "max_projects_per_user": settings.MAX_PROJECTS_PER_USER,
            "project_count": Project.objects.filter(users=request.user).count(),
        }
    )


# ---------------------------------------------------------------------------
# Cancellable computations (see api/jobs.py)
# ---------------------------------------------------------------------------

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def jobs_status(request):
    """Progress of the jobs named in ``?ids=a,b,c`` (own jobs only)."""
    raw = request.query_params.get("ids", "")
    ids = [i.strip() for i in raw.split(",") if i.strip()][:50]
    return Response(jobs.status_of(ids, request.user.pk), status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def job_cancel(request, job_id):
    """Stop the computation behind a job id (own jobs only)."""
    if not jobs.valid_job_id(job_id):
        return Response({"error": "Invalid job id"}, status=status.HTTP_400_BAD_REQUEST)
    return Response(jobs.cancel(job_id, request.user.pk), status=status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# Per-user, per-project component filter persistence 
# ---------------------------------------------------------------------------

@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def component_filters(request, project_id):
    """Read or update local filter params.

    GET  → returns a dict of {component_key: local_filter_params}
    PUT  → body {"component_key": str, "local_filter_params": dict}
           upserts one record and returns 204
    """
    try:
        project = Project.objects.get(pk=project_id, users=request.user)
    except Project.DoesNotExist:
        return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        filters = ProjectComponentFilter.objects.filter(
            user=request.user, project=project
        ).values("component_key", "local_filter_params")
        return Response({f["component_key"]: f["local_filter_params"] for f in filters})

    # PUT
    key = request.data.get("component_key")
    params = request.data.get("local_filter_params")
    if not key or not isinstance(key, str):
        return Response({"error": "component_key required"}, status=status.HTTP_400_BAD_REQUEST)
    if not isinstance(params, dict):
        return Response({"error": "local_filter_params must be an object"}, status=status.HTTP_400_BAD_REQUEST)
    cleaned = {str(k): str(v) for k, v in params.items() if k and v is not None and str(v) != ""}
    ProjectComponentFilter.objects.update_or_create(
        user=request.user,
        project=project,
        component_key=key,
        defaults={"local_filter_params": cleaned},
    )
    return Response(status=status.HTTP_204_NO_CONTENT)
