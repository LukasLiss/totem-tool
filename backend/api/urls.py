from django.urls import path
from . import views

urlpatterns = [
    path('greeting/', views.greeting, name='greeting'),
]