"""
ASGI config for totem_backend project.

Exposes the ASGI callable as a module-level variable named ``application``.
"""

import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from agent.jwt_ws_middleware import JwtAuthMiddlewareStack
import agent.routing

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'totem_backend.settings')

django_asgi_app = get_asgi_application()

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": JwtAuthMiddlewareStack(
        URLRouter(
            agent.routing.websocket_urlpatterns
        )
    ),
})
