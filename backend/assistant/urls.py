from django.urls import path
from .views import ChatView, confirm_action

urlpatterns = [
    path('chat/', ChatView.as_view(), name='assistant-chat'),
    path('confirm/', confirm_action, name='assistant-confirm'),
]
