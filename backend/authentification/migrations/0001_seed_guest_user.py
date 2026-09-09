from django.conf import settings
from django.db import migrations
from django.contrib.auth.hashers import make_password


def seed_guest_user(apps, schema_editor):
    # Only local/desktop installs (or explicit demo deployments) get the
    # well-known Guest account. Hosted instances must create their own users.
    # The post_migrate handler in authentification/apps.py keeps the account
    # in sync on every `migrate` run, so this migration is just the initial seed.
    if not getattr(settings, 'SEED_GUEST_USER', False):
        return
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
