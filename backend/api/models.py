from django.db import models
from django.core.files.storage import FileSystemStorage
from django.contrib.auth.models import User
import os
# Create your models here.

def user_directory_path(instance, filename):
    return os.path.join(instance.user.username, "files", filename)

class UserFile(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="files")
    file = models.FileField(upload_to=user_directory_path)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username} - {self.file.name}"

    