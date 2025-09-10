from rest_framework import serializers
from .models import UserFile

class UserFileSerializer(serializers.ModelSerializer):
     class Meta:
        #not including user to ensure security
        model = UserFile
        fields = ["id", "file", "uploaded_at"]