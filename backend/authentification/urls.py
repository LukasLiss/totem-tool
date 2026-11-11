from django.urls import path
from . import views

urlpatterns = [
     path('home/', views.HomeView.as_view(), name ='home'),
     path('logout/', views.LogoutView.as_view(), name ='logout'),
     path('auth/login-options/', views.LoginOptionsView.as_view(), name='login_options'),
     path('auth/oauth/<str:provider>/login/', views.OAuthLoginView.as_view(), name='oauth_login'),
     path('auth/oauth/<str:provider>/callback/', views.OAuthCallbackView.as_view(), name='oauth_callback'),
]
