import copy
import json
from contextlib import nullcontext
from unittest.mock import patch

import polars as pl
from django.contrib.auth import get_user_model
from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError
from django.test import TestCase
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

from .models import EventLog, Project, ProjectAsset
from .serializers import ProjectAssetSerializer
from .views import EventLogViewSet


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
                "START_Order": {
                    "omg": [[("Create Order", "Order", (1, 1), 1)]]
                },
                "Create Order": {
                    "img": [[("START_Order", "Order", (1, 1), 1)]],
                    "omg": [[("END_Order", "Order", (1, 1), 1)]],
                },
                "END_Order": {
                    "img": [[("Create Order", "Order", (1, 1), 1)]]
                },
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
                "api.views._get_ocel_object_types",
                return_value=["Item", "Order"],
            ) as get_types,
            patch("api.views._with_ocel_db") as algorithm_lock,
        ):
            response = self.client.get(self.url)

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
                "api.views._with_ocel_db",
                return_value=nullcontext(db),
            ) as load_ocel,
            patch("api.views.conformance_of_totem") as conformance,
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
                    patch("api.views._with_ocel_db") as load_ocel,
                    patch("api.views.conformance_of_totem") as conformance,
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
                "api.views._with_ocel_db",
                side_effect=RuntimeError("OCEL unavailable"),
            ) as load_ocel,
            patch("api.views.conformance_of_totem") as conformance,
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
                "api.views._with_ocel_db",
                return_value=nullcontext(db),
            ),
            patch(
                "api.views.conformance_of_totem",
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
                "api.views._with_ocel_db",
                return_value=nullcontext(object()),
            ),
            patch("api.views.conformance_of_totem") as conformance,
            patch("api.views.totemDiscovery_db") as discovery,
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
        for max_states in (99, 50_001, "not-a-number"):
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
            patch("api.views._with_ocel_db") as load_ocel,
            patch("api.views.extract_occn_replay_units") as extract,
            patch("api.views.occn_replay_fitness") as fitness,
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
                "api.views._with_ocel_db",
                return_value=nullcontext(db),
            ),
            patch("api.views._object_types", return_value=["Item", "Order"]),
            patch("api.views.extract_occn_replay_units") as extract,
            patch("api.views.occn_replay_fitness") as fitness,
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
                    patch("api.views._with_ocel_db") as load_ocel,
                    patch("api.views.extract_occn_replay_units") as extract,
                    patch("api.views.occn_replay_fitness") as fitness,
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
                "api.views._with_ocel_db",
                side_effect=RuntimeError("OCEL unavailable"),
            ) as load_ocel,
            patch("api.views.extract_occn_replay_units") as extract,
            patch("api.views.occn_replay_fitness") as fitness,
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
                "api.views._with_ocel_db",
                return_value=nullcontext(db),
            ),
            patch(
                "api.views.extract_occn_replay_units",
                side_effect=RuntimeError("Extraction failed"),
            ) as extract,
            patch("api.views.occn_replay_fitness") as fitness,
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
        )
        fitness.assert_not_called()

    def test_replay_failure_returns_server_error(self):
        db = object()
        replay_units = (object(),)
        with (
            patch(
                "api.views._with_ocel_db",
                return_value=nullcontext(db),
            ),
            patch(
                "api.views.extract_occn_replay_units",
                return_value=replay_units,
            ),
            patch(
                "api.views.occn_replay_fitness",
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
                "api.views._with_ocel_db",
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
                "api.views._with_ocel_db",
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
                ),
                OCCNReplayUnitResult(
                    unit_id="connected_components:000003",
                    status=OCCNReplayStatus.INCONCLUSIVE,
                    event_count=8,
                    explored_state_count=1000,
                    object_types=("Delivery", "Order"),
                    limit_reason="max_states",
                ),
            )
        )
        db = object()
        with (
            patch(
                "api.views._with_ocel_db",
                return_value=nullcontext(db),
            ) as load_ocel,
            patch(
                "api.views.extract_occn_replay_units",
                return_value=replay_units,
            ) as extract,
            patch(
                "api.views.occn_replay_fitness",
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
        )
        fitness.assert_called_once()
        deserialized_occn, called_units = fitness.call_args.args
        self.assertIsInstance(deserialized_occn, OCCausalNet)
        self.assertIs(called_units, replay_units)
        self.assertEqual(fitness.call_args.kwargs, {"max_states": 5_000})
        self.assertEqual(response.data["fitness"], 0.5)
        self.assertAlmostEqual(response.data["coverage"], 2 / 3)
        self.assertEqual(response.data["inconclusive_units"], 1)

    def test_empty_replay_result_preserves_complete_aggregate_contract(self):
        result = OCCNReplayFitnessResult(unit_results=())
        with (
            patch(
                "api.views._with_ocel_db",
                return_value=nullcontext(object()),
            ),
            patch(
                "api.views.extract_occn_replay_units",
                return_value=(),
            ),
            patch(
                "api.views.occn_replay_fitness",
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
        self.url = (
            f"/api/files/{self.event_log.pk}/occn_replay_unit_detail/"
        )
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
        return EventLogViewSet.as_view(
            {"get": "occn_replay_unit_detail"}
        )(request, pk=self.event_log.pk)

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

        with patch("api.views._with_ocel_db") as load_ocel:
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
            with self.subTest(label=label), patch(
                "api.views._with_ocel_db"
            ) as load_ocel:
                response = self.client.get(self.url, query)

            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            load_ocel.assert_not_called()

    def test_unknown_replay_unit_returns_not_found(self):
        with (
            patch(
                "api.views._with_ocel_db",
                return_value=nullcontext(object()),
            ),
            patch(
                "api.views.extract_occn_replay_units",
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
                "api.views._with_ocel_db",
                return_value=nullcontext(db),
            ),
            patch("api.views._object_types", return_value=["Order"]),
            patch(
                "api.views.extract_occn_replay_units",
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
        )

    def test_extraction_failure_returns_server_error(self):
        with patch(
            "api.views._with_ocel_db",
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
                "api.views._with_ocel_db",
                return_value=nullcontext(object()),
            ),
            patch(
                "api.views.extract_occn_replay_units",
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
                "api.views._with_ocel_db",
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
