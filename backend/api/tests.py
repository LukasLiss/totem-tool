import copy
import json
import os
import shutil
import tempfile
import time
from contextlib import nullcontext
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError
from django.test import SimpleTestCase, TestCase
from rest_framework import status
from rest_framework.test import APIClient, APIRequestFactory
from totem_lib.totem import Totem, totem_to_dict

from .lru_filecache import LRUFileBasedCache
from .models import EventLog, Project, ProjectAsset
from .serializers import ProjectAssetSerializer


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


class LRUFileBasedCacheTests(SimpleTestCase):
    """Eviction policy of the result cache backend (Epic #71).

    Mtimes are set explicitly rather than relying on wall-clock ordering —
    consecutive writes can land inside the filesystem's timestamp resolution,
    which would make ordering assertions flaky.
    """

    def _make_cache(self, max_entries, cull_frequency=2):
        cache_dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, cache_dir, ignore_errors=True)
        return LRUFileBasedCache(
            cache_dir,
            {
                "TIMEOUT": None,
                "OPTIONS": {
                    "MAX_ENTRIES": max_entries,
                    "CULL_FREQUENCY": cull_frequency,
                },
            },
        )

    def _age(self, backend, key, seconds):
        """Backdate *key*'s file by *seconds* to simulate an older access."""
        path = backend._key_to_file(key)
        old = time.time() - seconds
        os.utime(path, (old, old))

    def test_cull_evicts_least_recently_used(self):
        """The oldest *written* entries survive if they were recently *read*.

        k0-k3 start out as the stalest entries, so a random-eviction backend
        would be as likely to drop them as any other; reading them must make
        them the safest. Culling 5 of 10 entries means a random policy has a
        1-in-252 chance of coincidentally matching this assertion.
        """
        backend = self._make_cache(max_entries=10, cull_frequency=2)
        keys = [f"k{i}" for i in range(10)]
        for i, key in enumerate(keys):
            backend.set(key, f"value-{key}")
            self._age(backend, key, 1000 - i)  # k0 oldest ... k9 newest

        # Read the four *oldest* entries, promoting them to most-recently-used.
        for key in keys[:4]:
            self.assertEqual(backend.get(key), f"value-{key}")

        # Trips the cap: culls the 5 least-recently-used, now k4-k8.
        backend.set("k10", "value-k10")

        survivors = {"k0", "k1", "k2", "k3", "k9", "k10"}
        evicted = {"k4", "k5", "k6", "k7", "k8"}
        for key in survivors:
            self.assertEqual(backend.get(key), f"value-{key}", f"{key} should survive")
        for key in evicted:
            self.assertIsNone(backend.get(key), f"{key} should be evicted")

    def test_get_marks_entry_as_recently_used(self):
        backend = self._make_cache(max_entries=10)
        backend.set("k", "v")
        self._age(backend, "k", 1000)
        before = os.path.getmtime(backend._key_to_file("k"))

        backend.get("k")

        self.assertGreater(os.path.getmtime(backend._key_to_file("k")), before)

    def test_miss_does_not_create_entry_and_returns_default(self):
        backend = self._make_cache(max_entries=10)
        self.assertEqual(backend.get("absent", "fallback"), "fallback")
        self.assertFalse(backend._list_cache_files())

    def test_cached_none_is_returned_as_a_hit(self):
        """A stored ``None`` must not be mistaken for a miss."""
        backend = self._make_cache(max_entries=10)
        backend.set("k", None)
        self.assertIsNone(backend.get("k", "fallback"))

    def test_cull_frequency_zero_clears_cache(self):
        """Matches the superclass contract: CULL_FREQUENCY=0 purges everything."""
        backend = self._make_cache(max_entries=2, cull_frequency=0)
        backend.set("a", "value-a")
        backend.set("b", "value-b")  # cap reached -> next set() clears
        backend.set("c", "value-c")

        self.assertIsNone(backend.get("a"))
        self.assertIsNone(backend.get("b"))
        self.assertEqual(backend.get("c"), "value-c")
