"""Optional limits for hosted installs (see docs/DOCKER.md).

``MAX_UPLOAD_BYTES`` and ``MAX_PROJECTS_PER_USER`` come from the environment;
``None`` means no limit, which is the default.
"""

import threading

from django.conf import settings
from django.core.files.uploadhandler import FileUploadHandler
from rest_framework import status
from rest_framework.exceptions import APIException

from .models import Project

# Makes the count and the insert one step, so parallel uploads cannot slip past
# the limit. Requests share one process (GUNICORN_WORKERS stays 1).
_PROJECT_CREATE_LOCK = threading.Lock()

UNLIMITED_VERSION_HINT = (
    "At totem-tool.com, you can download the local or self-hosted version "
    "that has no limitations."
)


class UploadTooLarge(APIException):
    status_code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    default_code = "upload_too_large"


class ProjectLimitReached(APIException):
    status_code = status.HTTP_403_FORBIDDEN
    default_code = "project_limit_reached"


def _project_limit_message() -> str:
    limit = settings.MAX_PROJECTS_PER_USER
    return (
        f"You have reached the limit of {limit} "
        f"project{'' if limit == 1 else 's'}. Delete a project to add a new one. "
        f"{UNLIMITED_VERSION_HINT}"
    )


def check_project_limit(user) -> None:
    """Raise ``ProjectLimitReached`` if ``user`` cannot get another project."""
    limit = settings.MAX_PROJECTS_PER_USER
    if limit is None or user is None:
        return
    if Project.objects.filter(users=user).count() >= limit:
        raise ProjectLimitReached(_project_limit_message())


def create_project(name: str, user) -> Project:
    """Create a project owned by ``user``, enforcing the project limit."""
    with _PROJECT_CREATE_LOCK:
        check_project_limit(user)
        project = Project.objects.create(name=name)
        if user:
            project.users.add(user)
    return project


class MaxSizeUploadHandler(FileUploadHandler):
    """Rejects a file as soon as it passes ``MAX_UPLOAD_BYTES``.

    Runs while the body is read, so every upload endpoint is covered and an
    oversized file never reaches the disk in full.
    """

    def new_file(self, *args, **kwargs):
        super().new_file(*args, **kwargs)
        self._received = 0

    def receive_data_chunk(self, raw_data, start):
        limit = settings.MAX_UPLOAD_BYTES
        self._received += len(raw_data)
        if limit is not None and self._received > limit:
            raise UploadTooLarge(
                f"This file is larger than the upload limit of "
                f"{limit // (1024 * 1024)} MB. {UNLIMITED_VERSION_HINT}"
            )
        return raw_data

    def file_complete(self, file_size):
        return None
