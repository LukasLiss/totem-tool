"""
JWT WebSocket Authentication Middleware for Django Channels.

Authenticates incoming WebSocket connections using SimpleJWT access tokens passed
via query string (?token=... or ?access_token=...), Authorization header
(Authorization: Bearer ...), or Sec-WebSocket-Protocol.
Also parses and attaches session_id to scope.
"""

from urllib.parse import parse_qs
import uuid
import logging
from django.contrib.auth.models import AnonymousUser
from django.contrib.auth import get_user_model
from channels.db import database_sync_to_async
from channels.auth import AuthMiddlewareStack
from rest_framework_simplejwt.tokens import AccessToken, UntypedToken
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError

logger = logging.getLogger(__name__)


@database_sync_to_async
def get_user_from_jwt(token_str: str):
    """
    Validate SimpleJWT access token and return the associated Django User.
    Returns AnonymousUser if the token is missing, expired, or invalid.
    """
    if not token_str:
        return AnonymousUser()
    User = get_user_model()
    try:
        token = AccessToken(token_str)
        user_id = token.get("user_id")
        if not user_id:
            return AnonymousUser()
        return User.objects.get(id=user_id)
    except (InvalidToken, TokenError, User.DoesNotExist, Exception) as exc:
        logger.debug("JWT WebSocket authentication failed: %s", exc)
        return AnonymousUser()


class JwtAuthMiddleware:
    """
    ASGI middleware that authenticates WebSocket requests with JWT tokens and
    attaches user and session_id to scope.
    """

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "websocket":
            query_string = scope.get("query_string", b"").decode("utf-8")
            query_params = parse_qs(query_string)

            headers = dict(scope.get("headers", []))
            auth_header = headers.get(b"authorization", b"").decode("utf-8")

            # 1. Extract Token
            token = None
            if "token" in query_params and query_params["token"]:
                token = query_params["token"][0]
            elif "access_token" in query_params and query_params["access_token"]:
                token = query_params["access_token"][0]
            elif auth_header.startswith("Bearer "):
                token = auth_header[7:].strip()
            elif b"sec-websocket-protocol" in headers:
                proto = headers[b"sec-websocket-protocol"].decode("utf-8")
                parts = [p.strip() for p in proto.split(",") if p.strip()]
                if len(parts) >= 2 and parts[0] == "Bearer":
                    token = parts[1]
                elif len(parts) == 1 and not parts[0].startswith("totem"):
                    token = parts[0]

            # 2. Extract or generate session_id
            session_id = None
            if "session_id" in query_params and query_params["session_id"]:
                session_id = query_params["session_id"][0]
            elif "sessionId" in query_params and query_params["sessionId"]:
                session_id = query_params["sessionId"][0]
            elif b"x-session-id" in headers and headers[b"x-session-id"].decode("utf-8"):
                session_id = headers[b"x-session-id"].decode("utf-8")

            if not session_id:
                session_id = f"sess_{uuid.uuid4().hex[:12]}"

            scope["session_id"] = session_id

            # 3. Resolve User
            if token:
                user = await get_user_from_jwt(token)
                scope["user"] = user
            elif "user" not in scope or scope["user"] is None:
                scope["user"] = AnonymousUser()

        return await self.inner(scope, receive, send)


def JwtAuthMiddlewareStack(inner):
    """
    Convenience helper wrapping inner application with AuthMiddlewareStack and JwtAuthMiddleware.
    """
    return AuthMiddlewareStack(JwtAuthMiddleware(inner))
