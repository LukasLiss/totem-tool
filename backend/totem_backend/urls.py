"""
URL configuration for totem_backend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
import os
from pathlib import Path

from django.contrib import admin
from django.http import FileResponse, Http404
from django.urls import path, include, re_path
from django.views.static import serve
from rest_framework.throttling import AnonRateThrottle
from rest_framework_simplejwt import views as jwt_views
from django.conf import settings
from django.conf.urls.static import static

class LoginRateThrottle(AnonRateThrottle):
    scope = 'login'


class ThrottledTokenObtainPairView(jwt_views.TokenObtainPairView):
    throttle_classes = [LoginRateThrottle]


class ThrottledTokenRefreshView(jwt_views.TokenRefreshView):
    throttle_classes = [LoginRateThrottle]


urlpatterns = [
    path('api/', include('api.urls')),
    path('token/', ThrottledTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('token/refresh/', ThrottledTokenRefreshView.as_view(), name='token_refresh'),
    path('', include('authentification.urls')),
]

# The Django admin is only mounted for development, the desktop app, or when
# explicitly enabled — a public instance should not expose it by default.
if settings.DEBUG or settings.LOCAL_MODE or os.environ.get('ENABLE_ADMIN') == '1':
    urlpatterns.insert(0, path('admin/', admin.site.urls))
# Uploaded files (image assets etc.) are served by Django itself in
# development and in the local desktop app, where there is no reverse proxy.
# `static()` is a no-op unless DEBUG, so the desktop build (DEBUG=0,
# LOCAL_MODE=1) mounts the same view explicitly.
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
elif settings.LOCAL_MODE:
    urlpatterns += [
        re_path(
            rf"^{settings.MEDIA_URL.lstrip('/')}(?P<path>.*)$",
            serve,
            {"document_root": settings.MEDIA_ROOT},
        )
    ]
elif settings.FRONTEND_DIST_DIR:
    # Self-contained server (Docker image): no proxy serves MEDIA_ROOT either.
    # MEDIA_ROOT also holds uploaded event logs, so only images are exposed,
    # and the sandbox CSP keeps an uploaded SVG from running script on the
    # app's origin when opened directly.
    def media_image(request, path):
        if not path.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg')):
            raise Http404()
        response = serve(request, path, document_root=settings.MEDIA_ROOT)
        response['Content-Security-Policy'] = 'sandbox'
        response['X-Content-Type-Options'] = 'nosniff'
        return response

    urlpatterns += [
        re_path(rf"^{settings.MEDIA_URL.lstrip('/')}(?P<path>.*)$", media_image),
    ]

# Built frontend (Docker image): hand index.html to every path the API does
# not own, so client-side routes like /upload survive a reload. Must stay last.
if settings.FRONTEND_DIST_DIR:
    def frontend_index(request):
        index = Path(settings.FRONTEND_DIST_DIR) / 'index.html'
        if not index.is_file():
            raise Http404('Frontend build not found.')
        response = FileResponse(index.open('rb'), content_type='text/html')
        response['Cache-Control'] = 'no-cache'
        return response

    urlpatterns += [
        re_path(r'^(?!(?:api|token|auth|admin|static|files)/).*$', frontend_index),
    ]
