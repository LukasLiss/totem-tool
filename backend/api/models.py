from django.db import models
from django.core.files.storage import FileSystemStorage
# Create your models here.

class UserFiles(models.Model):
    username =models.CharField(max_length=20)
    fs = FileSystemStorage(location='/'+str(username)+'/files')
    file = models.FileField(storage=fs)

    