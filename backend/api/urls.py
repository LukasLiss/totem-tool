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
from .views import GetNumberOfEvents

router = DefaultRouter()
router.register(r'files', GetNumberOfEvents, basename="userfile")

urlpatterns = [
    path('greeting/', views.greeting, name='greeting'),
    path("", include(router.urls)),
]