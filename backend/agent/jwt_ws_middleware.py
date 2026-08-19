"""
JWT authentication middleware for Django Channels.

Parses the `token` query parameter from the WebSocket URL,
validates it using SimpleJWT, and attaches the User to scope["user"].
"""

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework_simplejwt.exceptions import TokenError


@database_sync_to_async
def get_user_from_token(token_string: str):
    from django.contrib.auth import get_user_model

    User = get_user_model()
    try:
        payload = AccessToken(token_string)
        user_id = payload["user_id"]
        return User.objects.get(pk=user_id)
    except (TokenError, KeyError, User.DoesNotExist):
        return None


class JWTAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        query_string = scope.get("query_string", b"").decode()
        params = parse_qs(query_string)
        token_list = params.get("token", [])

        if not token_list:
            await self._reject(send, "Missing token parameter.")
            return

        user = await get_user_from_token(token_list[0])
        if user is None:
            await self._reject(send, "Invalid or expired token.")
            return

        scope["user"] = user
        return await super().__call__(scope, receive, send)

    async def _reject(self, send, detail):
        await send({
            "type": "websocket.close",
            "code": 4001,
            "reason": detail,
        })
