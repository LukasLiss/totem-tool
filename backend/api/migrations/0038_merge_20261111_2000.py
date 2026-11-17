# Merge of the design-cleanup branch (chart/point style fields) with main.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0036_resourceprofiling_point_style"),
        ("api", "0037_process_area_compositions"),
    ]

    operations = []
