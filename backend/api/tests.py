import copy
import importlib
import json
from contextlib import nullcontext
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient, APIRequestFactory
from totem_lib.totem import Totem, totem_to_dict

from .models import Dashboard, EventLog, Project, ProjectAsset
from .serializers import ProjectAssetSerializer


legacy_project_name_migration = importlib.import_module(
    "api.migrations.0016_normalize_legacy_project_names"
)


def valid_totem_content_json():
    return totem_to_dict(
        Totem(
            tempgraph={
                "nodes": {"Order", "Item"},
                "D": {("Order", "Item")},
                "Di": set(),
                "I": set(),
                "Ii": set(),
                "P": set(),
            },
            cardinalities={
                ("Order", "Item"): {"LC": "1..*", "EC": "0...*"},
            },
            type_relations={frozenset(("Order", "Item"))},
            all_event_types={"Create Order", "Pick Item"},
            object_type_to_event_types={
                "Order": {"Create Order"},
                "Item": {"Pick Item"},
            },
        )
    )


def valid_occn_content_json():
    return {
        "schema": "occn",
        "version": 1,
        "activities": ["START_Order", "END_Order"],
        "object_types": ["Order"],
        "dependency_graph": {
            "edges": [
                {
                    "source": "START_Order",
                    "target": "END_Order",
                    "object_type": "Order",
                }
            ]
        },
        "input_marker_groups": {
            "START_Order": [],
            "END_Order": [
                {
                    "support_count": 1,
                    "markers": [
                        {
                            "related_activity": "START_Order",
                            "object_type": "Order",
                            "min_count": 1,
                            "max_count": 1,
                            "marker_key": 1,
                        }
                    ],
                }
            ],
        },
        "output_marker_groups": {
            "START_Order": [
                {
                    "support_count": 1,
                    "markers": [
                        {
                            "related_activity": "END_Order",
                            "object_type": "Order",
                            "min_count": 1,
                            "max_count": 1,
                            "marker_key": 1,
                        }
                    ],
                }
            ],
            "END_Order": [],
        },
        "activity_count": {"START_Order": 1, "END_Order": 1},
        "relative_occurrence_threshold": 0.0,
    }


class LegacyProjectNameMigrationTests(TestCase):
    def test_uses_event_log_filename_without_extension(self):
        result = legacy_project_name_migration.normalized_legacy_project_name(
            "ocel2-exportxml_Guest",
            ["Guest"],
            "ocel2-export.xml",
        )

        self.assertEqual(result, "ocel2-export_project")

    def test_removes_django_storage_collision_suffix(self):
        result = legacy_project_name_migration.normalized_legacy_project_name(
            "ocel2-exportxml_Guest",
            ["Guest"],
            "uploads/ocel2-export_B4UuNSL.xml",
        )

        self.assertEqual(result, "ocel2-export_project")

    def test_recovers_filename_from_empty_legacy_project(self):
        result = legacy_project_name_migration.normalized_legacy_project_name(
            "dotted-testxml_Guest",
            ["Guest"],
        )

        self.assertEqual(result, "dotted-test_project")

    def test_preserves_custom_name_that_happens_to_end_with_username(self):
        result = legacy_project_name_migration.normalized_legacy_project_name(
            "Research_Guest",
            ["Guest"],
            "ocel2-export.xml",
        )

        self.assertIsNone(result)


class ProjectModelTests(TestCase):
    def test_named_project_uses_trimmed_name_as_display_name(self):
        project = Project.objects.create(name="  Project A  ")

        self.assertEqual(project.display_name, "Project A")
        self.assertEqual(str(project), "Project A")

    def test_unnamed_project_uses_stable_id_based_display_name(self):
        project = Project.objects.create()

        self.assertEqual(project.name, "")
        self.assertEqual(project.display_name, f"Project {project.pk}")
        self.assertEqual(str(project), f"Project {project.pk}")


class ProjectApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="project-user")
        self.other_user = User.objects.create_user(username="other-project-user")
        self.client.force_authenticate(user=self.user)

    def test_create_named_project_trims_name_and_adds_current_user(self):
        response = self.client.post("/api/projects/", {"name": "  Research  "})

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        project = Project.objects.get(pk=response.data["id"])
        self.assertEqual(project.name, "Research")
        self.assertEqual(response.data["display_name"], "Research")
        self.assertTrue(project.users.filter(pk=self.user.pk).exists())

    def test_create_unnamed_project_uses_id_based_display_name(self):
        response = self.client.post("/api/projects/", {})

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        project = Project.objects.get(pk=response.data["id"])
        self.assertEqual(project.name, "")
        self.assertEqual(response.data["display_name"], f"Project {project.pk}")
        self.assertEqual(project.event_logs.count(), 0)

    def test_list_projects_only_returns_accessible_projects(self):
        own_project = Project.objects.create(name="Own")
        own_project.users.add(self.user)
        foreign_project = Project.objects.create(name="Foreign")
        foreign_project.users.add(self.other_user)

        response = self.client.get("/api/projects/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in response.data], [own_project.pk])

    def test_retrieve_foreign_project_returns_not_found(self):
        foreign_project = Project.objects.create(name="Foreign")
        foreign_project.users.add(self.other_user)

        response = self.client.get(f"/api/projects/{foreign_project.pk}/")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_patch_project_name_supports_rename_and_clearing(self):
        project = Project.objects.create(name="Initial")
        project.users.add(self.user)

        rename_response = self.client.patch(
            f"/api/projects/{project.pk}/",
            {"name": "  Renamed  "},
            format="json",
        )
        clear_response = self.client.patch(
            f"/api/projects/{project.pk}/",
            {"name": ""},
            format="json",
        )

        self.assertEqual(rename_response.status_code, status.HTTP_200_OK)
        self.assertEqual(rename_response.data["name"], "Renamed")
        self.assertEqual(rename_response.data["display_name"], "Renamed")
        self.assertEqual(clear_response.status_code, status.HTTP_200_OK)
        self.assertEqual(clear_response.data["name"], "")
        self.assertEqual(clear_response.data["display_name"], f"Project {project.pk}")

    def test_project_names_are_labels_and_do_not_need_to_be_unique(self):
        first_response = self.client.post("/api/projects/", {"name": "Repeated"})
        second_response = self.client.post("/api/projects/", {"name": "Repeated"})

        self.assertEqual(first_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second_response.status_code, status.HTTP_201_CREATED)
        self.assertNotEqual(first_response.data["id"], second_response.data["id"])

    def test_project_delete_is_not_exposed_by_this_api(self):
        project = Project.objects.create(name="Keep")
        project.users.add(self.user)

        response = self.client.delete(f"/api/projects/{project.pk}/")

        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertTrue(Project.objects.filter(pk=project.pk).exists())


class EventLogApiTests(TestCase):
    def setUp(self):
        self.media_directory = TemporaryDirectory()
        self.media_override = override_settings(MEDIA_ROOT=self.media_directory.name)
        self.media_override.enable()

        self.client = APIClient()
        self.user = User.objects.create_user(username="event-log-user")
        self.other_user = User.objects.create_user(username="other-event-log-user")
        self.project = Project.objects.create(name="Project A")
        self.project.users.add(self.user)
        self.second_project = Project.objects.create(name="Project B")
        self.second_project.users.add(self.user)
        self.foreign_project = Project.objects.create(name="Foreign")
        self.foreign_project.users.add(self.other_user)
        self.client.force_authenticate(user=self.user)

    def tearDown(self):
        self.media_override.disable()
        self.media_directory.cleanup()

    @staticmethod
    def _upload(filename):
        return SimpleUploadedFile(
            filename,
            b'{"ocel:events": {}, "ocel:objects": {}}',
            content_type="application/json",
        )

    def _create_log(self, project, filename):
        return EventLog.objects.create(project=project, file=filename)

    def test_upload_event_log_into_existing_project(self):
        response = self.client.post(
            "/api/files/",
            {
                "project": self.project.pk,
                "file": self._upload("first.json"),
            },
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        event_log = EventLog.objects.get(pk=response.data["id"])
        self.assertEqual(event_log.project, self.project)
        self.assertEqual(response.data["project"], self.project.pk)
        self.assertIn("updated_at", response.data)

    def test_multiple_event_logs_can_be_uploaded_into_same_project(self):
        first_response = self.client.post(
            "/api/files/",
            {
                "project": self.project.pk,
                "file": self._upload("first.json"),
            },
        )
        second_response = self.client.post(
            "/api/files/",
            {
                "project": self.project.pk,
                "file": self._upload("second.json"),
            },
        )

        self.assertEqual(first_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(self.project.event_logs.count(), 2)

    def test_upload_requires_project_and_does_not_create_one_implicitly(self):
        project_count = Project.objects.count()

        response = self.client.post(
            "/api/files/",
            {"file": self._upload("missing-project.json")},
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("project", response.data)
        self.assertEqual(Project.objects.count(), project_count)
        self.assertEqual(EventLog.objects.count(), 0)

    def test_upload_rejects_project_without_membership(self):
        response = self.client.post(
            "/api/files/",
            {
                "project": self.foreign_project.pk,
                "file": self._upload("foreign.json"),
            },
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("project", response.data)
        self.assertEqual(EventLog.objects.count(), 0)

    def test_list_event_logs_filters_by_project(self):
        first_log = self._create_log(self.project, "first.json")
        second_log = self._create_log(self.second_project, "second.json")

        first_response = self.client.get(
            f"/api/files/?project={self.project.pk}"
        )
        second_response = self.client.get(
            f"/api/files/?project={self.second_project.pk}"
        )

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            [item["id"] for item in first_response.data],
            [first_log.pk],
        )
        self.assertEqual(
            [item["id"] for item in second_response.data],
            [second_log.pk],
        )

    def test_list_event_logs_excludes_inaccessible_projects(self):
        own_log = self._create_log(self.project, "own.json")
        self._create_log(self.foreign_project, "foreign.json")

        response = self.client.get("/api/files/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in response.data], [own_log.pk])

    def test_list_event_logs_rejects_non_integer_project_filter(self):
        response = self.client.get("/api/files/?project=not-an-id")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("project", response.data)

    def test_existing_single_log_project_remains_accessible(self):
        existing_log = self._create_log(self.project, "legacy.json")

        response = self.client.get(
            f"/api/files/?project={self.project.pk}"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data[0]["id"], existing_log.pk)
        self.assertEqual(response.data[0]["project"], self.project.pk)

    def test_existing_event_log_cannot_be_moved_between_projects(self):
        event_log = self._create_log(self.project, "fixed.json")

        response = self.client.patch(
            f"/api/files/{event_log.pk}/",
            {"project": self.second_project.pk},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("project", response.data)
        event_log.refresh_from_db()
        self.assertEqual(event_log.project, self.project)

    def test_delete_event_log_removes_database_row_and_stored_file(self):
        upload_response = self.client.post(
            "/api/files/",
            {
                "project": self.project.pk,
                "file": self._upload("delete-me.json"),
            },
        )
        event_log = EventLog.objects.get(pk=upload_response.data["id"])
        stored_path = Path(event_log.file.path)
        self.assertTrue(stored_path.exists())

        response = self.client.delete(f"/api/files/{event_log.pk}/")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(EventLog.objects.filter(pk=event_log.pk).exists())
        self.assertFalse(stored_path.exists())
        self.assertTrue(Project.objects.filter(pk=self.project.pk).exists())

    def test_delete_event_log_is_scoped_to_accessible_projects(self):
        foreign_log = self._create_log(self.foreign_project, "foreign.json")

        response = self.client.delete(f"/api/files/{foreign_log.pk}/")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(EventLog.objects.filter(pk=foreign_log.pk).exists())


class DashboardApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="dashboard-user")
        self.other_user = User.objects.create_user(username="other-dashboard-user")
        self.first_project = Project.objects.create(name="First project")
        self.first_project.users.add(self.user)
        self.second_project = Project.objects.create(name="Second project")
        self.second_project.users.add(self.user)
        self.foreign_project = Project.objects.create(name="Foreign project")
        self.foreign_project.users.add(self.other_user)
        self.client.force_authenticate(user=self.user)

    @staticmethod
    def _create_dashboard(project, name, order):
        return Dashboard.objects.create(
            project=project,
            name=name,
            order_in_project=order,
        )

    def test_list_dashboards_filters_by_project(self):
        first_dashboard = self._create_dashboard(
            self.first_project,
            "First dashboard",
            1,
        )
        second_dashboard = self._create_dashboard(
            self.second_project,
            "Second dashboard",
            1,
        )

        first_response = self.client.get(
            f"/api/dashboard/?project={self.first_project.pk}"
        )
        second_response = self.client.get(
            f"/api/dashboard/?project={self.second_project.pk}"
        )

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            [item["id"] for item in first_response.data],
            [first_dashboard.pk],
        )
        self.assertEqual(
            [item["id"] for item in second_response.data],
            [second_dashboard.pk],
        )

    def test_list_dashboards_excludes_inaccessible_projects(self):
        own_dashboard = self._create_dashboard(
            self.first_project,
            "Own dashboard",
            1,
        )
        self._create_dashboard(self.foreign_project, "Foreign dashboard", 1)

        response = self.client.get("/api/dashboard/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            [item["id"] for item in response.data],
            [own_dashboard.pk],
        )

    def test_create_dashboard_uses_explicit_accessible_project(self):
        response = self.client.post(
            "/api/dashboard/",
            {"project": self.first_project.pk, "name": "Created dashboard"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        dashboard = Dashboard.objects.get(pk=response.data["id"])
        self.assertEqual(dashboard.project, self.first_project)
        self.assertEqual(dashboard.order_in_project, 1)

    def test_create_dashboard_rejects_inaccessible_project(self):
        response = self.client.post(
            "/api/dashboard/",
            {"project": self.foreign_project.pk, "name": "Foreign dashboard"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("project", response.data)
        self.assertFalse(
            Dashboard.objects.filter(name="Foreign dashboard").exists()
        )


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
        content_json = valid_totem_content_json()
        serializer = self._serializer(
            {
                "project": self.project.pk,
                "name": "  Baseline TOTeM  ",
                "asset_type": ProjectAsset.AssetType.TOTEM,
                "content_json": content_json,
                "metadata": {"source_log_id": 12},
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        asset = serializer.save()

        self.assertEqual(asset.name, "Baseline TOTeM")
        self.assertEqual(asset.content_json, content_json)
        self.assertEqual(asset.metadata["source_log_id"], 12)
        self.assertEqual(asset.created_by, self.user)

    def test_serializer_creates_asset_from_json_file(self):
        content_json = valid_occn_content_json()
        upload = SimpleUploadedFile(
            "model.asset",
            json.dumps(content_json).encode("utf-8"),
            content_type="application/octet-stream",
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

        self.assertEqual(asset.content_json, content_json)

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

    def test_serializer_rejects_non_canonical_model_json(self):
        serializer = self._serializer(
            {
                "project": self.project.pk,
                "name": "Incomplete model",
                "asset_type": ProjectAsset.AssetType.TOTEM,
                "content_json": {"schema": "totem", "version": 1},
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


class EventLogTotemDiscoveryApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(username="totem-api-user")
        self.project = Project.objects.create(name="Project A")
        self.project.users.add(self.user)
        self.event_log = EventLog.objects.create(
            project=self.project,
            file="test-log.json",
        )
        self.client.force_authenticate(user=self.user)

    def _totem(self):
        return Totem(
            tempgraph={
                "nodes": {"Order", "Item"},
                "D": {("Order", "Item")},
                "Di": set(),
                "I": set(),
                "Ii": set(),
                "P": set(),
            },
            cardinalities={
                ("Order", "Item"): {"LC": "1..*", "EC": "0...*"},
            },
            type_relations={frozenset(("Order", "Item"))},
            all_event_types={"Create Order", "Pick Item"},
            object_type_to_event_types={
                "Order": {"Create Order"},
                "Item": {"Pick Item"},
            },
        )

    def test_discover_totem_returns_canonical_totem_v1_json(self):
        totem = self._totem()

        with (
            patch("api.views._with_ocel_db", return_value=nullcontext(object())),
            patch("api.views.totemDiscovery_db", return_value=totem),
        ):
            response = self.client.get(
                f"/api/files/{self.event_log.pk}/discover_totem/"
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, totem_to_dict(totem))
        self.assertEqual(response.data["schema"], "totem")
        self.assertEqual(response.data["version"], 1)


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

    def _create_asset(self, project, name, asset_type):
        content_json = (
            valid_totem_content_json()
            if asset_type == ProjectAsset.AssetType.TOTEM
            else valid_occn_content_json()
        )
        return ProjectAsset.objects.create(
            project=project,
            name=name,
            asset_type=asset_type,
            content_json=content_json,
        )

    def _upload_asset_file(
        self,
        content_json,
        asset_type,
        name="Uploaded model",
        filename="mock.model",
    ):
        upload = SimpleUploadedFile(
            filename,
            json.dumps(content_json).encode("utf-8"),
            content_type="application/octet-stream",
        )
        return self.client.post(
            "/api/assets/",
            {
                "project": self.project.pk,
                "name": name,
                "asset_type": asset_type,
                "file": upload,
            },
        )

    def test_list_assets_only_returns_accessible_project_assets(self):
        own_asset = self._create_asset(
            self.project,
            "Own model",
            ProjectAsset.AssetType.TOTEM,
        )
        self._create_asset(
            self.other_project,
            "Foreign model",
            ProjectAsset.AssetType.OCCN,
        )

        response = self.client.get("/api/assets/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["id"], own_asset.pk)

    def test_list_assets_filters_by_project(self):
        second_project = Project.objects.create(name="Project C")
        second_project.users.add(self.user)
        first_asset = self._create_asset(
            self.project,
            "First model",
            ProjectAsset.AssetType.TOTEM,
        )
        second_asset = self._create_asset(
            second_project,
            "Second model",
            ProjectAsset.AssetType.OCCN,
        )

        first_response = self.client.get(f"/api/assets/?project={self.project.pk}")
        second_response = self.client.get(f"/api/assets/?project={second_project.pk}")

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in first_response.data], [first_asset.pk])
        self.assertEqual([item["id"] for item in second_response.data], [second_asset.pk])

    def test_list_assets_filters_by_asset_type(self):
        totem_asset = self._create_asset(
            self.project,
            "TOTeM model",
            ProjectAsset.AssetType.TOTEM,
        )
        occn_asset = self._create_asset(
            self.project,
            "OCCN model",
            ProjectAsset.AssetType.OCCN,
        )

        totem_response = self.client.get("/api/assets/?asset_type=TOTEM")
        occn_response = self.client.get("/api/assets/?asset_type=OCCN")

        self.assertEqual(totem_response.status_code, status.HTTP_200_OK)
        self.assertEqual(occn_response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in totem_response.data], [totem_asset.pk])
        self.assertEqual([item["id"] for item in occn_response.data], [occn_asset.pk])

    def test_list_assets_rejects_unsupported_asset_type_filter(self):
        response = self.client.get("/api/assets/?asset_type=UNKNOWN")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("asset_type", response.data)

    def test_create_asset_from_direct_content_json(self):
        content_json = valid_totem_content_json()
        response = self.client.post(
            "/api/assets/",
            {
                "project": self.project.pk,
                "name": "API TOTeM",
                "asset_type": ProjectAsset.AssetType.TOTEM,
                "content_json": content_json,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        asset = ProjectAsset.objects.get(pk=response.data["id"])
        self.assertEqual(asset.content_json, content_json)
        self.assertEqual(asset.created_by, self.user)

    def test_create_asset_from_uploaded_json_file(self):
        content_json = valid_occn_content_json()
        upload = SimpleUploadedFile(
            "model.asset",
            json.dumps(content_json).encode("utf-8"),
            content_type="application/octet-stream",
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
        self.assertEqual(response.data["content_json"], content_json)

    def test_upload_accepts_valid_totem_from_arbitrary_file_extension(self):
        content_json = valid_totem_content_json()

        response = self._upload_asset_file(
            content_json,
            ProjectAsset.AssetType.TOTEM,
            name="Verified TOTeM upload",
            filename="mock.totem-model",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["content_json"], content_json)

    def test_upload_accepts_valid_occn_from_arbitrary_file_extension(self):
        content_json = valid_occn_content_json()

        response = self._upload_asset_file(
            content_json,
            ProjectAsset.AssetType.OCCN,
            name="Verified OCCN upload",
            filename="mock.occn-model",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["content_json"], content_json)

    def test_validate_upload_accepts_valid_model_without_persisting_it(self):
        upload = SimpleUploadedFile(
            "model.json",
            json.dumps(valid_totem_content_json()).encode("utf-8"),
            content_type="application/json",
        )

        response = self.client.post(
            "/api/assets/validate/",
            {
                "asset_type": ProjectAsset.AssetType.TOTEM,
                "file": upload,
            },
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, {"valid": True})
        self.assertEqual(ProjectAsset.objects.count(), 0)

    def test_validate_upload_rejects_incomplete_model_without_persisting_it(self):
        content_json = valid_totem_content_json()
        del content_json["tempgraph"]
        upload = SimpleUploadedFile(
            "model.json",
            json.dumps(content_json).encode("utf-8"),
            content_type="application/json",
        )

        response = self.client.post(
            "/api/assets/validate/",
            {
                "asset_type": ProjectAsset.AssetType.TOTEM,
                "file": upload,
            },
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("content_json", response.data)
        self.assertEqual(ProjectAsset.objects.count(), 0)

    def test_upload_rejects_schema_type_mismatch(self):
        response = self._upload_asset_file(
            valid_occn_content_json(),
            ProjectAsset.AssetType.TOTEM,
            name="Mismatched schema upload",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("content_json", response.data)

    def test_upload_rejects_missing_schema_marker(self):
        content_json = valid_totem_content_json()
        del content_json["schema"]

        response = self._upload_asset_file(
            content_json,
            ProjectAsset.AssetType.TOTEM,
            name="Missing schema upload",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("content_json", response.data)

    def test_upload_rejects_unsupported_schema_version(self):
        content_json = valid_totem_content_json()
        content_json["version"] = 2

        response = self._upload_asset_file(
            content_json,
            ProjectAsset.AssetType.TOTEM,
            name="Unsupported version upload",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("content_json", response.data)

    def test_upload_rejects_incomplete_totem_structure(self):
        content_json = valid_totem_content_json()
        del content_json["tempgraph"]

        response = self._upload_asset_file(
            content_json,
            ProjectAsset.AssetType.TOTEM,
            name="Incomplete TOTeM upload",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("content_json", response.data)

    def test_upload_rejects_occn_marker_without_matching_dependency_edge(self):
        content_json = copy.deepcopy(valid_occn_content_json())
        content_json["dependency_graph"]["edges"] = []

        response = self._upload_asset_file(
            content_json,
            ProjectAsset.AssetType.OCCN,
            name="Inconsistent OCCN upload",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("content_json", response.data)

    def test_retrieve_asset_scoped_to_user_project(self):
        own_asset = ProjectAsset.objects.create(
            project=self.project,
            name="Own model",
            asset_type=ProjectAsset.AssetType.TOTEM,
            content_json=valid_totem_content_json(),
        )
        foreign_asset = ProjectAsset.objects.create(
            project=self.other_project,
            name="Foreign model",
            asset_type=ProjectAsset.AssetType.TOTEM,
            content_json=valid_totem_content_json(),
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
            content_json=valid_occn_content_json(),
        )

        response = self.client.delete(f"/api/assets/{asset.pk}/")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(ProjectAsset.objects.filter(pk=asset.pk).exists())

    def test_delete_asset_scoped_to_user_project(self):
        foreign_asset = ProjectAsset.objects.create(
            project=self.other_project,
            name="Foreign delete",
            asset_type=ProjectAsset.AssetType.OCCN,
            content_json=valid_occn_content_json(),
        )

        response = self.client.delete(f"/api/assets/{foreign_asset.pk}/")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(ProjectAsset.objects.filter(pk=foreign_asset.pk).exists())

    def test_download_asset_generates_json_response_from_content_json(self):
        asset = self._create_asset(
            self.project,
            "Download Model",
            ProjectAsset.AssetType.TOTEM,
        )

        response = self.client.get(f"/api/assets/{asset.pk}/download/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, asset.content_json)
        self.assertEqual(
            response["Content-Disposition"],
            'attachment; filename="download-model.json"',
        )

    def test_download_asset_scoped_to_user_project(self):
        foreign_asset = self._create_asset(
            self.other_project,
            "Foreign download",
            ProjectAsset.AssetType.OCCN,
        )

        response = self.client.get(f"/api/assets/{foreign_asset.pk}/download/")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
