"""
Stored process executions (``views_process_executions``), the resource-aware
variants endpoint and OCCN conformance on a stored execution column.

All tests run on the tiny orders log from ``totem_lib/test_data/small`` (see
``totem_lib/examples/generate_resource_aware_logs.py``): four orders, one
worker touching everything, ``o3``/``o4`` sharing a package.
"""

import os
import tempfile
from pathlib import Path

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APITestCase
from totem_lib import STORED_COLUMN_REPLAY_STRATEGY, discover_occn
from totem_lib.ocel import OcelDuckDB, import_ocel_db

from . import views
from .models import EventLog, Project, ProjectAsset

_MEDIA_ROOT = tempfile.mkdtemp(prefix="totem-test-media-executions-")
EXAMPLE_LOGS = Path(__file__).resolve().parents[2] / "totem_lib" / "test_data" / "small"
CLEAN_LOG = "resource_aware_orders.json"
DEVIATING_LOG = "resource_aware_orders_deviating.json"

BUSINESS_TYPES = ["order", "item", "package"]
BUSINESS_ACTIVITIES = ["place order", "pick item", "pack items", "ship package", "close order"]


def _import_example(name: str, path: str) -> None:
    db = import_ocel_db(str(EXAMPLE_LOGS / name), db_path=path)
    db.close()


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class StoredProcessExecutionTests(APITestCase):
    def setUp(self):
        cache.clear()
        views._OCEL_DB_REGISTRY.clear()
        views._OCEL_OBJECT_TYPES_REGISTRY.clear()

        self.user = User.objects.create_user("tester", password="pw")
        self.project = Project.objects.create(name="orders-project")
        self.project.users.add(self.user)

        self.filename = f"orders-{self._testMethodName}.duckdb"
        _import_example(CLEAN_LOG, f"{_MEDIA_ROOT}/{self.filename}")
        self.log = EventLog.objects.create(project=self.project, file=self.filename)
        self.client.force_authenticate(self.user)

    def _store(self, **overrides):
        body = {
            "extraction": "resource_aware",
            "business_object_types": BUSINESS_TYPES,
            "business_activities": BUSINESS_ACTIVITIES,
            "execution_column": "process execution",
            "compute_variants": True,
            "variant_column": "variant",
        }
        body.update(overrides)
        query = overrides.pop("_query", "") if "_query" in overrides else ""
        return self.client.post(
            f"/api/files/{self.log.pk}/process_executions/{query}", body, format="json"
        )

    def _column_values(self, column: str) -> dict:
        db = OcelDuckDB.load(f"{_MEDIA_ROOT}/{self.filename}", read_only=True)
        try:
            rows = db.conn.execute(
                f'SELECT event_id, "{column}" FROM events ORDER BY event_id'
            ).fetchall()
        finally:
            db.close()
        return dict(rows)

    # --- /api/variants/ -----------------------------------------------------

    def test_resource_aware_variants_endpoint(self):
        response = self.client.get(
            "/api/variants/",
            {
                "file_id": self.log.pk,
                "extraction": "resource_aware",
                "business_object_types": BUSINESS_TYPES,
                "business_activities": BUSINESS_ACTIVITIES,
            },
        )
        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual([v["support"] for v in payload["variants"]], [2, 1])
        self.assertEqual(sorted(payload["variants"][0]["case_ids"]), ["i1", "i3"])
        self.assertEqual(payload["extraction"], "resource_aware")
        self.assertEqual(sorted(payload["business_object_types"]), sorted(BUSINESS_TYPES))
        self.assertEqual(payload["leading_type"], None)
        # The worker never becomes a lane of a resource-aware variant.
        lane_types = {o["type"] for v in payload["variants"] for o in v["graph"]["objects"]}
        self.assertNotIn("worker", lane_types)

    def test_connected_extraction_sees_one_execution_because_of_the_worker(self):
        response = self.client.get(
            "/api/variants/", {"file_id": self.log.pk, "extraction": "connected"}
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([v["support"] for v in response.json()["variants"]], [1])

    def test_resource_aware_requires_business_object_types(self):
        response = self.client.get(
            "/api/variants/", {"file_id": self.log.pk, "extraction": "resource_aware"}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("business object type", response.json()["error"])

    def test_resource_aware_rejects_types_missing_from_the_log(self):
        response = self.client.get(
            "/api/variants/",
            {
                "file_id": self.log.pk,
                "extraction": "resource_aware",
                "business_object_types": ["truck"],
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("None of the selected business object types", response.json()["error"])

    # --- storing executions -------------------------------------------------

    def test_store_executions_writes_columns_and_reports_counts(self):
        response = self._store()
        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(payload["execution_column"], "process execution")
        self.assertEqual(payload["variant_column"], "variant")
        self.assertEqual(payload["execution_count"], 3)
        self.assertEqual(payload["total_event_count"], 22)
        self.assertEqual(payload["assigned_event_count"], 20)
        self.assertEqual(payload["ambiguous_event_count"], 0)
        self.assertEqual(payload["unassigned_event_count"], 2)
        self.assertEqual(payload["variant_count"], 2)
        self.assertEqual([v["support"] for v in payload["variants"]], [2, 1])

        executions = self._column_values("process execution")
        self.assertEqual(executions["e02"], "i1")
        self.assertEqual(executions["e13"], "i3")
        self.assertEqual(executions["e20"], "i5")
        self.assertIsNone(executions["e01"])  # start shift: worker only
        self.assertIsNone(executions["e22"])  # end shift: worker only
        variants = self._column_values("variant")
        self.assertEqual(variants["e02"], variants["e13"])
        self.assertNotEqual(variants["e02"], variants["e20"])

        columns = self.client.get(f"/api/files/{self.log.pk}/event_columns/")
        self.assertEqual(columns.status_code, 200, columns.data)
        self.assertEqual(
            columns.json(),
            [
                {"name": "process execution", "non_null_count": 20, "distinct_count": 3},
                {"name": "variant", "non_null_count": 20, "distinct_count": 2},
            ],
        )

    def test_store_without_variants_skips_the_grouping(self):
        response = self._store(compute_variants=False, variant_column=None)
        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertIsNone(payload["variants"])
        self.assertIsNone(payload["variant_count"])
        self.assertEqual(payload["execution_count"], 3)
        self.assertEqual(self._column_values("process execution")["e02"], "i1")

        response = self._store(compute_variants=False, variant_column="variant")
        self.assertEqual(response.status_code, 400)
        self.assertIn("variant column", response.json()["error"])

    def test_store_rejects_invalid_column_names(self):
        for column in ("event_id", 'bad"name', "", None):
            with self.subTest(column=column):
                response = self._store(execution_column=column)
                self.assertEqual(response.status_code, 400, response.data)
                self.assertIn("execution_column", response.json()["error"])
        response = self._store(variant_column="process execution")
        self.assertEqual(response.status_code, 400)
        self.assertIn("must differ", response.json()["error"])

    def test_store_reports_ambiguous_events_for_overlapping_executions(self):
        # One execution per order with its direct neighbours. Every order
        # neighbours the worker (via "close order"), so all worker events are
        # shared by every execution and stay unassigned as ambiguous.
        response = self._store(
            extraction="leading_1hop",
            leading_type="order",
            compute_variants=False,
            variant_column=None,
        )
        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(payload["execution_count"], 4)
        self.assertGreater(payload["ambiguous_event_count"], 0)
        self.assertEqual(
            payload["assigned_event_count"]
            + payload["ambiguous_event_count"]
            + payload["unassigned_event_count"],
            payload["total_event_count"],
        )
        executions = self._column_values("process execution")
        self.assertIsNone(executions["e01"])  # start shift: in every execution
        self.assertIsNone(executions["e04"])  # pick item i1 with the worker
        self.assertEqual(executions["e02"], "o1")  # place order o1: o1, i1, i2
        self.assertEqual(executions["e14"], "o3")

    def test_global_filter_limits_the_stored_executions(self):
        response = self._store(
            compute_variants=False,
            variant_column=None,
            _query="?activities=place%20order,pick%20item,pack%20items,ship%20package",
        )
        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(payload["execution_count"], 3)
        # 22 events minus 4 "close order" and 2 shift events
        self.assertEqual(payload["total_event_count"], 16)
        self.assertEqual(payload["assigned_event_count"], 16)
        self.assertEqual(payload["unassigned_event_count"], 0)
        executions = self._column_values("process execution")
        self.assertIsNone(executions["e08"])  # close order o1 -- filtered out
        self.assertEqual(executions["e07"], "i1")

    def test_registry_connection_is_reopened_read_only_after_storing(self):
        self.assertEqual(self._store().status_code, 200)
        db = views._OCEL_DB_REGISTRY[self.log.pk]
        with self.assertRaises(Exception):
            db.conn.execute("CREATE TABLE not_allowed (a INTEGER)")
        self.assertIn("process execution", db._event_attr_cols)

        # Readers keep working on the fresh connection, results are recomputed.
        response = self.client.get(
            "/api/variants/", {"file_id": self.log.pk, "extraction": "connected"}
        )
        self.assertEqual(response.status_code, 200, response.data)

    def test_store_requires_project_membership(self):
        outsider = User.objects.create_user("outsider", password="pw")
        self.client.force_authenticate(outsider)
        self.assertEqual(self._store().status_code, 404)
        self.assertEqual(
            self.client.get(f"/api/files/{self.log.pk}/event_columns/").status_code, 404
        )


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class StoredColumnOccnConformanceTests(APITestCase):
    """OCCN mined from the clean log, replayed on stored executions of the deviating log."""

    def setUp(self):
        cache.clear()
        views._OCEL_DB_REGISTRY.clear()
        views._OCEL_OBJECT_TYPES_REGISTRY.clear()

        self.user = User.objects.create_user("tester", password="pw")
        self.project = Project.objects.create(name="orders-project")
        self.project.users.add(self.user)

        clean_name = f"clean-{self._testMethodName}.duckdb"
        _import_example(CLEAN_LOG, f"{_MEDIA_ROOT}/{clean_name}")
        clean = OcelDuckDB.load(f"{_MEDIA_ROOT}/{clean_name}", read_only=True)
        try:
            occn = discover_occn(
                clean, relativeOccuranceThreshold=0.0, parameters={"object_types": BUSINESS_TYPES}
            )
        finally:
            clean.close()
        self.asset = ProjectAsset.objects.create(
            project=self.project,
            name="orders OCCN",
            asset_type=ProjectAsset.AssetType.OCCN,
            content_json=views.EventLogViewSet._occn_content_json(occn),
        )

        self.filename = f"deviating-{self._testMethodName}.duckdb"
        _import_example(DEVIATING_LOG, f"{_MEDIA_ROOT}/{self.filename}")
        self.log = EventLog.objects.create(project=self.project, file=self.filename)
        self.client.force_authenticate(self.user)

        response = self.client.post(
            f"/api/files/{self.log.pk}/process_executions/",
            {
                "extraction": "resource_aware",
                "business_object_types": BUSINESS_TYPES,
                "business_activities": BUSINESS_ACTIVITIES,
                "execution_column": "process execution",
                "compute_variants": False,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)

    def _conformance(self, **overrides):
        body = {
            "asset_id": self.asset.pk,
            "replay_unit_strategy": STORED_COLUMN_REPLAY_STRATEGY,
            "execution_column": "process execution",
            "restrict_to_model_object_types": True,
        }
        body.update(overrides)
        return self.client.post(
            f"/api/files/{self.log.pk}/occn_conformance/", body, format="json"
        )

    def test_stored_executions_detect_the_missing_pick(self):
        response = self._conformance()
        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(payload["replay_unit_strategy"], STORED_COLUMN_REPLAY_STRATEGY)
        self.assertEqual(payload["execution_column"], "process execution")
        self.assertTrue(payload["restrict_to_model_object_types"])
        self.assertEqual(payload["total_units"], 3)
        self.assertEqual(payload["non_fitting_units"], 1)
        self.assertAlmostEqual(payload["fitness"], 2 / 3)
        by_unit = {u["unit_id"]: u for u in payload["unit_results"]}
        self.assertEqual(by_unit["stored_column:i3"]["status"], "non_fitting")
        self.assertEqual(by_unit["stored_column:i3"]["stopping_activity"], "pack items")
        self.assertEqual(by_unit["stored_column:i3"]["failure_event_id"], "e11")

    def test_without_projection_the_worker_breaks_every_unit(self):
        response = self._conformance(restrict_to_model_object_types=False)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["fitness"], 0.0)
        self.assertTrue(
            all(u["stopping_activity"] == "START_worker" for u in response.json()["unit_results"])
        )

    def test_replay_unit_detail_reproduces_stored_units(self):
        response = self.client.get(
            f"/api/files/{self.log.pk}/occn_replay_unit_detail/",
            {
                "unit_id": "stored_column:i3",
                "replay_unit_strategy": STORED_COLUMN_REPLAY_STRATEGY,
                "execution_column": "process execution",
                "restrict_to_model_object_types": "true",
                "asset_id": self.asset.pk,
            },
        )
        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(payload["execution_column"], "process execution")
        self.assertEqual(payload["event_count"], 5)
        self.assertEqual([e["event_id"] for e in payload["events"]], ["e03", "e09", "e11", "e12", "e13"])
        self.assertNotIn("worker", payload["object_types"])
        # Events are projected: no worker object in the detail either.
        self.assertNotIn("worker", payload["events"][1]["objects_by_type"])

    def test_detail_projection_requires_the_asset(self):
        response = self.client.get(
            f"/api/files/{self.log.pk}/occn_replay_unit_detail/",
            {
                "unit_id": "stored_column:i3",
                "replay_unit_strategy": STORED_COLUMN_REPLAY_STRATEGY,
                "execution_column": "process execution",
                "restrict_to_model_object_types": "true",
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("asset_id", response.data)

    def test_request_validation(self):
        response = self._conformance(execution_column=None)
        self.assertEqual(response.status_code, 400)
        self.assertIn("execution_column", response.data)

        response = self._conformance(execution_column="missing column")
        self.assertEqual(response.status_code, 400)
        self.assertIn("execution_column", response.data)

        response = self._conformance(execution_column="event_id")
        self.assertEqual(response.status_code, 400)
        self.assertIn("execution_column", response.data)

        response = self._conformance(replay_unit_strategy="connected_components")
        self.assertEqual(response.status_code, 400)
        self.assertIn("execution_column", response.data)

    def test_projection_also_applies_to_connected_components(self):
        response = self._conformance(
            replay_unit_strategy="connected_components", execution_column=None
        )
        self.assertEqual(response.status_code, 200, response.data)
        # Without the worker the standard strategy also finds the three
        # executions (o3/o4 share a package) and the same deviation.
        self.assertEqual(response.json()["total_units"], 3)
        self.assertEqual(response.json()["non_fitting_units"], 1)
