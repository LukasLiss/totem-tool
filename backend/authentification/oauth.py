"""OAuth 2.0 authorization-code login with GitHub and Google.

Flow (all browser redirects, no session needed):

1. The frontend sends the browser to ``/auth/oauth/<provider>/login/``.
   set a random nonce in an HttpOnly cookie, sign it into ``state`` and
   redirect to the provider's consent screen.
2. The provider redirects back to ``/auth/oauth/<provider>/callback/``.
   check ``state`` against the cookie (login-CSRF protection), swap the
   code for an access token server-side, and read the user's identity.
3. find or create the Django user and hand the frontend a normal
   SimpleJWT access/refresh pair in the URL fragment of
   ``<FRONTEND_URL>/oauth/callback``. Fragments never reach a server or a
   Referer header, and the frontend strips it from history immediately.

Client ids/secrets come from settings.OAUTH_PROVIDERS; a provider without
both is reported as disabled and its endpoints return an error.
"""

import json
import logging
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

try:
    import certifi
except ImportError:
    certifi = None

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction

from .models import SocialAccount

HTTP_TIMEOUT_SECONDS = 10

logger = logging.getLogger(__name__)

# The python.org macOS builds ship without trusted CA certificates (until
# "Install Certificates.command" is run), so every HTTPS call to a provider
# fails verification. certifi's bundle works the same on every platform.
_SSL_CONTEXT = ssl.create_default_context(
    cafile=certifi.where() if certifi else None
)


class OAuthError(Exception):

    def __init__(self, code, detail=''):
        super().__init__(detail or code)
        self.code = code


@dataclass(frozen=True)
class Provider:
    name: str
    authorize_url: str
    token_url: str
    scope: str


PROVIDERS = {
    'github': Provider(
        name='github',
        authorize_url='https://github.com/login/oauth/authorize',
        token_url='https://github.com/login/oauth/access_token',
        scope='read:user user:email',
    ),
    'google': Provider(
        name='google',
        authorize_url='https://accounts.google.com/o/oauth2/v2/auth',
        token_url='https://oauth2.googleapis.com/token',
        scope='openid email profile',
    ),
}


@dataclass(frozen=True)
class Identity:
    uid: str
    email: str
    username_hint: str
    first_name: str = ''
    last_name: str = ''


def credentials(provider_name):
    """(client_id, client_secret) for a configured provider, else None."""
    if provider_name not in PROVIDERS:
        return None
    conf = getattr(settings, 'OAUTH_PROVIDERS', {}).get(provider_name) or {}
    client_id = conf.get('client_id')
    client_secret = conf.get('client_secret')
    if not client_id or not client_secret:
        return None
    return client_id, client_secret


def enabled_providers():
    return [name for name in PROVIDERS if credentials(name)]


def authorize_url(provider_name, redirect_uri, state):
    provider = PROVIDERS[provider_name]
    client_id, _ = credentials(provider_name)
    params = {
        'client_id': client_id,
        'redirect_uri': redirect_uri,
        'response_type': 'code',
        'scope': provider.scope,
        'state': state,
    }
    if provider_name == 'google':
        params['prompt'] = 'select_account'
    return f'{provider.authorize_url}?{urllib.parse.urlencode(params)}'


# --- HTTP helpers -----------------------------------------------------------

def _request_json(url, data=None, token=None):
    headers = {'Accept': 'application/json', 'User-Agent': 'totem-tool'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers)
    try:
        with urllib.request.urlopen(
            req, timeout=HTTP_TIMEOUT_SECONDS, context=_SSL_CONTEXT
        ) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        # The provider answered, but refused (e.g. Google's 400 for a wrong
        # redirect_uri or secret). Must come before URLError, its base class,
        # so misconfiguration isn't reported as the provider being down.
        detail = _error_detail(exc)
        logger.warning('OAuth request to %s failed: HTTP %s %s', url, exc.code, detail)
        raise OAuthError('provider_error', detail) from exc
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        logger.warning('OAuth request to %s failed: %s', url, exc)
        raise OAuthError('provider_unreachable', str(exc)) from exc


