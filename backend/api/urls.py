from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework.routers import DefaultRouter
from .views import EventLogViewSet, greeting, variants, DashboardViewSet, delete_user_data, OCDFGViewSet, health_check, ochandover, profile_matrix, event_log_table

router = DefaultRouter()
router.register(r'files', EventLogViewSet, basename="userfile")
router.register(r'dashboard', DashboardViewSet, basename="dashboard")

urlpatterns = [
    path('health-check/', health_check, name='health-check'),
    path('greeting/', greeting, name='greeting'),
    path('ocdfg/', OCDFGViewSet, name='ocdfg'),
    path("", include(router.urls)),
    path("variants/", variants, name="variants"),
    path("handover/", ochandover, name="handover"),
    path("profile-matrix/", profile_matrix, name="profile_matrix"),
    path("event-log/", event_log_table, name="event_log_table"),
    path("delete-data/", delete_user_data, name="delete_user_data"),
]
