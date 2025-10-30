from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework.routers import DefaultRouter
from .views import EventLogViewSet, greeting, DashboardViewSet, OCDFGViewSet, discover_totem_mock

router = DefaultRouter()
router.register(r'files', EventLogViewSet, basename="userfile")
router.register(r'dashboard', DashboardViewSet, basename="dashboard")

urlpatterns = [
    path('greeting/', greeting, name='greeting'),
    path('ocdfg/', OCDFGViewSet, name='ocdfg'),
    path('eventlogs/<int:pk>/discover_totem/', discover_totem_mock, name='eventlog-discover-totem'),
    path("", include(router.urls)),
    #path("variants/", variants, name="variants"),
]
