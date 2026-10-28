import io
import urllib.error
import urllib.parse
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import signing
from django.test import TestCase, override_settings

from . import oauth
from .models import SocialAccount
from .views import OAUTH_NONCE_COOKIE, OAUTH_STATE_SALT

User = get_user_model()

OAUTH_SETTINGS = {
    'OAUTH_PROVIDERS': {
        'github': {'client_id': 'gh-id', 'client_secret': 'gh-secret'},
        'google': {'client_id': '', 'client_secret': ''},
    },
    'FRONTEND_URL': 'http://frontend.test',
    'OAUTH_REDIRECT_BASE_URL': '',
}

IDENTITY = oauth.Identity(
    uid='42', email='octo@example.com', username_hint='octocat',
    first_name='Octo', last_name='Cat',
)


@override_settings(**OAUTH_SETTINGS)
class OAuthFlowTests(TestCase):
    def _start(self, next_path='/overview'):
        resp = self.client.get('/auth/oauth/github/login/', {'next': next_path})
        self.assertEqual(resp.status_code, 302)
        query = urllib.parse.parse_qs(urllib.parse.urlparse(resp['Location']).query)
        return query['state'][0], query

    def _callback(self, state, code='abc'):
        return self.client.get(
            '/auth/oauth/github/callback/', {'state': state, 'code': code}
        )

    def _fragment(self, resp):
        self.assertEqual(resp.status_code, 302)
        location = resp['Location']
        self.assertTrue(location.startswith('http://frontend.test/oauth/callback#'))
        return urllib.parse.parse_qs(location.split('#', 1)[1])

    def _error(self, resp):
        self.assertEqual(resp.status_code, 302)
        parsed = urllib.parse.urlparse(resp['Location'])
        self.assertEqual(parsed.path, '/login')
        return urllib.parse.parse_qs(parsed.query)['oauth_error'][0]

    def test_login_options_follow_dev_login_and_configured_providers(self):
        for dev_login in (False, True):
            with self.subTest(DEV_LOGIN=dev_login), override_settings(DEV_LOGIN=dev_login):
                resp = self.client.get('/auth/login-options/')
                self.assertEqual(resp.status_code, 200)
                self.assertEqual(
                    resp.json(), {'password_login': dev_login, 'providers': ['github']}
                )

    def test_login_redirects_to_provider_with_callback(self):
        _, query = self._start()
        self.assertEqual(query['client_id'], ['gh-id'])
        self.assertEqual(
            query['redirect_uri'], ['http://testserver/auth/oauth/github/callback/']
        )
        self.assertIn(OAUTH_NONCE_COOKIE, self.client.cookies)

    @mock.patch.object(oauth, 'fetch_identity', return_value=IDENTITY)
    def test_new_user_is_created_and_receives_tokens(self, _):
        state, _ = self._start('/overview')
        params = self._fragment(self._callback(state))
        self.assertIn('access', params)
        self.assertIn('refresh', params)
        self.assertEqual(params['next'], ['/overview'])

        user = User.objects.get(email='octo@example.com')
        self.assertEqual(user.username, 'octocat')
        self.assertFalse(user.has_usable_password())
        self.assertTrue(
            SocialAccount.objects.filter(user=user, provider='github', uid='42').exists()
        )

    @mock.patch.object(oauth, 'fetch_identity', return_value=IDENTITY)
    def test_existing_user_with_same_email_is_linked(self, _):
        existing = User.objects.create_user('lukas', 'OCTO@example.com', 'pw')
        state, _ = self._start()
        self._fragment(self._callback(state))
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(SocialAccount.objects.get().user, existing)

    @mock.patch.object(oauth, 'fetch_identity', return_value=IDENTITY)
    def test_returning_user_matched_by_uid_not_email(self, _):
        user = User.objects.create_user('someone', 'old@example.com')
        SocialAccount.objects.create(user=user, provider='github', uid='42')
        state, _ = self._start()
        self._fragment(self._callback(state))
        self.assertEqual(User.objects.count(), 1)

    @mock.patch.object(oauth, 'fetch_identity', return_value=IDENTITY)
    def test_username_collision_gets_suffix(self, _):
        User.objects.create_user('octocat', 'other@example.com')
        state, _ = self._start()
        self._fragment(self._callback(state))
        self.assertTrue(User.objects.filter(username='octocat2').exists())

    @mock.patch.object(oauth, 'fetch_identity', return_value=IDENTITY)
    def test_inactive_user_is_refused(self, _):
        User.objects.create_user('octocat', 'octo@example.com', is_active=False)
        state, _ = self._start()
        self.assertEqual(self._error(self._callback(state)), 'inactive_account')

    @mock.patch.object(oauth, 'fetch_identity')
    def test_state_without_matching_cookie_is_refused(self, fetch):
        forged = signing.dumps(
            {'p': 'github', 'n': 'attacker-nonce', 'next': '/upload'},
            salt=OAUTH_STATE_SALT,
        )
        self._start()
        self.assertEqual(self._error(self._callback(forged)), 'invalid_state')
        fetch.assert_not_called()

    @mock.patch.object(oauth, 'fetch_identity', return_value=IDENTITY)
    def test_offsite_next_is_replaced(self, _):
        state, _ = self._start('//evil.example/steal')
        params = self._fragment(self._callback(state))
        self.assertEqual(params['next'], ['/upload'])


