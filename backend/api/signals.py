from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver
from .models import EventLog
from .cache import result_cache


@receiver(post_delete, sender=EventLog)
def delete_eventlog_file(sender, instance, **kwargs):
    """Automatically delete file from filesystem when EventLog is deleted."""
    if instance.file:
        instance.file.delete(save=False)
    # Invalidate all cached results for this file
    result_cache.invalidate_file(instance.pk)


@receiver(post_save, sender=EventLog)
def invalidate_eventlog_cache(sender, instance, **kwargs):
    """Invalidate cached results when an EventLog is re-saved (e.g. file re-upload)."""
    result_cache.invalidate_file(instance.pk)
