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
    x = models.FloatField(
        validators=[
            MinValueValidator(0.0),
            MaxValueValidator(100.0)
        ]
    )
    y = models.FloatField(
        validators=[
            MinValueValidator(0.0),
            MaxValueValidator(100.0)
        ]
    )
    width = models.FloatField()
    height = models.FloatField()

    class Meta:
        verbose_name = "Dashboard Component"
        verbose_name_plural = "Dashboard Components"


class NumberofEventsComponent(DashboardComponent):
    color = models.CharField(max_length=20, default="blue")


class TextBoxComponent(DashboardComponent):
    text = models.TextField()
    font_size = models.IntegerField(default=14)

