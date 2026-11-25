import secrets
import urllib.parse

from django.conf import settings
from django.contrib.auth.models import update_last_login
from django.core import signing
from django.http import HttpResponseRedirect
from django.urls import reverse
from django.utils.crypto import constant_time_compare
from django.views import View
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from . import oauth


class HomeView(APIView):
    permission_classes = (IsAuthenticated, )   
    
    def get(self, request):
        content = {'message': 'Welcome to the JWT Authentication page using React Js and Django!'
        }         
        return Response(content)
    
class LogoutView(APIView):     
    permission_classes = (IsAuthenticated,)     
    def post(self, request):
          
        try:               
            refresh_token = request.data["refresh_token"]               
            token = RefreshToken(refresh_token)
            token.blacklist()               
            return Response(status=status.HTTP_205_RESET_CONTENT)
        except Exception as e:
            return Response(status=status.HTTP_400_BAD_REQUEST)


# --- OAuth (GitHub / Google) login -----------------------------------------

OAUTH_STATE_SALT = 'totem.oauth.state'
OAUTH_STATE_MAX_AGE = 600  # seconds the user has to finish the consent screen
OAUTH_NONCE_COOKIE = 'totem_oauth_nonce'
DEFAULT_NEXT = '/upload'


def _safe_next(value):
    if value and value.startswith('/') and not value.startswith(('//', '/\\')):
        return value
    return DEFAULT_NEXT


def _redirect_uri(request, provider):
    path = reverse('oauth_callback', args=[provider])
    base = settings.OAUTH_REDIRECT_BASE_URL
    return f'{base}{path}' if base else request.build_absolute_uri(path)


def _frontend_error(code):
    query = urllib.parse.urlencode({'oauth_error': code})
    return HttpResponseRedirect(f'{settings.FRONTEND_URL}/login?{query}')


class LoginOptionsView(APIView):
    """What the login page should offer: the password form (DEV_LOGIN only)
    and which OAuth buttons are configured."""
    permission_classes = (AllowAny,)
    authentication_classes = ()

    def get(self, request):
        return Response({
            'password_login': settings.DEV_LOGIN,
            'providers': oauth.enabled_providers(),
        })


class OAuthLoginView(View):
    def get(self, request, provider):
        if not oauth.credentials(provider):
            return _frontend_error('provider_disabled')
        nonce = secrets.token_urlsafe(32)
        state = signing.dumps(
            {'p': provider, 'n': nonce, 'next': _safe_next(request.GET.get('next'))},
            salt=OAUTH_STATE_SALT,
        )
        response = HttpResponseRedirect(
            oauth.authorize_url(provider, _redirect_uri(request, provider), state)
        )
        # Binds the callback to this browser: a callback carrying a state that
        # was minted for someone else (login CSRF) has no matching cookie.
        response.set_cookie(
            OAUTH_NONCE_COOKIE,
            nonce,
            max_age=OAUTH_STATE_MAX_AGE,
            path='/auth/oauth/',
            httponly=True,
            secure=not settings.DEBUG,
            samesite='Lax',
        )
        return response


class OAuthCallbackView(View):
    def get(self, request, provider):
        response = self._handle(request, provider)
        response.delete_cookie(OAUTH_NONCE_COOKIE, path='/auth/oauth/')
        return response

    def _handle(self, request, provider):
        if not oauth.credentials(provider):
            return _frontend_error('provider_disabled')
        if request.GET.get('error'):
            return _frontend_error('access_denied')
        try:
            state = signing.loads(
                request.GET.get('state', ''),
                salt=OAUTH_STATE_SALT,
                max_age=OAUTH_STATE_MAX_AGE,
            )
        except signing.BadSignature:
            return _frontend_error('invalid_state')
        cookie_nonce = request.COOKIES.get(OAUTH_NONCE_COOKIE, '')
        if state.get('p') != provider or not cookie_nonce or not constant_time_compare(
            state.get('n', ''), cookie_nonce
        ):
            return _frontend_error('invalid_state')
        code = request.GET.get('code')
        if not code:
            return _frontend_error('missing_code')

        try:
            identity = oauth.fetch_identity(
                provider, code, _redirect_uri(request, provider)
            )
            user = oauth.resolve_user(provider, identity)
        except oauth.OAuthError as exc:
            return _frontend_error(exc.code)

        update_last_login(None, user)
        refresh = RefreshToken.for_user(user)
        fragment = urllib.parse.urlencode({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'next': _safe_next(state.get('next')),
        })
        return HttpResponseRedirect(f'{settings.FRONTEND_URL}/oauth/callback#{fragment}')
