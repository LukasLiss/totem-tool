from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend


class EmailOrUsernameBackend(ModelBackend):
    """Password login that accepts the email address in the username field.

    The username wins when both could match. An email shared by several
    accounts is refused rather than guessed.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        user = super().authenticate(request, username=username, password=password, **kwargs)
        if user is not None or not username or '@' not in username:
            return user
        User = get_user_model()
        matches = list(User.objects.filter(email__iexact=username)[:2])
        if len(matches) != 1:
            # Same work as a real check, so a miss is not faster than a hit.
            User().set_password(password)
            return None
        candidate = matches[0]
        if candidate.check_password(password) and self.user_can_authenticate(candidate):
            return candidate
        return None
