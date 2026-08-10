import json

from rest_framework import serializers
from rest_polymorphic.serializers import PolymorphicSerializer
from totem_lib import (
    CONNECTED_COMPONENTS_REPLAY_STRATEGY,
    validate_occn_dict,
    validate_totem_dict,
)
from .models import EventLog, Project, ProjectAsset
from .models import Dashboard
from .models import DashboardComponent, NumberofEventsComponent, TextBoxComponent, ImageComponent, VariantsComponent, ProcessAreaComponent, LogStatisticsComponent, OCDFGComponent, OCDottedChartComponent, NewOCDFGComponent, OCCNComponent
from django.db.models import Max


class TotemConformanceRequestSerializer(serializers.Serializer):
    asset_id = serializers.IntegerField(min_value=1)


class OCCNConformanceRequestSerializer(serializers.Serializer):
    asset_id = serializers.IntegerField(min_value=1)
    replay_unit_strategy = serializers.ChoiceField(
        choices=(CONNECTED_COMPONENTS_REPLAY_STRATEGY,),
        default=CONNECTED_COMPONENTS_REPLAY_STRATEGY,
    )


class EventLogSerializer(serializers.ModelSerializer):
     class Meta:
        #not including user to ensure security
        model = EventLog
        fields = ["id", "project", "file", "uploaded_at"]
        read_only_fields = ["project", "uploaded_at"]


class ProjectAssetSerializer(serializers.ModelSerializer):
    file = serializers.FileField(write_only=True, required=False)
    project = serializers.PrimaryKeyRelatedField(queryset=Project.objects.all())
    created_by = serializers.PrimaryKeyRelatedField(read_only=True)
    content_json = serializers.JSONField(required=False)

    class Meta:
        model = ProjectAsset
        fields = [
            "id",
            "project",
            "name",
            "asset_type",
            "file",
            "content_json",
            "metadata",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]
        validators = []

    def validate_name(self, value):
        name = value.strip()
        if not name:
            raise serializers.ValidationError("Asset name must not be empty.")
        return name

    def validate_asset_type(self, value):
        if value not in ProjectAsset.AssetType.values:
            raise serializers.ValidationError("Unsupported asset type.")
        return value

    def validate_project(self, value):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            raise serializers.ValidationError("Authenticated request context is required.")
        if not value.users.filter(pk=user.pk).exists():
            raise serializers.ValidationError("You do not have access to this project.")
        return value

    def validate(self, attrs):
        # On update, project/name may be omitted from the payload; fall back to
        # the stored values so the uniqueness check still runs (and a duplicate
        # rename is rejected with a clean 400 instead of a DB IntegrityError).
        project = attrs.get("project")
        if project is None and self.instance is not None:
            project = self.instance.project
        name = attrs.get("name")
        if name is None and self.instance is not None:
            name = self.instance.name
        if project and name:
            existing_assets = ProjectAsset.objects.filter(project=project, name=name)
            if self.instance is not None:
                existing_assets = existing_assets.exclude(pk=self.instance.pk)
            if existing_assets.exists():
                raise serializers.ValidationError(
                    {"name": "A project asset with this name already exists in this project."}
                )

        file_obj = attrs.pop("file", None)
        content_json = attrs.get("content_json")

        if file_obj is not None and content_json is not None:
            raise serializers.ValidationError(
                {"file": "Provide either file or content_json, not both."}
            )

        is_update = self.instance is not None
        if file_obj is None and content_json is None:
            # Creating an asset always needs its content; on update the model
            # content may be left unchanged (e.g. a rename-only PATCH).
            if not is_update:
                raise serializers.ValidationError(
                    {"file": "Provide either a JSON file or direct content_json."}
                )
            return attrs

        if file_obj is not None:
            content_json = self._parse_json_file(file_obj)

        # On update the asset_type is often not resent; fall back to the stored
        # value so content validation still runs against the correct schema.
        asset_type = attrs.get("asset_type")
        if asset_type is None and is_update:
            asset_type = self.instance.asset_type

        attrs["content_json"] = self._validate_content_json(
            content_json,
            asset_type,
        )
        return attrs

    def create(self, validated_data):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user and user.is_authenticated:
            validated_data["created_by"] = user
        return super().create(validated_data)

    @staticmethod
    def _parse_json_file(file_obj):
        try:
            raw_content = file_obj.read()
            if isinstance(raw_content, bytes):
                raw_content = raw_content.decode("utf-8")
            content = json.loads(raw_content)
        except UnicodeDecodeError:
            raise serializers.ValidationError(
                {"content_json": "JSON file must be UTF-8 encoded."}
            )
        except json.JSONDecodeError as exc:
            raise serializers.ValidationError(
                {"content_json": f"Invalid JSON file: {exc.msg}."}
            )

        if not isinstance(content, dict):
            raise serializers.ValidationError(
                {"content_json": "Model asset JSON must be an object."}
            )
        return content

    @staticmethod
    def _validate_content_json(content, asset_type):
        if not isinstance(content, dict):
            raise serializers.ValidationError(
                {"content_json": "Model asset JSON must be an object."}
            )

        schema_validators = {
            ProjectAsset.AssetType.TOTEM: validate_totem_dict,
            ProjectAsset.AssetType.OCCN: validate_occn_dict,
        }
        validator = schema_validators.get(asset_type)
        if validator is None:
            return content

        try:
            validator(content)
        except ValueError as exc:
            raise serializers.ValidationError(
                {"content_json": str(exc)}
            )
        return content


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
    image = serializers.ImageField(read_only=True)

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


class OCDottedChartComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = OCDottedChartComponent
        fields = "__all__"


class NewOCDFGComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = NewOCDFGComponent
        fields = "__all__"


class OCCNComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = OCCNComponent
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
        OCDottedChartComponent: OCDottedChartComponentSerializer,
        NewOCDFGComponent: NewOCDFGComponentSerializer,
        OCCNComponent: OCCNComponentSerializer,
    }
