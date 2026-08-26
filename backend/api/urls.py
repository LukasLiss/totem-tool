from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework.routers import DefaultRouter
from .views import EventLogViewSet, ProjectAssetViewSet, greeting, variants, DashboardViewSet, delete_user_data, OCDFGViewSet, NewOCDFGViewSet, OCCNViewSet, health_check, playout, playout_export_ocel, cache_stats, cache_clear, user_settings

router = DefaultRouter()
router.register(r'files', EventLogViewSet, basename="userfile")
router.register(r'assets', ProjectAssetViewSet, basename="projectasset")
router.register(r'dashboard', DashboardViewSet, basename="dashboard")

urlpatterns = [
    path('health-check/', health_check, name='health-check'),
    path('greeting/', greeting, name='greeting'),
    path('ocdfg/', OCDFGViewSet, name='ocdfg'),
    path('new-ocdfg/', NewOCDFGViewSet, name='new-ocdfg'),
    path('occn/', OCCNViewSet, name='occn'),
    path("", include(router.urls)),
    path("variants/", variants, name="variants"),
    path("playout/", playout, name="playout"),
    path("playout/export-ocel/", playout_export_ocel, name="playout-export-ocel"),
    path("delete-data/", delete_user_data, name="delete_user_data"),
    path("cache/stats/", cache_stats, name="cache-stats"),
    path("cache/clear/", cache_clear, name="cache-clear"),
    path("settings/", user_settings, name="user-settings"),
]

