from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework.routers import DefaultRouter
from .views import EventLogViewSet, greeting, variants, DashboardViewSet, delete_user_data, OCDFGViewSet, health_check, run_simulation, simulation_graph_edit_distance, get_process_areas, get_simulation_details, get_resource_calendars

router = DefaultRouter()
router.register(r'files', EventLogViewSet, basename="userfile")
router.register(r'dashboard', DashboardViewSet, basename="dashboard")

urlpatterns = [
    path('health-check/', health_check, name='health-check'),
    path('greeting/', greeting, name='greeting'),
    path('ocdfg/', OCDFGViewSet, name='ocdfg'),
    path("", include(router.urls)),
    path("variants/", variants, name="variants"),
    path("simulation/run/", run_simulation, name="run_simulation"),
    path("simulation/graph-edit-distance/", simulation_graph_edit_distance, name="simulation_graph_edit_distance"),
    path("simulation/process-areas/", get_process_areas, name="get_process_areas"),
    path("simulation/details/", get_simulation_details, name="get_simulation_details"),
    path("simulation/resource-calendars/", get_resource_calendars, name="get_resource_calendars"),
    path("delete-data/", delete_user_data, name="delete_user_data"),
]
