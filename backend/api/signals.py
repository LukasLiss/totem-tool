import glob
import os

from django.db.models.signals import post_delete
from django.dispatch import receiver
from .models import EventLog, OcelEditorSession


@receiver(post_delete, sender=EventLog)
def delete_eventlog_file(sender, instance, **kwargs):
    """Automatically delete file from filesystem when EventLog is deleted."""
    if instance.file:
        instance.file.delete(save=False)

    # Cache invalidation is handled by versioned keys (see cache_utils.make_cache_key):
    # a deleted log's PK is never reused, so its cached entries can never be served
    # again and are reclaimed by MAX_ENTRIES culling. No explicit purge needed.

    # Evict the DuckDB connection from the process-local registry so stale
    # handles don't linger after the underlying file is gone.
    from .views import _OCEL_DB_REGISTRY, _OCEL_DB_LOCKS, _OCEL_DB_REGISTRY_LOCK
    pk = int(instance.pk)
    with _OCEL_DB_REGISTRY_LOCK:
        db = _OCEL_DB_REGISTRY.pop(pk, None)
        _OCEL_DB_LOCKS.pop(pk, None)
    if db is not None:
        try:
            db.conn.close()
        except Exception:
            pass


@receiver(post_delete, sender=OcelEditorSession)
def delete_editor_session_files(sender, instance, **kwargs):
    """Remove the working copy (and any export scratch files) of a session."""
    pattern = os.path.join(instance.working_dir, f"{instance.id}*")
    for path in glob.glob(pattern):
        try:
            os.remove(path)
        except OSError:
            pass
