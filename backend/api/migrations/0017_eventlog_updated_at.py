from django.db import migrations, models


def initialize_updated_at(apps, schema_editor):
    EventLog = apps.get_model("api", "EventLog")
    for event_log in EventLog.objects.only("pk", "uploaded_at"):
        event_log.updated_at = event_log.uploaded_at
        event_log.save(update_fields=["updated_at"])


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0016_normalize_legacy_project_names"),
    ]

    operations = [
        migrations.AddField(
            model_name="eventlog",
            name="updated_at",
            field=models.DateTimeField(null=True),
        ),
        migrations.RunPython(initialize_updated_at, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="eventlog",
            name="updated_at",
            field=models.DateTimeField(auto_now=True),
        ),
    ]
