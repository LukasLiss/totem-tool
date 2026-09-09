"""Small standalone endpoints: health, greeting, bulk delete, cache, settings."""

from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from ..models import Project, UserSettings


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
    projects = Project.objects.filter(users=user)
    deleted_count = projects.count()
    projects.delete()

    return Response(
        {
            "detail": f"Deleted {deleted_count} project(s) and related data for user '{user.username}'."
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
    """Clear the entire results cache."""
    from ..cache_utils import clear_all_cache

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
