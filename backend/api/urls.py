from django.urls import path, include
from . import views
from django.conf import settings
from django.conf.urls.static import static

'''
urlpatterns = [
    path('greeting/', views.greeting, name='greeting'),
    path("files/", views.UserFileListCreateView.as_view(), name="user-files"),
    path('api/', include(router.urls)),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
'''
from rest_framework.routers import DefaultRouter
from .views import UserFileViewSet, greeting

router = DefaultRouter()
router.register(r'files', UserFileViewSet, basename="userfile")

urlpatterns = [
    path('greeting/', greeting, name='greeting'),
    path("", include(router.urls)),
]