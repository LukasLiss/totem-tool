from django.db import migrations
from django.contrib.auth.hashers import make_password


def seed_guest_user(apps, schema_editor):
    User = apps.get_model('auth', 'User')
    guest, _ = User.objects.get_or_create(
        username='Guest',
        defaults={
            'email': 'guest@local.host',
            'is_staff': False,
            'is_superuser': False,
            'is_active': True,
        },
    )
    # Always reset the password so the Guest account stays usable for local-mode
    # auto-login even if a previous run created it with a different password.
    guest.password = make_password('guest')
    guest.is_active = True
    guest.save()


def remove_guest_user(apps, schema_editor):
    User = apps.get_model('auth', 'User')
    User.objects.filter(username='Guest').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('auth', '0012_alter_user_first_name_max_length'),
    ]

    operations = [
        migrations.RunPython(seed_guest_user, remove_guest_user),
    ]
