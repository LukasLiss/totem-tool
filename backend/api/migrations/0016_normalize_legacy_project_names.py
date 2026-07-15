import re
from pathlib import PurePosixPath

from django.db import migrations


KNOWN_EVENT_LOG_EXTENSIONS = (
    "duckdb",
    "sqlite",
    "json",
    "xml",
    "csv",
    "db",
)
STORAGE_COLLISION_SUFFIX = re.compile(r"_[A-Za-z0-9]{7}$")


def _comparison_key(value):
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _legacy_name_base(project_name, usernames):
    for username in sorted((name for name in usernames if name), key=len, reverse=True):
        suffix = f"_{username}"
        if project_name.endswith(suffix):
            return project_name[: -len(suffix)]
    return None


def _name_from_event_log(legacy_base, event_log_filename):
    filename = PurePosixPath(str(event_log_filename).replace("\\", "/")).name
    stem, separator, extension = filename.rpartition(".")
    if not separator:
        stem, extension = filename, ""

    candidate_stems = [stem]
    without_collision_suffix = STORAGE_COLLISION_SUFFIX.sub("", stem)
    if without_collision_suffix != stem:
        candidate_stems.append(without_collision_suffix)

    legacy_key = _comparison_key(legacy_base)
    for candidate_stem in candidate_stems:
        if _comparison_key(f"{candidate_stem}{extension}") == legacy_key:
            return candidate_stem
    return None


def _name_from_legacy_base(legacy_base):
    lower_base = legacy_base.lower()
    for extension in KNOWN_EVENT_LOG_EXTENSIONS:
        if lower_base.endswith(extension):
            return legacy_base[: -len(extension)].rstrip("._- ")
    return None


def normalized_legacy_project_name(project_name, usernames, event_log_filename=None):
    legacy_base = _legacy_name_base(project_name, usernames)
    if legacy_base is None:
        return None

    if event_log_filename:
        base = _name_from_event_log(legacy_base, event_log_filename)
    else:
        base = _name_from_legacy_base(legacy_base)

    base = (base or "").strip()
    if not base:
        return None
    return f"{base[:92]}_project"


def normalize_legacy_project_names(apps, schema_editor):
    Project = apps.get_model("api", "Project")

    for project in Project.objects.prefetch_related("users", "event_logs"):
        usernames = project.users.values_list("username", flat=True)
        first_event_log = project.event_logs.order_by("pk").first()
        event_log_filename = first_event_log.file.name if first_event_log else None
        normalized_name = normalized_legacy_project_name(
            project.name,
            usernames,
            event_log_filename,
        )
        if normalized_name and normalized_name != project.name:
            project.name = normalized_name
            project.save(update_fields=["name"])


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0015_make_project_independent"),
    ]

    operations = [
        migrations.RunPython(normalize_legacy_project_names, migrations.RunPython.noop),
    ]
