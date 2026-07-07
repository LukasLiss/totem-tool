from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient, APIRequestFactory

from .models import Project, ProjectAsset
from .serializers import ProjectAssetSerializer


class ProjectAssetModelTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="asset-user")
        self.project = Project.objects.create(name="Project A")
        self.project.users.add(self.user)

    def test_project_asset_stores_canonical_json_payload(self):
        asset = ProjectAsset.objects.create(
            project=self.project,
            name="Baseline TOTeM",
            asset_type=ProjectAsset.AssetType.TOTEM,
            content_json={"schema": "totem", "version": 1, "nodes": []},
            metadata={"source_log_id": 1},
            created_by=self.user,
        )

        asset.refresh_from_db()

        self.assertEqual(asset.content_json["schema"], "totem")
        self.assertEqual(asset.metadata["source_log_id"], 1)
        self.assertEqual(asset.created_by, self.user)

    def test_project_asset_name_is_unique_within_project(self):
        ProjectAsset.objects.create(
            project=self.project,
            name="Reusable model",
            asset_type=ProjectAsset.AssetType.TOTEM,
            content_json={"schema": "totem", "version": 1},
        )

        with self.assertRaises(IntegrityError):
            ProjectAsset.objects.create(
                project=self.project,
                name="Reusable model",
                asset_type=ProjectAsset.AssetType.OCCN,
                content_json={"schema": "occn", "version": 1},
            )

    def test_project_asset_name_can_be_reused_across_projects(self):
        other_project = Project.objects.create(name="Project B")
        other_project.users.add(self.user)

        ProjectAsset.objects.create(
            project=self.project,
            name="Shared name",
            asset_type=ProjectAsset.AssetType.TOTEM,
            content_json={"schema": "totem", "version": 1},
        )
        ProjectAsset.objects.create(
            project=other_project,
            name="Shared name",
            asset_type=ProjectAsset.AssetType.OCCN,
            content_json={"schema": "occn", "version": 1},
        )

        self.assertEqual(ProjectAsset.objects.filter(name="Shared name").count(), 2)

    def test_project_asset_is_deleted_with_project(self):
        ProjectAsset.objects.create(
            project=self.project,
            name="Temporary model",
            asset_type=ProjectAsset.AssetType.TOTEM,
            content_json={"schema": "totem", "version": 1},
        )

        self.project.delete()

        self.assertFalse(ProjectAsset.objects.filter(name="Temporary model").exists())


class ProjectAssetSerializerTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.user = User.objects.create_user(username="serializer-user")
        self.project = Project.objects.create(name="Project A")
        self.project.users.add(self.user)

    def _request(self, user=None):
        request = self.factory.post("/api/assets/")
        request.user = user or self.user
        return request

    def _serializer(self, data, user=None):
        return ProjectAssetSerializer(
            data=data,
            context={"request": self._request(user=user)},
        )

    def test_serializer_creates_asset_from_direct_content_json(self):
        serializer = self._serializer(
            {
                "project": self.project.pk,
                "name": "  Baseline TOTeM  ",
                "asset_type": ProjectAsset.AssetType.TOTEM,
                "content_json": {"schema": "totem", "version": 1},
                "metadata": {"source_log_id": 12},
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        asset = serializer.save()

        self.assertEqual(asset.name, "Baseline TOTeM")
        self.assertEqual(asset.content_json["schema"], "totem")
        self.assertEqual(asset.metadata["source_log_id"], 12)
        self.assertEqual(asset.created_by, self.user)

    def test_serializer_creates_asset_from_json_file(self):
        upload = SimpleUploadedFile(
            "model.json",
            b'{"schema": "occn", "version": 1}',
            content_type="application/json",
        )
        serializer = self._serializer(
            {
                "project": self.project.pk,
                "name": "OCCN model",
                "asset_type": ProjectAsset.AssetType.OCCN,
                "file": upload,
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        asset = serializer.save()

        self.assertEqual(asset.content_json, {"schema": "occn", "version": 1})

    def test_serializer_rejects_invalid_json_file(self):
        upload = SimpleUploadedFile(
            "model.json",
            b'{"schema":',
            content_type="application/json",
        )
        serializer = self._serializer(
            {
                "project": self.project.pk,
                "name": "Broken model",
                "asset_type": ProjectAsset.AssetType.TOTEM,
                "file": upload,
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("content_json", serializer.errors)

    def test_serializer_rejects_non_object_json(self):
        serializer = self._serializer(
            {
                "project": self.project.pk,
                "name": "List model",
                "asset_type": ProjectAsset.AssetType.TOTEM,
                "content_json": [],
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("content_json", serializer.errors)

    def test_serializer_rejects_missing_json_source(self):
        serializer = self._serializer(
            {
                "project": self.project.pk,
                "name": "Missing model",
                "asset_type": ProjectAsset.AssetType.TOTEM,
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("file", serializer.errors)

    def test_serializer_rejects_ambiguous_json_sources(self):
        upload = SimpleUploadedFile(
            "model.json",
            b'{"schema": "totem", "version": 1}',
            content_type="application/json",
        )
        serializer = self._serializer(
            {
                "project": self.project.pk,
                "name": "Ambiguous model",
                "asset_type": ProjectAsset.AssetType.TOTEM,
                "file": upload,
                "content_json": {"schema": "totem", "version": 1},
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("file", serializer.errors)

    def test_serializer_rejects_empty_name(self):
        serializer = self._serializer(
            {
                "project": self.project.pk,
                "name": "   ",
                "asset_type": ProjectAsset.AssetType.TOTEM,
                "content_json": {"schema": "totem", "version": 1},
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("name", serializer.errors)

    def test_serializer_rejects_duplicate_name_in_project(self):
        ProjectAsset.objects.create(
            project=self.project,
            name="Duplicate model",
            asset_type=ProjectAsset.AssetType.TOTEM,
            content_json={"schema": "totem", "version": 1},
        )
        serializer = self._serializer(
            {
                "project": self.project.pk,
                "name": "Duplicate model",
                "asset_type": ProjectAsset.AssetType.OCCN,
                "content_json": {"schema": "occn", "version": 1},
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("name", serializer.errors)

    def test_serializer_rejects_inaccessible_project(self):
        other_project = Project.objects.create(name="Project B")
        serializer = self._serializer(
            {
                "project": other_project.pk,
                "name": "Foreign model",
                "asset_type": ProjectAsset.AssetType.TOTEM,
                "content_json": {"schema": "totem", "version": 1},
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("project", serializer.errors)

    def test_serializer_rejects_unsupported_asset_type(self):
        serializer = self._serializer(
            {
                "project": self.project.pk,
                "name": "Unknown model",
                "asset_type": "UNKNOWN",
                "content_json": {"schema": "totem", "version": 1},
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("asset_type", serializer.errors)

    def test_serializer_rejects_schema_mismatch(self):
        serializer = self._serializer(
            {
                "project": self.project.pk,
                "name": "Mismatched model",
                "asset_type": ProjectAsset.AssetType.TOTEM,
                "content_json": {"schema": "occn", "version": 1},
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("content_json", serializer.errors)

    def test_serializer_response_does_not_include_file_fields(self):
        asset = ProjectAsset.objects.create(
            project=self.project,
            name="Serialized model",
            asset_type=ProjectAsset.AssetType.TOTEM,
            content_json={"schema": "totem", "version": 1},
            created_by=self.user,
        )

        data = ProjectAssetSerializer(asset).data

        self.assertIn("content_json", data)
        self.assertNotIn("file", data)
        self.assertNotIn("original_filename", data)
        self.assertNotIn("content_type", data)
        self.assertNotIn("size_bytes", data)


class ProjectAssetApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="api-user")
        self.other_user = User.objects.create_user(username="other-user")
        self.project = Project.objects.create(name="Project A")
        self.project.users.add(self.user)
        self.other_project = Project.objects.create(name="Project B")
        self.other_project.users.add(self.other_user)
        self.client.force_authenticate(user=self.user)

    def test_create_asset_from_direct_content_json(self):
        response = self.client.post(
            "/api/assets/",
            {
                "project": self.project.pk,
                "name": "API TOTeM",
                "asset_type": ProjectAsset.AssetType.TOTEM,
                "content_json": {"schema": "totem", "version": 1},
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        asset = ProjectAsset.objects.get(pk=response.data["id"])
        self.assertEqual(asset.content_json, {"schema": "totem", "version": 1})
        self.assertEqual(asset.created_by, self.user)

    def test_create_asset_from_uploaded_json_file(self):
        upload = SimpleUploadedFile(
            "model.json",
            b'{"schema": "occn", "version": 1}',
            content_type="application/json",
        )

        response = self.client.post(
            "/api/assets/",
            {
                "project": self.project.pk,
                "name": "API OCCN",
                "asset_type": ProjectAsset.AssetType.OCCN,
                "file": upload,
            },
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["content_json"], {"schema": "occn", "version": 1})

    def test_retrieve_asset_scoped_to_user_project(self):
        own_asset = ProjectAsset.objects.create(
            project=self.project,
            name="Own model",
            asset_type=ProjectAsset.AssetType.TOTEM,
            content_json={"schema": "totem", "version": 1},
        )
        foreign_asset = ProjectAsset.objects.create(
            project=self.other_project,
            name="Foreign model",
            asset_type=ProjectAsset.AssetType.TOTEM,
            content_json={"schema": "totem", "version": 1},
        )

        own_response = self.client.get(f"/api/assets/{own_asset.pk}/")
        foreign_response = self.client.get(f"/api/assets/{foreign_asset.pk}/")

        self.assertEqual(own_response.status_code, status.HTTP_200_OK)
        self.assertEqual(foreign_response.status_code, status.HTTP_404_NOT_FOUND)

    def test_create_asset_rejects_inaccessible_project(self):
        response = self.client.post(
            "/api/assets/",
            {
                "project": self.other_project.pk,
                "name": "Foreign project model",
                "asset_type": ProjectAsset.AssetType.TOTEM,
                "content_json": {"schema": "totem", "version": 1},
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("project", response.data)

    def test_delete_asset_removes_database_row(self):
        asset = ProjectAsset.objects.create(
            project=self.project,
            name="Delete me",
            asset_type=ProjectAsset.AssetType.OCCN,
            content_json={"schema": "occn", "version": 1},
        )

        response = self.client.delete(f"/api/assets/{asset.pk}/")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(ProjectAsset.objects.filter(pk=asset.pk).exists())

    def test_delete_asset_scoped_to_user_project(self):
        foreign_asset = ProjectAsset.objects.create(
            project=self.other_project,
            name="Foreign delete",
            asset_type=ProjectAsset.AssetType.OCCN,
            content_json={"schema": "occn", "version": 1},
        )

        response = self.client.delete(f"/api/assets/{foreign_asset.pk}/")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(ProjectAsset.objects.filter(pk=foreign_asset.pk).exists())
