"""
Object-centric alignment endpoints and the OCAlignmentComponent dashboard widget.

Runs on the tiny orders log of ``totem_lib/test_data/small``: a model is
discovered from the clean log (business types only, so the worker is not part
of it) and the deviating log -- order ``o2`` never picks item ``i4`` -- is
aligned against it.
"""

import tempfile
from pathlib import Path

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APITestCase
from totem_lib.ocel import import_ocel_db
from totem_lib.ocpn import discover_ocpn_db

from . import views
from .models import (
    Dashboard,
    EventLog,
    OCAlignmentComponent,
    Project,
    ProjectAsset,
)

_MEDIA_ROOT = tempfile.mkdtemp(prefix="totem-test-media-alignments-")
EXAMPLE_LOGS = Path(__file__).resolve().parents[2] / "totem_lib" / "test_data" / "small"
BUSINESS_TYPES = ["order", "item", "package"]
BUSINESS_ACTIVITIES = ["place order", "pick item", "pack items", "ship package", "close order"]


def _discover_model():
    db = import_ocel_db(str(EXAMPLE_LOGS / "resource_aware_orders.json"))
    try:
        return dict(discover_ocpn_db(db, object_types=BUSINESS_TYPES))
    finally:
        db.close()


_MODEL = _discover_model()


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class OCAlignmentEndpointTests(APITestCase):
    def setUp(self):
        cache.clear()
        views._OCEL_DB_REGISTRY.clear()
        views._OCEL_OBJECT_TYPES_REGISTRY.clear()

        self.user = User.objects.create_user("tester", password="pw")
        self.project = Project.objects.create(name="orders-project")
        self.project.users.add(self.user)
        filename = f"orders-{self._testMethodName}.duckdb"
        import_ocel_db(
            str(EXAMPLE_LOGS / "resource_aware_orders_deviating.json"),
            db_path=f"{_MEDIA_ROOT}/{filename}",
        ).close()
        self.log = EventLog.objects.create(project=self.project, file=filename)
        self.asset = ProjectAsset.objects.create(
            project=self.project,
            name="orders model",
            asset_type=ProjectAsset.AssetType.OCPN,
            content_json=_MODEL,
        )
        self.client.force_authenticate(self.user)

    def _area(self, **overrides):
        body = {
            "source": "area",
            "business_object_types": BUSINESS_TYPES,
            "business_activities": BUSINESS_ACTIVITIES,
        }
        body.update(overrides)
        return body

    def _post(self, action, body, query=""):
        return self.client.post(f"/api/files/{self.log.pk}/{action}/{query}", body, format="json")

    # --- executions -------------------------------------------------------

    def test_area_executions_are_listed(self):
        response = self._post("oc_alignment_executions", self._area(asset_id=self.asset.pk))
        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(payload["total"], 3)
        self.assertFalse(payload["truncated"])
        self.assertEqual([e["id"] for e in payload["executions"]], ["i1", "i3", "i5"])
        self.assertEqual(payload["model_object_types"], sorted(BUSINESS_TYPES))
        self.assertTrue(all(e["ignored_object_types"] == [] for e in payload["executions"]))

    def test_area_requires_object_types(self):
        response = self._post("oc_alignment_executions", {"source": "area"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("business_object_types", response.json())

    def test_stored_requires_an_existing_column(self):
        response = self._post("oc_alignment_executions", {"source": "stored"})
        self.assertEqual(response.status_code, 400)
        response = self._post(
            "oc_alignment_executions", {"source": "stored", "execution_column": "missing"}
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("execution_column", response.json())

    def test_stored_executions_after_storing_them(self):
        stored = self.client.post(
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
        self.assertEqual(stored.status_code, 200, stored.data)

        listing = self._post(
            "oc_alignment_executions",
            {"source": "stored", "execution_column": "process execution", "asset_id": self.asset.pk},
        )
        self.assertEqual(listing.status_code, 200, listing.data)
        executions = listing.json()["executions"]
        self.assertEqual(len(executions), 3)
        # Stored executions keep the worker; the model does not know it.
        self.assertTrue(all(e["ignored_object_types"] == ["worker"] for e in executions))

        response = self._post(
            "oc_alignment",
            {
                "source": "stored",
                "execution_column": "process execution",
                "execution_id": "i3",
                "asset_id": self.asset.pk,
            },
        )
        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(payload["status"], "optimal")
        self.assertEqual(payload["cost"], 1)
        self.assertEqual(payload["projection"]["ignored_object_types"], ["worker"])
        self.assertEqual(payload["projection"]["ignored_object_count"], 1)

    # --- alignment --------------------------------------------------------

    def test_alignment_of_the_deviating_execution(self):
        response = self._post(
            "oc_alignment", self._area(asset_id=self.asset.pk, execution_id="i3")
        )
        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(payload["status"], "optimal")
        self.assertEqual(payload["cost"], 1)
        self.assertEqual(payload["execution_id"], "i3")
        self.assertEqual(payload["move_counts"]["model"], 1)
        model_moves = [m for m in payload["moves"] if m["kind"] == "model"]
        self.assertEqual(model_moves[0]["model_activity"], "pick item")
        self.assertEqual(model_moves[0]["model_objects"], {"item": ["i4"]})
        self.assertEqual(payload["projection"]["ignored_object_types"], [])
        self.assertTrue(payload["edges"])

    def test_fitting_execution_and_global_filter(self):
        response = self._post("oc_alignment", self._area(asset_id=self.asset.pk, execution_id="i1"))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["cost"], 0)

        # With "pick item" filtered out of the log every pick becomes a model move.
        acts = ",".join(a for a in BUSINESS_ACTIVITIES if a != "pick item")
        filtered = self._post(
            "oc_alignment",
            self._area(asset_id=self.asset.pk, execution_id="i1"),
            query=f"?activities={acts}",
        )
        self.assertEqual(filtered.status_code, 200, filtered.data)
        self.assertEqual(filtered.json()["cost"], 2)

    def test_unknown_execution_is_404(self):
        response = self._post("oc_alignment", self._area(asset_id=self.asset.pk, execution_id="zz"))
        self.assertEqual(response.status_code, 404)
        self.assertIn("execution_id", response.json())

    def test_asset_must_be_an_ocpn_of_the_project(self):
        occn = ProjectAsset.objects.create(
            project=self.project,
            name="not a petri net",
            asset_type=ProjectAsset.AssetType.QUERY,
            content_json={"schema": "sql-query", "version": 1, "query": "SELECT 1"},
        )
        response = self._post("oc_alignment", self._area(asset_id=occn.pk, execution_id="i1"))
        self.assertEqual(response.status_code, 400)

        other = Project.objects.create(name="other")
        other.users.add(self.user)
        foreign = ProjectAsset.objects.create(
            project=other, name="m", asset_type=ProjectAsset.AssetType.OCPN, content_json=_MODEL
        )
        response = self._post("oc_alignment", self._area(asset_id=foreign.pk, execution_id="i1"))
        self.assertEqual(response.status_code, 400)

        response = self._post("oc_alignment", self._area(asset_id=999999, execution_id="i1"))
        self.assertEqual(response.status_code, 404)

    def test_other_users_cannot_align(self):
        intruder = User.objects.create_user("intruder", password="pw")
        self.client.force_authenticate(intruder)
        response = self._post("oc_alignment", self._area(asset_id=self.asset.pk, execution_id="i1"))
        self.assertEqual(response.status_code, 404)

    def test_state_limit_below_the_minimum_is_rejected(self):
        response = self._post(
            "oc_alignment",
            self._area(asset_id=self.asset.pk, execution_id="i3", max_states=999),
        )
        self.assertEqual(response.status_code, 400)  # below the minimum


    # --- batch ------------------------------------------------------------

    def test_batch_aligns_every_area_execution(self):
        response = self._post("oc_alignment_batch", self._area(asset_id=self.asset.pk))
        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(payload["total"], 3)
        self.assertEqual(payload["aligned"], 3)
        self.assertEqual(payload["fitting"], 2)
        self.assertEqual({r["id"]: r["cost"] for r in payload["rows"]}, {"i1": 0, "i3": 1, "i5": 0})
        self.assertEqual(payload["max_states"], 50_000)
        self.assertFalse(payload["stopped_early"])
        pick = next(r for r in payload["deviations_by_activity"] if r["activity"] == "pick item")
        self.assertEqual(pick["model"], 1)

    def test_batch_validates_input(self):
        self.assertEqual(self._post("oc_alignment_batch", self._area()).status_code, 400)
        response = self._post(
            "oc_alignment_batch", {"source": "stored", "execution_column": "missing", "asset_id": self.asset.pk}
        )
        self.assertEqual(response.status_code, 400)
        response = self._post(
            "oc_alignment_batch", self._area(asset_id=self.asset.pk, total_timeout_s=1)
        )
        self.assertEqual(response.status_code, 400)

    def test_no_alignment_comes_with_diagnostics(self):
        broken = dict(_MODEL)
        broken["places"] = [dict(p) for p in _MODEL["places"]]
        item_places = [p for p in broken["places"] if p["objectType"] == "item"]
        next(p for p in item_places if not p.get("final") and not p.get("initial"))["final"] = True
        asset = ProjectAsset.objects.create(
            project=self.project, name="broken", asset_type=ProjectAsset.AssetType.OCPN, content_json=broken
        )
        response = self._post("oc_alignment", self._area(asset_id=asset.pk, execution_id="i1"))
        self.assertEqual(response.status_code, 200, response.data)
        payload = response.json()
        self.assertEqual(payload["status"], "no_alignment")
        self.assertTrue(any("can never get" in d for d in payload["diagnostics"]))


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class OCAlignmentComponentLayoutTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("tester", password="pw")
        self.project = Project.objects.create(name="layout-project")
        self.project.users.add(self.user)
        self.dashboard = Dashboard.objects.create(project=self.project, name="d", order_in_project=0)
        self.asset = ProjectAsset.objects.create(
            project=self.project,
            name="orders model",
            asset_type=ProjectAsset.AssetType.OCPN,
            content_json=_MODEL,
        )
        self.client.force_authenticate(self.user)

    def test_layout_round_trip_and_clamping(self):
        layout = [
            {
                "component_name": "OCAlignmentComponent",
                "x": 0, "y": 0, "w": 10, "h": 8,
                "show_controls": False,
                "automatic_loading": True,
                "model_asset": self.asset.pk,
                "execution_source": "stored",
                "execution_column": "process execution",
                "business_object_types": ["order", 3, ""],
                "business_activities": ["place order"],
                "execution_id": "i3",
                "max_states": 10**9,
                "timeout_s": "nan",
                "show_silent_moves": True,
            },
            {
                "component_name": "OCAlignmentComponent",
                "x": 0, "y": 8, "w": 10, "h": 8,
                "model_asset": 999999,
                "execution_source": "bogus",
            },
        ]
        response = self.client.post(
            f"/api/dashboard/{self.dashboard.pk}/save_layout/", {"layout": layout}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)

        first, second = OCAlignmentComponent.objects.order_by("y")
        self.assertEqual(first.model_asset_id, self.asset.pk)
        self.assertEqual(first.execution_source, "stored")
        self.assertEqual(first.business_object_types, ["order"])
        self.assertEqual(first.max_states, 2_000_000)
        self.assertEqual(first.timeout_s, 60.0)
        self.assertTrue(first.show_silent_moves)
        self.assertIsNone(second.model_asset)
        self.assertEqual(second.execution_source, "area")

        loaded = self.client.get(f"/api/dashboard/{self.dashboard.pk}/get_layout/")
        self.assertEqual(loaded.status_code, 200)
        item = next(c for c in loaded.json() if c["y"] == 0)
        self.assertEqual(item["component_name"], "OCAlignmentComponent")
        self.assertEqual(item["model_asset"], self.asset.pk)
        self.assertEqual(item["execution_id"], "i3")
        self.assertFalse(item["show_controls"])
        self.assertTrue(item["automatic_loading"])
