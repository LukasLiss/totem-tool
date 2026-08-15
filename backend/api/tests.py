import copy
import json
from contextlib import nullcontext
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient, APIRequestFactory
from totem_lib.totem import Totem, totem_to_dict
from totem_lib.process_areas import (
    CardinalityCounts,
    DivergenceCounts,
    LogAggregates,
    TemporalCounts,
)

from .models import Dashboard, EventLog, ProcessAreaComponent, Project, ProjectAsset
from .serializers import ProjectAssetSerializer
from .views import _parse_process_area_params, _process_area_cache_key


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


# ---------------------------------------------------------------------------
# Endpoint tests for the playout API (POST /api/playout/ and
# POST /api/playout/export-ocel/).
#
# The tiny models are hand-built in the editor JSON shapes
# (frontend/src/editors/shared/model-types.ts: OcpnModelFile / OccnModelFile);
# the playout itself is covered in depth by totem_lib/tests/playout/.
# ---------------------------------------------------------------------------

PLAYOUT_URL = "/api/playout/"
EXPORT_OCEL_URL = "/api/playout/export-ocel/"


def tiny_ocpn_model() -> dict:
    """Smallest live OCPN: initial place -> "place order" -> final place."""
    return {
        "format": "ocpn",
        "version": 1,
        "name": "tiny ocpn",
        "objectTypes": [{"name": "order"}],
        "places": [
            {"id": "p1", "objectType": "order", "initial": True},
            {"id": "p2", "objectType": "order", "final": True},
        ],
        "transitions": [{"id": "t1", "label": "place order"}],
        "arcs": [
            {"id": "a1", "source": "p1", "target": "t1"},
            {"id": "a2", "source": "t1", "target": "p2"},
        ],
    }


def tiny_occn_model() -> dict:
    """Smallest OCCN: START_order -> act -> END_order for one object type."""
    return {
        "format": "occn",
        "version": 1,
        "name": "tiny occn",
        "objectTypes": [{"name": "order"}],
        "activities": [{"name": "START_order"}, {"name": "act"}, {"name": "END_order"}],
        "arcs": [
            {"source": "START_order", "target": "act", "objectType": "order"},
            {"source": "act", "target": "END_order", "objectType": "order"},
        ],
        "markerGroups": {
            "START_order": {"img": [], "omg": [[["act", "order", [1, 1], 0]]]},
            "act": {
                "img": [[["START_order", "order", [1, 1], 0]]],
                "omg": [[["END_order", "order", [1, 1], 0]]],
            },
            "END_order": {"img": [[["act", "order", [1, 1], 0]]], "omg": []},
        },
    }


def playout_body(**overrides) -> dict:
    body = {
        "modelFormat": "ocpn",
        "model": tiny_ocpn_model(),
        "objectsPerType": {"order": 1},
        "activityLimits": {"place order": 1},
        "timeoutS": 10,
    }
    body.update(overrides)
    return body


class PlayoutEndpointTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="playout-tester", password="irrelevant"
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    # --- auth ---------------------------------------------------------------

    def test_playout_requires_authentication(self):
        anonymous = APIClient()
        for url in (PLAYOUT_URL, EXPORT_OCEL_URL):
            response = anonymous.post(url, {}, format="json")
            self.assertIn(response.status_code, (401, 403), url)

    # --- malformed bodies ---------------------------------------------------

    def test_playout_rejects_bad_model_format(self):
        response = self.client.post(
            PLAYOUT_URL, playout_body(modelFormat="totem"), format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json())

    def test_playout_rejects_missing_model(self):
        body = playout_body()
        del body["model"]
        response = self.client.post(PLAYOUT_URL, body, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json())

    # --- happy paths --------------------------------------------------------

    def test_playout_ocpn_happy_path(self):
        response = self.client.post(PLAYOUT_URL, playout_body(), format="json")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data["variantCount"], 1)
        self.assertTrue(data["exhaustive"])
        self.assertFalse(data["timedOut"])
        (variant,) = data["variants"]
        (event,) = variant["events"]
        self.assertEqual(event["activity"], "place order")
        self.assertEqual(event["objects"], {"order": ["order_1"]})
        self.assertEqual(data["effectiveActivityLimits"], {"place order": 1})

    def test_playout_occn_happy_path(self):
        body = playout_body(
            modelFormat="occn",
            model=tiny_occn_model(),
            activityLimits={"act": 1},
        )
        response = self.client.post(PLAYOUT_URL, body, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertGreaterEqual(data["variantCount"], 1)
        # START_/END_ pseudo activities are auto-limited to the object count.
        self.assertEqual(data["effectiveActivityLimits"]["START_order"], 1)
        self.assertEqual(data["effectiveActivityLimits"]["END_order"], 1)

    # --- OCEL export ----------------------------------------------------------

    def test_export_ocel_happy_path(self):
        body = {
            "variants": [
                {
                    "events": [
                        {"activity": "place order", "objects": {"order": ["order_1"]}}
                    ],
                    "objectCounts": {"order": 1},
                }
            ]
        }
        response = self.client.post(EXPORT_OCEL_URL, body, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(
            set(data.keys()), {"objectTypes", "eventTypes", "objects", "events"}
        )
        self.assertEqual([t["name"] for t in data["objectTypes"]], ["order"])
        self.assertEqual([t["name"] for t in data["eventTypes"]], ["place order"])
        self.assertEqual(len(data["objects"]), 1)
        self.assertEqual(len(data["events"]), 1)
        self.assertEqual(data["events"][0]["type"], "place order")

    def test_export_ocel_rejects_malformed_variants(self):
        response = self.client.post(
            EXPORT_OCEL_URL, {"variants": "nope"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json())

    # --- regression: adversarial inputs must be 400s, never 500s -------------

    def test_playout_malformed_occn_marker_group_is_a_400(self):
        model = {
            "format": "occn",
            "version": 1,
            "name": "broken",
            "objectTypes": [{"name": "order"}],
            "activities": [{"name": "a"}],
            "arcs": [],
            # Empty marker (no fields at all) — used to raise IndexError (500).
            "markerGroups": {"a": {"img": [[[]]], "omg": []}},
        }
        response = self.client.post(
            PLAYOUT_URL,
            playout_body(modelFormat="occn", model=model, objectsPerType={"order": 1}),
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("error", response.json())

    def test_playout_overflowing_json_numbers_are_clamped_not_500(self):
        # 1e400 parses to float('inf'); int(inf) used to raise OverflowError
        # (500). The test client cannot encode inf, so send raw JSON text.
        body = playout_body()
        body["objectsPerType"] = {"order": "__INF__"}
        body["maxStates"] = "__INF__"
        raw = json.dumps(body).replace('"__INF__"', "1e400")
        response = self.client.post(PLAYOUT_URL, data=raw, content_type="application/json")
        self.assertEqual(response.status_code, 200, response.content)

    def test_export_ocel_rejects_oversized_object_counts(self):
        body = {"variants": [{"events": [], "objectCounts": {"A": 999_999_999}}]}
        response = self.client.post(EXPORT_OCEL_URL, body, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("error", response.json())

    def test_export_ocel_rejects_excessive_total_objects(self):
        variants = [{"events": [], "objectCounts": {"A": 10_000}} for _ in range(51)]
        response = self.client.post(EXPORT_OCEL_URL, {"variants": variants}, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("more than", response.json()["error"])

    def test_export_ocel_infinite_object_count_is_a_400(self):
        raw = '{"variants": [{"events": [], "objectCounts": {"A": 1e400}}]}'
        response = self.client.post(EXPORT_OCEL_URL, data=raw, content_type="application/json")
        self.assertEqual(response.status_code, 400, response.content)


class ProcessAreaDiscoveryApiTests(TestCase):
    """
    `discover_process_areas` — the advanced (thesis section 4.1) layering
    engine, exposed alongside `discover_mlpa` rather than replacing it.
    """

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = User.objects.create_user(username="process-area-user")
        self.project = Project.objects.create(name="Project PA")
        self.project.users.add(self.user)
        self.event_log = EventLog.objects.create(
            project=self.project,
            file="test-log.json",
        )
        self.client.force_authenticate(user=self.user)

    def _totem(self):
        return Totem(
            tempgraph={
                "nodes": {"Order", "Item", "Worker"},
                "D": {("Order", "Item")},
                "Di": set(),
                "I": set(),
                "Ii": set(),
                "P": {("Order", "Worker")},
            },
            cardinalities={("Order", "Item"): {"LC": "1..*", "EC": "0...*"}},
            type_relations={
                frozenset(("Order", "Item")),
                frozenset(("Order", "Worker")),
            },
            all_event_types={"Create Order", "Pick Item"},
            object_type_to_event_types={
                "Order": {"Create Order"},
                "Item": {"Pick Item"},
                "Worker": {"Pick Item"},
            },
        )

    def _aggregates(self):
        """
        A three-type toy log: Worker outlives Order, which outlives Item.
        Enough structure that the ILP produces a real hierarchy.
        """
        types = ("Item", "Order", "Worker")
        temporal = {}
        for source in types:
            for target in types:
                temporal[(source, target)] = TemporalCounts(total=10)
        temporal[("Item", "Order")] = TemporalCounts(total=10, dependent=10)
        temporal[("Order", "Worker")] = TemporalCounts(total=10, dependent=10)
        temporal[("Item", "Worker")] = TemporalCounts(total=10, dependent=10)

        return LogAggregates(
            object_types=types,
            object_counts={"Item": 30, "Order": 10, "Worker": 2},
            temporal=temporal,
            cardinality={
                (source, target): CardinalityCounts(total=10, constant=10)
                for source in types
                for target in types
            },
            divergence={
                (source, target): DivergenceCounts(related_sources=10)
                for source in types
                for target in types
            },
            event_types_by_object_type={
                "Order": frozenset({"Create Order"}),
                "Item": frozenset({"Pick Item"}),
                "Worker": frozenset({"Pick Item"}),
            },
            all_event_types=frozenset({"Create Order", "Pick Item"}),
            type_relations=frozenset(
                {frozenset({"Order", "Item"}), frozenset({"Order", "Worker"})}
            ),
        )

    def _get(self, query=""):
        url = f"/api/files/{self.event_log.pk}/discover_process_areas/{query}"
        with (
            patch("api.views._with_ocel_db", return_value=nullcontext(object())),
            patch("api.views.totemDiscovery_db", return_value=self._totem()),
            patch("api.views.prepare_db", return_value=self._aggregates()) as prepared,
        ):
            return self.client.get(url), prepared

    def test_returns_the_same_schema_as_mlpa(self):
        response, _ = self._get()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            set(response.data),
            {
                "layers",
                "tempgraph",
                "type_relations",
                "all_event_types",
                "object_type_to_event_types",
            },
        )
        layers = response.data["layers"]
        self.assertTrue(layers)
        for layer in layers:
            self.assertIn("level", layer)
            for area in layer["areas"]:
                self.assertIn("objectTypes", area)
                self.assertIn("eventTypes", area)

    def test_resources_land_on_the_higher_layers(self):
        # alpha weights the resource force. Turning it up is exactly how a user
        # asks for a hierarchy rather than a flat, cohesion-dominated view.
        response, _ = self._get("?alpha=25")
        level_of = {
            object_type: layer["level"]
            for layer in response.data["layers"]
            for area in layer["areas"]
            for object_type in area["objectTypes"]
        }
        self.assertGreater(level_of["Worker"], level_of["Order"])
        self.assertGreater(level_of["Order"], level_of["Item"])

    def test_each_parameter_gets_its_own_cache_entry(self):
        first, _ = self._get("?alpha=1")
        second, _ = self._get("?alpha=25")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertNotEqual(first.data["layers"], second.data["layers"])

    def test_every_parameter_is_part_of_the_cache_key(self):
        base = _parse_process_area_params({})
        base_key = _process_area_cache_key(1, base)
        for query, value in [
            ("w_temporal", "0.5"),
            ("w_cardinality", "0.5"),
            ("w_divergence", "0.5"),
            ("alpha", "2"),
            ("beta", "3"),
        ]:
            changed = _parse_process_area_params({query: value})
            self.assertNotEqual(
                base_key, _process_area_cache_key(1, changed), query
            )
        self.assertNotEqual(base_key, _process_area_cache_key(2, base))

    def test_preparation_is_cached_across_parameter_changes(self):
        _, first_prepare = self._get("?alpha=1")
        _, second_prepare = self._get("?alpha=25")
        self.assertEqual(first_prepare.call_count, 1)
        self.assertEqual(second_prepare.call_count, 0)

    def test_repeated_identical_request_is_served_from_cache(self):
        self._get("?alpha=4")
        _, prepared = self._get("?alpha=4")
        self.assertEqual(prepared.call_count, 0)

    def test_unknown_file_is_a_404(self):
        response = self.client.get("/api/files/999999/discover_process_areas/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_invalid_parameters_are_400_not_500(self):
        for query in [
            "?alpha=-1",
            "?beta=-0.5",
            "?alpha=abc",
            "?beta=nan",
            "?alpha=inf",
            "?w_temporal=-2",
            "?w_temporal=0&w_cardinality=0&w_divergence=0",
        ]:
            with self.subTest(query=query):
                response = self.client.get(
                    f"/api/files/{self.event_log.pk}/discover_process_areas/{query}"
                )
                self.assertEqual(
                    response.status_code, status.HTTP_400_BAD_REQUEST, query
                )
                self.assertIn("error", response.data)

    def test_mlpa_cache_key_is_untouched(self):
        totem = self._totem()
        with (
            patch("api.views._with_ocel_db", return_value=nullcontext(object())),
            patch("api.views.totemDiscovery_db", return_value=totem),
        ):
            response = self.client.get(
                f"/api/files/{self.event_log.pk}/discover_mlpa/"
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNotNone(cache.get(f"mlpa_discovery_{self.event_log.pk}"))


class ProcessAreaComponentPersistenceTests(TestCase):
    """
    Dashboard round-trip for the Process Area component's discovery settings.

    Before this the model was an empty `pass`, so tuning the indicator weights
    was lost on every reload.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="process-area-dash-user")
        self.project = Project.objects.create(name="Project PA Dash")
        self.project.users.add(self.user)
        self.dashboard = Dashboard.objects.create(
            project=self.project, name="PA", order_in_project=0
        )
        self.client.force_authenticate(user=self.user)

    def _save(self, extra=None):
        item = {
            "x": 0, "y": 0, "w": 6, "h": 6,
            "component_name": "ProcessAreaComponent",
        }
        item.update(extra or {})
        return self.client.post(
            f"/api/dashboard/{self.dashboard.pk}/save_layout/",
            {"layout": [item]},
            format="json",
        )

    def test_settings_survive_a_save_and_reload(self):
        response = self._save({
            "algorithm": "advanced",
            "w_temporal": 0.5,
            "w_cardinality": 0.0,
            "w_divergence": 1.5,
            "alpha": 8.0,
            "beta": 0.5,
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)

        layout = self.client.get(f"/api/dashboard/{self.dashboard.pk}/get_layout/")
        self.assertEqual(layout.status_code, status.HTTP_200_OK)
        component = layout.data[0]
        self.assertEqual(component["algorithm"], "advanced")
        self.assertEqual(component["w_temporal"], 0.5)
        self.assertEqual(component["w_cardinality"], 0.0)
        self.assertEqual(component["w_divergence"], 1.5)
        self.assertEqual(component["alpha"], 8.0)
        self.assertEqual(component["beta"], 0.5)

    def test_mlpa_selection_is_persisted(self):
        self._save({"algorithm": "mlpa"})
        layout = self.client.get(f"/api/dashboard/{self.dashboard.pk}/get_layout/")
        self.assertEqual(layout.data[0]["algorithm"], "mlpa")

    def test_a_component_saved_without_settings_gets_the_defaults(self):
        # This is the shape a dashboard created before this change sends back.
        response = self._save()
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)

        layout = self.client.get(f"/api/dashboard/{self.dashboard.pk}/get_layout/")
        component = layout.data[0]
        self.assertEqual(component["algorithm"], "advanced")
        self.assertEqual(component["w_temporal"], 1.0)
        self.assertEqual(component["w_cardinality"], 1.0)
        self.assertEqual(component["w_divergence"], 1.0)
        self.assertEqual(component["alpha"], 1.0)
        self.assertEqual(component["beta"], 1.0)

    def test_existing_rows_are_backfilled_by_the_migration_defaults(self):
        component = ProcessAreaComponent.objects.create(
            dashboard=self.dashboard,
            x=0, y=0, w=6, h=6,
            component_name="ProcessAreaComponent",
        )
        component.refresh_from_db()
        self.assertEqual(component.algorithm, "advanced")
        self.assertEqual(component.alpha, 1.0)
        self.assertEqual(component.beta, 1.0)

    def test_get_layout_exposes_the_new_fields(self):
        self._save({"alpha": 3.0})
        layout = self.client.get(f"/api/dashboard/{self.dashboard.pk}/get_layout/")
        self.assertLessEqual(
            {"algorithm", "w_temporal", "w_cardinality", "w_divergence", "alpha", "beta"},
            set(layout.data[0]),
        )
