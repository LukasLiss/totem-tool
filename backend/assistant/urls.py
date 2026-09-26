from django.urls import path
from .views import ChatView, confirm_action, validate_api_key

urlpatterns = [
    path('chat/', ChatView.as_view(), name='assistant-chat'),
    path('confirm/', confirm_action, name='assistant-confirm'),
    path('validate-key/', validate_api_key, name='assistant-validate-key'),
]