@override_settings(**OAUTH_SETTINGS)
class GitHubIdentityTests(TestCase):
    def _fake(self, emails):
        def request_json(url, data=None, token=None):
            if url.endswith('/user'):
                return {'id': 7, 'login': 'octo', 'name': 'Octo Cat'}
            return emails
        return request_json

    def test_uses_primary_verified_email(self):
        emails = [
            {'email': 'a@x.com', 'verified': True, 'primary': False},
            {'email': 'b@x.com', 'verified': True, 'primary': True},
        ]
        with mock.patch.object(oauth, '_request_json', self._fake(emails)):
            ident = oauth._github_identity('t')
        self.assertEqual((ident.uid, ident.email), ('7', 'b@x.com'))

    def test_unverified_only_is_refused(self):
        emails = [{'email': 'a@x.com', 'verified': False, 'primary': True}]
        with (
            mock.patch.object(oauth, '_request_json', self._fake(emails)),
            self.assertRaises(oauth.OAuthError) as ctx,
        ):
            oauth._github_identity('t')
        self.assertEqual(ctx.exception.code, 'no_verified_email')


@override_settings(**OAUTH_SETTINGS)
class ProviderErrorTests(TestCase):
    def _http_error(self, status, body):
        return urllib.error.HTTPError(
            'https://provider.test', status, 'Bad Request', {}, io.BytesIO(body)
        )

    def test_rejected_token_exchange_is_not_reported_as_unreachable(self):
        err = self._http_error(400, b'{"error": "redirect_uri_mismatch"}')
        with (
            mock.patch('urllib.request.urlopen', side_effect=err),
            self.assertLogs('authentification.oauth', 'WARNING'),
            self.assertRaises(oauth.OAuthError) as ctx,
        ):
            oauth._exchange_code('github', 'code', 'http://testserver/cb')
        self.assertEqual(ctx.exception.code, 'token_exchange_failed')
        self.assertIn('redirect_uri_mismatch', str(ctx.exception))

    def test_github_200_error_payload_is_token_exchange_failure(self):
        with (
            mock.patch.object(
                oauth, '_request_json', return_value={'error': 'bad_verification_code'}
            ),
            self.assertLogs('authentification.oauth', 'WARNING'),
            self.assertRaises(oauth.OAuthError) as ctx,
        ):
            oauth._exchange_code('github', 'code', 'http://testserver/cb')
        self.assertEqual(ctx.exception.code, 'token_exchange_failed')

    def test_rejected_api_call_is_provider_error(self):
        err = self._http_error(403, b'{"message": "Resource not accessible"}')
        with (
            mock.patch('urllib.request.urlopen', side_effect=err),
            self.assertLogs('authentification.oauth', 'WARNING'),
            self.assertRaises(oauth.OAuthError) as ctx,
        ):
            oauth._request_json('https://api.github.com/user/emails', token='t')
        self.assertEqual(ctx.exception.code, 'provider_error')

    def test_network_failure_is_still_unreachable(self):
        err = urllib.error.URLError('connection refused')
        with (
            mock.patch('urllib.request.urlopen', side_effect=err),
            self.assertLogs('authentification.oauth', 'WARNING'),
            self.assertRaises(oauth.OAuthError) as ctx,
        ):
            oauth._request_json('https://api.github.com/user', token='t')
        self.assertEqual(ctx.exception.code, 'provider_unreachable')
