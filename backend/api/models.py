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
    return os.path.join(instance.project.name, filename)


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


class ProcessAreaComponent(DashboardComponent):
    pass


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


class TotemModelComponent(DashboardComponent):
    initial_tau = models.FloatField(default=0.9, null=True, blank=True)
