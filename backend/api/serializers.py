from rest_framework import serializers
from rest_polymorphic.serializers import PolymorphicSerializer
from .models import EventLog
from .models import Dashboard
from .models import DashboardComponent, NumberofEventsComponent, TextBoxComponent, ImageComponent, VariantsComponent, ProcessAreaComponent, LogStatisticsComponent, OCDFGComponent, TotemModelComponent
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

#Dashboard components

class DashboardComponentSerializer(serializers.ModelSerializer):
    class Meta:
        model = DashboardComponent
        fields = "__all__"

class NumberOfEventsComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = NumberofEventsComponent
        fields = "__all__"


class TextBoxComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = TextBoxComponent
        fields = "__all__"

class ImageComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = ImageComponent
        fields = "__all__"


class VariantsComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = VariantsComponent
        fields = "__all__"

class ProcessAreaComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = ProcessAreaComponent
        fields = "__all__"

class LogStatisticsComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = LogStatisticsComponent
        fields = "__all__"

class OCDFGComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = OCDFGComponent
        fields = "__all__"

class TotemModelComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = TotemModelComponent
        fields = "__all__"
#Fill in new Component Serializers here and then edit the mapping below

class DashboardComponentPolymorphicSerializer(PolymorphicSerializer):
    model_serializer_mapping = {
        DashboardComponent: DashboardComponentSerializer,
        NumberofEventsComponent: NumberOfEventsComponentSerializer,
        TextBoxComponent: TextBoxComponentSerializer,
        ImageComponent: ImageComponentSerializer,
        VariantsComponent: VariantsComponentSerializer,
        ProcessAreaComponent: ProcessAreaComponentSerializer,
        LogStatisticsComponent: LogStatisticsComponentSerializer,
        OCDFGComponent: OCDFGComponentSerializer,
        TotemModelComponent: TotemModelComponentSerializer,
    }