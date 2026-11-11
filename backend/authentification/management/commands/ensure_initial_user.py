import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = (
        'Create or update the password-login account given by the '
        'TOTEM_USER_EMAIL / TOTEM_USER_PASSWORD environment variables '
        '(TOTEM_USER_USERNAME optional, defaults to the email). Does nothing '
        'when they are unset. Used by the Docker entrypoint on every start, '
        'so the environment stays the source of truth for the password.'
    )

    def handle(self, *args, **options):
        email = os.environ.get('TOTEM_USER_EMAIL', '').strip()
        password = os.environ.get('TOTEM_USER_PASSWORD', '')
        if not email and not password:
            return
        if not email or not password:
            raise CommandError('Set both TOTEM_USER_EMAIL and TOTEM_USER_PASSWORD, or neither.')
        username = os.environ.get('TOTEM_USER_USERNAME', '').strip() or email

        User = get_user_model()
        user = User.objects.filter(username=username).first()
        created = user is None
        if created:
            user = User(username=username)
        user.email = email
        user.is_active = True
        user.set_password(password)
        user.save()
        self.stdout.write(
            f"{'Created' if created else 'Updated'} login account '{username}' ({email})."
        )
