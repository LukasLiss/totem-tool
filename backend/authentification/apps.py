from django.apps import AppConfig
from django.conf import settings
from django.db.models.signals import post_migrate


def ensure_guest_user(sender, **kwargs):
    """Create/refresh the local Guest account after every `migrate`.

    Runs only when SEED_GUEST_USER is on (LOCAL_MODE, or SEED_GUEST_USER=1).
    The desktop app runs `migrate` on every launch, so an install whose
    database was first migrated without LOCAL_MODE still gets the account.
    The account is deliberately a plain user — never staff/superuser.
    """
    if not getattr(settings, 'SEED_GUEST_USER', False):
        return
    from django.contrib.auth import get_user_model

    User = get_user_model()
    guest, _ = User.objects.get_or_create(
        username=settings.LOCAL_GUEST_USERNAME,
        defaults={'email': 'guest@local.host', 'is_active': True},
    )
    guest.set_password(settings.LOCAL_GUEST_PASSWORD)
    guest.is_active = True
    guest.is_staff = False
    guest.is_superuser = False
    guest.save()


class AuthentificationConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'authentification'

    def ready(self):
        post_migrate.connect(ensure_guest_user, sender=self, dispatch_uid='seed-local-guest')
