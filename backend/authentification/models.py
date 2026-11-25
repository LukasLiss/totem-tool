from django.conf import settings
from django.db import models


class SocialAccount(models.Model):
    """Links a Django user to an identity at an OAuth provider (GitHub, Google).

    Users are looked up by the provider's stable account id (`uid`), not by
    email, so a user who changes the email on their GitHub/Google account
    still lands in the same TOTeM account.
    """

    PROVIDER_CHOICES = [
        ('github', 'GitHub'),
        ('google', 'Google'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='social_accounts',
    )
    provider = models.CharField(max_length=32, choices=PROVIDER_CHOICES)
    uid = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['provider', 'uid'], name='unique_social_account'
            ),
        ]

    def __str__(self):
        return f'{self.provider}:{self.uid} -> {self.user}'
