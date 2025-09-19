from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework.routers import DefaultRouter
from .views import EventLogViewSet, greeting

router = DefaultRouter()
router.register(r'files', EventLogViewSet, basename="userfile")

urlpatterns = [
    path('greeting/', greeting, name='greeting'),
    path("", include(router.urls)),
]