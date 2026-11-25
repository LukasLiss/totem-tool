from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0033_seedstate"),
    ]

    operations = [
        migrations.AddField(
            model_name="variantscomponent",
            name="variants_mode",
            field=models.CharField(blank=True, default="process_areas", max_length=32),
        ),
        migrations.AddField(
            model_name="variantscomponent",
            name="area_execution_column",
            field=models.CharField(
                blank=True, default="process-executions-cc-process-areas", max_length=64
            ),
        ),
        migrations.AddField(
            model_name="variantscomponent",
            name="area_variant_column",
            field=models.CharField(blank=True, default="variant-cc-process-areas", max_length=64),
        ),
    ]
