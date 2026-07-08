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


@receiver(post_delete, sender=OcelEditorSession)
def delete_editor_session_files(sender, instance, **kwargs):
    """Remove the working copy (and any export scratch files) of a session."""
    pattern = os.path.join(instance.working_dir, f"{instance.id}*")
    for path in glob.glob(pattern):
        try:
            os.remove(path)
        except OSError:
            pass
