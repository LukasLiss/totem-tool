"""Export and import a whole project as a single ``.totem`` file.

A project bundle carries everything an installation needs to recreate a
project: the event log, the saved models and stored queries, the images, and
every dashboard. Unlike a dashboard bundle (:mod:`api.dashboard_bundle`), which
describes structure that must be re-pointed at whatever the target project
already has, a project bundle ships its own dependencies — so a clean import
resolves every reference and reports nothing.

The file is a **zip** named ``.totem``. Not ``.totem.zip``: Safari expands
downloaded zip archives on arrival, which would leave a user who clicked a
sample-project link holding a folder and nothing to drag back into the tool. A
custom extension over a zip container is the ``.docx`` / ``.epub`` / ``.sketch``
pattern — opaque to the operating system, still openable by renaming it.

Layout::

    manifest.json                {"schema": "totem-project", "version": 1, ...}
    project.json                 name, display_name, view_settings
    event-log/log.duckdb         the stored log, byte for byte
    assets/models.json           TOTEM / OCCN / OCPN / OC-DFG / QUERY assets
    assets/images.json           image names and content types
    assets/images/<n>.<ext>      the image bytes
    dashboards/001-<slug>.json   one `totem-dashboard` bundle each, verbatim

**Dashboards are embedded unmodified.** ``build_dashboard_bundle`` and
``resolve_bundle_components`` are called per dashboard and need no changes, so
a dashboard extracted from a project zip imports through the existing
``/api/dashboard/import/`` as-is.

**The event log travels as DuckDB** because that is what the upload path
converts every format to before deleting the original, so it is the canonical
store rather than a derived copy — and the smallest one (2.3 MB against 9.5 MB
of OCEL JSON for the same log). The cost is that DuckDB guarantees a newer
build reads an older file but not the reverse, so the manifest records the
version that wrote it and an import that cannot open the file says so.

A bundle is a *file*, so it is trusted less than anything built in the UI:
every member name is checked for traversal, a bomb's compression ratio is
refused, and asset contents are re-validated with the same validators the
asset endpoints use.

What is deliberately **not** limited is how large a project is or how much it
holds. A hosted install decides how big a request body it accepts
(``MAX_UPLOAD_BYTES``); on the desktop the file is the user's own. Neither is
improved by this module inventing a ceiling.
"""

from __future__ import annotations

import json
import os
import posixpath
import zipfile
from datetime import datetime, timezone

from django.core.files.base import ContentFile
from django.utils.text import slugify

from .dashboard_bundle import (
    build_dashboard_bundle,
    resolve_bundle_components,
    validate_dashboard_bundle_dict,
)
from .models import Dashboard, EventLog, ImageAsset, Project, ProjectAsset

PROJECT_BUNDLE_SCHEMA = "totem-project"
PROJECT_BUNDLE_VERSION = 1

MANIFEST_NAME = "manifest.json"
PROJECT_NAME = "project.json"
EVENT_LOG_DIR = "event-log"
ASSETS_DIR = "assets"
MODELS_NAME = f"{ASSETS_DIR}/models.json"
IMAGES_NAME = f"{ASSETS_DIR}/images.json"
IMAGES_DIR = f"{ASSETS_DIR}/images"
DASHBOARDS_DIR = "dashboards"

# Deliberately no limit on how large a project is, or on how many dashboards,
# assets or images it holds. A hosted install decides how big a request body it
# will accept (MAX_UPLOAD_BYTES), and on the desktop the file is the user's
# own — neither case is improved by this module guessing a ceiling.
#
# A zip claiming to expand far beyond its own size is still refused: that is a
# bomb, not a big project, and it is the one thing an upload-size limit cannot
# catch, because the uploaded file is small. The ratio is what separates the
# two — a DuckDB log compresses around 3x and JSON around 10x, so nothing
# genuine comes near this.
MAX_COMPRESSION_RATIO = 200

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp"}


