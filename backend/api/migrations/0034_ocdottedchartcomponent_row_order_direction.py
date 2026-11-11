from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0033_seedstate'),
    ]

    operations = [
        migrations.AddField(
            model_name='ocdottedchartcomponent',
            name='row_order_direction',
            field=models.CharField(default='asc', max_length=4),
        ),
    ]
