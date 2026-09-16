from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from rest_framework.routers import DefaultRouter
from .views import EventLogViewSet, ImageAssetViewSet, ProjectAssetViewSet, greeting, variants, DashboardViewSet, delete_user_data, OCDFGViewSet, NewOCDFGViewSet, OCCNViewSet, health_check, playout, playout_export_ocel, cache_stats, cache_clear, user_settings
from . import views_ocel_editor
from . import views_process_executions

router = DefaultRouter()
router.register(r'files', EventLogViewSet, basename="userfile")
router.register(r'assets', ProjectAssetViewSet, basename="projectasset")
router.register(r'image-assets', ImageAssetViewSet, basename="imageasset")
router.register(r'dashboard', DashboardViewSet, basename="dashboard")

urlpatterns = [
    path('health-check/', health_check, name='health-check'),
    path('greeting/', greeting, name='greeting'),
    path('ocdfg/', OCDFGViewSet, name='ocdfg'),
    path('new-ocdfg/', NewOCDFGViewSet, name='new-ocdfg'),
    path('occn/', OCCNViewSet, name='occn'),
    # Process executions stored as event columns (see views_process_executions.py).
    # Registered before the router so the explicit paths win over `files/<pk>/`.
    path("files/<int:pk>/event_columns/", views_process_executions.event_columns, name="event-columns"),
    path("files/<int:pk>/process_executions/", views_process_executions.process_executions, name="process-executions"),
    path("", include(router.urls)),
    path("variants/", variants, name="variants"),
    path("playout/", playout, name="playout"),
    path("playout/export-ocel/", playout_export_ocel, name="playout-export-ocel"),
    path("delete-data/", delete_user_data, name="delete_user_data"),
    # OCEL editor — ephemeral working-copy sessions (see views_ocel_editor.py)
    path("ocel-editor/", views_ocel_editor.sessions, name="ocel-editor-sessions"),
    path("ocel-editor/<uuid:session_id>/", views_ocel_editor.session_detail, name="ocel-editor-session"),
    path("ocel-editor/<uuid:session_id>/events/", views_ocel_editor.events, name="ocel-editor-events"),
    path("ocel-editor/<uuid:session_id>/events/detail/", views_ocel_editor.event_detail, name="ocel-editor-event-detail"),
    path("ocel-editor/<uuid:session_id>/objects/", views_ocel_editor.objects, name="ocel-editor-objects"),
    path("ocel-editor/<uuid:session_id>/objects/detail/", views_ocel_editor.object_detail, name="ocel-editor-object-detail"),
    path("ocel-editor/<uuid:session_id>/relations/", views_ocel_editor.relations, name="ocel-editor-relations"),
    path("ocel-editor/<uuid:session_id>/latex/", views_ocel_editor.latex, name="ocel-editor-latex"),
    path("ocel-editor/<uuid:session_id>/export/", views_ocel_editor.export, name="ocel-editor-export"),
    path("ocel-editor/<uuid:session_id>/save-as-project/", views_ocel_editor.save_as_project, name="ocel-editor-save"),
    path("cache/stats/", cache_stats, name="cache-stats"),
    path("cache/clear/", cache_clear, name="cache-clear"),
    path("settings/", user_settings, name="user-settings"),
]