def totem_version():
    """The app version, for the manifest. Empty when it cannot be determined.

    The version of record lives in the root ``package.json`` (the Electron and
    frontend builds read the same one); the backend has no constant of its
    own. Advisory only — ``duckdb_version`` is the field an import acts on —
    so a packaged backend that cannot see the file simply records nothing.
    """
    from django.conf import settings

    override = getattr(settings, "TOTEM_VERSION", "")
    if override:
        return str(override)
    candidate = os.path.join(os.path.dirname(str(settings.BASE_DIR)), "package.json")
    try:
        with open(candidate, encoding="utf-8") as handle:
            return str(json.load(handle).get("version") or "")
    except (OSError, ValueError):
        return ""


class ProjectBundleError(ValueError):
    """Rejected bundle. The message is written to be shown to the user."""


def _require(condition, message):
    if not condition:
        raise ProjectBundleError(message)


# ---------------------------------------------------------------------------
# Safe zip handling
# ---------------------------------------------------------------------------


def safe_member_path(name):
    """``name`` as a relative POSIX path, or None if it is not safe to use.

    Rejects absolute paths, drive letters, and anything climbing out with
    ``..`` — the zip-slip family, where a member called ``../../etc/x``
    escapes the directory it is supposed to land in. Returning None rather
    than raising lets callers decide whether an odd member is fatal or merely
    skipped.
    """
    if not name or name.endswith("/"):
        return None
    # Zip stores forward slashes, but a hostile file can carry backslashes
    # that Windows would treat as separators.
    candidate = name.replace("\\", "/")
    if candidate.startswith("/") or ":" in candidate.split("/")[0]:
        return None
    normalised = posixpath.normpath(candidate)
    if normalised.startswith("../") or normalised == ".." or normalised.startswith("/"):
        return None
    if any(part == ".." for part in normalised.split("/")):
        return None
    return normalised


def check_archive_safety(zf):
    """Refuse a zip that is hostile rather than merely invalid.

    Neither size nor item counts are limited — an event log is as big as it is,
    and how many dashboards a project holds is the user's business. What is
    refused is a file whose *shape* is an attack: a member path that escapes
    the extraction directory, or a compression ratio no real content reaches.
    Checked against the declared metadata before a single member is read, so a
    bomb is refused without expanding it.
    """
    infos = zf.infolist()
    total_uncompressed = 0
    total_compressed = 0
    for info in infos:
        if info.is_dir():
            continue
        _require(
            safe_member_path(info.filename) is not None,
            "The file contains an entry with an unsafe path and was not imported.",
        )
        total_uncompressed += info.file_size
        total_compressed += info.compress_size

    # No ceiling on the total: a project is as large as its event log. Only the
    # ratio is checked, which a real project never approaches.
    #
    # A small archive claiming a huge expansion is the classic bomb. Only
    # meaningful once there is something to compare against.
    if total_compressed > 4096:
        _require(
            total_uncompressed <= total_compressed * MAX_COMPRESSION_RATIO,
            "The file's contents expand far beyond its size and were not imported.",
        )


def _read_json_member(zf, name, *, required=True, default=None):
    try:
        raw = zf.read(name)
    except KeyError:
        _require(not required, f"The file is missing {name}.")
        return default
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ProjectBundleError(f"{name} in the file is not valid JSON.")


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


def _event_log_member(event_log):
    """The archive path for a log, keeping the stored file's extension."""
    ext = os.path.splitext(event_log.file.name)[1].lower() or ".duckdb"
    return f"{EVENT_LOG_DIR}/log{ext}"


def _dashboard_member(index, dashboard):
    """Numbered so the archive lists in the order the sidebar shows."""
    stem = slugify(dashboard.name) or "dashboard"
    return f"{DASHBOARDS_DIR}/{index:03d}-{stem}.json"


def _model_assets_payload(project):
    return [
        {
            "name": asset.name,
            "asset_type": asset.asset_type,
            "content_json": asset.content_json,
            "metadata": asset.metadata,
        }
        for asset in ProjectAsset.objects.filter(project=project).order_by("pk")
    ]


