import copy
import json
import os
import shutil
import tempfile
import time
from contextlib import nullcontext
from unittest.mock import patch

import polars as pl
from django.contrib.auth import get_user_model
from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError
from django.test import SimpleTestCase, TestCase
from rest_framework import status
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate
from totem_lib import (
    CONNECTED_COMPONENTS_REPLAY_STRATEGY,
    LEADING_OBJECT_REPLAY_STRATEGY,
    OCCausalNet,
    OCCNReplayEvent,
    OCCNReplayFitnessResult,
    OCCNReplayStatus,
    OCCNReplayUnit,
    OCCNReplayUnitResult,
    occn_to_dict,
)
from totem_lib.ocel.ocel import (
    EVENTS_SCHEMA,
    OBJECTS_SCHEMA,
    ObjectCentricEventLog,
)
from totem_lib.ocel.ocel_duckdb import OcelDuckDB
from totem_lib.totem import Totem, totem_to_dict
from totem_lib.process_areas import (
    CardinalityCounts,
    DivergenceCounts,
    LogAggregates,
    TemporalCounts,
)

from .cache_utils import RESULTS_CACHE, get_cached_result, make_cache_key
from .lru_filecache import LRUFileBasedCache
from .models import (
    Dashboard,
    EventLog,
    ProcessAreaComponent,
    Project,
    ProjectAsset,
    TextBoxComponent,
)
from .serializers import ProjectAssetSerializer
from .views import _parse_process_area_params, _process_area_cache_params, EventLogViewSet
from .views._ocel_db import (
    _OCEL_DB_REGISTRY,
    _OCEL_DB_REGISTRY_LOCK,
    _close_ocel_db,
    _with_ocel_db,
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


def replayable_occn_content_json():
    return occn_to_dict(
        OCCausalNet.from_dict(
            {
                "START_Order": {"omg": [[("Create Order", "Order", (1, 1), 1)]]},
                "Create Order": {
                    "img": [[("START_Order", "Order", (1, 1), 1)]],
                    "omg": [[("END_Order", "Order", (1, 1), 1)]],
                },
                "END_Order": {"img": [[("Create Order", "Order", (1, 1), 1)]]},
            }
        )
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
            patch("api.views.event_log._with_ocel_db", return_value=nullcontext(object())),
            patch("api.views.event_log.totemDiscovery_db", return_value=totem),
        ):
            response = self.client.get(
                f"/api/files/{self.event_log.pk}/discover_totem/"
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        expected = totem_to_dict(totem)
        expected["relations_stats"] = []
        self.assertEqual(response.data, expected)
        self.assertEqual(response.data["schema"], "totem")
        self.assertEqual(response.data["version"], 1)


class EventLogReplaceIsNotAllowedTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="no-replace-user")
        self.project = Project.objects.create(name="No Replace")
        self.project.users.add(self.user)
        self.event_log = EventLog.objects.create(project=self.project, file="keep.duckdb")
        self.client.force_authenticate(user=self.user)

    def test_put_and_patch_are_rejected(self):
        for method in (self.client.put, self.client.patch):
            response = method(
                f"/api/files/{self.event_log.pk}/",
                {"file": SimpleUploadedFile("other.json", b"{}")},
                format="multipart",
            )
            self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.event_log.refresh_from_db()
        self.assertEqual(self.event_log.file.name, "keep.duckdb")


class ProjectRenameAndDeleteTests(TestCase):
    """The project switcher's rename and delete actions (issue #360, item 15)."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="owner")
        self.other = User.objects.create_user(username="colleague")
        self.media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media, ignore_errors=True)
        self.project = Project.objects.create(name="ocel2-p2p_owner")
        self.project.users.add(self.user)
        self.event_log = EventLog.objects.create(
            project=self.project, file="log.duckdb"
        )
        self.client.force_authenticate(user=self.user)

    def _log_on_disk(self):
        """Give the event log a real file under a throwaway MEDIA_ROOT."""
        path = os.path.join(self.media, "log.duckdb")
        with open(path, "wb") as handle:
            handle.write(b"not really duckdb")
        return path

    def test_rename_sets_display_name_and_leaves_the_slug_alone(self):
        response = self.client.patch(
            f"/api/files/{self.event_log.pk}/rename/",
            {"name": "Purchase-to-pay study"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["display_name"], "Purchase-to-pay study")
        self.project.refresh_from_db()
        self.assertEqual(self.project.display_name, "Purchase-to-pay study")
        # `name` is a directory name for image uploads and must not follow.
        self.assertEqual(self.project.name, "ocel2-p2p_owner")

    def test_rename_rejects_an_empty_name(self):
        for value in ("", "   "):
            response = self.client.patch(
                f"/api/files/{self.event_log.pk}/rename/",
                {"name": value},
                format="json",
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.project.refresh_from_db()
        self.assertEqual(self.project.display_name, "")

    def test_rename_rejects_a_name_over_the_field_limit(self):
        limit = Project._meta.get_field("display_name").max_length
        response = self.client.patch(
            f"/api/files/{self.event_log.pk}/rename/",
            {"name": "x" * (limit + 1)},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_rename_is_refused_for_someone_elses_project(self):
        self.client.force_authenticate(user=self.other)
        response = self.client.patch(
            f"/api/files/{self.event_log.pk}/rename/",
            {"name": "mine now"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_delete_removes_the_project_and_the_file_on_disk(self):
        path = self._log_on_disk()
        with self.settings(MEDIA_ROOT=self.media):
            response = self.client.delete(f"/api/files/{self.event_log.pk}/")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(EventLog.objects.filter(pk=self.event_log.pk).exists())
        self.assertFalse(Project.objects.filter(pk=self.project.pk).exists())
        self.assertFalse(os.path.exists(path))

    def test_delete_evicts_the_cached_duckdb_connection(self):
        path = self._log_on_disk()
        pk = int(self.event_log.pk)

        class FakeDb:
            closed = False

            def close(self):
                FakeDb.closed = True

        with _OCEL_DB_REGISTRY_LOCK:
            _OCEL_DB_REGISTRY[pk] = FakeDb()
        self.addCleanup(lambda: _OCEL_DB_REGISTRY.pop(pk, None))

        with self.settings(MEDIA_ROOT=self.media):
            self.client.delete(f"/api/files/{self.event_log.pk}/")

        self.assertTrue(FakeDb.closed)
        self.assertNotIn(pk, _OCEL_DB_REGISTRY)

    def test_delete_of_a_shared_project_only_drops_the_membership(self):
        self.project.users.add(self.other)
        path = self._log_on_disk()

        with self.settings(MEDIA_ROOT=self.media):
            response = self.client.delete(f"/api/files/{self.event_log.pk}/")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.project.refresh_from_db()
        self.assertEqual(list(self.project.users.all()), [self.other])
        self.assertTrue(EventLog.objects.filter(pk=self.event_log.pk).exists())
        self.assertTrue(os.path.exists(path))
        # Gone from the owner's listing all the same.
        self.assertEqual(self.client.get("/api/files/").data, [])

    def test_delete_keeps_a_project_that_still_has_another_log(self):
        sibling = EventLog.objects.create(project=self.project, file="other.duckdb")
        path = self._log_on_disk()

        with self.settings(MEDIA_ROOT=self.media):
            self.client.delete(f"/api/files/{self.event_log.pk}/")

        self.assertTrue(Project.objects.filter(pk=self.project.pk).exists())
        self.assertTrue(EventLog.objects.filter(pk=sibling.pk).exists())
        self.assertFalse(os.path.exists(path))

    def test_listing_exposes_the_display_name(self):
        self.project.display_name = "Purchase-to-pay study"
        self.project.save(update_fields=["display_name"])
        response = self.client.get("/api/files/")
        self.assertEqual(
            response.data[0]["display_name"], "Purchase-to-pay study"
        )


class DeleteUserDataTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="deleter")
        self.other = User.objects.create_user(username="colleague")
        self.own = Project.objects.create(name="own")
        self.own.users.add(self.user)
        self.shared = Project.objects.create(name="shared")
        self.shared.users.add(self.user, self.other)
        self.client.force_authenticate(user=self.user)

    def test_requires_confirmation(self):
        response = self.client.delete("/api/delete-data/", {}, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(Project.objects.filter(pk=self.own.pk).exists())

    def test_shared_projects_survive_for_other_members(self):
        response = self.client.delete(
            "/api/delete-data/", {"confirm": "DELETE"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(Project.objects.filter(pk=self.own.pk).exists())
        self.shared.refresh_from_db()
        self.assertEqual(list(self.shared.users.all()), [self.other])
        self.assertEqual(response.data["deleted_projects"], 1)
        self.assertEqual(response.data["left_shared_projects"], 1)


class ApiInputValidationTests(TestCase):
    """Client mistakes must be 400s, not 500s."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="validation-user")
        self.project = Project.objects.create(name="Validation")
        self.project.users.add(self.user)
        self.event_log = EventLog.objects.create(project=self.project, file="v.duckdb")
        self.client.force_authenticate(user=self.user)

    def test_variants_with_non_integer_file_id_is_400(self):
        response = self.client.get("/api/variants/?file_id=abc")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_dotted_chart_with_non_integer_time_bounds_is_400(self):
        response = self.client.get(
            f"/api/files/{self.event_log.pk}/oc_dotted_chart/?t_min=abc"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_invalid_filter_definition_is_400(self):
        with patch("api.views.event_log._with_ocel_db", return_value=nullcontext(object())):
            response = self.client.post(
                f"/api/files/{self.event_log.pk}/apply_filters/",
                {"filters": [{"type": "definitely-not-a-filter"}]},
                format="json",
            )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_long_upload_filename_yields_project_name_within_limit(self):
        from .views.event_log import _project_name_for_upload

        name = _project_name_for_upload("x" * 80 + ".json", self.user.username)
        self.assertLessEqual(len(name), 30)
        self.assertTrue(name.endswith(f"_{self.user.username}"))
        self.assertEqual(
            _project_name_for_upload("log.json", "bob"), "logjson_bob"
        )


class EventLogObjectTypesApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="object-types-user")
        self.project = Project.objects.create(name="Object Types Project")
        self.project.users.add(self.user)
        self.event_log = EventLog.objects.create(
            project=self.project,
            file="object-types.xml",
        )
        self.url = f"/api/files/{self.event_log.pk}/object_types/"
        self.client.force_authenticate(user=self.user)

    def test_returns_cached_metadata_without_taking_algorithm_lock(self):
        with (
            patch(
                "api.views.event_log._get_ocel_object_types",
                return_value=["Item", "Order"],
            ) as get_types,
            patch("api.views.event_log._with_ocel_db") as algorithm_lock,
        ):
            response = self.client.get(self.url, {"bypass_cache": "1"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, ["Item", "Order"])
        get_types.assert_called_once()
        self.assertEqual(get_types.call_args.args[0].pk, self.event_log.pk)
        algorithm_lock.assert_not_called()


class TotemConformanceApiValidationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="conformance-api-user")
        self.other_user = User.objects.create_user(username="conformance-other-user")

        self.project = Project.objects.create(name="Project A")
        self.project.users.add(self.user)
        self.event_log = EventLog.objects.create(
            project=self.project,
            file="test-log.json",
        )
        self.totem_asset = ProjectAsset.objects.create(
            project=self.project,
            name="Selected TOTeM",
            asset_type=ProjectAsset.AssetType.TOTEM,
            content_json=valid_totem_content_json(),
        )
        self.url = f"/api/files/{self.event_log.pk}/totem_conformance/"
        self.client.force_authenticate(user=self.user)

    def _post_directly_to_view(self):
        request = APIRequestFactory().post(
            self.url,
            {"asset_id": self.totem_asset.pk},
            format="json",
        )
        force_authenticate(request, user=self.user)
        return EventLogViewSet.as_view({"post": "totem_conformance"})(
            request,
            pk=self.event_log.pk,
        )

    def test_request_requires_asset_id(self):
        response = self.client.post(self.url, {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("asset_id", response.data)

    def test_request_requires_positive_integer_asset_id(self):
        zero_response = self.client.post(
            self.url,
            {"asset_id": 0},
            format="json",
        )
        string_response = self.client.post(
            self.url,
            {"asset_id": "not-an-id"},
            format="json",
        )

        self.assertEqual(zero_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(string_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("asset_id", zero_response.data)
        self.assertIn("asset_id", string_response.data)

    def test_event_log_is_scoped_to_authenticated_user(self):
        foreign_project = Project.objects.create(name="Foreign Project")
        foreign_project.users.add(self.other_user)
        foreign_log = EventLog.objects.create(
            project=foreign_project,
            file="foreign-log.json",
        )

        response = self.client.post(
            f"/api/files/{foreign_log.pk}/totem_conformance/",
            {"asset_id": self.totem_asset.pk},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_inaccessible_asset_returns_not_found(self):
        foreign_project = Project.objects.create(name="Foreign Project")
        foreign_project.users.add(self.other_user)
        foreign_asset = ProjectAsset.objects.create(
            project=foreign_project,
            name="Foreign TOTeM",
            asset_type=ProjectAsset.AssetType.TOTEM,
            content_json=valid_totem_content_json(),
        )

        response = self.client.post(
            self.url,
            {"asset_id": foreign_asset.pk},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn("asset_id", response.data)

    def test_asset_from_another_accessible_project_is_rejected(self):
        other_project = Project.objects.create(name="Other Accessible Project")
        other_project.users.add(self.user)
        other_asset = ProjectAsset.objects.create(
            project=other_project,
            name="Other TOTeM",
            asset_type=ProjectAsset.AssetType.TOTEM,
            content_json=valid_totem_content_json(),
        )

        response = self.client.post(
            self.url,
            {"asset_id": other_asset.pk},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("event log project", response.data["asset_id"])

    def test_wrong_asset_type_is_rejected(self):
        occn_asset = ProjectAsset.objects.create(
            project=self.project,
            name="Wrong model type",
            asset_type=ProjectAsset.AssetType.OCCN,
            content_json=valid_occn_content_json(),
        )

        response = self.client.post(
            self.url,
            {"asset_id": occn_asset.pk},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("TOTEM", response.data["asset_id"])

    def test_valid_request_executes_conformance_and_returns_result(self):
        expected_result = {
            "overall_metrics": {
                "temporal": {"fitness": 1.0, "precision": 0.75},
                "log_cardinality": {"fitness": 0.8, "precision": 0.6},
                "event_cardinality": {"fitness": 0.9, "precision": 0.7},
            },
            "object_type_metrics": {
                "Item": {
                    "temporal": {"avg_fitness": 1.0, "avg_precision": 0.75},
                    "log_cardinality": {
                        "avg_fitness": 0.8,
                        "avg_precision": 0.6,
                    },
                    "event_cardinality": {
                        "avg_fitness": 0.9,
                        "avg_precision": 0.7,
                    },
                },
                "Order": {
                    "temporal": {"avg_fitness": 1.0, "avg_precision": 0.75},
                    "log_cardinality": {
                        "avg_fitness": 0.8,
                        "avg_precision": 0.6,
                    },
                    "event_cardinality": {
                        "avg_fitness": 0.9,
                        "avg_precision": 0.7,
                    },
                },
            },
            "type_pair_metrics": [
                {
                    "source_type": "Order",
                    "target_type": "Item",
                    "temporal": {
                        "model_relation": "D",
                        "fitness": 1.0,
                        "precision": 0.75,
                    },
                    "log_cardinality": {
                        "model_relation": "1..*",
                        "fitness": 0.8,
                        "precision": 0.6,
                    },
                    "event_cardinality": {
                        "model_relation": "0...*",
                        "fitness": 0.9,
                        "precision": 0.7,
                    },
                }
            ],
            "histograms": {
                "temporal": [
                    {
                        "source_type": "Order",
                        "target_type": "Item",
                        "counts": {"D": 4, "P": 1},
                    }
                ],
                "log_cardinality": [
                    {
                        "source_type": "Order",
                        "target_type": "Item",
                        "counts": {"1..*": 4, "0...*": 1},
                    }
                ],
                "event_cardinality": [
                    {
                        "source_type": "Order",
                        "target_type": "Item",
                        "counts": {"0...*": 5},
                    }
                ],
                "event_cardinality_by_activity": [
                    {
                        "source_type": "Order",
                        "target_type": "Item",
                        "activity": "Pick Item",
                        "counts": {"0...*": 5},
                    }
                ],
                "temporal_by_relation_type": [
                    {
                        "source_type": "Order",
                        "target_type": "Item",
                        "relation_type": "qualified",
                        "counts": {"D": 4, "P": 1},
                    }
                ],
                "log_cardinality_by_relation_type": [
                    {
                        "source_type": "Order",
                        "target_type": "Item",
                        "relation_type": "qualified",
                        "counts": {"1..*": 4, "0...*": 1},
                    }
                ],
            },
        }
        db = object()
        with (
            patch(
                "api.views.event_log._with_ocel_db",
                return_value=nullcontext(db),
            ) as load_ocel,
            patch("api.views.event_log.conformance_of_totem") as conformance,
        ):
            conformance.return_value.to_dict.return_value = expected_result
            response = self.client.post(
                self.url,
                {"asset_id": self.totem_asset.pk},
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data,
            {
                "file_id": self.event_log.pk,
                "asset_id": self.totem_asset.pk,
                **expected_result,
            },
        )
        load_ocel.assert_called_once()
        self.assertEqual(load_ocel.call_args.args[0].pk, self.event_log.pk)
        conformance.assert_called_once()
        deserialized_totem, called_db = conformance.call_args.args
        self.assertIsInstance(deserialized_totem, Totem)
        self.assertEqual(
            deserialized_totem.cardinalities,
            {("Order", "Item"): {"LC": "1..*", "EC": "0...*"}},
        )
        self.assertIs(called_db, db)

    def test_invalid_stored_totem_models_return_validation_error(self):
        wrong_schema = valid_totem_content_json()
        wrong_schema["schema"] = "occn"

        unsupported_version = valid_totem_content_json()
        unsupported_version["version"] = 2

        unknown_relation_node = valid_totem_content_json()
        unknown_relation_node["tempgraph"]["D"] = [["Order", "Unknown"]]

        invalid_cardinality = valid_totem_content_json()
        invalid_cardinality["cardinalities"][0]["log_cardinality"] = "sometimes"

        invalid_models = (
            ("non-object payload", []),
            ("wrong schema", wrong_schema),
            ("unsupported schema version", unsupported_version),
            ("relation references unknown node", unknown_relation_node),
            ("unsupported cardinality", invalid_cardinality),
        )

        for label, content_json in invalid_models:
            with self.subTest(label=label):
                ProjectAsset.objects.filter(pk=self.totem_asset.pk).update(
                    content_json=content_json
                )
                with (
                    patch("api.views.event_log._with_ocel_db") as load_ocel,
                    patch("api.views.event_log.conformance_of_totem") as conformance,
                ):
                    response = self.client.post(
                        self.url,
                        {"asset_id": self.totem_asset.pk},
                        format="json",
                    )

                self.assertEqual(
                    response.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )
                self.assertIn(
                    "Stored TOTeM model is invalid",
                    response.data["asset_id"],
                )
                load_ocel.assert_not_called()
                conformance.assert_not_called()

    def test_ocel_load_failure_returns_server_error(self):
        with (
            patch(
                "api.views.event_log._with_ocel_db",
                side_effect=RuntimeError("OCEL unavailable"),
            ) as load_ocel,
            patch("api.views.event_log.conformance_of_totem") as conformance,
        ):
            response = self._post_directly_to_view()

        self.assertEqual(
            response.status_code,
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
        self.assertEqual(
            response.data,
            {"error": "Failed to calculate TOTeM conformance: OCEL unavailable"},
        )
        load_ocel.assert_called_once()
        conformance.assert_not_called()

    def test_conformance_failure_returns_server_error(self):
        db = object()
        with (
            patch(
                "api.views.event_log._with_ocel_db",
                return_value=nullcontext(db),
            ),
            patch(
                "api.views.event_log.conformance_of_totem",
                side_effect=RuntimeError("Conformance failed"),
            ) as conformance,
        ):
            response = self._post_directly_to_view()

        self.assertEqual(
            response.status_code,
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
        self.assertEqual(
            response.data,
            {"error": "Failed to calculate TOTeM conformance: Conformance failed"},
        )
        conformance.assert_called_once()
        deserialized_totem, called_db = conformance.call_args.args
        self.assertIsInstance(deserialized_totem, Totem)
        self.assertIs(called_db, db)

    def test_conformance_uses_stored_model_without_discovery(self):
        result_json = {
            "overall_metrics": {},
            "object_type_metrics": {},
            "type_pair_metrics": [],
            "histograms": {},
        }
        with (
            patch(
                "api.views.event_log._with_ocel_db",
                return_value=nullcontext(object()),
            ),
            patch("api.views.event_log.conformance_of_totem") as conformance,
            patch("api.views.event_log.totemDiscovery_db") as discovery,
        ):
            conformance.return_value.to_dict.return_value = result_json
            response = self.client.post(
                self.url,
                {"asset_id": self.totem_asset.pk},
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        discovery.assert_not_called()
        conformance.assert_called_once()
        self.assertIsInstance(conformance.call_args.args[0], Totem)


class OCCNConformanceApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="occn-conformance-user")
        self.other_user = User.objects.create_user(username="occn-other-user")
        self.project = Project.objects.create(name="OCCN Project")
        self.project.users.add(self.user)
        self.event_log = EventLog.objects.create(
            project=self.project,
            file="occn-test-log.json",
        )
        self.occn_asset = ProjectAsset.objects.create(
            project=self.project,
            name="Selected OCCN",
            asset_type=ProjectAsset.AssetType.OCCN,
            content_json=valid_occn_content_json(),
        )
        self.url = f"/api/files/{self.event_log.pk}/occn_conformance/"
        self.client.force_authenticate(user=self.user)

    def _post_directly_to_view(self):
        request = APIRequestFactory().post(
            self.url,
            {"asset_id": self.occn_asset.pk},
            format="json",
        )
        force_authenticate(request, user=self.user)
        return EventLogViewSet.as_view({"post": "occn_conformance"})(
            request,
            pk=self.event_log.pk,
        )

    def test_authentication_is_required(self):
        self.client.force_authenticate(user=None)

        response = self.client.post(
            self.url,
            {"asset_id": self.occn_asset.pk},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_request_requires_asset_id(self):
        response = self.client.post(self.url, {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("asset_id", response.data)

    def test_request_requires_positive_integer_asset_id(self):
        for invalid_id in (0, "not-an-id"):
            with self.subTest(asset_id=invalid_id):
                response = self.client.post(
                    self.url,
                    {"asset_id": invalid_id},
                    format="json",
                )

                self.assertEqual(
                    response.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )
                self.assertIn("asset_id", response.data)

    def test_state_limit_is_bounded(self):
        for max_states in (999, 15_001, "not-a-number"):
            with self.subTest(max_states=max_states):
                response = self.client.post(
                    self.url,
                    {
                        "asset_id": self.occn_asset.pk,
                        "max_states": max_states,
                    },
                    format="json",
                )

                self.assertEqual(
                    response.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )
                self.assertIn("max_states", response.data)

    def test_unsupported_replay_unit_strategy_is_rejected(self):
        with (
            patch("api.views.event_log._with_ocel_db") as load_ocel,
            patch("api.views.event_log.extract_occn_replay_units") as extract,
            patch("api.views.event_log.occn_replay_fitness") as fitness,
        ):
            response = self.client.post(
                self.url,
                {
                    "asset_id": self.occn_asset.pk,
                    "replay_unit_strategy": "variants",
                },
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("replay_unit_strategy", response.data)
        load_ocel.assert_not_called()
        extract.assert_not_called()
        fitness.assert_not_called()

    def test_leading_object_strategy_requires_an_object_type(self):
        response = self.client.post(
            self.url,
            {
                "asset_id": self.occn_asset.pk,
                "replay_unit_strategy": LEADING_OBJECT_REPLAY_STRATEGY,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("leading_object_type", response.data)

    def test_standard_strategy_rejects_a_leading_object_type(self):
        response = self.client.post(
            self.url,
            {
                "asset_id": self.occn_asset.pk,
                "replay_unit_strategy": CONNECTED_COMPONENTS_REPLAY_STRATEGY,
                "leading_object_type": "Order",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("leading_object_type", response.data)

    def test_leading_object_type_must_exist_in_event_log(self):
        db = object()
        with (
            patch(
                "api.views.event_log._with_ocel_db",
                return_value=nullcontext(db),
            ),
            patch("api.views.event_log._object_types", return_value=["Item", "Order"]),
            patch("api.views.event_log.extract_occn_replay_units") as extract,
            patch("api.views.event_log.occn_replay_fitness") as fitness,
        ):
            response = self.client.post(
                self.url,
                {
                    "asset_id": self.occn_asset.pk,
                    "replay_unit_strategy": LEADING_OBJECT_REPLAY_STRATEGY,
                    "leading_object_type": "Package",
                },
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("leading_object_type", response.data)
        extract.assert_not_called()
        fitness.assert_not_called()

    def test_event_log_is_scoped_to_authenticated_user(self):
        foreign_project = Project.objects.create(name="Foreign Project")
        foreign_project.users.add(self.other_user)
        foreign_log = EventLog.objects.create(
            project=foreign_project,
            file="foreign-log.json",
        )

        response = self.client.post(
            f"/api/files/{foreign_log.pk}/occn_conformance/",
            {"asset_id": self.occn_asset.pk},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_inaccessible_asset_returns_not_found(self):
        foreign_project = Project.objects.create(name="Foreign Project")
        foreign_project.users.add(self.other_user)
        foreign_asset = ProjectAsset.objects.create(
            project=foreign_project,
            name="Foreign OCCN",
            asset_type=ProjectAsset.AssetType.OCCN,
            content_json=valid_occn_content_json(),
        )

        response = self.client.post(
            self.url,
            {"asset_id": foreign_asset.pk},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn("asset_id", response.data)

    def test_asset_from_another_accessible_project_is_rejected(self):
        other_project = Project.objects.create(name="Other Accessible Project")
        other_project.users.add(self.user)
        other_asset = ProjectAsset.objects.create(
            project=other_project,
            name="Other OCCN",
            asset_type=ProjectAsset.AssetType.OCCN,
            content_json=valid_occn_content_json(),
        )

        response = self.client.post(
            self.url,
            {"asset_id": other_asset.pk},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("event log project", response.data["asset_id"])

    def test_wrong_asset_type_is_rejected(self):
        totem_asset = ProjectAsset.objects.create(
            project=self.project,
            name="Wrong model type",
            asset_type=ProjectAsset.AssetType.TOTEM,
            content_json=valid_totem_content_json(),
        )

        response = self.client.post(
            self.url,
            {"asset_id": totem_asset.pk},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("OCCN", response.data["asset_id"])

    def test_invalid_stored_occn_models_return_validation_error(self):
        wrong_schema = valid_occn_content_json()
        wrong_schema["schema"] = "totem"

        unsupported_version = valid_occn_content_json()
        unsupported_version["version"] = 2

        missing_end_activity = valid_occn_content_json()
        missing_end_activity["activities"].remove("END_Order")

        unexpected_start = valid_occn_content_json()
        unexpected_start["activities"].append("START_Unknown")
        unexpected_start["input_marker_groups"]["START_Unknown"] = []
        unexpected_start["output_marker_groups"]["START_Unknown"] = []
        unexpected_start["activity_count"]["START_Unknown"] = 1

        invalid_models = (
            ("non-object payload", []),
            ("wrong schema", wrong_schema),
            ("unsupported schema version", unsupported_version),
            ("missing end activity", missing_end_activity),
            ("unexpected artificial start", unexpected_start),
        )

        for label, content_json in invalid_models:
            with self.subTest(label=label):
                ProjectAsset.objects.filter(pk=self.occn_asset.pk).update(
                    content_json=content_json
                )
                with (
                    patch("api.views.event_log._with_ocel_db") as load_ocel,
                    patch("api.views.event_log.extract_occn_replay_units") as extract,
                    patch("api.views.event_log.occn_replay_fitness") as fitness,
                ):
                    response = self.client.post(
                        self.url,
                        {"asset_id": self.occn_asset.pk},
                        format="json",
                    )

                self.assertEqual(
                    response.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )
                self.assertIn(
                    "Stored OCCN model is invalid",
                    response.data["asset_id"],
                )
                load_ocel.assert_not_called()
                extract.assert_not_called()
                fitness.assert_not_called()

    def test_ocel_load_failure_returns_server_error(self):
        with (
            patch(
                "api.views.event_log._with_ocel_db",
                side_effect=RuntimeError("OCEL unavailable"),
            ) as load_ocel,
            patch("api.views.event_log.extract_occn_replay_units") as extract,
            patch("api.views.event_log.occn_replay_fitness") as fitness,
        ):
            response = self._post_directly_to_view()

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertEqual(
            response.data,
            {"error": "Failed to extract OCCN replay units: OCEL unavailable"},
        )
        load_ocel.assert_called_once()
        extract.assert_not_called()
        fitness.assert_not_called()

    def test_replay_unit_extraction_failure_returns_server_error(self):
        db = object()
        with (
            patch(
                "api.views.event_log._with_ocel_db",
                return_value=nullcontext(db),
            ),
            patch(
                "api.views.event_log.extract_occn_replay_units",
                side_effect=RuntimeError("Extraction failed"),
            ) as extract,
            patch("api.views.event_log.occn_replay_fitness") as fitness,
        ):
            response = self._post_directly_to_view()

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertEqual(
            response.data,
            {"error": "Failed to extract OCCN replay units: Extraction failed"},
        )
        extract.assert_called_once_with(
            db,
            strategy=CONNECTED_COMPONENTS_REPLAY_STRATEGY,
            leading_object_type=None,
            execution_column=None,
            object_types=None,
        )
        fitness.assert_not_called()

    def test_replay_failure_returns_server_error(self):
        db = object()
        replay_units = (object(),)
        with (
            patch(
                "api.views.event_log._with_ocel_db",
                return_value=nullcontext(db),
            ),
            patch(
                "api.views.event_log.extract_occn_replay_units",
                return_value=replay_units,
            ),
            patch(
                "api.views.event_log.occn_replay_fitness",
                side_effect=RuntimeError("Replay failed"),
            ) as fitness,
        ):
            response = self._post_directly_to_view()

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertEqual(
            response.data,
            {"error": "Failed to calculate OCCN conformance: Replay failed"},
        )
        fitness.assert_called_once()
        deserialized_occn, called_units = fitness.call_args.args
        self.assertIsInstance(deserialized_occn, OCCausalNet)
        self.assertIs(called_units, replay_units)

    def test_valid_request_runs_real_extraction_and_replay(self):
        ProjectAsset.objects.filter(pk=self.occn_asset.pk).update(
            content_json=replayable_occn_content_json()
        )
        source = ObjectCentricEventLog(
            events=pl.DataFrame(
                [
                    {
                        "_eventId": "e1",
                        "_activity": "Create Order",
                        "_timestampUnix": 1,
                        "_objects": ["o1"],
                        "_qualifiers": [None],
                        "_attributes": "",
                    }
                ],
                schema=EVENTS_SCHEMA,
            ),
            objects=pl.DataFrame(
                [
                    {
                        "_objId": "o1",
                        "_objType": "Order",
                        "_targetObjects": [],
                        "_qualifiers": [],
                    }
                ],
                schema=OBJECTS_SCHEMA,
            ),
        )
        database = OcelDuckDB(source)
        try:
            with patch(
                "api.views.event_log._with_ocel_db",
                return_value=nullcontext(database),
            ):
                response = self.client.post(
                    self.url,
                    {"asset_id": self.occn_asset.pk},
                    format="json",
                )
        finally:
            database.conn.close()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["fitness"], 1.0)
        self.assertEqual(response.data["coverage"], 1.0)
        self.assertEqual(response.data["total_units"], 1)
        self.assertEqual(response.data["fitting_units"], 1)
        self.assertEqual(response.data["non_fitting_units"], 0)
        self.assertEqual(response.data["inconclusive_units"], 0)
        self.assertEqual(
            response.data["unit_results"][0]["status"],
            OCCNReplayStatus.FITTING.value,
        )
        self.assertEqual(
            response.data["unit_results"][0]["object_types"],
            ["Order"],
        )

    def test_valid_leading_object_request_projects_by_selected_type(self):
        ProjectAsset.objects.filter(pk=self.occn_asset.pk).update(
            content_json=replayable_occn_content_json()
        )
        source = ObjectCentricEventLog(
            events=pl.DataFrame(
                [
                    {
                        "_eventId": "e1",
                        "_activity": "Create Order",
                        "_timestampUnix": 1,
                        "_objects": ["o1"],
                        "_qualifiers": [None],
                        "_attributes": "",
                    }
                ],
                schema=EVENTS_SCHEMA,
            ),
            objects=pl.DataFrame(
                [
                    {
                        "_objId": "o1",
                        "_objType": "Order",
                        "_targetObjects": [],
                        "_qualifiers": [],
                    }
                ],
                schema=OBJECTS_SCHEMA,
            ),
        )
        database = OcelDuckDB(source)
        try:
            with patch(
                "api.views.event_log._with_ocel_db",
                return_value=nullcontext(database),
            ):
                response = self.client.post(
                    self.url,
                    {
                        "asset_id": self.occn_asset.pk,
                        "replay_unit_strategy": LEADING_OBJECT_REPLAY_STRATEGY,
                        "leading_object_type": "Order",
                    },
                    format="json",
                )
        finally:
            database.conn.close()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data["replay_unit_strategy"],
            LEADING_OBJECT_REPLAY_STRATEGY,
        )
        self.assertEqual(response.data["leading_object_type"], "Order")
        self.assertEqual(response.data["total_units"], 1)
        self.assertEqual(
            response.data["unit_results"][0]["unit_id"],
            "leading_object:o1",
        )

    def test_valid_request_executes_conformance_and_returns_result(self):
        replay_units = (object(), object(), object())
        result = OCCNReplayFitnessResult(
            unit_results=(
                OCCNReplayUnitResult(
                    unit_id="connected_components:000001",
                    status=OCCNReplayStatus.FITTING,
                    event_count=2,
                    explored_state_count=4,
                    object_types=("Order",),
                ),
                OCCNReplayUnitResult(
                    unit_id="connected_components:000002",
                    status=OCCNReplayStatus.NON_FITTING,
                    event_count=1,
                    explored_state_count=2,
                    object_types=("Order", "Item"),
                    failure_event_index=0,
                    failure_event_id="e3",
                    stopping_activity="Ship Order",
                    stopping_phase="visible_event",
                    stopping_reason="no_enabled_event_binding",
                    last_replayed_activity="Create Order",
                    replayed_activities=("START_Order", "Create Order"),
                    stopping_object_types=("Item", "Order"),
                ),
                OCCNReplayUnitResult(
                    unit_id="connected_components:000003",
                    status=OCCNReplayStatus.INCONCLUSIVE,
                    event_count=8,
                    explored_state_count=1000,
                    object_types=("Delivery", "Order"),
                    limit_reason="max_states",
                    stopping_activity="END_Order",
                    stopping_phase="object_end",
                    stopping_reason="max_states",
                    last_replayed_activity="Ship Order",
                ),
            )
        )
        db = object()
        with (
            patch(
                "api.views.event_log._with_ocel_db",
                return_value=nullcontext(db),
            ) as load_ocel,
            patch(
                "api.views.event_log.extract_occn_replay_units",
                return_value=replay_units,
            ) as extract,
            patch(
                "api.views.event_log.occn_replay_fitness",
                return_value=result,
            ) as fitness,
        ):
            response = self.client.post(
                self.url,
                {"asset_id": self.occn_asset.pk, "max_states": 5_000},
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data,
            {
                "file_id": self.event_log.pk,
                "asset_id": self.occn_asset.pk,
                "replay_unit_strategy": CONNECTED_COMPONENTS_REPLAY_STRATEGY,
                "leading_object_type": None,
                "execution_column": None,
                "restrict_to_model_object_types": False,
                "max_states": 5_000,
                **result.to_dict(),
            },
        )
        load_ocel.assert_called_once()
        self.assertEqual(load_ocel.call_args.args[0].pk, self.event_log.pk)
        extract.assert_called_once_with(
            db,
            strategy=CONNECTED_COMPONENTS_REPLAY_STRATEGY,
            leading_object_type=None,
            execution_column=None,
            object_types=None,
        )
        fitness.assert_called_once()
        deserialized_occn, called_units = fitness.call_args.args
        self.assertIsInstance(deserialized_occn, OCCausalNet)
        self.assertIs(called_units, replay_units)
        self.assertEqual(fitness.call_args.kwargs, {"max_states": 5_000})
        self.assertEqual(response.data["fitness"], 0.5)
        self.assertAlmostEqual(response.data["coverage"], 2 / 3)
        self.assertEqual(response.data["inconclusive_units"], 1)
        self.assertEqual(
            response.data["unit_results"][1]["stopping_activity"],
            "Ship Order",
        )
        self.assertEqual(
            response.data["unit_results"][2]["stopping_activity"],
            "END_Order",
        )
        self.assertEqual(
            response.data["unit_results"][1]["stopping_reason"],
            "no_enabled_event_binding",
        )
        self.assertEqual(
            response.data["unit_results"][2]["last_replayed_activity"],
            "Ship Order",
        )
        self.assertEqual(
            response.data["unit_results"][1]["replayed_activities"],
            ["START_Order", "Create Order"],
        )
        self.assertEqual(
            response.data["unit_results"][1]["stopping_object_types"],
            ["Item", "Order"],
        )

    def test_empty_replay_result_preserves_complete_aggregate_contract(self):
        result = OCCNReplayFitnessResult(unit_results=())
        with (
            patch(
                "api.views.event_log._with_ocel_db",
                return_value=nullcontext(object()),
            ),
            patch(
                "api.views.event_log.extract_occn_replay_units",
                return_value=(),
            ),
            patch(
                "api.views.event_log.occn_replay_fitness",
                return_value=result,
            ),
        ):
            response = self.client.post(
                self.url,
                {"asset_id": self.occn_asset.pk},
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data["fitness"])
        self.assertEqual(response.data["coverage"], 1.0)
        self.assertEqual(response.data["total_units"], 0)
        self.assertEqual(response.data["fitting_units"], 0)
        self.assertEqual(response.data["non_fitting_units"], 0)
        self.assertEqual(response.data["inconclusive_units"], 0)
        self.assertEqual(response.data["unit_results"], [])


class OCCNReplayUnitDetailApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="occn-detail-user")
        self.other_user = User.objects.create_user(username="occn-detail-other")
        self.project = Project.objects.create(name="OCCN Detail Project")
        self.project.users.add(self.user)
        self.event_log = EventLog.objects.create(
            project=self.project,
            file="occn-detail-log.json",
        )
        self.url = f"/api/files/{self.event_log.pk}/occn_replay_unit_detail/"
        self.client.force_authenticate(user=self.user)

    @staticmethod
    def _unit(unit_id="connected_components:000001", event_count=5):
        return OCCNReplayUnit(
            unit_id=unit_id,
            strategy=CONNECTED_COMPONENTS_REPLAY_STRATEGY,
            events=tuple(
                OCCNReplayEvent(
                    event_id=f"event-{index}",
                    activity=f"Activity {index}",
                    timestamp_unix=index,
                    objects_by_type=(("Order", ("order-1",)),),
                )
                for index in range(event_count)
            ),
        )

    def _get_directly_to_view(self, query):
        request = APIRequestFactory().get(self.url, query)
        force_authenticate(request, user=self.user)
        return EventLogViewSet.as_view({"get": "occn_replay_unit_detail"})(
            request, pk=self.event_log.pk
        )

    def test_authentication_is_required(self):
        self.client.force_authenticate(user=None)

        response = self.client.get(
            self.url,
            {"unit_id": "connected_components:000001"},
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_event_log_is_scoped_to_authenticated_user(self):
        foreign_project = Project.objects.create(name="Foreign Detail Project")
        foreign_project.users.add(self.other_user)
        foreign_log = EventLog.objects.create(
            project=foreign_project,
            file="foreign-detail-log.json",
        )

        with patch("api.views.event_log._with_ocel_db") as load_ocel:
            response = self.client.get(
                f"/api/files/{foreign_log.pk}/occn_replay_unit_detail/",
                {"unit_id": "connected_components:000001"},
            )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        load_ocel.assert_not_called()

    def test_query_parameters_are_validated_before_extraction(self):
        invalid_queries = (
            ("missing unit id", {}),
            ("blank unit id", {"unit_id": " "}),
            (
                "unsupported strategy",
                {"unit_id": "unit-1", "replay_unit_strategy": "variants"},
            ),
            ("negative offset", {"unit_id": "unit-1", "offset": -1}),
            ("zero limit", {"unit_id": "unit-1", "limit": 0}),
            ("excessive limit", {"unit_id": "unit-1", "limit": 251}),
        )

        for label, query in invalid_queries:
            with (
                self.subTest(label=label),
                patch("api.views.event_log._with_ocel_db") as load_ocel,
            ):
                response = self.client.get(self.url, query)

            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            load_ocel.assert_not_called()

    def test_unknown_replay_unit_returns_not_found(self):
        with (
            patch(
                "api.views.event_log._with_ocel_db",
                return_value=nullcontext(object()),
            ),
            patch(
                "api.views.event_log.extract_occn_replay_units",
                return_value=(self._unit(),),
            ),
        ):
            response = self.client.get(
                self.url,
                {"unit_id": "connected_components:999999"},
            )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(
            response.data,
            {"unit_id": "Replay unit not found."},
        )

    def test_leading_object_detail_uses_the_selected_type(self):
        connected_unit = self._unit(event_count=2)
        replay_unit = OCCNReplayUnit(
            unit_id="leading_object:order-1",
            strategy=LEADING_OBJECT_REPLAY_STRATEGY,
            events=connected_unit.events,
        )
        db = object()
        with (
            patch(
                "api.views.event_log._with_ocel_db",
                return_value=nullcontext(db),
            ),
            patch("api.views.event_log._object_types", return_value=["Order"]),
            patch(
                "api.views.event_log.extract_occn_replay_units",
                return_value=(replay_unit,),
            ) as extract,
        ):
            response = self.client.get(
                self.url,
                {
                    "unit_id": replay_unit.unit_id,
                    "replay_unit_strategy": LEADING_OBJECT_REPLAY_STRATEGY,
                    "leading_object_type": "Order",
                },
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data["replay_unit_strategy"],
            LEADING_OBJECT_REPLAY_STRATEGY,
        )
        self.assertEqual(response.data["leading_object_type"], "Order")
        extract.assert_called_once_with(
            db,
            strategy=LEADING_OBJECT_REPLAY_STRATEGY,
            leading_object_type="Order",
            execution_column=None,
            object_types=None,
        )

    def test_extraction_failure_returns_server_error(self):
        with patch(
            "api.views.event_log._with_ocel_db",
            side_effect=RuntimeError("OCEL unavailable"),
        ):
            response = self._get_directly_to_view(
                {"unit_id": "connected_components:000001"}
            )

        self.assertEqual(
            response.status_code,
            status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
        self.assertEqual(
            response.data,
            {"error": "Failed to extract OCCN replay units: OCEL unavailable"},
        )

    def test_paginates_events_with_stable_global_indexes(self):
        replay_unit = self._unit(event_count=5)
        with (
            patch(
                "api.views.event_log._with_ocel_db",
                return_value=nullcontext(object()),
            ),
            patch(
                "api.views.event_log.extract_occn_replay_units",
                return_value=(replay_unit,),
            ) as extract,
        ):
            middle = self.client.get(
                self.url,
                {
                    "unit_id": replay_unit.unit_id,
                    "offset": 2,
                    "limit": 2,
                },
            )
            final = self.client.get(
                self.url,
                {
                    "unit_id": replay_unit.unit_id,
                    "offset": 4,
                    "limit": 2,
                },
            )
            beyond = self.client.get(
                self.url,
                {
                    "unit_id": replay_unit.unit_id,
                    "offset": 10,
                    "limit": 2,
                },
            )

        self.assertEqual(middle.status_code, status.HTTP_200_OK)
        self.assertEqual(
            [event["event_id"] for event in middle.data["events"]],
            ["event-2", "event-3"],
        )
        self.assertEqual(
            [event["event_index"] for event in middle.data["events"]],
            [2, 3],
        )
        self.assertEqual(
            middle.data["pagination"],
            {
                "offset": 2,
                "limit": 2,
                "returned_count": 2,
                "total_count": 5,
                "has_previous": True,
                "has_next": True,
                "previous_offset": 0,
                "next_offset": 4,
            },
        )
        self.assertEqual(final.data["pagination"]["returned_count"], 1)
        self.assertFalse(final.data["pagination"]["has_next"])
        self.assertIsNone(final.data["pagination"]["next_offset"])
        self.assertEqual(beyond.data["events"], [])
        self.assertEqual(beyond.data["pagination"]["returned_count"], 0)
        self.assertFalse(beyond.data["pagination"]["has_next"])
        self.assertEqual(beyond.data["pagination"]["previous_offset"], 4)
        self.assertEqual(extract.call_count, 3)
        for call in extract.call_args_list:
            self.assertEqual(
                call.kwargs,
                {
                    "strategy": CONNECTED_COMPONENTS_REPLAY_STRATEGY,
                    "leading_object_type": None,
                    "execution_column": None,
                    "object_types": None,
                },
            )

    def test_real_ocel_preserves_event_order_and_object_information(self):
        source = ObjectCentricEventLog(
            events=pl.DataFrame(
                [
                    {
                        "_eventId": "event-shipped",
                        "_activity": "Ship Order",
                        "_timestampUnix": 2,
                        "_objects": ["order-1", "item-1"],
                        "_qualifiers": [None, None],
                        "_attributes": "",
                    },
                    {
                        "_eventId": "event-objectless",
                        "_activity": "System Check",
                        "_timestampUnix": 0,
                        "_objects": [],
                        "_qualifiers": [],
                        "_attributes": "",
                    },
                    {
                        "_eventId": "event-created",
                        "_activity": "Create Order",
                        "_timestampUnix": 1,
                        "_objects": ["order-1"],
                        "_qualifiers": [None],
                        "_attributes": "",
                    },
                ],
                schema=EVENTS_SCHEMA,
            ),
            objects=pl.DataFrame(
                [
                    {
                        "_objId": "order-1",
                        "_objType": "Order",
                        "_targetObjects": [],
                        "_qualifiers": [],
                    },
                    {
                        "_objId": "item-1",
                        "_objType": "Item",
                        "_targetObjects": [],
                        "_qualifiers": [],
                    },
                ],
                schema=OBJECTS_SCHEMA,
            ),
        )
        database = OcelDuckDB(source)
        try:
            with patch(
                "api.views.event_log._with_ocel_db",
                return_value=nullcontext(database),
            ):
                objectless = self.client.get(
                    self.url,
                    {"unit_id": "connected_components:000001"},
                )
                connected = self.client.get(
                    self.url,
                    {"unit_id": "connected_components:000002"},
                )
        finally:
            database.conn.close()

        self.assertEqual(objectless.status_code, status.HTTP_200_OK)
        self.assertEqual(objectless.data["event_count"], 1)
        self.assertEqual(objectless.data["object_types"], [])
        self.assertEqual(objectless.data["pagination"]["offset"], 0)
        self.assertEqual(objectless.data["pagination"]["limit"], 50)
        self.assertEqual(
            objectless.data["events"][0]["objects_by_type"],
            {},
        )

        self.assertEqual(connected.status_code, status.HTTP_200_OK)
        self.assertEqual(connected.data["event_count"], 2)
        self.assertEqual(connected.data["object_types"], ["Item", "Order"])
        self.assertEqual(
            [event["event_id"] for event in connected.data["events"]],
            ["event-created", "event-shipped"],
        )
        self.assertEqual(
            [event["activity"] for event in connected.data["events"]],
            ["Create Order", "Ship Order"],
        )
        self.assertEqual(
            [event["timestamp_unix"] for event in connected.data["events"]],
            [1, 2],
        )
        self.assertEqual(
            connected.data["events"][1]["objects_by_type"],
            {"Item": ["item-1"], "Order": ["order-1"]},
        )


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
        self.assertEqual(
            [item["id"] for item in second_response.data], [second_asset.pk]
        )

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

    def test_patch_rename_asset_keeps_content(self):
        asset = self._create_asset(
            self.project,
            "Old name",
            ProjectAsset.AssetType.TOTEM,
        )
        original_content = asset.content_json

        response = self.client.patch(
            f"/api/assets/{asset.pk}/",
            {"name": "New name"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        asset.refresh_from_db()
        self.assertEqual(asset.name, "New name")
        self.assertEqual(asset.content_json, original_content)

    def test_patch_updates_content_json(self):
        asset = self._create_asset(
            self.project,
            "Updatable",
            ProjectAsset.AssetType.TOTEM,
        )
        updated = valid_totem_content_json()
        updated["all_event_types"] = ["Create Order", "Pick Item", "Ship Order"]

        response = self.client.patch(
            f"/api/assets/{asset.pk}/",
            {"content_json": updated},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        asset.refresh_from_db()
        self.assertIn("Ship Order", asset.content_json["all_event_types"])

    def test_patch_rejects_invalid_content_json(self):
        asset = self._create_asset(
            self.project,
            "Guarded",
            ProjectAsset.AssetType.TOTEM,
        )
        invalid = valid_totem_content_json()
        invalid["schema"] = "occn"

        response = self.client.patch(
            f"/api/assets/{asset.pk}/",
            {"content_json": invalid},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        asset.refresh_from_db()
        self.assertEqual(asset.content_json["schema"], "totem")

    def test_patch_rejects_duplicate_name_in_project(self):
        self._create_asset(self.project, "Existing", ProjectAsset.AssetType.TOTEM)
        asset = self._create_asset(
            self.project,
            "To rename",
            ProjectAsset.AssetType.OCCN,
        )

        response = self.client.patch(
            f"/api/assets/{asset.pk}/",
            {"name": "Existing"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_patch_scoped_to_user_project(self):
        foreign_asset = self._create_asset(
            self.other_project,
            "Foreign update",
            ProjectAsset.AssetType.OCCN,
        )

        response = self.client.patch(
            f"/api/assets/{foreign_asset.pk}/",
            {"name": "Hacked"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class SqlQueryAssetApiTests(TestCase):
    """Stored SQL queries live in the project asset store as QUERY assets."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="query-user")
        self.project = Project.objects.create(name="Query project")
        self.project.users.add(self.user)
        self.client.force_authenticate(user=self.user)

    def _create(self, content_json, name="Events per activity"):
        return self.client.post(
            "/api/assets/",
            {
                "project": self.project.pk,
                "name": name,
                "asset_type": ProjectAsset.AssetType.QUERY,
                "content_json": content_json,
            },
            format="json",
        )

    def test_create_query_asset(self):
        response = self._create(
            {
                "schema": "sql-query",
                "version": 1,
                "query": "SELECT activity, count(*) AS n FROM events GROUP BY activity",
                "description": "one row per activity",
            }
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        asset = ProjectAsset.objects.get(pk=response.data["id"])
        self.assertEqual(asset.asset_type, ProjectAsset.AssetType.QUERY)
        self.assertEqual(asset.content_json["query"].split()[0], "SELECT")

    def test_query_asset_requires_schema_and_query(self):
        response = self._create({"query": "SELECT 1"})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        response = self._create({"schema": "sql-query", "version": 1, "query": "   "})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        response = self._create({"schema": "sql-query", "version": 2, "query": "SELECT 1"})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_list_filters_query_assets(self):
        self._create({"schema": "sql-query", "version": 1, "query": "SELECT 1"}, name="q")
        ProjectAsset.objects.create(
            project=self.project,
            name="model",
            asset_type=ProjectAsset.AssetType.TOTEM,
            content_json=valid_totem_content_json(),
        )
        response = self.client.get(
            f"/api/assets/?project={self.project.pk}&asset_type=QUERY"
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([a["name"] for a in response.data], ["q"])

    def test_patch_query_text_is_revalidated(self):
        created = self._create({"schema": "sql-query", "version": 1, "query": "SELECT 1"})
        asset_id = created.data["id"]
        response = self.client.patch(
            f"/api/assets/{asset_id}/",
            {"content_json": {"schema": "sql-query", "version": 1, "query": "SELECT 2"}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(ProjectAsset.objects.get(pk=asset_id).content_json["query"], "SELECT 2")
        response = self.client.patch(
            f"/api/assets/{asset_id}/",
            {"content_json": {"schema": "sql-query", "version": 1}},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class QueryReferenceResolutionTests(SimpleTestCase):
    """Stored queries can be used like tables inside other queries."""

    def test_unreferenced_query_is_returned_unchanged(self):
        from .query_refs import resolve_query_references
        stored = {"a": "SELECT 1 AS x"}
        self.assertEqual(resolve_query_references("SELECT 2", stored), "SELECT 2")

    def test_reference_becomes_cte(self):
        from .query_refs import resolve_query_references
        stored = {"Waiting times": "SELECT 1 AS w"}
        out = resolve_query_references('SELECT w FROM "Waiting times"', stored)
        self.assertEqual(out, 'WITH "Waiting times" AS (SELECT 1 AS w) SELECT w FROM "Waiting times"')

    def test_bare_identifier_reference_is_case_insensitive(self):
        from .query_refs import resolve_query_references
        stored = {"waiting_times": "SELECT 1 AS w;"}
        out = resolve_query_references("select w from Waiting_Times", stored)
        self.assertTrue(out.startswith('WITH "waiting_times" AS (SELECT 1 AS w) select'))

    def test_transitive_references_are_ordered(self):
        from .query_refs import resolve_query_references
        stored = {"avg": 'SELECT avg(d) AS a FROM "durations"', "durations": "SELECT 1 AS d"}
        out = resolve_query_references('SELECT a FROM "avg"', stored)
        self.assertEqual(
            out,
            'WITH "durations" AS (SELECT 1 AS d), "avg" AS (SELECT avg(d) AS a FROM "durations") SELECT a FROM "avg"',
        )

    def test_user_with_clause_is_merged(self):
        from .query_refs import resolve_query_references
        stored = {"base": "SELECT 1 AS d"}
        out = resolve_query_references('-- c\nWITH t AS (SELECT d FROM base) SELECT * FROM t', stored)
        self.assertEqual(out, 'WITH "base" AS (SELECT 1 AS d), t AS (SELECT d FROM base) SELECT * FROM t')

    def test_references_in_strings_and_comments_are_ignored(self):
        from .query_refs import resolve_query_references
        stored = {"base": "SELECT 1"}
        self.assertEqual(
            resolve_query_references("SELECT 'base' -- base", stored), "SELECT 'base' -- base"
        )

    def test_reserved_table_names_are_never_references(self):
        from .query_refs import resolve_query_references
        stored = {"events": "SELECT 1"}
        self.assertEqual(
            resolve_query_references("SELECT * FROM events", stored, reserved=("events",)),
            "SELECT * FROM events",
        )

    def test_cycles_are_rejected(self):
        from .query_refs import QueryReferenceError, resolve_query_references
        stored = {"a": 'SELECT * FROM "b"', "b": 'SELECT * FROM "a"'}
        with self.assertRaises(QueryReferenceError):
            resolve_query_references('SELECT * FROM "a"', stored)
        with self.assertRaises(QueryReferenceError):
            resolve_query_references('SELECT * FROM "a"', {"a": 'SELECT 1'}, self_name="a")


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
        response = self.client.post(
            PLAYOUT_URL, data=raw, content_type="application/json"
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_export_ocel_rejects_oversized_object_counts(self):
        body = {"variants": [{"events": [], "objectCounts": {"A": 999_999_999}}]}
        response = self.client.post(EXPORT_OCEL_URL, body, format="json")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("error", response.json())

    def test_export_ocel_rejects_excessive_total_objects(self):
        variants = [{"events": [], "objectCounts": {"A": 10_000}} for _ in range(51)]
        response = self.client.post(
            EXPORT_OCEL_URL, {"variants": variants}, format="json"
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("more than", response.json()["error"])

    def test_export_ocel_infinite_object_count_is_a_400(self):
        raw = '{"variants": [{"events": [], "objectCounts": {"A": 1e400}}]}'
        response = self.client.post(
            EXPORT_OCEL_URL, data=raw, content_type="application/json"
        )
        self.assertEqual(response.status_code, 400, response.content)


class EventLogConversionErrorTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="conv-user", password="password")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    @patch("api.views.event_log.import_ocel_db")
    def test_conversion_failure_deletes_project_eventlog_and_duckdb_file(self, mock_import):
        mock_import.side_effect = RuntimeError("Simulated DuckDB conversion crash")

        corrupt_file = SimpleUploadedFile("test_log.json", b"{invalid_json_data}", content_type="application/json")

        response = self.client.post("/api/files/", {"file": corrupt_file}, format="multipart")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("error", response.json())
        self.assertIn("Failed to convert file to DuckDB format", response.json()["error"])

        self.assertEqual(Project.objects.count(), 0)
        self.assertEqual(EventLog.objects.count(), 0)


EXAMPLE_LOGS = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "totem_lib", "test_data", "small"
)


class EventLogDuplicateUploadTests(TestCase):
    """Uploading a file whose converted name is already taken.

    Django only de-duplicates the uploaded `.sqlite`/`.json` name, and that
    file is gone once converted, so a second upload of the same file used to
    convert into the first log's `.duckdb`, fail, and then delete it.
    """

    def setUp(self):
        self.user = User.objects.create_user(username="dup-user")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media, ignore_errors=True)
        media_override = self.settings(MEDIA_ROOT=self.media)
        media_override.enable()
        self.addCleanup(media_override.disable)

    def _upload(self, name, content=None):
        if content is None:
            with open(os.path.join(EXAMPLE_LOGS, name), "rb") as handle:
                content = handle.read()
        response = self.client.post(
            "/api/files/", {"file": SimpleUploadedFile(name, content)}, format="multipart"
        )
        if response.status_code == status.HTTP_201_CREATED:
            # Registered on upload; it holds the file open until closed.
            self.addCleanup(_close_ocel_db, int(response.data["id"]))
        return response

    def _assert_loads(self, event_log):
        path = event_log.file.path
        self.assertTrue(os.path.exists(path), path)
        db = OcelDuckDB.load(path, read_only=True)
        try:
            return db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        finally:
            db.close()

    def test_uploading_the_same_file_twice_keeps_both_logs(self):
        first = self._upload("container_logistics.sqlite")
        second = self._upload("container_logistics.sqlite")

        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED, second.data)
        first_log = EventLog.objects.get(pk=first.data["id"])
        second_log = EventLog.objects.get(pk=second.data["id"])
        self.assertEqual(first_log.file.name, "container_logistics.duckdb")
        self.assertNotEqual(first_log.file.name, second_log.file.name)
        self.assertTrue(second_log.file.name.endswith(".duckdb"))
        events = self._assert_loads(first_log)
        self.assertGreater(events, 0)
        self.assertEqual(self._assert_loads(second_log), events)
        # Each upload's registered connection serves its own log.
        for event_log in (first_log, second_log):
            with _with_ocel_db(event_log) as db:
                count = db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
            self.assertEqual(count, events)
        # Only the two converted logs are left behind: no uploaded originals
        # and no conversion scratch space.
        self.assertCountEqual(
            os.listdir(self.media), [first_log.file.name, second_log.file.name]
        )

    def test_a_failed_upload_leaves_the_log_it_collides_with_alone(self):
        first = self._upload("resource_aware_orders.json")
        self.assertEqual(first.status_code, status.HTTP_201_CREATED, first.data)
        first_log = EventLog.objects.get(pk=first.data["id"])

        broken = self._upload("resource_aware_orders.json", b"{not json")

        self.assertEqual(broken.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(list(EventLog.objects.all()), [first_log])
        self.assertEqual(Project.objects.count(), 1)
        self.assertGreater(self._assert_loads(first_log), 0)
        self.assertEqual(os.listdir(self.media), [first_log.file.name])

    def test_a_name_taken_after_it_was_checked_is_not_reused(self):
        from django.core.files.storage import default_storage

        from .views.event_log import _claim_storage_name

        open(os.path.join(self.media, "log.duckdb"), "wb").close()
        # As if another upload claimed the name between the check and ours.
        answers = iter(["log.duckdb", "log_2.duckdb"])
        with patch.object(
            default_storage, "get_available_name", side_effect=lambda *a, **k: next(answers)
        ):
            name, path = _claim_storage_name(default_storage, "log.duckdb")

        self.assertEqual(name, "log_2.duckdb")
        self.assertEqual(path, os.path.join(self.media, "log_2.duckdb"))
        self.assertTrue(os.path.exists(path))


class ProcessAreaDiscoveryApiTests(TestCase):
    """
    `discover_process_areas` — the advanced (thesis section 4.1) layering
    engine, exposed alongside `discover_mlpa` rather than replacing it.
    """

    def setUp(self):
        cache.clear()
        # `cache.clear()` only clears the "default" alias; discovery results
        # live in the separate file-backed "results" cache, which would
        # otherwise leak hits between tests.
        RESULTS_CACHE.clear()
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
            patch("api.views.event_log._with_ocel_db", return_value=nullcontext(object())),
            patch("api.views.event_log.totemDiscovery_db", return_value=self._totem()),
            patch("api.views.event_log.prepare_db", return_value=self._aggregates()) as prepared,
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
        def key(file_pk, params):
            return make_cache_key(
                file_pk, "discover_process_areas", _process_area_cache_params(params)
            )

        base = _parse_process_area_params({})
        base_key = key(1, base)
        for query, value in [
            ("w_temporal", "0.5"),
            ("w_cardinality", "0.5"),
            ("w_divergence", "0.5"),
            ("alpha", "4"),
            ("beta", "3"),
        ]:
            changed = _parse_process_area_params({query: value})
            self.assertNotEqual(base_key, key(1, changed), query)
        self.assertNotEqual(base_key, key(2, base))

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
            "?alpha=0&beta=0",
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
            patch("api.views.event_log._with_ocel_db", return_value=nullcontext(object())),
            patch("api.views.event_log.totemDiscovery_db", return_value=totem),
        ):
            response = self.client.get(f"/api/files/{self.event_log.pk}/discover_mlpa/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNotNone(get_cached_result(self.event_log, "discover_mlpa"))


class DashboardAuthorizationAndLayoutTests(TestCase):
    """Dashboards must stay inside projects the caller belongs to, and a bad
    layout payload must not wipe the existing layout."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="dash-owner")
        self.other = User.objects.create_user(username="dash-other")
        self.project = Project.objects.create(name="Mine")
        self.project.users.add(self.user)
        self.foreign_project = Project.objects.create(name="Theirs")
        self.foreign_project.users.add(self.other)
        self.dashboard = Dashboard.objects.create(
            project=self.project, name="D", order_in_project=0
        )
        self.client.force_authenticate(user=self.user)

    def test_cannot_create_dashboard_in_foreign_project(self):
        response = self.client.post(
            "/api/dashboard/",
            {"project": self.foreign_project.pk, "name": "sneaky"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Dashboard.objects.filter(project=self.foreign_project).exists())

    def test_create_with_unknown_project_is_400_not_500(self):
        response = self.client.post(
            "/api/dashboard/", {"project": 999999, "name": "x"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_move_dashboard_into_foreign_project(self):
        response = self.client.patch(
            f"/api/dashboard/{self.dashboard.pk}/",
            {"project": self.foreign_project.pk},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.dashboard.refresh_from_db()
        self.assertEqual(self.dashboard.project, self.project)

    def _save(self, layout):
        return self.client.post(
            f"/api/dashboard/{self.dashboard.pk}/save_layout/",
            {"layout": layout},
            format="json",
        )

    def test_invalid_layout_item_keeps_existing_components(self):
        ok = self._save(
            [{"x": 0, "y": 0, "w": 2, "h": 2, "component_name": "TextBoxComponent", "text": "hi"}]
        )
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(self.dashboard.components.count(), 1)

        bad = self._save([{"component_name": "TextBoxComponent"}])  # no x/y/w/h
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.dashboard.components.count(), 1)

        bad = self._save(["not-an-object"])
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.dashboard.components.count(), 1)

    def test_filter_stack_component_round_trips(self):
        rules = [{"kind": "activity", "values": ["a"]}]
        response = self._save(
            [{"x": 0, "y": 0, "w": 2, "h": 2, "component_name": "FilterStackComponent",
              "filter_stack_json": rules}]
        )
        self.assertEqual(response.status_code, 200)
        layout = self.client.get(f"/api/dashboard/{self.dashboard.pk}/get_layout/")
        self.assertEqual(layout.status_code, 200)
        self.assertEqual(layout.data[0]["component_name"], "FilterStackComponent")
        self.assertEqual(layout.data[0]["filter_stack_json"], rules)


class TextBoxComponentFormattingTests(TestCase):
    """Block-level formatting on the Text Box widget (#373): it must survive a
    save/load round-trip, and every value must be validated down to something
    renderable rather than trusted or rejected."""

    FORMAT = {
        "font_size": 32,
        "font_family": "serif",
        "font_weight": "bold",
        "italic": True,
        "underline": True,
        "text_align": "center",
        "vertical_align": "middle",
        "text_color": "#ffffff",
        "background_color": "#1e293b",
        "line_height": 2.0,
    }

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="text-box-owner")
        self.project = Project.objects.create(name="TextBoxes")
        self.project.users.add(self.user)
        self.dashboard = Dashboard.objects.create(
            project=self.project, name="D", order_in_project=0
        )
        self.client.force_authenticate(user=self.user)

    def _save(self, **props):
        item = {
            "x": 0,
            "y": 0,
            "w": 2,
            "h": 2,
            "component_name": "TextBoxComponent",
            "text": "Quarterly notes",
        }
        item.update(props)
        return self.client.post(
            f"/api/dashboard/{self.dashboard.pk}/save_layout/",
            {"layout": [item]},
            format="json",
        )

    def _layout(self):
        response = self.client.get(f"/api/dashboard/{self.dashboard.pk}/get_layout/")
        self.assertEqual(response.status_code, 200)
        return response.data[0]

    def test_every_formatting_option_round_trips(self):
        self.assertEqual(self._save(**self.FORMAT).status_code, 200)
        item = self._layout()
        for key, expected in self.FORMAT.items():
            self.assertEqual(item[key], expected, key)

    def test_get_layout_exposes_the_new_fields(self):
        self.assertEqual(self._save().status_code, 200)
        item = self._layout()
        for key in self.FORMAT:
            self.assertIn(key, item)

    def test_defaults_reproduce_the_unformatted_look(self):
        """A payload from a client that knows nothing about formatting — i.e.
        every dashboard saved before #373 — must come back unstyled."""
        self.assertEqual(self._save().status_code, 200)
        item = self._layout()
        self.assertEqual(item["font_size"], 14)
        self.assertEqual(item["font_family"], "sans")
        self.assertEqual(item["font_weight"], "normal")
        self.assertFalse(item["italic"])
        self.assertFalse(item["underline"])
        self.assertEqual(item["text_align"], "left")
        self.assertEqual(item["vertical_align"], "top")
        self.assertEqual(item["text_color"], "#1e293b")
        self.assertEqual(item["background_color"], "#ffffff")
        self.assertEqual(item["line_height"], 1.5)

    def test_a_component_created_before_the_migration_still_loads(self):
        """The model defaults are what backfill existing rows, so a component
        created without any formatting must render and serialize."""
        TextBoxComponent.objects.create(
            dashboard=self.dashboard,
            x=0,
            y=0,
            w=2,
            h=2,
            component_name="TextBoxComponent",
            text="legacy",
        )
        item = self._layout()
        self.assertEqual(item["text"], "legacy")
        self.assertEqual(item["font_size"], 14)
        self.assertEqual(item["text_color"], "#1e293b")

    def test_unknown_choices_fall_back_to_the_default(self):
        response = self._save(
            font_family="Comic Sans",
            font_weight="900",
            text_align="middle",
            vertical_align="centre",
        )
        self.assertEqual(response.status_code, 200)
        item = self._layout()
        self.assertEqual(item["font_family"], "sans")
        self.assertEqual(item["font_weight"], "normal")
        self.assertEqual(item["text_align"], "left")
        self.assertEqual(item["vertical_align"], "top")

    def test_a_colour_that_is_not_a_hex_literal_is_replaced(self):
        """These land in an inline style on every dashboard that shows the
        component, so nothing but #rgb / #rrggbb is stored."""
        for bad in [
            "red",
            "rgb(0,0,0)",
            "#12345",
            "red; background: url(https://example.com/x)",
            "javascript:alert(1)",
            "",
            None,
            42,
            {"hex": "#fff"},
        ]:
            response = self._save(text_color=bad, background_color=bad)
            self.assertEqual(response.status_code, 200, bad)
            item = self._layout()
            self.assertEqual(item["text_color"], "#1e293b", bad)
            self.assertEqual(item["background_color"], "#ffffff", bad)

    def test_a_short_hex_colour_is_accepted(self):
        self.assertEqual(self._save(text_color="#fff").status_code, 200)
        self.assertEqual(self._layout()["text_color"], "#fff")

    def test_out_of_range_numbers_are_clamped_not_rejected(self):
        self.assertEqual(self._save(font_size=0, line_height=0).status_code, 200)
        item = self._layout()
        self.assertEqual(item["font_size"], 8)
        self.assertEqual(item["line_height"], 0.5)

        self.assertEqual(self._save(font_size=10000, line_height=99).status_code, 200)
        item = self._layout()
        self.assertEqual(item["font_size"], 200)
        self.assertEqual(item["line_height"], 5.0)

    def test_non_numeric_sizes_fall_back_to_the_default(self):
        # NaN / Infinity are absent on purpose: DRF's STRICT_JSON parser
        # rejects them with a 400 before any of this runs. They are covered
        # directly in TextBoxValidationHelperTests below.
        for bad in ["abc", None, True, [], {}]:
            response = self._save(font_size=bad, line_height=bad)
            self.assertEqual(response.status_code, 200, bad)
            item = self._layout()
            self.assertEqual(item["font_size"], 14, bad)
            self.assertEqual(item["line_height"], 1.5, bad)

    def test_a_numeric_string_is_accepted(self):
        """The frontend sends numbers, but a number input can round-trip a
        string through a hand-written payload."""
        self.assertEqual(self._save(font_size="20", line_height="2").status_code, 200)
        item = self._layout()
        self.assertEqual(item["font_size"], 20)
        self.assertEqual(item["line_height"], 2.0)

    def test_links_round_trip_through_save_and_load(self):
        sibling = Dashboard.objects.create(
            project=self.project, name="Sibling", order_in_project=1
        )
        doc = {
            "type": "doc",
            "content": [{"type": "paragraph", "content": [
                {"type": "text", "text": "site",
                 "marks": [{"type": "link", "attrs": {"href": "https://example.com"}}]},
                {"type": "text", "text": "mail",
                 "marks": [{"type": "link", "attrs": {"href": "mailto:a@b.com"}}]},
                {"type": "text", "text": "board",
                 "marks": [{"type": "dashboardLink",
                            "attrs": {"dashboardId": sibling.pk}}]},
            ]}],
        }
        self.assertEqual(self._save(rich_text=doc).status_code, 200)
        runs = self._layout()["rich_text"]["content"][0]["content"]
        self.assertEqual(
            [run["marks"][0] for run in runs],
            [
                {"type": "link", "attrs": {"href": "https://example.com"}},
                {"type": "link", "attrs": {"href": "mailto:a@b.com"}},
                {"type": "dashboardLink", "attrs": {"dashboardId": sibling.pk}},
            ],
        )

    def test_a_link_to_another_projects_dashboard_is_dropped(self):
        """The id has to be in *this* project."""
        foreign_project = Project.objects.create(name="Theirs")
        foreign = Dashboard.objects.create(
            project=foreign_project, name="Theirs", order_in_project=0
        )
        doc = {
            "type": "doc",
            "content": [{"type": "paragraph", "content": [
                {"type": "text", "text": "peek",
                 "marks": [{"type": "dashboardLink",
                            "attrs": {"dashboardId": foreign.pk}}]},
            ]}],
        }
        self.assertEqual(self._save(rich_text=doc).status_code, 200)
        run = self._layout()["rich_text"]["content"][0]["content"][0]
        self.assertEqual(run["text"], "peek")
        self.assertNotIn("marks", run)

    def test_a_hostile_href_is_dropped_without_losing_the_text(self):
        doc = {
            "type": "doc",
            "content": [{"type": "paragraph", "content": [
                {"type": "text", "text": "click",
                 "marks": [{"type": "link",
                            "attrs": {"href": "javascript:alert(1)"}}]},
            ]}],
        }
        self.assertEqual(self._save(rich_text=doc).status_code, 200)
        item = self._layout()
        run = item["rich_text"]["content"][0]["content"][0]
        self.assertEqual(run["text"], "click")
        self.assertNotIn("marks", run)
        self.assertEqual(item["text"], "click")

    def test_rich_text_round_trips_through_save_and_load(self):
        doc = {"type": "doc", "content": [
            {"type": "paragraph", "attrs": {"textAlign": "center"},
             "content": [{"type": "text", "text": "bold bit",
                          "marks": [{"type": "bold"}]}]},
            {"type": "paragraph",
             "content": [{"type": "text", "text": "red italic bit",
                          "marks": [{"type": "italic"},
                                    {"type": "textStyle",
                                     "attrs": {"color": "#f43f5e"}}]}]},
        ]}
        self.assertEqual(self._save(rich_text=doc).status_code, 200)
        item = self._layout()
        self.assertEqual(item["rich_text"], doc)

    def test_plain_text_is_derived_from_the_rich_document(self):
        """`text` must keep describing what the box shows, for anything that
        still reads the plain column."""
        doc = {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "line one"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "line two"}]},
        ]}
        self.assertEqual(self._save(text="ignored", rich_text=doc).status_code, 200)
        self.assertEqual(self._layout()["text"], "line one\nline two")

    def test_a_box_without_rich_text_stores_null_and_keeps_its_plain_text(self):
        self.assertEqual(self._save(text="just words").status_code, 200)
        item = self._layout()
        self.assertIsNone(item["rich_text"])
        self.assertEqual(item["text"], "just words")

    def test_a_hostile_document_is_rebuilt_rather_than_stored(self):
        doc = {"type": "doc", "content": [
            {"type": "script", "content": [{"type": "text", "text": "boom"}]},
            {"type": "paragraph", "attrs": {"textAlign": "middle"},
             "content": [{"type": "text", "text": "kept", "marks": [
                 {"type": "link", "attrs": {"href": "javascript:alert(1)"}},
                 {"type": "textStyle", "attrs": {"color": "red; background:url(x)"}},
             ]}]},
        ]}
        self.assertEqual(self._save(rich_text=doc).status_code, 200)
        stored = self._layout()["rich_text"]
        self.assertEqual([n["type"] for n in stored["content"]], ["paragraph", "paragraph"])
        self.assertEqual(stored["content"][0]["content"][0]["text"], "boom")
        run = stored["content"][1]["content"][0]
        self.assertEqual(run["text"], "kept")
        self.assertNotIn("marks", run)
        self.assertNotIn("attrs", stored["content"][1])

    def test_an_oversized_document_is_refused_with_400_not_silently_stripped(self):
        """Losing all formatting and still being told "saved" is worse than
        being refused."""
        from .rich_text import MAX_NODES

        doc = {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "x"}]}
            for _ in range(MAX_NODES)
        ]}
        response = self._save(rich_text=doc)
        self.assertEqual(response.status_code, 400)
        self.assertIn("too large", response.data["error"])
        self.assertEqual(self.dashboard.components.count(), 0)

    def test_junk_in_rich_text_does_not_500(self):
        for bad in ("not a doc", [], 42, {"type": "paragraph"}, None):
            response = self._save(text="fallback", rich_text=bad)
            self.assertEqual(response.status_code, 200, bad)
            item = self._layout()
            self.assertIsNone(item["rich_text"], bad)
            self.assertEqual(item["text"], "fallback", bad)

    def test_a_string_false_is_not_read_as_true(self):
        """``bool("false")`` is True; a string falls back to the default."""
        self.assertEqual(self._save(italic="false", underline="true").status_code, 200)
        item = self._layout()
        self.assertIs(item["italic"], False)
        self.assertIs(item["underline"], False)

    def test_italic_and_underline_accept_only_booleans_out(self):
        self.assertEqual(self._save(italic=1, underline=0).status_code, 200)
        item = self._layout()
        self.assertIs(item["italic"], True)
        self.assertIs(item["underline"], False)


class TextBoxValidationHelperTests(SimpleTestCase):
    """The value validators behind the Text Box formatting branch (#373).

    These need no database, and they cover the cases the API cannot reach:
    DRF's STRICT_JSON parser rejects NaN / Infinity outright, so the
    non-finite guard only ever fires for a direct Python caller.
    """

    def test_validated_int_rejects_non_finite_values(self):
        from .views.dashboards import _validated_int

        # int(float("inf")) raises OverflowError, so finiteness has to be
        # checked before the cast, not after it.
        for bad in (float("nan"), float("inf"), float("-inf")):
            self.assertEqual(_validated_int(bad, 14, 8, 200), 14, bad)

    def test_validated_int_clamps_and_falls_back(self):
        from .views.dashboards import _validated_int

        self.assertEqual(_validated_int(0, 14, 8, 200), 8)
        self.assertEqual(_validated_int(9999, 14, 8, 200), 200)
        self.assertEqual(_validated_int("20", 14, 8, 200), 20)
        self.assertEqual(_validated_int("abc", 14, 8, 200), 14)
        self.assertEqual(_validated_int(None, 14, 8, 200), 14)
        # A bool is an int in Python; treating True as 1 would silently
        # become font-size 8 after clamping.
        self.assertEqual(_validated_int(True, 14, 8, 200), 14)

    def test_validated_int_rounds_rather_than_truncates(self):
        from .views.dashboards import _validated_int

        # Must agree with Math.round in resolveTextBoxFormat; int() alone
        # would give 17 here and disagree with the frontend.
        self.assertEqual(_validated_int(17.6, 14, 8, 200), 18)
        self.assertEqual(_validated_int("17.4", 14, 8, 200), 17)

    def test_validated_number_clamps_floats(self):
        from .views.dashboards import _validated_number

        self.assertEqual(_validated_number(0, 1.5, 0.5, 5.0), 0.5)
        self.assertEqual(_validated_number(99, 1.5, 0.5, 5.0), 5.0)
        self.assertEqual(_validated_number("2", 1.5, 0.5, 5.0), 2.0)
        self.assertEqual(_validated_number("abc", 1.5, 0.5, 5.0), 1.5)
        self.assertEqual(_validated_number(float("nan"), 1.5, 0.5, 5.0), 1.5)

    def test_validated_hex_color_accepts_only_hex_literals(self):
        from .views.dashboards import _validated_hex_color

        self.assertEqual(_validated_hex_color("#fff", "#000000"), "#fff")
        self.assertEqual(_validated_hex_color("#1E293B", "#000000"), "#1E293B")
        self.assertEqual(_validated_hex_color("  #abc  ", "#000000"), "#abc")
        for bad in ("red", "#12345", "rgb(0,0,0)", "", None, 42, ["#fff"]):
            self.assertEqual(_validated_hex_color(bad, "#000000"), "#000000", bad)

    def test_validated_choice_reads_the_models_own_choices(self):
        from .models import TextBoxComponent
        from .views.dashboards import _validated_choice

        choices = TextBoxComponent.TEXT_ALIGN_CHOICES
        self.assertEqual(_validated_choice("center", choices, "left"), "center")
        self.assertEqual(_validated_choice("Center", choices, "left"), "left")
        self.assertEqual(_validated_choice("middle", choices, "left"), "left")
        self.assertEqual(_validated_choice(None, choices, "left"), "left")
        # The label side of a (value, label) pair must not be accepted.
        self.assertEqual(_validated_choice("Center", choices, "left"), "left")


class TextBoxRichTextValidationTests(SimpleTestCase):
    """The rich-text whitelist (#373 follow-up).

    The document comes from the browser and is served back to everyone who can
    open the dashboard, so only known node types, marks and attribute values
    may survive. It is never rendered as HTML, but it is still untrusted input.
    """

    def _doc(self, *content):
        return {"type": "doc", "content": list(content)}

    def _para(self, *content, **attrs):
        node = {"type": "paragraph", "content": list(content)}
        if attrs:
            node["attrs"] = attrs
        return node

    def _text(self, text, marks=None):
        node = {"type": "text", "text": text}
        if marks is not None:
            node["marks"] = marks
        return node

    def test_a_plain_document_survives_unchanged(self):
        from .rich_text import validated_rich_text

        doc = self._doc(self._para(self._text("hello")))
        self.assertEqual(validated_rich_text(doc), doc)

    def test_known_marks_survive(self):
        from .rich_text import validated_rich_text

        marks = [{"type": "bold"}, {"type": "italic"}, {"type": "underline"}]
        doc = self._doc(self._para(self._text("hi", marks)))
        self.assertEqual(validated_rich_text(doc)["content"][0]["content"][0]["marks"], marks)

    def test_unknown_marks_are_dropped_but_the_text_stays(self):
        from .rich_text import validated_rich_text

        doc = self._doc(self._para(self._text("hi", [
            {"type": "bold"},
            {"type": "evil"},
        ])))
        run = validated_rich_text(doc)["content"][0]["content"][0]
        self.assertEqual(run["text"], "hi")
        self.assertEqual(run["marks"], [{"type": "bold"}])

    def test_a_known_mark_with_a_hostile_value_is_dropped_but_the_text_stays(self):
        """`link` is a known mark, so a bad href must fail on the href itself
        rather than on the mark type being unknown."""
        from .rich_text import validated_rich_text

        doc = self._doc(self._para(self._text("hi", [
            {"type": "bold"},
            {"type": "link", "attrs": {"href": "javascript:alert(1)"}},
        ])))
        run = validated_rich_text(doc)["content"][0]["content"][0]
        self.assertEqual(run["text"], "hi")
        self.assertEqual(run["marks"], [{"type": "bold"}])

    def test_accepted_link_targets_survive(self):
        from .rich_text import validated_rich_text

        for href in (
            "https://example.com",
            "http://example.com/a/b?c=d#e",
            "HTTPS://EXAMPLE.COM",
            "https://example.com:8443/path",
            "mailto:someone@example.com",
            "mailto:first.last+tag@sub.example.co.uk",
        ):
            doc = self._doc(self._para(self._text("hi", [
                {"type": "link", "attrs": {"href": href}},
            ])))
            marks = validated_rich_text(doc)["content"][0]["content"][0]["marks"]
            self.assertEqual(marks, [{"type": "link", "attrs": {"href": href}}], href)

    def test_a_padded_href_is_trimmed(self):
        from .rich_text import validated_rich_text

        doc = self._doc(self._para(self._text("hi", [
            {"type": "link", "attrs": {"href": "  https://example.com  "}},
        ])))
        marks = validated_rich_text(doc)["content"][0]["content"][0]["marks"]
        self.assertEqual(marks[0]["attrs"]["href"], "https://example.com")

    def test_hostile_hrefs_are_dropped_and_the_text_survives(self):
        from .rich_text import validated_rich_text

        hostile = (
            "javascript:alert(1)",
            "JavaScript:alert(1)",
            "java\nscript:alert(1)",
            "java\tscript:alert(1)",
            "https://example.com\x00.evil.example",
            "javascript:alert(1)//https://example.com",
            "data:text/html,<script>alert(1)</script>",
            "vbscript:msgbox(1)",
            "file:///etc/passwd",
            "ftp://example.com/x",
            "tel:+15551234",
            "//evil.example/path",
            "/dashboards/1",
            "dashboards/1",
            "https://",
            # urlsplit and the browser's parser disagree on these two.
            "https:///path",
            "https://exa mple.com",
            "https://ho\"st/",
            "mailto:a@b.com?cc=victim@evil.example",
            "mailto:a@b.com?subject=hi",
            "mailto:a@b.com,c@d.com",
            "mailto:notanaddress",
            "mailto:",
            "",
            "   ",
            "https://example.com/" + ("a" * 3000),
        )
        for href in hostile:
            doc = self._doc(self._para(self._text("hi", [
                {"type": "link", "attrs": {"href": href}},
            ])))
            run = validated_rich_text(doc)["content"][0]["content"][0]
            self.assertEqual(run["text"], "hi", href)
            self.assertNotIn("marks", run, href)

    def test_a_non_string_href_is_dropped(self):
        from .rich_text import validated_rich_text

        for href in ({"a": 1}, ["https://example.com"], 5, True, None):
            doc = self._doc(self._para(self._text("hi", [
                {"type": "link", "attrs": {"href": href}},
            ])))
            run = validated_rich_text(doc)["content"][0]["content"][0]
            self.assertNotIn("marks", run, repr(href))

    def test_a_link_stores_its_href_and_nothing_else(self):
        """The renderer sets target and rel itself, so a stored value could
        only override what it decided."""
        from .rich_text import validated_rich_text

        doc = self._doc(self._para(self._text("hi", [
            {"type": "link", "attrs": {
                "href": "https://example.com",
                "target": "_self",
                "rel": "opener",
                "class": "evil",
                "title": "x",
                "onclick": "alert(1)",
            }},
        ])))
        marks = validated_rich_text(doc)["content"][0]["content"][0]["marks"]
        self.assertEqual(marks, [{"type": "link", "attrs": {"href": "https://example.com"}}])

    def test_a_dashboard_link_survives_only_for_an_allowed_id(self):
        from .rich_text import validated_rich_text

        doc = self._doc(self._para(self._text("hi", [
            {"type": "dashboardLink", "attrs": {"dashboardId": 7}},
        ])))
        marks = validated_rich_text(doc, {7, 8})["content"][0]["content"][0]["marks"]
        self.assertEqual(
            marks, [{"type": "dashboardLink", "attrs": {"dashboardId": 7}}]
        )

        # Another project's dashboard, and one that no longer exists, look
        # exactly the same from here: an id that is not on the list.
        run = validated_rich_text(doc, {8, 9})["content"][0]["content"][0]
        self.assertEqual(run["text"], "hi")
        self.assertNotIn("marks", run)

    def test_a_dashboard_link_is_dropped_when_no_project_is_known(self):
        """The default trusts nothing."""
        from .rich_text import validated_rich_text

        doc = self._doc(self._para(self._text("hi", [
            {"type": "dashboardLink", "attrs": {"dashboardId": 7}},
        ])))
        run = validated_rich_text(doc)["content"][0]["content"][0]
        self.assertNotIn("marks", run)

    def test_a_malformed_dashboard_id_is_dropped(self):
        from .rich_text import validated_rich_text

        for dashboard_id in (True, 0, -1, "7", 1.5, None, {"id": 7}):
            doc = self._doc(self._para(self._text("hi", [
                {"type": "dashboardLink", "attrs": {"dashboardId": dashboard_id}},
            ])))
            run = validated_rich_text(doc, {0, 1, 7})["content"][0]["content"][0]
            self.assertNotIn("marks", run, repr(dashboard_id))

    def test_hrefs_count_against_the_document_size_limit(self):
        """Otherwise thousands of maximal hrefs are megabytes of payload
        while the visible text stays tiny."""
        from .rich_text import validated_rich_text

        from .rich_text import RichTextTooLarge

        href = "https://example.com/" + ("a" * 2000)
        paragraphs = [
            self._para(self._text("x", [{"type": "link", "attrs": {"href": href}}]))
            for _ in range(60)
        ]
        with self.assertRaises(RichTextTooLarge):
            validated_rich_text(self._doc(*paragraphs))

    def test_text_style_keeps_only_valid_attributes(self):
        from .rich_text import validated_rich_text

        doc = self._doc(self._para(self._text("hi", [
            {"type": "textStyle", "attrs": {
                "color": "#F43F5E",
                "fontSize": "24px",
                "fontFamily": "var(--font-serif)",
            }},
        ])))
        attrs = validated_rich_text(doc)["content"][0]["content"][0]["marks"][0]["attrs"]
        self.assertEqual(
            attrs,
            {"color": "#f43f5e", "fontSize": "24px", "fontFamily": "var(--font-serif)"},
        )

    def test_text_style_rejects_hostile_or_unknown_attribute_values(self):
        from .rich_text import validated_rich_text

        doc = self._doc(self._para(self._text("hi", [
            {"type": "textStyle", "attrs": {
                "color": "red; background: url(https://evil.example/x)",
                "fontSize": "24px; position: fixed",
                "fontFamily": "Comic Sans",
                "onclick": "alert(1)",
            }},
        ])))
        # Nothing valid is left on the mark, so the mark itself goes.
        run = validated_rich_text(doc)["content"][0]["content"][0]
        self.assertEqual(run["text"], "hi")
        self.assertNotIn("marks", run)

    def test_font_size_is_clamped(self):
        from .rich_text import validated_rich_text

        for sent, expected in (("2px", "8px"), ("999px", "200px"), ("24px", "24px")):
            doc = self._doc(self._para(self._text("hi", [
                {"type": "textStyle", "attrs": {"fontSize": sent}},
            ])))
            attrs = validated_rich_text(doc)["content"][0]["content"][0]["marks"][0]["attrs"]
            self.assertEqual(attrs["fontSize"], expected, sent)

    def test_paragraph_alignment_and_line_height(self):
        from .rich_text import validated_rich_text

        doc = self._doc(self._para(self._text("hi"), textAlign="center", lineHeight="2"))
        attrs = validated_rich_text(doc)["content"][0]["attrs"]
        self.assertEqual(attrs["textAlign"], "center")
        self.assertEqual(attrs["lineHeight"], "2.0")

    def test_unknown_alignment_is_dropped(self):
        from .rich_text import validated_rich_text

        doc = self._doc(self._para(self._text("hi"), textAlign="middle"))
        self.assertNotIn("attrs", validated_rich_text(doc)["content"][0])

    def test_heading_level_is_restricted(self):
        from .rich_text import validated_rich_text

        for sent in (9, 0, "2", True, None):
            doc = self._doc({"type": "heading", "attrs": {"level": sent},
                             "content": [self._text("h")]})
            self.assertEqual(validated_rich_text(doc)["content"][0]["attrs"]["level"], 1, sent)
        doc = self._doc({"type": "heading", "attrs": {"level": 3},
                         "content": [self._text("h")]})
        self.assertEqual(validated_rich_text(doc)["content"][0]["attrs"]["level"], 3)

    def test_deeper_headings_become_the_smallest_rather_than_the_largest(self):
        from .rich_text import validated_rich_text

        for sent in (4, 5, 6):
            doc = self._doc({"type": "heading", "attrs": {"level": sent},
                             "content": [self._text("h")]})
            self.assertEqual(validated_rich_text(doc)["content"][0]["attrs"]["level"], 3, sent)

    def test_an_ordered_list_keeps_its_start_number(self):
        from .rich_text import validated_rich_text

        def start_of(sent):
            doc = self._doc({"type": "orderedList", "attrs": {"start": sent}, "content": [
                {"type": "listItem", "content": [self._para(self._text("x"))]},
            ]})
            return validated_rich_text(doc)["content"][0].get("attrs", {}).get("start")

        self.assertEqual(start_of(5), 5)
        for bad in (1, 0, -3, "5", 2.5, True, None, 10**9):
            self.assertIsNone(start_of(bad), bad)

    def test_an_unknown_inline_wrapper_does_not_nest_a_paragraph(self):
        """Inside a paragraph, the wrapper's words are spliced in as runs."""
        from .rich_text import validated_rich_text

        doc = self._doc(self._para(
            self._text("a "),
            {"type": "mention", "content": [self._text("@b")]},
            {"type": "widget", "content": [self._para(self._text(" c"))]},
        ))
        para = validated_rich_text(doc)["content"][0]
        self.assertEqual([n["type"] for n in para["content"]], ["text", "text", "text"])
        self.assertEqual("".join(n["text"] for n in para["content"]), "a @b c")

    def test_bare_text_under_a_block_container_is_wrapped(self):
        from .rich_text import validated_rich_text

        doc = self._doc(self._text("loose"), {"type": "blockquote", "content": [self._text("q")]})
        content = validated_rich_text(doc)["content"]
        self.assertEqual(content[0]["type"], "paragraph")
        self.assertEqual(content[1]["content"][0]["type"], "paragraph")

    def test_plain_text_gives_each_list_item_its_own_line(self):
        from .rich_text import plain_text_from_doc

        item = lambda text: {"type": "listItem", "content": [self._para(self._text(text))]}
        doc = self._doc(
            {"type": "bulletList", "content": [item("Revenue"), item("Costs")]},
            self._para(),
            self._para(self._text("end")),
        )
        self.assertEqual(plain_text_from_doc(doc), "Revenue\nCosts\n\nend")

    def test_unknown_node_types_are_dropped_but_their_text_is_kept(self):
        """The wrapper goes; the words it held do not. Bare inline content
        gets a paragraph, or the editor's schema would reject the result."""
        from .rich_text import validated_rich_text

        doc = self._doc(
            {"type": "script", "content": [self._text("boom")]},
            {"type": "image", "attrs": {"src": "javascript:alert(1)"}},
            self._para(self._text("kept")),
        )
        content = validated_rich_text(doc)["content"]
        self.assertEqual([node["type"] for node in content], ["paragraph", "paragraph"])
        self.assertEqual(content[0]["content"][0]["text"], "boom")
        self.assertEqual(content[1]["content"][0]["text"], "kept")
        self.assertNotIn("attrs", content[0])

    def test_lists_and_blockquotes_survive(self):
        from .rich_text import validated_rich_text

        doc = self._doc({"type": "bulletList", "content": [
            {"type": "listItem", "content": [self._para(self._text("one"))]},
        ]})
        result = validated_rich_text(doc)
        self.assertEqual(result["content"][0]["type"], "bulletList")
        self.assertEqual(
            result["content"][0]["content"][0]["content"][0]["content"][0]["text"], "one"
        )

    def test_anything_that_is_not_a_document_stores_nothing(self):
        from .rich_text import validated_rich_text

        for bad in (None, "", [], 42, {"type": "paragraph"}, {"content": []},
                    self._doc(), {"type": "doc", "content": "nope"}):
            self.assertIsNone(validated_rich_text(bad), bad)

    def test_an_oversized_document_raises_rather_than_storing_nothing(self):
        """Too big is not "no rich text": the caller has to tell them apart,
        or a user loses all their formatting to a 200 response."""
        from .rich_text import MAX_NODES, RichTextTooLarge, validated_rich_text

        doc = self._doc(*[self._para(self._text("x")) for _ in range(MAX_NODES)])
        with self.assertRaises(RichTextTooLarge):
            validated_rich_text(doc)

    def test_a_deeply_nested_document_raises(self):
        from .rich_text import MAX_DEPTH, RichTextTooLarge, validated_rich_text

        node = self._para(self._text("deep"))
        for _ in range(MAX_DEPTH + 5):
            node = {"type": "blockquote", "content": [node]}
        with self.assertRaises(RichTextTooLarge):
            validated_rich_text(self._doc(node))

    def test_an_unknown_wrapper_is_dropped_but_its_text_survives(self):
        """A newer client's table or task list would otherwise have every
        word inside it deleted at save time."""
        from .rich_text import validated_rich_text

        doc = self._doc({
            "type": "table",
            "content": [self._para(self._text("inside a table"))],
        })
        cleaned = validated_rich_text(doc)
        self.assertEqual(cleaned["content"][0]["type"], "paragraph")
        self.assertEqual(cleaned["content"][0]["content"][0]["text"], "inside a table")

    def test_plain_text_is_derived_one_line_per_block(self):
        from .rich_text import plain_text_from_doc

        doc = self._doc(
            self._para(self._text("first "), self._text("line", [{"type": "bold"}])),
            self._para(self._text("second")),
        )
        self.assertEqual(plain_text_from_doc(doc), "first line\nsecond")


class SqlDashboardComponentsLayoutTests(TestCase):
    """Round-trip of the SQL-driven widgets (KPI, bar chart, scatter plot,
    SQL editor, pie chart) including links to stored query assets."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="sql-dash-owner")
        self.other = User.objects.create_user(username="sql-dash-other")
        self.project = Project.objects.create(name="Mine")
        self.project.users.add(self.user)
        self.foreign_project = Project.objects.create(name="Theirs")
        self.foreign_project.users.add(self.other)
        self.dashboard = Dashboard.objects.create(
            project=self.project, name="D", order_in_project=0
        )
        self.query_asset = ProjectAsset.objects.create(
            project=self.project,
            name="stored",
            asset_type=ProjectAsset.AssetType.QUERY,
            content_json={"schema": "sql-query", "version": 1, "query": "SELECT 1 AS value"},
        )
        self.foreign_query_asset = ProjectAsset.objects.create(
            project=self.foreign_project,
            name="foreign",
            asset_type=ProjectAsset.AssetType.QUERY,
            content_json={"schema": "sql-query", "version": 1, "query": "SELECT 2 AS value"},
        )
        self.model_asset = ProjectAsset.objects.create(
            project=self.project,
            name="model",
            asset_type=ProjectAsset.AssetType.TOTEM,
            content_json=valid_totem_content_json(),
        )
        self.client.force_authenticate(user=self.user)

    def _save(self, layout):
        return self.client.post(
            f"/api/dashboard/{self.dashboard.pk}/save_layout/",
            {"layout": layout},
            format="json",
        )

    def _layout(self):
        response = self.client.get(f"/api/dashboard/{self.dashboard.pk}/get_layout/")
        self.assertEqual(response.status_code, 200)
        return {item["component_name"]: item for item in response.data}

    def test_new_components_round_trip(self):
        response = self._save(
            [
                {"x": 0, "y": 0, "w": 2, "h": 2, "component_name": "KpiComponent",
                 "title": "Events", "query": "SELECT count(*) AS value FROM events",
                 "value_column": "value", "prefix": "", "suffix": " ev", "decimals": 2},
                {"x": 2, "y": 0, "w": 4, "h": 4, "component_name": "BarChartComponent",
                 "title": "Per activity", "query": "SELECT activity AS label, count(*) AS value FROM events GROUP BY activity",
                 "label_column": "label", "value_column": "value", "horizontal": True, "show_values": True},
                {"x": 6, "y": 0, "w": 4, "h": 4, "component_name": "ScatterPlotComponent",
                 "title": "xy", "query": "SELECT 1 AS x, 2 AS y, 'a' AS s",
                 "x_column": "x", "y_column": "y", "series_column": "s", "x_label": "X", "y_label": "Y"},
                {"x": 0, "y": 4, "w": 6, "h": 6, "component_name": "SqlQueryComponent",
                 "name": "raw", "query": "SELECT * FROM events", "row_limit": 50},
            ]
        )
        self.assertEqual(response.status_code, 200, response.data)
        layout = self._layout()

        kpi = layout["KpiComponent"]
        self.assertEqual(kpi["title"], "Events")
        self.assertEqual(kpi["value_column"], "value")
        self.assertEqual(kpi["suffix"], " ev")
        self.assertEqual(kpi["decimals"], 2)
        self.assertIsNone(kpi["query_asset"])

        bar = layout["BarChartComponent"]
        self.assertEqual(bar["label_column"], "label")
        self.assertTrue(bar["horizontal"])
        self.assertTrue(bar["show_values"])

        scatter = layout["ScatterPlotComponent"]
        self.assertEqual(scatter["series_column"], "s")
        self.assertEqual(scatter["y_label"], "Y")

        sql = layout["SqlQueryComponent"]
        self.assertEqual(sql["row_limit"], 50)
        self.assertNotIn("expected_result", sql)

    def test_linked_query_asset_is_kept_when_it_belongs_to_the_project(self):
        response = self._save(
            [
                {"x": 0, "y": 0, "w": 2, "h": 2, "component_name": "KpiComponent",
                 "query": "SELECT 0", "query_asset": self.query_asset.pk},
                {"x": 0, "y": 2, "w": 4, "h": 4, "component_name": "PieChartComponent",
                 "query": "SELECT 0", "query_asset": str(self.query_asset.pk)},
            ]
        )
        self.assertEqual(response.status_code, 200, response.data)
        layout = self._layout()
        self.assertEqual(layout["KpiComponent"]["query_asset"], self.query_asset.pk)
        self.assertEqual(layout["PieChartComponent"]["query_asset"], self.query_asset.pk)

    def test_foreign_or_non_query_assets_are_unlinked(self):
        response = self._save(
            [
                {"x": 0, "y": 0, "w": 2, "h": 2, "component_name": "KpiComponent",
                 "query": "SELECT 0", "query_asset": self.foreign_query_asset.pk},
                {"x": 0, "y": 2, "w": 4, "h": 4, "component_name": "BarChartComponent",
                 "query": "SELECT 0", "query_asset": self.model_asset.pk},
                {"x": 0, "y": 6, "w": 4, "h": 4, "component_name": "ScatterPlotComponent",
                 "query": "SELECT 0", "query_asset": "not-an-id"},
            ]
        )
        self.assertEqual(response.status_code, 200, response.data)
        layout = self._layout()
        self.assertIsNone(layout["KpiComponent"]["query_asset"])
        self.assertIsNone(layout["BarChartComponent"]["query_asset"])
        self.assertIsNone(layout["ScatterPlotComponent"]["query_asset"])

    def test_deleting_a_stored_query_unlinks_components(self):
        self._save(
            [{"x": 0, "y": 0, "w": 2, "h": 2, "component_name": "KpiComponent",
              "query": "SELECT 0", "query_asset": self.query_asset.pk}]
        )
        self.assertEqual(self.client.delete(f"/api/assets/{self.query_asset.pk}/").status_code, 204)
        self.assertIsNone(self._layout()["KpiComponent"]["query_asset"])


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
            "x": 0,
            "y": 0,
            "w": 6,
            "h": 6,
            "component_name": "ProcessAreaComponent",
        }
        item.update(extra or {})
        return self.client.post(
            f"/api/dashboard/{self.dashboard.pk}/save_layout/",
            {"layout": [item]},
            format="json",
        )

    def test_settings_survive_a_save_and_reload(self):
        response = self._save(
            {
                "algorithm": "advanced",
                "w_temporal": 0.5,
                "w_cardinality": 0.0,
                "w_divergence": 1.5,
                "alpha": 8.0,
                "beta": 0.5,
            }
        )
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
        self.assertEqual(component["alpha"], 2.0)
        self.assertEqual(component["beta"], 1.0)

    def test_existing_rows_are_backfilled_by_the_migration_defaults(self):
        component = ProcessAreaComponent.objects.create(
            dashboard=self.dashboard,
            x=0,
            y=0,
            w=6,
            h=6,
            component_name="ProcessAreaComponent",
        )
        component.refresh_from_db()
        self.assertEqual(component.algorithm, "advanced")
        self.assertEqual(component.alpha, 2.0)
        self.assertEqual(component.beta, 1.0)

    def test_get_layout_exposes_the_new_fields(self):
        self._save({"alpha": 3.0})
        layout = self.client.get(f"/api/dashboard/{self.dashboard.pk}/get_layout/")
        self.assertLessEqual(
            {
                "algorithm",
                "w_temporal",
                "w_cardinality",
                "w_divergence",
                "alpha",
                "beta",
            },
            set(layout.data[0]),
        )


# ---------------------------------------------------------------------------
# OCPN discovery endpoint tests
# ---------------------------------------------------------------------------
import tempfile

import duckdb
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APITestCase

from totem_lib.ocel.ocel_duckdb import OcelDuckDB, create_ocel_schema

from .models import EventLog, Project
from . import views

_MEDIA_ROOT = tempfile.mkdtemp(prefix="totem-test-media-")


def _write_paper_example_duckdb(path: str) -> None:
    """The order/item example from the OCPN paper as a native .duckdb OCEL."""
    conn = duckdb.connect(":memory:")
    create_ocel_schema(conn, [], [])
    conn.executemany(
        "INSERT INTO events VALUES (?, ?, ?)",
        [
            ("e1", "place order", 1),
            ("e2", "pick item", 2),
            ("e3", "pick item", 3),
            ("e4", "complete order", 4),
        ],
    )
    conn.executemany(
        "INSERT INTO objects VALUES (?, ?)",
        [("o1", "order"), ("i1", "item"), ("i2", "item")],
    )
    conn.executemany(
        "INSERT INTO event_object VALUES (?, ?, NULL)",
        [
            ("e1", "o1"),
            ("e1", "i1"),
            ("e1", "i2"),
            ("e2", "i1"),
            ("e3", "i2"),
            ("e4", "o1"),
            ("e4", "i1"),
            ("e4", "i2"),
        ],
    )
    db = OcelDuckDB._from_prepared_connection(conn, [], [])
    db.save(path)
    db.close()


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class DiscoverOcpnEndpointTests(APITestCase):
    def setUp(self):
        cache.clear()
        views._OCEL_DB_REGISTRY.clear()
        views._OCEL_OBJECT_TYPES_REGISTRY.clear()

        self.user = User.objects.create_user("tester", password="pw")
        self.project = Project.objects.create(name="test-project")
        self.project.users.add(self.user)

        filename = f"paper-example-{self._testMethodName}.duckdb"
        _write_paper_example_duckdb(f"{_MEDIA_ROOT}/{filename}")
        self.log = EventLog.objects.create(project=self.project, file=filename)

        self.client.force_authenticate(self.user)

    def test_discover_ocpn_returns_model(self):
        response = self.client.get(f"/api/files/{self.log.pk}/discover_ocpn/")
        self.assertEqual(response.status_code, 200)
        model = response.json()["ocpn"]
        self.assertEqual(model["format"], "ocpn")
        self.assertEqual(model["version"], 1)
        labels = sorted(
            t["label"] for t in model["transitions"] if not t.get("silent")
        )
        self.assertEqual(labels, ["complete order", "pick item", "place order"])
        self.assertEqual(
            [ot["name"] for ot in model["objectTypes"]], ["item", "order"]
        )
        self.assertTrue(model["places"])
        self.assertTrue(model["arcs"])
        # "place order"/"complete order" involve two items -> variable arcs.
        self.assertTrue(any(arc.get("variable") for arc in model["arcs"]))

    def test_object_types_filter(self):
        response = self.client.get(
            f"/api/files/{self.log.pk}/discover_ocpn/",
            {"object_types": "order"},
        )
        self.assertEqual(response.status_code, 200)
        model = response.json()["ocpn"]
        self.assertEqual([ot["name"] for ot in model["objectTypes"]], ["order"])
        labels = sorted(t["label"] for t in model["transitions"])
        self.assertEqual(labels, ["complete order", "place order"])

    def test_requires_project_membership(self):
        outsider = User.objects.create_user("outsider", password="pw")
        self.client.force_authenticate(outsider)
        response = self.client.get(f"/api/files/{self.log.pk}/discover_ocpn/")
        self.assertEqual(response.status_code, 404)

    def test_invalid_timeout_falls_back_to_default(self):
        response = self.client.get(
            f"/api/files/{self.log.pk}/discover_ocpn/",
            {"timeout_s": "not-a-number"},
        )
        self.assertEqual(response.status_code, 200)


# ---------------------------------------------------------------------------
# DuckDB concurrency model tests
# ---------------------------------------------------------------------------
#
# The dashboard fires several endpoints in parallel on first load; all of
# them funnel into one shared DuckDB connection per file. These tests pin
# down the model that makes that safe: stored .duckdb logs open read-only,
# every OcelDuckDB carries a reentrant lock, and the OCCN endpoint (the one
# that used to run unlocked) holds that lock for its whole discovery.

import threading as _threading

import duckdb as _duckdb

from totem_lib.ocel.ocel_duckdb import create_ocel_schema
from . import views as _views
from .views.event_log import QUERY_BROWSER_TABLES


def _write_minimal_duckdb_log(path: str) -> None:
    conn = _duckdb.connect(":memory:")
    create_ocel_schema(conn, [], [])
    conn.executemany(
        "INSERT INTO events VALUES (?, ?, ?)",
        [("e1", "create order", 1), ("e2", "ship order", 2)],
    )
    conn.executemany(
        "INSERT INTO objects VALUES (?, ?)",
        [("o1", "Order"), ("i1", "Item")],
    )
    conn.executemany(
        "INSERT INTO event_object VALUES (?, ?, NULL)",
        [("e1", "o1"), ("e1", "i1"), ("e2", "o1")],
    )
    db = OcelDuckDB._from_prepared_connection(conn, [], [])
    db.save(path)
    db.close()


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class ExecuteQuerySandboxTests(APITestCase):
    """The ad-hoc SQL endpoint must not reach the host filesystem."""

    def setUp(self):
        cache.clear()
        views._OCEL_DB_REGISTRY.clear()
        views._OCEL_OBJECT_TYPES_REGISTRY.clear()
        self.user = User.objects.create_user("sql-user", password="pw")
        self.project = Project.objects.create(name="sql-project")
        self.project.users.add(self.user)
        filename = f"sql-sandbox-{self._testMethodName}.duckdb"
        _write_minimal_duckdb_log(f"{_MEDIA_ROOT}/{filename}")
        self.log = EventLog.objects.create(project=self.project, file=filename)
        self.client.force_authenticate(self.user)

    def _run(self, query):
        return self.client.post(
            f"/api/files/{self.log.pk}/execute_query/", {"query": query}, format="json"
        )

    def test_select_works_and_reports_truncation_flag(self):
        response = self._run("SELECT activity FROM events ORDER BY activity;")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["columns"], ["activity"])
        self.assertEqual(
            [r["activity"] for r in response.data["data"]], ["create order", "ship order"]
        )
        self.assertFalse(response.data["truncated"])

    def test_multiple_statements_are_rejected(self):
        response = self._run("SELECT 1; SELECT 2")
        self.assertEqual(response.status_code, 400)

    def test_non_select_statement_is_rejected(self):
        response = self._run("COPY (SELECT 1) TO '/tmp/should-not-exist.csv'")
        self.assertEqual(response.status_code, 400)
        response = self._run("CREATE TABLE x AS SELECT 1")
        self.assertEqual(response.status_code, 400)

    def test_select_cannot_read_host_files(self):
        response = self._run("SELECT * FROM glob('/*')")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertNotIn("data", response.data)
        response = self._run("SELECT content FROM read_text('/etc/hosts')")
        self.assertEqual(response.status_code, 400, response.data)

    def test_other_users_cannot_query_the_log(self):
        other = User.objects.create_user("other-sql-user", password="pw")
        self.client.force_authenticate(other)
        response = self._run("SELECT 1")
        self.assertEqual(response.status_code, 404)

    def test_stored_queries_can_be_referenced_by_name(self):
        ProjectAsset.objects.create(
            project=self.project,
            name="Activity counts",
            asset_type=ProjectAsset.AssetType.QUERY,
            content_json={"schema": "sql-query", "version": 1,
                          "query": "SELECT activity, count(*) AS n FROM events GROUP BY activity"},
        )
        response = self._run('SELECT sum(n) AS total FROM "Activity counts"')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["data"], [{"total": 2}])

    def test_circular_stored_queries_fail_cleanly(self):
        ProjectAsset.objects.create(
            project=self.project, name="a", asset_type=ProjectAsset.AssetType.QUERY,
            content_json={"schema": "sql-query", "version": 1, "query": 'SELECT * FROM "b"'},
        )
        ProjectAsset.objects.create(
            project=self.project, name="b", asset_type=ProjectAsset.AssetType.QUERY,
            content_json={"schema": "sql-query", "version": 1, "query": 'SELECT * FROM "a"'},
        )
        response = self._run('SELECT * FROM "a"')
        self.assertEqual(response.status_code, 400)
        self.assertIn("Circular", response.data["error"])

    def test_referenced_stored_query_cannot_escape_the_sandbox(self):
        ProjectAsset.objects.create(
            project=self.project, name="evil", asset_type=ProjectAsset.AssetType.QUERY,
            content_json={"schema": "sql-query", "version": 1, "query": "SELECT * FROM glob('/*')"},
        )
        response = self._run('SELECT * FROM "evil"')
        self.assertEqual(response.status_code, 400)

    def _run_page(self, query, **paging):
        return self.client.post(
            f"/api/files/{self.log.pk}/execute_query/",
            {"query": query, **paging},
            format="json",
        )

    def test_pages_are_served_with_offset_and_limit(self):
        query = "SELECT activity FROM events ORDER BY activity"
        first = self._run_page(query, offset=0, limit=1)
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual([r["activity"] for r in first.data["data"]], ["create order"])
        self.assertTrue(first.data["has_more"])
        self.assertEqual(first.data["offset"], 0)
        self.assertEqual(first.data["limit"], 1)

        second = self._run_page(query, offset=1, limit=1)
        self.assertEqual([r["activity"] for r in second.data["data"]], ["ship order"])
        self.assertFalse(second.data["has_more"])

        beyond = self._run_page(query, offset=5, limit=1)
        self.assertEqual(beyond.data["data"], [])
        self.assertFalse(beyond.data["has_more"])
        # Columns are still reported for an empty page so the table header
        # survives scrolling past the end.
        self.assertEqual(beyond.data["columns"], ["activity"])

    def test_paging_parameters_are_validated(self):
        response = self._run_page("SELECT 1", offset=-1)
        self.assertEqual(response.status_code, 400)
        response = self._run_page("SELECT 1", limit=0)
        self.assertEqual(response.status_code, 400)
        response = self._run_page("SELECT 1", limit="lots")
        self.assertEqual(response.status_code, 400)
        # Over-large limits are clamped to the server cap rather than rejected.
        response = self._run_page("SELECT 1", limit=10**9)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["limit"], views.event_log.EXECUTE_QUERY_MAX_ROWS)


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class QueryColumnsEndpointTests(APITestCase):
    """The SQL editor's schema browser."""

    def setUp(self):
        cache.clear()
        views._OCEL_DB_REGISTRY.clear()
        views._OCEL_OBJECT_TYPES_REGISTRY.clear()
        self.user = User.objects.create_user("cols-user", password="pw")
        self.project = Project.objects.create(name="cols-project")
        self.project.users.add(self.user)
        filename = f"sql-columns-{self._testMethodName}.duckdb"
        _write_minimal_duckdb_log(f"{_MEDIA_ROOT}/{filename}")
        self.log = EventLog.objects.create(project=self.project, file=filename)
        self.client.force_authenticate(self.user)

    def _get(self, pk=None):
        return self.client.get(f"/api/files/{pk or self.log.pk}/query_columns/")

    def test_lists_every_exposed_table_with_columns_and_counts(self):
        response = self._get()
        self.assertEqual(response.status_code, 200, response.data)
        tables = {t["name"]: t for t in response.data["tables"]}
        self.assertEqual(set(tables), set(QUERY_BROWSER_TABLES))
        events = tables["events"]
        self.assertEqual(events["rowCount"], 2)
        self.assertIn("activity", [c["name"] for c in events["columns"]])

    def test_reports_structural_key_hints(self):
        tables = {t["name"]: t for t in self._get().data["tables"]}
        notes = {c["name"]: c["note"] for c in tables["event_object"]["columns"]}
        self.assertEqual(notes["event_id"], "FK -> events")
        self.assertEqual(notes["obj_id"], "FK -> objects")
        event_notes = {c["name"]: c["note"] for c in tables["events"]["columns"]}
        self.assertEqual(event_notes["event_id"], "PK")

    def test_other_users_cannot_read_the_schema(self):
        other = User.objects.create_user("other-cols-user", password="pw")
        self.client.force_authenticate(other)
        self.assertEqual(self._get().status_code, 404)

    def test_non_duckdb_logs_are_rejected(self):
        json_log = EventLog.objects.create(
            project=self.project, file="not-converted.json"
        )
        response = self._get(pk=json_log.pk)
        self.assertEqual(response.status_code, 400)


class OcelDbConcurrencyTests(TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="totem-duckdb-tests-")
        self.addCleanup(shutil.rmtree, self.tmpdir, ignore_errors=True)
        self.db_path = os.path.join(self.tmpdir, "log.duckdb")
        _write_minimal_duckdb_log(self.db_path)

    def test_stored_duckdb_logs_open_read_only(self):
        """The registry connection must never take the exclusive write lock.

        A read-write open is exclusive per file, so a second opener (another
        process, or a converter still holding its handle) fails with a lock
        conflict — the "error when loading many things at once" failure mode.
        Read-only connections coexist; TEMP tables (which the algorithms
        rely on) still work on them.
        """
        db = _views._build_ocel_db_from_path(self.db_path)
        self.addCleanup(db.close)

        with self.assertRaises(Exception):
            db.conn.execute("CREATE TABLE not_allowed (a INTEGER)")

        db.conn.execute("CREATE TEMP TABLE scratch AS SELECT * FROM events")
        self.assertEqual(
            db.conn.execute("SELECT COUNT(*) FROM scratch").fetchone()[0], 2
        )

        # A second concurrent open of the same file must succeed.
        other = OcelDuckDB.load(self.db_path, read_only=True)
        other.close()

    def test_every_ocel_db_carries_a_reentrant_lock(self):
        db = OcelDuckDB.load(self.db_path, read_only=True)
        self.addCleanup(db.close)

        # Reentrant: a view holding the lock can call helpers that lock again.
        with db.lock:
            with db.lock:
                held_elsewhere = []

                def probe():
                    held_elsewhere.append(db.lock.acquire(blocking=False))

                t = _threading.Thread(target=probe)
                t.start()
                t.join()
        self.assertEqual(held_elsewhere, [False])

    def test_occn_view_reads_the_shared_connection_only_under_the_lock(self):
        """The OCCN endpoint touches the shared DuckDB only to extract the
        discovery input, which must run under the per-file lock; the discovery
        itself then works on the extracted tables, off the shared connection."""
        user = User.objects.create_user(username="occn-lock-user")
        project = Project.objects.create(name="OCCN Lock Project")
        project.users.add(user)
        event_log = EventLog.objects.create(project=project, file="occn-lock.duckdb")

        client = APIClient()
        client.force_authenticate(user=user)

        fake_db = OcelDuckDB.load(self.db_path, read_only=True)
        self.addCleanup(fake_db.close)
        lock_was_held = []
        converted = object()

        def fake_convert(db):
            holder = []

            def probe():
                holder.append(db.lock.acquire(blocking=False))

            t = _threading.Thread(target=probe)
            t.start()
            t.join()
            lock_was_held.append(holder == [False])
            return converted

        discover_inputs = []

        def fake_discover(ocel, relativeOccuranceThreshold, parameters, progress=None):
            discover_inputs.append(ocel)
            return object()

        with (
            patch("api.views._ocel_db._get_or_load_ocel_db", return_value=fake_db),
            patch("api.views.occn.extract_occn_input", side_effect=fake_convert),
            patch("api.views.occn.discover_occn", side_effect=fake_discover),
            patch("api.views.occn.serialize_occn", return_value={"ok": True}),
        ):
            _views._occn_base_cache.clear()
            response = client.get("/api/occn/", {"file_id": event_log.pk})
            _views._occn_base_cache.clear()

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(lock_was_held, [True])
        # discovery ran on the extracted tables, not the shared connection
        self.assertEqual(discover_inputs, [converted])


# ---------------------------------------------------------------------------
# Global filter shadow (#232)
# ---------------------------------------------------------------------------
#
# `_filter_shadow` swaps in filtered TEMP copies of events/objects/event_object
# so the totem_lib algorithms operate on filtered data unchanged. The subtle
# part is the *direction* of the derivation: objects must be filtered by type
# first and the events derived from them. Deriving objects from events instead
# re-admits a removed type whenever one of its objects shares an event with a
# kept type — which in an OCEL is the normal case, not the corner case.


def _shadow_fixture_conn():
    """order/item/worker log where every type co-occurs with another type."""
    conn = duckdb.connect(":memory:")
    create_ocel_schema(conn, [], [])
    conn.executemany(
        "INSERT INTO events VALUES (?, ?, ?)",
        [
            ("e1", "place order", 1),   # order + item  (co-occurrence)
            ("e2", "pick item", 2),     # item only
            ("e3", "assist", 3),        # worker only
            ("e4", "complete order", 4),  # order + worker (co-occurrence)
        ],
    )
    conn.executemany(
        "INSERT INTO objects VALUES (?, ?)",
        [("o1", "order"), ("i1", "item"), ("w1", "worker")],
    )
    conn.executemany(
        "INSERT INTO event_object VALUES (?, ?, NULL)",
        [
            ("e1", "o1"), ("e1", "i1"),
            ("e2", "i1"),
            ("e3", "w1"),
            ("e4", "o1"), ("e4", "w1"),
        ],
    )
    return conn


class FilterShadowTests(SimpleTestCase):
    def setUp(self):
        self.conn = _shadow_fixture_conn()
        self.db = type("_DbShim", (), {})()
        self.db.conn = self.conn

    def tearDown(self):
        self.conn.close()

    def _types(self):
        return sorted(
            r[0] for r in self.conn.execute(
                "SELECT DISTINCT obj_type FROM objects"
            ).fetchall()
        )

    def _events(self):
        return sorted(
            r[0] for r in self.conn.execute("SELECT event_id FROM events").fetchall()
        )

    def test_removed_object_type_disappears_despite_co_occurrence(self):
        # `worker` shares e4 with the kept `order`. The old shadow kept it.
        with views._filter_shadow(self.db, {"object_types": ["order", "item"]}):
            self.assertEqual(self._types(), ["item", "order"])
            # e3 was worker-only -> no surviving relation -> event gone.
            self.assertEqual(self._events(), ["e1", "e2", "e4"])
            # ...and no relation may still point at the removed object.
            rel_objs = {
                r[0] for r in self.conn.execute(
                    "SELECT DISTINCT obj_id FROM event_object"
                ).fetchall()
            }
            self.assertEqual(rel_objs, {"o1", "i1"})

    def test_kept_type_is_not_dropped_when_it_never_co_occurs(self):
        # `worker` only ever appears with `order` (e4) or alone (e3). Keeping
        # it must not depend on any other type surviving.
        with views._filter_shadow(self.db, {"object_types": ["worker"]}):
            self.assertEqual(self._types(), ["worker"])
            self.assertEqual(self._events(), ["e3", "e4"])

    def test_activity_filter_drops_orphaned_objects(self):
        with views._filter_shadow(self.db, {"activities": ["pick item"]}):
            self.assertEqual(self._events(), ["e2"])
            self.assertEqual(self._types(), ["item"])

    def test_time_filter(self):
        with views._filter_shadow(self.db, {"after": 2, "before": 3}):
            self.assertEqual(self._events(), ["e2", "e3"])
            self.assertEqual(self._types(), ["item", "worker"])

    def test_combined_type_and_activity_filter(self):
        with views._filter_shadow(
            self.db, {"object_types": ["order"], "activities": ["place order"]}
        ):
            self.assertEqual(self._types(), ["order"])
            self.assertEqual(self._events(), ["e1"])

    def test_shadow_is_torn_down_on_exit(self):
        with views._filter_shadow(self.db, {"object_types": ["order"]}):
            self.assertEqual(self._types(), ["order"])
        self.assertEqual(self._types(), ["item", "order", "worker"])
        self.assertEqual(self._events(), ["e1", "e2", "e3", "e4"])

    def test_shadow_is_torn_down_when_body_raises(self):
        with self.assertRaises(RuntimeError):
            with views._filter_shadow(self.db, {"object_types": ["order"]}):
                raise RuntimeError("boom")
        self.assertEqual(self._types(), ["item", "order", "worker"])

    def test_empty_filter_is_a_noop(self):
        with views._filter_shadow(self.db, {}):
            self.assertEqual(self._types(), ["item", "order", "worker"])
            self.assertEqual(self._events(), ["e1", "e2", "e3", "e4"])

    def _flaky_db(self, fail_on: str, times: int = 1):
        """A db whose connection raises (like a DuckDB interrupt) the first
        ``times`` statements containing ``fail_on``."""
        conn = self.conn
        state = {"left": times}

        class _FlakyConn:
            def execute(self, sql, *args):
                if fail_on in sql and state["left"] > 0:
                    state["left"] -= 1
                    raise RuntimeError("INTERRUPT Error: Interrupted!")
                return conn.execute(sql, *args)

        db = type("_DbShim", (), {})()
        db.conn = _FlakyConn()
        return db

    def _temp_tables(self):
        return self.conn.execute(
            "SELECT table_name FROM duckdb_tables() WHERE temporary"
        ).fetchall()

    def test_shadow_is_torn_down_when_setup_is_interrupted(self):
        # `objects` is already shadowed when building `event_object` fails.
        db = self._flaky_db("TEMP TABLE event_object")
        with self.assertRaises(RuntimeError):
            with views._filter_shadow(db, {"object_types": ["order"], "after": 1}):
                pass
        self.assertEqual(self._temp_tables(), [])
        self.assertEqual(self._types(), ["item", "order", "worker"])
        self.assertEqual(self._events(), ["e1", "e2", "e3", "e4"])

    def test_teardown_retries_an_interrupted_drop(self):
        db = self._flaky_db("DROP TABLE IF EXISTS temp.main.events")
        with views._filter_shadow(db, {"object_types": ["order"]}):
            self.assertEqual(self._types(), ["order"])
        self.assertEqual(self._temp_tables(), [])
        self.assertEqual(self._events(), ["e1", "e2", "e3", "e4"])


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class FilteredEndpointRegressionTests(APITestCase):
    """End-to-end checks that the global filter reaches the algorithms.

    The `variants` view in particular used to reference `cache_params` after
    the cache-lookup block that defined it had been removed, so every
    successful computation died with `NameError` on the way out (HTTP 500).
    """

    def setUp(self):
        cache.clear()
        views._OCEL_DB_REGISTRY.clear()
        views._OCEL_OBJECT_TYPES_REGISTRY.clear()

        self.user = User.objects.create_user("tester", password="pw")
        self.project = Project.objects.create(name="test-project")
        self.project.users.add(self.user)

        filename = f"paper-example-{self._testMethodName}.duckdb"
        _write_paper_example_duckdb(f"{_MEDIA_ROOT}/{filename}")
        self.log = EventLog.objects.create(project=self.project, file=filename)
        self.client.force_authenticate(self.user)

    def test_variants_unfiltered_returns_200(self):
        response = self.client.get("/api/variants/", {"file_id": self.log.pk})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("variants", response.json())

    def test_variants_with_object_type_filter_returns_200(self):
        response = self.client.get(
            "/api/variants/", {"file_id": self.log.pk, "object_types": "order"}
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["object_types"], ["order"])

    def test_variants_filtered_and_unfiltered_do_not_share_a_cache_entry(self):
        unfiltered = self.client.get("/api/variants/", {"file_id": self.log.pk})
        filtered = self.client.get(
            "/api/variants/", {"file_id": self.log.pk, "object_types": "order"}
        )
        self.assertEqual(unfiltered.status_code, 200)
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(unfiltered.json()["object_types"], ["item", "order"])
        self.assertEqual(filtered.json()["object_types"], ["order"])

    def test_variants_leading_type_filtered_out_falls_back(self):
        # Client still asks for the type it had selected before the filter
        # removed it; the view must fall back to a surviving type, not 500.
        response = self.client.get(
            "/api/variants/",
            {"file_id": self.log.pk, "object_types": "order", "leading_type": "item"},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["object_types"], ["order"])

    def test_mlpa_respects_object_type_filter(self):
        response = self.client.get(
            f"/api/files/{self.log.pk}/discover_mlpa/", {"object_types": "order"}
        )
        self.assertEqual(response.status_code, 200, response.data)
        seen = {
            t
            for layer in response.json()["layers"]
            for area in layer["areas"]
            for t in area["objectTypes"]
        }
        self.assertNotIn("item", seen)

    def test_process_areas_respects_object_type_filter(self):
        response = self.client.get(
            f"/api/files/{self.log.pk}/discover_process_areas/",
            {"object_types": "order"},
        )
        self.assertEqual(response.status_code, 200, response.data)
        seen = {
            t
            for layer in response.json()["layers"]
            for area in layer["areas"]
            for t in area["objectTypes"]
        }
        self.assertNotIn("item", seen)


    def test_mlpa_respects_activity_filter(self):
        response = self.client.get(
            f"/api/files/{self.log.pk}/discover_mlpa/", {"activities": "place order"}
        )
        self.assertEqual(response.status_code, 200, response.data)
        body = response.json()
        self.assertEqual(body["all_event_types"], ["place order"])
        for events in body["object_type_to_event_types"].values():
            self.assertEqual(events, ["place order"])

    def test_process_areas_respects_activity_filter(self):
        response = self.client.get(
            f"/api/files/{self.log.pk}/discover_process_areas/",
            {"activities": "place order"},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["all_event_types"], ["place order"])

    def test_process_areas_respects_time_filter(self):
        # Only e1 ("place order") falls inside [1, 1].
        response = self.client.get(
            f"/api/files/{self.log.pk}/discover_process_areas/",
            {"after": 1, "before": 1},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["all_event_types"], ["place order"])

    def test_new_ocdfg_drilldown_respects_activity_filter(self):
        """The TOTeM process-area drill-down calls /api/new-ocdfg/ with its
        own object_types selection alongside the global filter."""
        response = self.client.get(
            "/api/new-ocdfg/",
            {
                "file_id": self.log.pk,
                "object_types": "order,item",
                "activities": "place order",
            },
        )
        self.assertEqual(response.status_code, 200, response.data)
        labels = {
            n.get("label") or n.get("id")
            for n in response.json()["dfg"]["nodes"]
            if not (n.get("role") or "").strip()
        }
        self.assertEqual(labels, {"place order"})

    def test_new_ocdfg_drilldown_respects_time_filter(self):
        response = self.client.get(
            "/api/new-ocdfg/",
            {"file_id": self.log.pk, "object_types": "order,item", "after": 1, "before": 1},
        )
        self.assertEqual(response.status_code, 200, response.data)
        labels = {
            n.get("label") or n.get("id")
            for n in response.json()["dfg"]["nodes"]
            if not (n.get("role") or "").strip()
        }
        self.assertEqual(labels, {"place order"})

    def test_new_ocdfg_filtered_and_unfiltered_differ(self):
        # /api/new-ocdfg/ isn't cached (unlike /api/variants/ etc.), so this
        # only checks that the activity filter actually reaches the graph.
        unfiltered = self.client.get(
            "/api/new-ocdfg/", {"file_id": self.log.pk, "object_types": "order,item"}
        )
        filtered = self.client.get(
            "/api/new-ocdfg/",
            {
                "file_id": self.log.pk,
                "object_types": "order,item",
                "activities": "place order",
            },
        )
        self.assertEqual(unfiltered.status_code, 200)
        self.assertEqual(filtered.status_code, 200)
        self.assertNotEqual(
            len(unfiltered.json()["dfg"]["nodes"]),
            len(filtered.json()["dfg"]["nodes"]),
        )

    def test_new_ocdfg_global_object_type_filter_intersects_area_selection(self):
        # Area asks for order+item; the global filter allows only order.
        response = self.client.get(
            "/api/new-ocdfg/",
            {
                "file_id": self.log.pk,
                "object_types": "order,item",
            },
        )
        self.assertEqual(response.status_code, 200)


# ---------------------------------------------------------------------------
# Save-discovered-model endpoint tests
# ---------------------------------------------------------------------------


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class SaveDiscoveredModelApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        views._OCEL_DB_REGISTRY.clear()
        views._OCEL_OBJECT_TYPES_REGISTRY.clear()
        views._occn_base_cache.clear()

        self.user = User.objects.create_user("tester", password="pw")
        self.project = Project.objects.create(name="test-project")
        self.project.users.add(self.user)

        filename = f"paper-example-save-model-{self._testMethodName}.duckdb"
        _write_paper_example_duckdb(f"{_MEDIA_ROOT}/{filename}")
        self.log = EventLog.objects.create(project=self.project, file=filename)

        self.client.force_authenticate(self.user)

    def _save(self, model_type, name, params=None, query=""):
        return self.client.post(
            f"/api/files/{self.log.pk}/save_discovered_model/{query}",
            {"name": name, "model_type": model_type, "params": params or {}},
            format="json",
        )

    # The paper example: order o1 with items i1/i2; "pick item" is item-only.
    ORDER_ONLY_QUERY = "?object_types=order&activities=place%20order,complete%20order"

    def test_saved_totem_respects_the_global_filter(self):
        response = self._save("TOTEM", "Filtered TOTeM", {"tau": 0.0}, self.ORDER_ONLY_QUERY)
        self.assertEqual(response.status_code, 201, response.data)
        asset = ProjectAsset.objects.get(project=self.project, name="Filtered TOTeM")
        self.assertEqual(asset.content_json["tempgraph"]["nodes"], ["order"])
        self.assertEqual(
            asset.metadata["global_filter"],
            {"object_types": ["order"], "activities": ["place order", "complete order"]},
        )

        unfiltered = self._save("TOTEM", "Full TOTeM", {"tau": 0.0})
        self.assertEqual(unfiltered.status_code, 201, unfiltered.data)
        full = ProjectAsset.objects.get(project=self.project, name="Full TOTeM")
        self.assertEqual(full.content_json["tempgraph"]["nodes"], ["item", "order"])
        self.assertNotIn("global_filter", full.metadata)

    def test_saved_occn_respects_the_global_filter(self):
        response = self._save("OCCN", "Filtered OCCN", {}, self.ORDER_ONLY_QUERY)
        self.assertEqual(response.status_code, 201, response.data)
        content = ProjectAsset.objects.get(project=self.project, name="Filtered OCCN").content_json
        self.assertEqual(content["object_types"], ["order"])
        self.assertNotIn("pick item", content["activities"])
        self.assertNotIn("START_item", content["activities"])

        # ... and matches what the OCCN component displays under that filter.
        shown = self.client.get(
            "/api/occn/",
            {"file_id": self.log.pk, "object_types": "order", "activities": "place order,complete order"},
        )
        self.assertEqual(shown.status_code, 200, shown.data)
        shown_activities = {a["id"] for a in shown.json()["activities"]}
        self.assertEqual(set(content["activities"]), shown_activities)

    def test_saved_ocpn_respects_the_global_filter(self):
        response = self._save("OCPN", "Filtered OCPN", {"timeout_s": 30}, self.ORDER_ONLY_QUERY)
        self.assertEqual(response.status_code, 201, response.data)
        content = ProjectAsset.objects.get(project=self.project, name="Filtered OCPN").content_json
        self.assertEqual([ot["name"] for ot in content["objectTypes"]], ["order"])
        labels = sorted(t["label"] for t in content["transitions"] if not t.get("silent"))
        self.assertEqual(labels, ["complete order", "place order"])

        # A filtered save must not be served from the unfiltered cache entry.
        unfiltered = self._save("OCPN", "Full OCPN", {"timeout_s": 30})
        self.assertEqual(unfiltered.status_code, 201, unfiltered.data)
        full = ProjectAsset.objects.get(project=self.project, name="Full OCPN").content_json
        self.assertEqual([ot["name"] for ot in full["objectTypes"]], ["item", "order"])

    def test_saved_ocdfg_respects_the_global_filter(self):
        response = self._save("OCDFG", "Filtered OC-DFG", {}, self.ORDER_ONLY_QUERY)
        self.assertEqual(response.status_code, 201, response.data)
        content = ProjectAsset.objects.get(project=self.project, name="Filtered OC-DFG").content_json
        self.assertEqual(content["object_types"], ["order"])
        self.assertEqual(content["activities"], ["complete order", "place order"])

    def test_component_object_types_are_narrowed_by_the_global_filter(self):
        # The component's own selection is intersected with the global filter.
        response = self._save(
            "OCDFG", "Narrowed", {"object_types": ["item", "order"]}, "?object_types=order"
        )
        self.assertEqual(response.status_code, 201, response.data)
        content = ProjectAsset.objects.get(project=self.project, name="Narrowed").content_json
        self.assertEqual(content["object_types"], ["order"])

        # A stale selection outside the filter falls back to the filter itself.
        response = self._save(
            "OCDFG", "Stale selection", {"object_types": ["item"]}, "?object_types=order"
        )
        self.assertEqual(response.status_code, 201, response.data)
        content = ProjectAsset.objects.get(project=self.project, name="Stale selection").content_json
        self.assertEqual(content["object_types"], ["order"])

    def test_save_totem_creates_asset(self):
        response = self._save("TOTEM", "Discovered TOTeM", {"tau": 0.8})
        self.assertEqual(response.status_code, 201, response.data)
        asset = ProjectAsset.objects.get(project=self.project, name="Discovered TOTeM")
        self.assertEqual(asset.asset_type, "TOTEM")
        self.assertEqual(asset.content_json["schema"], "totem")
        self.assertEqual(asset.metadata["source"], "discovery")
        self.assertEqual(asset.metadata["event_log_id"], self.log.pk)

    def test_save_occn_creates_asset(self):
        response = self._save(
            "OCCN", "Discovered OCCN", {"relative_occurrence_threshold": 0.0}
        )
        self.assertEqual(response.status_code, 201, response.data)
        asset = ProjectAsset.objects.get(project=self.project, name="Discovered OCCN")
        self.assertEqual(asset.asset_type, "OCCN")
        self.assertEqual(asset.content_json["schema"], "occn")
        self.assertIn("START_order", asset.content_json["activities"])

    def test_save_ocpn_creates_asset(self):
        response = self._save("OCPN", "Discovered OCPN", {"timeout_s": 30})
        self.assertEqual(response.status_code, 201, response.data)
        asset = ProjectAsset.objects.get(project=self.project, name="Discovered OCPN")
        self.assertEqual(asset.asset_type, "OCPN")
        self.assertEqual(asset.content_json["format"], "ocpn")
        self.assertTrue(asset.content_json["places"])

    def test_save_ocdfg_creates_asset(self):
        response = self._save("OCDFG", "Discovered OC-DFG")
        self.assertEqual(response.status_code, 201, response.data)
        asset = ProjectAsset.objects.get(project=self.project, name="Discovered OC-DFG")
        self.assertEqual(asset.asset_type, "OCDFG")
        content = asset.content_json
        self.assertEqual(content["schema"], "ocdfg")
        self.assertEqual(
            content["activities"], ["complete order", "pick item", "place order"]
        )
        self.assertEqual(content["object_types"], ["item", "order"])
        sources = {edge["source"] for edge in content["edges"]}
        self.assertIn("__start__:order", sources)

    def test_duplicate_name_rejected(self):
        first = self._save("OCPN", "Same name")
        self.assertEqual(first.status_code, 201, first.data)
        second = self._save("OCPN", "Same name")
        self.assertEqual(second.status_code, 400)
        self.assertIn("name", second.data)

    def test_unknown_model_type_rejected(self):
        response = self._save("NOPE", "Whatever")
        self.assertEqual(response.status_code, 400)

    def test_requires_project_membership(self):
        outsider = User.objects.create_user("outsider", password="pw")
        self.client.force_authenticate(outsider)
        response = self._save("OCPN", "Sneaky")
        self.assertEqual(response.status_code, 404)

    # -- global filter -----------------------------------------------------
    #
    # The frontend appends the active global filter as query params to the
    # save request (same mechanism as the discovery read endpoints); the
    # stored model must be mined from the filtered log.

    def test_totem_save_respects_global_object_type_filter(self):
        response = self._save(
            "TOTEM", "Filtered TOTeM", {"tau": 0.0}, query="?object_types=order"
        )
        self.assertEqual(response.status_code, 201, response.data)
        asset = ProjectAsset.objects.get(project=self.project, name="Filtered TOTeM")
        self.assertEqual(asset.content_json["tempgraph"]["nodes"], ["order"])
        self.assertEqual(asset.metadata["global_filter"], {"object_types": ["order"]})

    def test_ocpn_save_respects_global_object_type_filter(self):
        response = self._save("OCPN", "Filtered OCPN", query="?object_types=order")
        self.assertEqual(response.status_code, 201, response.data)
        asset = ProjectAsset.objects.get(project=self.project, name="Filtered OCPN")
        self.assertEqual(
            [ot["name"] for ot in asset.content_json["objectTypes"]], ["order"]
        )
        labels = sorted(
            t["label"] for t in asset.content_json["transitions"] if not t.get("silent")
        )
        self.assertEqual(labels, ["complete order", "place order"])

    def test_ocpn_filtered_save_does_not_reuse_unfiltered_cache(self):
        # Prime the unfiltered discovery cache, then save with a filter: the
        # stored model must be the filtered one, not the cached full net.
        unfiltered = self.client.get(f"/api/files/{self.log.pk}/discover_ocpn/")
        self.assertEqual(unfiltered.status_code, 200)
        response = self._save("OCPN", "Filtered OCPN 2", query="?object_types=order")
        self.assertEqual(response.status_code, 201, response.data)
        asset = ProjectAsset.objects.get(project=self.project, name="Filtered OCPN 2")
        self.assertEqual(
            [ot["name"] for ot in asset.content_json["objectTypes"]], ["order"]
        )

    def test_ocdfg_save_respects_global_activity_filter(self):
        response = self._save(
            "OCDFG", "Filtered OC-DFG", query="?activities=place%20order"
        )
        self.assertEqual(response.status_code, 201, response.data)
        asset = ProjectAsset.objects.get(project=self.project, name="Filtered OC-DFG")
        self.assertEqual(asset.content_json["activities"], ["place order"])

    def test_occn_save_respects_global_activity_filter(self):
        response = self._save(
            "OCCN",
            "Filtered OCCN",
            {"relative_occurrence_threshold": 0.0},
            query="?activities=place%20order,pick%20item",
        )
        self.assertEqual(response.status_code, 201, response.data)
        asset = ProjectAsset.objects.get(project=self.project, name="Filtered OCCN")
        activities = asset.content_json["activities"]
        self.assertIn("place order", activities)
        self.assertNotIn("complete order", activities)


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class FilteredCacheKeyTests(APITestCase):
    """Filtered and unfiltered requests must never share a cache entry."""

    def setUp(self):
        cache.clear()
        RESULTS_CACHE.clear()
        views._OCEL_DB_REGISTRY.clear()
        views._OCEL_OBJECT_TYPES_REGISTRY.clear()

        self.user = User.objects.create_user("tester", password="pw")
        self.project = Project.objects.create(name="test-project")
        self.project.users.add(self.user)

        filename = f"paper-example-filter-cache-{self._testMethodName}.duckdb"
        _write_paper_example_duckdb(f"{_MEDIA_ROOT}/{filename}")
        self.log = EventLog.objects.create(project=self.project, file=filename)

        self.client.force_authenticate(self.user)

    def test_statistics_cache_is_filter_aware(self):
        full = self.client.get(f"/api/files/{self.log.pk}/statistics/")
        self.assertEqual(full.status_code, 200)
        self.assertEqual(full.data["num_object_types"], 2)

        filtered = self.client.get(
            f"/api/files/{self.log.pk}/statistics/", {"object_types": "order"}
        )
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(filtered.data["num_object_types"], 1)

        # The unfiltered entry must be untouched by the filtered request.
        full_again = self.client.get(f"/api/files/{self.log.pk}/statistics/")
        self.assertEqual(full_again.data["num_object_types"], 2)

    def test_noe_cache_is_filter_aware(self):
        full = self.client.get(f"/api/files/{self.log.pk}/NoE/")
        self.assertEqual(full.status_code, 200)
        self.assertEqual(full.data, 4)

        filtered = self.client.get(
            f"/api/files/{self.log.pk}/NoE/", {"activities": "pick item"}
        )
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(filtered.data, 2)

        full_again = self.client.get(f"/api/files/{self.log.pk}/NoE/")
        self.assertEqual(full_again.data, 4)


# ---------------------------------------------------------------------------
# Image asset endpoint tests
# ---------------------------------------------------------------------------

from .models import ImageAsset


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class ImageAssetApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("tester", password="pw")
        self.project = Project.objects.create(name="test-project")
        self.project.users.add(self.user)
        self.client.force_authenticate(self.user)

    def _upload(self, name="Logo", filename="logo.png", content_type="image/png"):
        return self.client.post(
            "/api/image-assets/",
            {
                "project": self.project.pk,
                "name": name,
                "image": SimpleUploadedFile(
                    filename, b"fake-image-bytes", content_type=content_type
                ),
            },
            format="multipart",
        )

    def test_upload_list_rename_delete_roundtrip(self):
        response = self._upload()
        self.assertEqual(response.status_code, 201, response.data)
        asset_id = response.data["id"]
        self.assertTrue(response.data["url"].startswith("/files/"))
        self.assertEqual(response.data["content_type"], "image/png")

        listed = self.client.get(f"/api/image-assets/?project={self.project.pk}")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([a["id"] for a in listed.data], [asset_id])

        renamed = self.client.patch(
            f"/api/image-assets/{asset_id}/", {"name": "Renamed"}, format="json"
        )
        self.assertEqual(renamed.status_code, 200, renamed.data)
        self.assertEqual(renamed.data["name"], "Renamed")

        stored_path = ImageAsset.objects.get(pk=asset_id).image.path
        self.assertTrue(os.path.exists(stored_path))
        deleted = self.client.delete(f"/api/image-assets/{asset_id}/")
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(ImageAsset.objects.filter(pk=asset_id).exists())
        self.assertFalse(os.path.exists(stored_path))

    def test_duplicate_name_rejected(self):
        self.assertEqual(self._upload().status_code, 201)
        response = self._upload(filename="other.png")
        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.data)

    def test_unsupported_extension_rejected(self):
        response = self._upload(filename="anim.gif", content_type="image/gif")
        self.assertEqual(response.status_code, 400)
        self.assertIn("image", response.data)

    def test_svg_accepted(self):
        response = self._upload(filename="icon.svg", content_type="image/svg+xml")
        self.assertEqual(response.status_code, 201, response.data)

    def test_requires_project_membership(self):
        outsider = User.objects.create_user("outsider", password="pw")
        self.client.force_authenticate(outsider)
        response = self._upload()
        self.assertEqual(response.status_code, 400)
        self.assertIn("project", response.data)

    def test_list_scoped_to_own_projects(self):
        self.assertEqual(self._upload().status_code, 201)
        outsider = User.objects.create_user("outsider", password="pw")
        self.client.force_authenticate(outsider)
        listed = self.client.get("/api/image-assets/")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.data, [])


# ---------------------------------------------------------------------------
# Release hardening: legacy image upload validation, timeout clamping and the
# shared cache-clear endpoint.
# ---------------------------------------------------------------------------

import os as _os
import tempfile as _tempfile

from django.core.files.uploadedfile import SimpleUploadedFile as _SimpleUploadedFile
from django.test import override_settings as _override_settings

from .models import Dashboard as _Dashboard, ImageComponent as _ImageComponent

_LEGACY_IMAGE_MEDIA_ROOT = _tempfile.mkdtemp(prefix="totem-test-legacy-image-")

_PNG_1x1 = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\x0f"
    b"\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)


@_override_settings(MEDIA_ROOT=_LEGACY_IMAGE_MEDIA_ROOT)
class LegacyImageComponentUploadTests(TestCase):
    """The legacy per-component image upload must apply the same type/size
    rules as the asset store, and ``save_layout`` must not accept arbitrary
    ``image`` paths."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="img-owner")
        self.project = Project.objects.create(name="ImgProject")
        self.project.users.add(self.user)
        self.other_project = Project.objects.create(name="OtherProject")
        self.dashboard = _Dashboard.objects.create(
            project=self.project, name="D", order_in_project=0
        )
        self.component = _ImageComponent.objects.create(
            dashboard=self.dashboard,
            x=0, y=0, w=2, h=2,
            component_name="ImageComponent",
        )
        self.client.force_authenticate(user=self.user)

    def _upload(self, filename, content, content_type):
        return self.client.post(
            f"/api/dashboard/{self.dashboard.pk}/components/{self.component.pk}/image/",
            {"image": _SimpleUploadedFile(filename, content, content_type=content_type)},
            format="multipart",
        )

    def test_png_upload_is_accepted(self):
        response = self._upload("pic.png", _PNG_1x1, "image/png")
        self.assertEqual(response.status_code, 200, response.data)
        self.component.refresh_from_db()
        self.assertTrue(self.component.image.name.endswith(".png"))

    def test_non_image_type_is_rejected(self):
        response = self._upload("evil.exe", b"MZ\x90\x00", "application/octet-stream")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Unsupported image type", response.data["error"])
        self.component.refresh_from_db()
        self.assertFalse(self.component.image)

    def test_oversized_image_is_rejected(self):
        big = _PNG_1x1 + b"\x00" * (10 * 1024 * 1024 + 1)
        response = self._upload("huge.png", big, "image/png")
        self.assertEqual(response.status_code, 400)
        self.assertIn("10 MB", response.data["error"])

    def _save_layout(self, image):
        return self.client.post(
            f"/api/dashboard/{self.dashboard.pk}/save_layout/",
            {"layout": [{
                "x": 0, "y": 0, "w": 2, "h": 2,
                "component_name": "ImageComponent",
                "image": image,
            }]},
            format="json",
        )

    def _component(self):
        return _ImageComponent.objects.get(dashboard=self.dashboard)

    def test_save_layout_keeps_existing_project_upload(self):
        project_dir = _os.path.join(_LEGACY_IMAGE_MEDIA_ROOT, self.project.name)
        _os.makedirs(project_dir, exist_ok=True)
        with open(_os.path.join(project_dir, "existing.png"), "wb") as fh:
            fh.write(_PNG_1x1)

        response = self._save_layout(f"/files/{self.project.name}/existing.png")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self._component().image.name, f"{self.project.name}/existing.png")

    def test_save_layout_drops_missing_and_foreign_paths(self):
        other_dir = _os.path.join(_LEGACY_IMAGE_MEDIA_ROOT, self.other_project.name)
        _os.makedirs(other_dir, exist_ok=True)
        with open(_os.path.join(other_dir, "theirs.png"), "wb") as fh:
            fh.write(_PNG_1x1)

        for bad in (
            f"/files/{self.project.name}/does-not-exist.png",
            f"/files/{self.other_project.name}/theirs.png",
            "/files/../../etc/passwd",
            "/etc/passwd",
            "../../secret.png",
        ):
            response = self._save_layout(bad)
            self.assertEqual(response.status_code, 200, (bad, response.data))
            self.assertFalse(self._component().image, bad)


class TimeoutClampTests(TestCase):
    """``timeout_s`` is clamped server-side to [1, 300]; <= 0 no longer
    disables the watchdog."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="timeout-user")
        self.project = Project.objects.create(name="TimeoutProject")
        self.project.users.add(self.user)
        self.client.force_authenticate(user=self.user)

    def _log(self):
        media = _tempfile.mkdtemp(prefix="totem-test-timeout-")
        filename = f"paper-example-{self._testMethodName}.duckdb"
        _write_paper_example_duckdb(_os.path.join(media, filename))
        return media, EventLog.objects.create(project=self.project, file=filename)

    def _timeouts_seen(self, target, url, query):
        """Patch the discovery function so it raises TimeoutError; the view
        then reports the (clamped) ``timeout_s`` it used in its 408 body."""
        def fake(*args, **kwargs):
            raise TimeoutError("test timeout")

        with patch(target, side_effect=fake):
            response = self.client.get(url, query)
        self.assertEqual(response.status_code, 408, response.content)
        return response.json()["timeout_s"]

    def test_discover_ocpn_clamps_timeout(self):
        media, log = self._log()
        with _override_settings(MEDIA_ROOT=media):
            views._OCEL_DB_REGISTRY.clear()
            for raw, expected in (("0", 1.0), ("-5", 1.0), ("0.2", 1.0),
                                  ("30", 30.0), ("100000", 300.0)):
                seen = self._timeouts_seen(
                    "api.views.event_log.discover_ocpn_db",
                    f"/api/files/{log.pk}/discover_ocpn/",
                    {"timeout_s": raw},
                )
                self.assertEqual(seen, expected, raw)

    def test_variants_clamps_timeout(self):
        media, log = self._log()
        with _override_settings(MEDIA_ROOT=media):
            views._OCEL_DB_REGISTRY.clear()
            cache.clear()
            for raw, expected in (("0", 1.0), ("-1", 1.0), ("10", 10.0), ("999", 300.0)):
                seen = self._timeouts_seen(
                    "api.views.variants.find_variants",
                    "/api/variants/",
                    {"file_id": log.pk, "timeout_s": raw, "leading_type": "order"},
                )
                self.assertEqual(seen, expected, raw)


class CacheClearPermissionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="cache-user")
        self.staff = User.objects.create_user(username="cache-staff", is_staff=True)

    def test_anonymous_is_rejected(self):
        self.assertEqual(self.client.post("/api/cache/clear/").status_code, 401)

    @_override_settings(LOCAL_MODE=False)
    def test_regular_user_cannot_clear_shared_cache(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post("/api/cache/clear/")
        self.assertEqual(response.status_code, 403)

    @_override_settings(LOCAL_MODE=False)
    def test_staff_can_clear(self):
        self.client.force_authenticate(user=self.staff)
        with patch("api.cache_utils.clear_all_cache") as clear:
            response = self.client.post("/api/cache/clear/")
        self.assertEqual(response.status_code, 200)
        clear.assert_called_once()

    @_override_settings(LOCAL_MODE=True)
    def test_local_mode_lets_the_single_user_clear(self):
        self.client.force_authenticate(user=self.user)
        with patch("api.cache_utils.clear_all_cache") as clear:
            response = self.client.post("/api/cache/clear/")
        self.assertEqual(response.status_code, 200)
        clear.assert_called_once()
