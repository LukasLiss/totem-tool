# apps.py
from django.apps import AppConfig
from django.db.models.signals import post_migrate


class YourAppConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'api'

    def ready(self):
        import api.signals  # 👈 make sure signals get registered

        # The desktop app runs `migrate` on every launch, which is when the
        # first-launch sample project gets provisioned (once -- see
        # api/sample_project.py).
        from .sample_project import seed_sample_project
        post_migrate.connect(
            seed_sample_project, sender=self, dispatch_uid='seed-sample-project'
        )
