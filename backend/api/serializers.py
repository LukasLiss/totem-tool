from rest_framework import serializers
from .models import EventLog

class EventLogSerializer(serializers.ModelSerializer):
     class Meta:
        #not including user to ensure security
        model = EventLog
        fields = ["id", "project", "file", "uploaded_at"]
        read_only_fields = ["project", "uploaded_at"]