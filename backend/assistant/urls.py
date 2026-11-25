from django.urls import path

from .views import ChatView, cancel_turn, confirm_action, reset_conversation, validate_api_key

urlpatterns = [
    path("chat/", ChatView.as_view(), name="assistant-chat"),
    path("confirm/", confirm_action, name="assistant-confirm"),
    path("cancel/", cancel_turn, name="assistant-cancel"),
    path("reset/", reset_conversation, name="assistant-reset"),
    path("validate-key/", validate_api_key, name="assistant-validate-key"),
]
