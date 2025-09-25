from rest_framework import serializers
from .models import EventLog
from .models import Dashboard
from django.db.models import Max

class EventLogSerializer(serializers.ModelSerializer):
     class Meta:
        #not including user to ensure security
        model = EventLog
        fields = ["id", "project", "file", "uploaded_at"]
        read_only_fields = ["project", "uploaded_at"]

class DashboardSerializer(serializers.ModelSerializer):
    order_in_project = serializers.IntegerField(required=False)  
    class Meta:
        model = Dashboard
        fields = ['id', 'project', 'name', 'order_in_project', 'created_at']

    def create(self, validated_data):
        project = validated_data['project']

        # Assign next order if not provided
        if 'order_in_project' not in validated_data:
            last_order = Dashboard.objects.filter(project=project).aggregate(
                Max('order_in_project')
            )['order_in_project__max'] or 0
            validated_data['order_in_project'] = last_order + 1

        return super().create(validated_data)