def build_project_bundle(project, destination, *, totem_version="", progress=None):
    """Write ``project`` to ``destination`` (a path) as a ``.totem`` archive.

    Streams member by member rather than building the archive in memory: the
    event log alone can be hundreds of megabytes.
    """
    dashboards = list(Dashboard.objects.filter(project=project).order_by("order_in_project", "pk"))
    images = list(ImageAsset.objects.filter(project=project).order_by("pk"))
    models = _model_assets_payload(project)
    event_log = EventLog.objects.filter(project=project).order_by("pk").first()

    def report(fraction, message):
        if progress:
            progress(fraction, message)

    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as zf:
        report(0.05, "Collecting the project")
        zf.writestr(
            PROJECT_NAME,
            json.dumps(
                {
                    "name": project.name,
                    "display_name": project.display_name,
                    "view_settings": project.view_settings,
                },
                indent=2,
            ),
        )

        zf.writestr(MODELS_NAME, json.dumps(models, indent=2))

        image_entries = []
        for index, image in enumerate(images, start=1):
            ext = os.path.splitext(image.image.name)[1].lower() or ".png"
            member = f"{IMAGES_DIR}/{index:03d}{ext}"
            image_entries.append(
                {
                    "name": image.name,
                    "content_type": image.content_type,
                    "file": member,
                }
            )
            try:
                with image.image.open("rb") as handle:
                    zf.writestr(member, handle.read())
            except (FileNotFoundError, OSError):
                # The row outlived its file. Better a project without one
                # picture than a failed export.
                image_entries.pop()
        zf.writestr(IMAGES_NAME, json.dumps(image_entries, indent=2))

        report(0.2, "Adding dashboards")
        dashboard_members = []
        for index, dashboard in enumerate(dashboards, start=1):
            member = _dashboard_member(index, dashboard)
            dashboard_members.append(member)
            zf.writestr(member, json.dumps(build_dashboard_bundle(dashboard), indent=2))

        log_member = None
        if event_log:
            report(0.35, "Adding the event log")
            log_member = _event_log_member(event_log)
            # Written through the storage API so this works with any backend,
            # and in chunks so a large log is never held whole in memory.
            with event_log.file.open("rb") as source, zf.open(log_member, "w") as target:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    target.write(chunk)

        report(0.9, "Finishing the file")
        import duckdb  # local: only needed to stamp the version

        zf.writestr(
            MANIFEST_NAME,
            json.dumps(
                {
                    "schema": PROJECT_BUNDLE_SCHEMA,
                    "version": PROJECT_BUNDLE_VERSION,
                    "exported_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "totem_version": totem_version,
                    # Why: DuckDB reads older files but not newer ones, so an
                    # import that cannot open the log can say which version
                    # wrote it instead of calling the bundle corrupt.
                    "duckdb_version": duckdb.__version__ if log_member else "",
                    "event_log": log_member,
                    "dashboards": dashboard_members,
                    "counts": {
                        "dashboards": len(dashboards),
                        "model_assets": len(models),
                        "images": len(image_entries),
                    },
                },
                indent=2,
            ),
        )
    report(1.0, "Done")
    return destination


def bundle_filename(project):
    """``<project>.totem``, safe to put in a Content-Disposition header."""
    stem = slugify(project.display_name or project.name) or "project"
    return f"{stem}.totem"


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate_project_manifest(raw):
    """Check ``raw`` is a project manifest this build can read."""
    _require(isinstance(raw, dict), f"{MANIFEST_NAME} must contain a JSON object.")

    schema = raw.get("schema")
    _require(
        schema == PROJECT_BUNDLE_SCHEMA,
        f'Not a TOTeM project file (expected schema "{PROJECT_BUNDLE_SCHEMA}", '
        f"found {schema!r}).",
    )

    version = raw.get("version")
    _require(
        isinstance(version, int) and not isinstance(version, bool),
        "The file's version must be a whole number.",
    )
    _require(version >= 1, "The file's version is not valid; it may be corrupt.")
    _require(
        version <= PROJECT_BUNDLE_VERSION,
        f"This file was written by a newer version of TOTeM (project format "
        f"{version}; this build reads up to {PROJECT_BUNDLE_VERSION}).",
    )

    listed = raw.get("dashboards")
    if listed is not None:
        _require(isinstance(listed, list), "The file's dashboard list is not a list.")
    return raw


