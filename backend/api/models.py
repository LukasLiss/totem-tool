from django.db import models
from django.core.files.storage import FileSystemStorage
from django.contrib.auth.models import User
from django.core.validators import MinValueValidator, MaxValueValidator
import os
# Create your models here.

#This is the general OCM datastructure

def user_directory_path(instance, filename):
    # Redirect to the new function (or just return a flat path)
    return os.path.join("legacy", filename)

def project_directory_path(instance, filename):
    return os.path.join(instance.dashboard.project.name, filename)

class UserSettings(models.Model):
    """Per-user application settings, independent of any project.

    Kept as a separate OneToOne row (rather than columns on the auth User)
    so we can add more preferences over time without touching auth. Created
    lazily on first access via ``get_or_create``.
    """
    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name="settings"
    )
    # When True the frontend adds ``?bypass_cache=1`` to every request so the
    # backend recomputes results instead of serving them from the disk cache.
    bypass_cache = models.BooleanField(default=False)

    def __str__(self):
        return f"Settings for {self.user.username}"


class Project(models.Model):
    users = models.ManyToManyField(User)
    name = models.CharField(max_length=30)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name}"


class EventLog(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    file = models.FileField()
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.project.name} - {self.file.name}"


class ProjectAsset(models.Model):
    class AssetType(models.TextChoices):
        TOTEM = "TOTEM", "TOTeM"
        OCCN = "OCCN", "OCCN"

    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name="assets",
    )
    name = models.CharField(max_length=100)
    asset_type = models.CharField(max_length=20, choices=AssetType.choices)
    content_json = models.JSONField()
    metadata = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["project", "name"],
                name="unique_project_asset_name",
            ),
        ]
        indexes = [
            models.Index(fields=["project", "asset_type"]),
        ]

    def __str__(self):
        return f"{self.project.name} - {self.name} ({self.asset_type})"


class Dashboard(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE)
    name = models.CharField(max_length=30)
    order_in_project = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    

class DashboardComponent(models.Model):
    dashboard = models.ForeignKey(
        Dashboard,
        on_delete=models.CASCADE,
        related_name="components"
    )

    # GridStack-native geometry
    x = models.IntegerField()
    y = models.IntegerField()
    w = models.IntegerField()
    h = models.IntegerField()

    # The actual component name, matching your React componentMap
    component_name = models.CharField(max_length=100)

    order = models.IntegerField(default=0)  # for z-order or stable sorting

    class Meta:
        verbose_name = "Dashboard Component"
        verbose_name_plural = "Dashboard Components"


class NumberofEventsComponent(DashboardComponent):
    color = models.CharField(max_length=20, default="blue")


class TextBoxComponent(DashboardComponent):
    text = models.TextField()
    font_size = models.IntegerField(default=14)

class ImageComponent(DashboardComponent):
    image = models.ImageField(upload_to=project_directory_path)


class VariantsComponent(DashboardComponent):
    automatic_loading = models.BooleanField(default=False, null=True, blank=True)
    leading_object_type = models.CharField(max_length=100, null=True, blank=True)
    # Advanced settings — persist user's chosen extraction / iso / timeout
    # so reloading the dashboard restores them. Defaults match `find_variants`.
    extraction = models.CharField(max_length=32, default="leading_1hop", null=True, blank=True)
    iso = models.CharField(max_length=32, default="wl+vf2", null=True, blank=True)
    timeout_s = models.FloatField(default=10.0, null=True, blank=True)


class ProcessAreaComponent(DashboardComponent):
    # Which engine decides the object-type hierarchy. "advanced" is the
    # default: it is the thesis section 4.1 algorithm, it reproduces MLPA's
    # hierarchy on the reference logs at these defaults, and it is faster.
    ALGORITHM_CHOICES = [
        ('mlpa', 'MLPA (temporal)'),
        ('advanced', 'Advanced (resource indicators)'),
    ]
    algorithm = models.CharField(
        max_length=16, choices=ALGORITHM_CHOICES, default='advanced'
    )

    # Parameters of the advanced algorithm. Weights per resource indicator,
    # then the two halves of the ILP objective: alpha weights the resource
    # force (separation), beta the attractive force (cohesion). These follow
    # the thesis convention, not the reference implementation's, which swaps
    # the two names.
    w_temporal = models.FloatField(default=1.0, validators=[MinValueValidator(0.0)])
    w_cardinality = models.FloatField(default=1.0, validators=[MinValueValidator(0.0)])
    w_divergence = models.FloatField(default=1.0, validators=[MinValueValidator(0.0)])
    alpha = models.FloatField(default=1.0, validators=[MinValueValidator(0.0)])
    beta = models.FloatField(default=1.0, validators=[MinValueValidator(0.0)])


class LogStatisticsComponent(DashboardComponent):
    show_num_events = models.BooleanField(default=True)
    show_num_activities = models.BooleanField(default=True)
    show_num_objects = models.BooleanField(default=True)
    show_num_object_types = models.BooleanField(default=True)
    show_earliest_timestamp = models.BooleanField(default=False)
    show_newest_timestamp = models.BooleanField(default=False)
    show_duration = models.BooleanField(default=False)


class OCDFGComponent(DashboardComponent):
    show_controls = models.BooleanField(default=True)
    initial_interaction_locked = models.BooleanField(default=True)


class OCDottedChartComponent(DashboardComponent):
    file_id = models.PositiveIntegerField(null=True, blank=True)
    x_axis = models.CharField(max_length=255, default="time")
    y_axis = models.CharField(max_length=255, default="activity")
    color_by = models.CharField(max_length=255, default="activity")
    shape_by = models.CharField(max_length=255, default="none")
    row_order = models.CharField(max_length=32, default="first_occurrence")
    max_points = models.PositiveIntegerField(default=10000)
    show_minimap = models.BooleanField(default=True)
    show_controls = models.BooleanField(default=True)


class NewOCDFGComponent(DashboardComponent):
    show_controls = models.BooleanField(default=True)
    initial_interaction_locked = models.BooleanField(default=True)
    layout_direction = models.CharField(
        max_length=2,
        choices=[('TB', 'Top to Bottom'), ('LR', 'Left to Right')],
        default='TB',
    )

class SQLQueryComponent(DashboardComponent):
    query = models.TextField(default="SELECT * FROM data LIMIT 10")


class PieChartComponent(DashboardComponent):
    query = models.TextField(default="SELECT * FROM events LIMIT 10")
    ring_text = models.CharField(max_length=200, blank=True, default="")
    chart_type = models.CharField(max_length=20, default="donut")
    title = models.CharField(max_length=200, blank=True, default="")
    label_column = models.CharField(max_length=100, blank=True, default="")
    value_column = models.CharField(max_length=100, blank=True, default="")
    show_legend = models.BooleanField(default=True)
    show_tooltip = models.BooleanField(default=True)


class OCCNComponent(DashboardComponent):
    relative_occurrence_threshold = models.FloatField(
        default=0.0,
        validators=[MinValueValidator(0.0), MaxValueValidator(1.0)],
    )
    show_controls = models.BooleanField(default=True)
    initial_interaction_locked = models.BooleanField(default=True)
    layout_direction = models.CharField(
        max_length=2,
        choices=[('TB', 'Top to Bottom'), ('LR', 'Left to Right')],
        default='LR',
    )
    # Comma-separated object type filter; empty = discover on all types.
    object_types = models.TextField(default="", blank=True)
