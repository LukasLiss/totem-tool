import json
import os

from rest_framework import serializers
from rest_polymorphic.serializers import PolymorphicSerializer
from totem_lib import (
    CONNECTED_COMPONENTS_REPLAY_STRATEGY,
    LEADING_OBJECT_REPLAY_STRATEGY,
    REPLAY_UNIT_STRATEGIES,
    STORED_COLUMN_REPLAY_STRATEGY,
    validate_occn_dict,
    validate_totem_dict,
)
from totem_lib.ocel.event_columns import EventColumnError, validate_event_column_name
from .asset_formats import validate_ocdfg_asset_dict, validate_ocpn_asset_dict
from .models import EventLog, ImageAsset, Project, ProjectAsset
from .models import Dashboard
from .models import DashboardComponent, NumberofEventsComponent, TextBoxComponent, ImageComponent, VariantsComponent, ProcessAreaComponent, TotemMinerComponent, LogStatisticsComponent, OCDFGComponent, OCDottedChartComponent, NewOCDFGComponent, OCCNComponent, FilterStackComponent, OCPNComponent, SQLQueryComponent, PieChartComponent
from django.db.models import Max


class TotemConformanceRequestSerializer(serializers.Serializer):
    asset_id = serializers.IntegerField(min_value=1)


class OCCNReplayStrategyRequestSerializer(serializers.Serializer):
    """Replay-unit options shared by the conformance and detail endpoints.

    * ``leading_object_type`` -- required by, and only valid for, the
      leading-object strategy.
    * ``execution_column`` -- name of an events column holding precomputed
      process execution ids; required by, and only valid for, the
      stored-column strategy.
    * ``restrict_to_model_object_types`` -- project every event onto the
      object types of the OCCN before building replay units, so objects the
      model deliberately leaves out (e.g. a shared worker resource) do not
      make every unit non-fitting. Valid for every strategy.
    """

    replay_unit_strategy = serializers.ChoiceField(
        choices=REPLAY_UNIT_STRATEGIES,
        default=CONNECTED_COMPONENTS_REPLAY_STRATEGY,
    )
    leading_object_type = serializers.CharField(
        allow_blank=False,
        required=False,
        trim_whitespace=True,
    )
    execution_column = serializers.CharField(
        allow_blank=False,
        allow_null=True,
        required=False,
        trim_whitespace=True,
    )
    restrict_to_model_object_types = serializers.BooleanField(default=False)

    def validate_execution_column(self, value):
        if value is None:
            return None
        try:
            return validate_event_column_name(value)
        except EventColumnError as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate(self, attrs):
        strategy = attrs["replay_unit_strategy"]
        leading_object_type = attrs.get("leading_object_type")
        execution_column = attrs.get("execution_column")
        if strategy == LEADING_OBJECT_REPLAY_STRATEGY:
            if leading_object_type is None:
                raise serializers.ValidationError(
                    {
                        "leading_object_type": (
                            "This field is required for the leading-object "
                            "replay strategy."
                        )
                    }
                )
        elif leading_object_type is not None:
            raise serializers.ValidationError(
                {
                    "leading_object_type": (
                        "This field is only supported for the leading-object "
                        "replay strategy."
                    )
                }
            )
        if strategy == STORED_COLUMN_REPLAY_STRATEGY:
            if execution_column is None:
                raise serializers.ValidationError(
                    {
                        "execution_column": (
                            "This field is required for the stored-column "
                            "replay strategy."
                        )
                    }
                )
        elif execution_column is not None:
            raise serializers.ValidationError(
                {
                    "execution_column": (
                        "This field is only supported for the stored-column "
                        "replay strategy."
                    )
                }
            )
        return attrs


class OCCNConformanceRequestSerializer(OCCNReplayStrategyRequestSerializer):
    asset_id = serializers.IntegerField(min_value=1)
    max_states = serializers.IntegerField(
        min_value=1_000,
        max_value=15_000,
        default=1_000,
    )


class OCCNReplayUnitDetailRequestSerializer(
    OCCNReplayStrategyRequestSerializer
):
    unit_id = serializers.CharField(allow_blank=False, trim_whitespace=True)
    offset = serializers.IntegerField(min_value=0, default=0)
    limit = serializers.IntegerField(min_value=1, max_value=250, default=50)
    # Only needed to reproduce a projection onto the model's object types.
    asset_id = serializers.IntegerField(min_value=1, required=False)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if attrs.get("restrict_to_model_object_types") and "asset_id" not in attrs:
            raise serializers.ValidationError(
                {
                    "asset_id": (
                        "This field is required when restricting replay units "
                        "to the model's object types."
                    )
                }
            )
        return attrs


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
            ProjectAsset.AssetType.OCPN: validate_ocpn_asset_dict,
            ProjectAsset.AssetType.OCDFG: validate_ocdfg_asset_dict,
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


IMAGE_ASSET_EXTENSIONS = {".png", ".jpg", ".jpeg", ".svg"}
IMAGE_ASSET_CONTENT_TYPES = {
    "image/png",
    "image/jpeg",
    "image/svg+xml",
}
IMAGE_ASSET_MAX_BYTES = 10 * 1024 * 1024  # 10 MB