def read_bundle(zf):
    """Everything a bundle describes, validated, without writing anything.

    Returns a dict the importer can act on. Raises ``ProjectBundleError`` with
    a message meant for the user; nothing has been created at that point.
    """
    check_archive_safety(zf)

    manifest = validate_project_manifest(_read_json_member(zf, MANIFEST_NAME))
    project_info = _read_json_member(zf, PROJECT_NAME, required=False, default={}) or {}
    _require(isinstance(project_info, dict), f"{PROJECT_NAME} must contain a JSON object.")

    models = _read_json_member(zf, MODELS_NAME, required=False, default=[]) or []
    _require(isinstance(models, list), "The file's model asset list is not a list.")

    images = _read_json_member(zf, IMAGES_NAME, required=False, default=[]) or []
    _require(isinstance(images, list), "The file's image list is not a list.")

    names = set(zf.namelist())

    dashboards = []
    for member in manifest.get("dashboards") or []:
        _require(isinstance(member, str), "A dashboard entry in the file is not a path.")
        _require(member in names, f"The file lists {member} but does not contain it.")
        bundle = _read_json_member(zf, member)
        # The embedded documents are ordinary dashboard bundles, so the
        # existing validator is the authority on them.
        try:
            validate_dashboard_bundle_dict(bundle)
        except ValueError as exc:
            raise ProjectBundleError(f"{member}: {exc}")
        dashboards.append(bundle)

    log_member = manifest.get("event_log") or None
    if log_member:
        _require(isinstance(log_member, str), "The file's event log entry is not a path.")
        _require(
            log_member in names,
            "The file says it contains an event log but does not.",
        )

    return {
        "manifest": manifest,
        "project": project_info,
        "models": models,
        "images": images,
        "dashboards": dashboards,
        "event_log": log_member,
    }


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------


def unique_project_name(desired):
    """A free ``Project.name`` based on ``desired``.

    ``name`` doubles as a directory name for image uploads, so it is slugified
    rather than taken verbatim, and it is kept unique so two imports of the
    same file cannot share a media directory.
    """
    limit = Project._meta.get_field("name").max_length
    base = (slugify(desired or "") or "project")[:limit]
    if not Project.objects.filter(name=base).exists():
        return base
    n = 2
    while True:
        suffix = f"-{n}"
        candidate = base[: limit - len(suffix)].rstrip("-") + suffix
        if not Project.objects.filter(name=candidate).exists():
            return candidate
        n += 1


def unique_display_name(user, desired):
    """A display name for an imported project that reads unambiguously.

    The switcher labels projects by `display_name`, so importing a project the
    user already has would otherwise put two identical rows in the list with
    nothing to tell them apart. Same rule as a dashboard import: never
    overwrite, suffix on clash — and leave the name alone when there is none,
    so a sample project keeps the name its author gave it.
    """
    limit = Project._meta.get_field("display_name").max_length
    base = (desired or "").strip()[:limit]
    if not base:
        return ""
    taken = set(
        Project.objects.filter(users=user).values_list("display_name", flat=True)
    )
    if base not in taken:
        return base
    for suffix in [" (imported)"] + [f" ({n})" for n in range(2, 100)]:
        candidate = base[: limit - len(suffix)].rstrip() + suffix
        if candidate not in taken:
            return candidate
    n = 100
    while True:
        suffix = f" ({n})"
        candidate = base[: limit - len(suffix)].rstrip() + suffix
        if candidate not in taken:
            return candidate
        n += 1


