from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework.routers import DefaultRouter
from .views import UserFileViewSet, greeting, variants

router = DefaultRouter()
router.register(r'files', UserFileViewSet, basename="userfile")

urlpatterns = [
    path('greeting/', greeting, name='greeting'),
    path("", include(router.urls)),
    path("variants", variants),
]