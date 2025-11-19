from django.db.models.signals import post_delete
from django.dispatch import receiver
from .models import EventLog

@receiver(post_delete, sender=EventLog)
def delete_eventlog_file(sender, instance, **kwargs):
    """Automatically delete file from filesystem when EventLog is deleted."""
    if instance.file:
        instance.file.delete(save=False)
