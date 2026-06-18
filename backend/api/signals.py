from django.db.models.signals import post_delete
from django.dispatch import receiver
from .models import EventLog


@receiver(post_delete, sender=EventLog)
def delete_eventlog_file(sender, instance, **kwargs):
    """Automatically delete file from filesystem when EventLog is deleted."""
    if instance.file:
        instance.file.delete(save=False)

    # --- Cache invalidation (#75) ---
    from .cache_utils import invalidate_log_cache
    invalidate_log_cache(instance.pk)

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