def _error_detail(exc):
    try:
        payload = json.loads(exc.read().decode())
    except (OSError, ValueError):
        return exc.reason or ''
    if not isinstance(payload, dict):
        return ''
    return str(
        payload.get('error_description')
        or payload.get('error')
        or payload.get('message')
        or ''
    )


def _exchange_code(provider_name, code, redirect_uri):
    client_id, client_secret = credentials(provider_name)
    try:
        payload = _request_json(
            PROVIDERS[provider_name].token_url,
            data={
                'client_id': client_id,
                'client_secret': client_secret,
                'code': code,
                'redirect_uri': redirect_uri,
                'grant_type': 'authorization_code',
            },
        )
    except OAuthError as exc:
        if exc.code != 'provider_error':
            raise
        raise OAuthError('token_exchange_failed', str(exc)) from exc
    token = payload.get('access_token')
    if not token:
        # GitHub reports failures as HTTP 200 with an `error` field.
        detail = str(payload.get('error_description') or payload.get('error') or '')
        logger.warning('OAuth token exchange with %s failed: %s', provider_name, detail)
        raise OAuthError('token_exchange_failed', detail)
    return token


# --- Identity lookup --------------------------------------------------------

def _github_identity(token):
    user = _request_json('https://api.github.com/user', token=token)
    emails = _request_json('https://api.github.com/user/emails', token=token)
    verified = [e for e in emails if isinstance(e, dict) and e.get('verified')]
    primary = next((e for e in verified if e.get('primary')), None) or (
        verified[0] if verified else None
    )
    if not primary:
        raise OAuthError('no_verified_email')
    first, _, last = (user.get('name') or '').partition(' ')
    return Identity(
        uid=str(user['id']),
        email=primary['email'],
        username_hint=user.get('login') or primary['email'].split('@')[0],
        first_name=first,
        last_name=last,
    )


def _google_identity(token):
    info = _request_json(
        'https://openidconnect.googleapis.com/v1/userinfo', token=token
    )
    if not info.get('email') or not info.get('email_verified'):
        raise OAuthError('no_verified_email')
    return Identity(
        uid=str(info['sub']),
        email=info['email'],
        username_hint=info['email'].split('@')[0],
        first_name=info.get('given_name', ''),
        last_name=info.get('family_name', ''),
    )


_IDENTITY_FETCHERS = {'github': _github_identity, 'google': _google_identity}


def fetch_identity(provider_name, code, redirect_uri):
    token = _exchange_code(provider_name, code, redirect_uri)
    try:
        return _IDENTITY_FETCHERS[provider_name](token)
    except KeyError as exc:
        raise OAuthError('bad_provider_response', str(exc)) from exc


# --- User resolution --------------------------------------------------------

def _unique_username(hint):
    User = get_user_model()
    max_len = User._meta.get_field('username').max_length
    base = re.sub(r'[^\w.@+-]', '', hint)[: max_len - 6] or 'user'
    candidate, n = base, 1
    while User.objects.filter(username__iexact=candidate).exists():
        n += 1
        candidate = f'{base}{n}'
    return candidate


@transaction.atomic
def resolve_user(provider_name, identity):
    """Return the user for this identity, linking or creating as needed.

    Order: an existing link for (provider, uid) → an existing user with the
    same (provider-verified) email, which is then linked → a new user.
    """
    User = get_user_model()
    account = (
        SocialAccount.objects.select_related('user')
        .filter(provider=provider_name, uid=identity.uid)
        .first()
    )
    if account:
        user = account.user
    else:
        matches = list(User.objects.filter(email__iexact=identity.email)[:2])
        if len(matches) > 1:
            raise OAuthError('ambiguous_email')
        if matches:
            user = matches[0]
        else:
            user = User(
                username=_unique_username(identity.username_hint),
                email=identity.email,
                first_name=identity.first_name[:150],
                last_name=identity.last_name[:150],
            )
            user.set_unusable_password()
            user.save()
        SocialAccount.objects.create(
            user=user, provider=provider_name, uid=identity.uid
        )
    if not user.is_active:
        raise OAuthError('inactive_account')
    return user
