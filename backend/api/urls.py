from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework.routers import DefaultRouter
from .views import EventLogViewSet, greeting, variants, DashboardViewSet, health_check

router = DefaultRouter()
router.register(r'files', EventLogViewSet, basename="userfile")
router.register(r'dashboard', DashboardViewSet, basename="dashboard")

urlpatterns = [
    path('health-check/', health_check, name='health-check'),
    path('greeting/', greeting, name='greeting'),
    path("", include(router.urls)),
    path("variants/", variants, name="variants"),
]