class ImageAssetSerializer(serializers.ModelSerializer):
    image = serializers.FileField(write_only=True, required=False)
    project = serializers.PrimaryKeyRelatedField(queryset=Project.objects.all())
    created_by = serializers.PrimaryKeyRelatedField(read_only=True)
    url = serializers.SerializerMethodField()

    class Meta:
        model = ImageAsset
        fields = [
            "id",
            "project",
            "name",
            "image",
            "url",
            "content_type",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "url",
            "content_type",
            "created_by",
            "created_at",
            "updated_at",
        ]
        validators = []

    def get_url(self, obj):
        try:
            return obj.image.url if obj.image else None
        except ValueError:
            return None

    def validate_name(self, value):
        name = value.strip()
        if not name:
            raise serializers.ValidationError("Image name must not be empty.")
        return name

    def validate_project(self, value):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            raise serializers.ValidationError("Authenticated request context is required.")
        if not value.users.filter(pk=user.pk).exists():
            raise serializers.ValidationError("You do not have access to this project.")
        return value

    def validate_image(self, value):
        extension = os.path.splitext(value.name or "")[1].lower()
        if extension not in IMAGE_ASSET_EXTENSIONS:
            raise serializers.ValidationError(
                "Unsupported image type. Allowed: png, jpg, jpeg, svg."
            )
        content_type = (getattr(value, "content_type", "") or "").lower()
        if content_type and content_type not in IMAGE_ASSET_CONTENT_TYPES:
            raise serializers.ValidationError(
                "Unsupported image content type. Allowed: png, jpeg, svg."
            )
        if value.size and value.size > IMAGE_ASSET_MAX_BYTES:
            raise serializers.ValidationError("Image must be 10 MB or smaller.")
        return value

    def validate(self, attrs):
        project = attrs.get("project")
        if project is None and self.instance is not None:
            project = self.instance.project
        name = attrs.get("name")
        if name is None and self.instance is not None:
            name = self.instance.name
        if project and name:
            existing = ImageAsset.objects.filter(project=project, name=name)
            if self.instance is not None:
                existing = existing.exclude(pk=self.instance.pk)
            if existing.exists():
                raise serializers.ValidationError(
                    {"name": "An image with this name already exists in this project."}
                )

        if self.instance is None and attrs.get("image") is None:
            raise serializers.ValidationError({"image": "Choose an image file."})

        image = attrs.get("image")
        if image is not None:
            attrs["content_type"] = (getattr(image, "content_type", "") or "").lower()
        return attrs

    def create(self, validated_data):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user and user.is_authenticated:
            validated_data["created_by"] = user
        return super().create(validated_data)


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
    image_asset = serializers.PrimaryKeyRelatedField(read_only=True)
    # Resolved URL of the linked asset so the dashboard can render without an
    # extra per-component request.
    image_asset_url = serializers.SerializerMethodField()

    class Meta:
        model = ImageComponent
        fields = "__all__"

    def get_image_asset_url(self, obj):
        asset = obj.image_asset
        if asset is None:
            return None
        try:
            return asset.image.url if asset.image else None
        except ValueError:
            return None

class VariantsComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = VariantsComponent
        fields = "__all__"

class ProcessAreaComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = ProcessAreaComponent
        fields = "__all__"

class TotemMinerComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = TotemMinerComponent
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


class OCPNComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = OCPNComponent
        fields = "__all__"


class OCCNComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = OCCNComponent
        fields = "__all__"
#Fill in new Component Serializers here and then edit the mapping below

class SQLQueryComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = SQLQueryComponent
        fields = "__all__"


class PieChartComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = PieChartComponent
        fields = "__all__"


class FilterStackComponentSerializer(DashboardComponentSerializer):
    class Meta:
        model = FilterStackComponent
        fields = "__all__"
class DashboardComponentPolymorphicSerializer(PolymorphicSerializer):
    model_serializer_mapping = {
        DashboardComponent: DashboardComponentSerializer,
        NumberofEventsComponent: NumberOfEventsComponentSerializer,
        TextBoxComponent: TextBoxComponentSerializer,
        ImageComponent: ImageComponentSerializer,
        VariantsComponent: VariantsComponentSerializer,
        ProcessAreaComponent: ProcessAreaComponentSerializer,
        TotemMinerComponent: TotemMinerComponentSerializer,
        LogStatisticsComponent: LogStatisticsComponentSerializer,
        OCDFGComponent: OCDFGComponentSerializer,
        FilterStackComponent: FilterStackComponentSerializer,
        OCDottedChartComponent: OCDottedChartComponentSerializer,
        NewOCDFGComponent: NewOCDFGComponentSerializer,
        OCPNComponent: OCPNComponentSerializer,
        SQLQueryComponent: SQLQueryComponentSerializer,
        PieChartComponent: PieChartComponentSerializer,
        OCCNComponent: OCCNComponentSerializer,
    }