def restore_model_assets(project, entries, user):
    """Create the project's saved models and stored queries.

    Content is re-validated with the validators the asset endpoints use: a
    bundle is a file, and the editor that produced it is not in the room.
    """
    # Local import: serializers pulls in the whole model graph.
    from .serializers import ProjectAssetSerializer

    created = 0
    skipped = []
    for entry in entries:
        if not isinstance(entry, dict):
            skipped.append("an entry that is not an object")
            continue
        name = entry.get("name")
        asset_type = entry.get("asset_type")
        content = entry.get("content_json")
        if not isinstance(name, str) or not name.strip():
            skipped.append("a saved model with no name")
            continue
        if asset_type not in ProjectAsset.AssetType.values:
            skipped.append(f'"{name}" (unknown type {asset_type!r})')
            continue
        try:
            # The same check the asset endpoints run, so a hand-edited bundle
            # cannot put content in the store that the editors would refuse.
            ProjectAssetSerializer._validate_content_json(content, asset_type)
        except Exception as exc:  # DRF ValidationError or ValueError
            skipped.append(f'"{name}" ({exc})')
            continue
        metadata = entry.get("metadata")
        ProjectAsset.objects.create(
            project=project,
            name=name.strip()[: ProjectAsset._meta.get_field("name").max_length],
            asset_type=asset_type,
            content_json=content,
            metadata=metadata if isinstance(metadata, dict) else {},
            created_by=user,
        )
        created += 1
    return created, skipped


def restore_images(project, entries, zf, user):
    """Create the project's images from the bytes in the archive.

    Saved through the ``ImageAsset`` file field rather than copied, so the new
    project's id lands in the storage path (``image_asset_directory_path``).
    """
    created = 0
    skipped = []
    names = set(zf.namelist())
    for entry in entries:
        if not isinstance(entry, dict):
            skipped.append("an entry that is not an object")
            continue
        name = entry.get("name")
        member = entry.get("file")
        if not isinstance(name, str) or not name.strip():
            skipped.append("an image with no name")
            continue
        if not isinstance(member, str) or member not in names:
            skipped.append(f'"{name}" (its picture is missing from the file)')
            continue
        ext = os.path.splitext(member)[1].lower()
        if ext not in IMAGE_EXTENSIONS:
            skipped.append(f'"{name}" (unsupported image type {ext or "none"})')
            continue
        data = zf.read(member)
        asset = ImageAsset(
            project=project,
            name=name.strip()[: ImageAsset._meta.get_field("name").max_length],
            content_type=(entry.get("content_type") or "")[:100],
            created_by=user,
        )
        asset.image.save(f"{slugify(name) or 'image'}{ext}", ContentFile(data), save=False)
        asset.save()
        created += 1
    return created, skipped


def restore_dashboards(project, bundles, zf, *, user, event_log_id, replace_components):
    """Create the project's dashboards from the embedded dashboard bundles.

    ``replace_components`` is ``DashboardViewSet._replace_components``, passed
    in rather than imported so this module does not depend on the viewset.
    Because the project bundle has already restored the assets these
    dashboards name, the warnings a bare dashboard import would produce do not
    arise here — any that do are real and worth returning.

    Two passes, and the reason matters: dashboard links resolve by **name**
    against the rows that exist at the time. Creating and filling one
    dashboard at a time means a link to a dashboard later in the file finds
    nothing and is dropped, so a project whose first dashboard links its
    second would quietly lose that link on every round trip. Every row is
    therefore created before any components are resolved.
    """
    limit = Dashboard._meta.get_field("name").max_length
    created = []
    for order, bundle in enumerate(bundles, start=1):
        name = bundle["dashboard"]["name"]
        created.append(
            (
                Dashboard.objects.create(
                    project=project,
                    name=name[:limit],
                    order_in_project=order,
                ),
                bundle,
                name,
            )
        )

    warnings = []
    for dashboard, bundle, name in created:
        layout, bundle_warnings = resolve_bundle_components(
            bundle["components"],
            project=project,
            user=user,
            event_log_id=event_log_id,
            # The log came out of this same bundle, so a dotted chart is not
            # being pointed at different data and has nothing to re-check.
            event_log_is_original=True,
            self_dashboard=dashboard,
            self_name=name,
        )
        replace_components(dashboard, layout)
        warnings.extend(bundle_warnings)
    return warnings
