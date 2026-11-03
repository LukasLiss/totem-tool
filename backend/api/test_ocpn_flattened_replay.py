"""OCPN flattened replay endpoint and dashboard widget.

Runs the endpoint on a small on-disk ``.duckdb`` log (orders and items) and
checks the dashboard layout round-trip of the widget.
"""

import os
import shutil
import tempfile

import duckdb
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APITestCase
from totem_lib.ocel.ocel_duckdb import OcelDuckDB, create_ocel_schema

from . import views
from .cache_utils import RESULTS_CACHE
from .models import (
    Dashboard,
    EventLog,
    OCPNFlattenedReplayComponent,
    Project,
    ProjectAsset,
)

_MEDIA_ROOT = tempfile.mkdtemp(prefix="totem-test-ocpn-replay-")


def _write_log(path: str) -> None:
    """o1 (items i1, i2) and o2 (item i3); item i3 skips "pick"."""
    conn = duckdb.connect(":memory:")
    create_ocel_schema(conn, [], [])
    conn.executemany(
        "INSERT INTO events VALUES (?, ?, ?)",
        [
            ("e1", "create", 1), ("e2", "pick", 2), ("e3", "pick", 3), ("e4", "ship", 4),
            ("e5", "create", 5), ("e6", "ship", 6),
        ],
    )
    conn.executemany(
        "INSERT INTO objects VALUES (?, ?)",
        [("o1", "order"), ("o2", "order"), ("i1", "item"), ("i2", "item"), ("i3", "item")],
    )
    conn.executemany(
        "INSERT INTO event_object VALUES (?, ?, NULL)",
        [
            ("e1", "o1"), ("e1", "i1"), ("e1", "i2"), ("e2", "i1"), ("e3", "i2"),
            ("e4", "o1"), ("e4", "i1"), ("e4", "i2"),
            ("e5", "o2"), ("e5", "i3"), ("e6", "o2"), ("e6", "i3"),
        ],
    )
    db = OcelDuckDB._from_prepared_connection(conn, [], [])
    db.save(path)
    db.close()


def _ocpn(duplicate_label=False):
    transitions = [
        {"id": "create", "label": "create"},
        {"id": "pick", "label": "pick"},
        {"id": "ship", "label": "ship"},
    ]
    if duplicate_label:
        transitions.append({"id": "pick2", "label": "pick"})
    return {
        "format": "ocpn",
        "version": 1,
        "name": "orders",
        "objectTypes": [{"name": "order"}, {"name": "item"}],
        "places": [
            {"id": "o_s", "objectType": "order", "initial": True},
            {"id": "o_1", "objectType": "order"},
            {"id": "o_e", "objectType": "order", "final": True},
            {"id": "i_s", "objectType": "item", "initial": True},
            {"id": "i_1", "objectType": "item"},
            {"id": "i_2", "objectType": "item"},
            {"id": "i_e", "objectType": "item", "final": True},
        ],
        "transitions": transitions,
        "arcs": [
            {"id": "a1", "source": "o_s", "target": "create"},
            {"id": "a2", "source": "create", "target": "o_1"},
            {"id": "a3", "source": "o_1", "target": "ship"},
            {"id": "a4", "source": "ship", "target": "o_e"},
            {"id": "a5", "source": "i_s", "target": "create", "variable": True},
            {"id": "a6", "source": "create", "target": "i_1", "variable": True},
            {"id": "a7", "source": "i_1", "target": "pick"},
            {"id": "a8", "source": "pick", "target": "i_2"},
            {"id": "a9", "source": "i_2", "target": "ship", "variable": True},
            {"id": "a10", "source": "ship", "target": "i_e", "variable": True},
        ],
    }


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class OCPNFlattenedReplayEndpointTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(_MEDIA_ROOT, ignore_errors=True)

    def setUp(self):
        cache.clear()
        RESULTS_CACHE.clear()
        views._OCEL_DB_REGISTRY.clear()
        views._OCEL_OBJECT_TYPES_REGISTRY.clear()

        self.user = User.objects.create_user("replay-user", password="pw")
        self.other = User.objects.create_user("replay-other", password="pw")
        self.project = Project.objects.create(name="replay-project")
        self.project.users.add(self.user)

        filename = f"replay-log-{self._testMethodName}.duckdb"
        os.makedirs(_MEDIA_ROOT, exist_ok=True)
        _write_log(os.path.join(_MEDIA_ROOT, filename))
        self.log = EventLog.objects.create(project=self.project, file=filename)
        self.asset = ProjectAsset.objects.create(
            project=self.project,
            name="Order net",
            asset_type=ProjectAsset.AssetType.OCPN,
            content_json=_ocpn(),
        )
        self.url = f"/api/files/{self.log.pk}/ocpn_flattened_replay/"
        self.client.force_authenticate(self.user)

    def test_replay_returns_fitness_per_type_and_place_stats(self):
        response = self.client.post(self.url, {"asset_id": self.asset.pk}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        body = response.json()
        self.assertEqual(body["asset_id"], self.asset.pk)
        self.assertEqual(body["model"]["name"], "orders")
        by_type = {r["object_type"]: r for r in body["object_types"]}
        self.assertEqual(by_type["order"]["fitness"], 1.0)
        self.assertEqual(by_type["order"]["num_objects"], 2)
        self.assertEqual(by_type["order"]["unmapped_activities"], {})
        item = by_type["item"]
        self.assertEqual(item["num_objects"], 3)
        self.assertEqual(item["fitting_objects"], 2)
        self.assertEqual((item["missing"], item["remaining"]), (1, 1))
        self.assertLess(item["fitness"], 1.0)
        self.assertAlmostEqual(
            body["average_fitness"], (1.0 + item["fitness"]) / 2
        )
        places = {p["place_id"]: p for p in body["places"]}
        self.assertEqual(places["i_2"]["missing"], 1)
        self.assertEqual(places["i_1"]["remaining"], 1)
        self.assertEqual(places["o_1"]["missing"], 0)

    def test_duplicate_labels_are_rejected(self):
        self.asset.content_json = _ocpn(duplicate_label=True)
        self.asset.save()
        response = self.client.post(self.url, {"asset_id": self.asset.pk}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("unique", response.json()["error"])

    def test_asset_must_be_an_ocpn_of_the_same_project(self):
        wrong_type = ProjectAsset.objects.create(
            project=self.project,
            name="Not a net",
            asset_type=ProjectAsset.AssetType.OCCN,
            content_json={},
        )
        response = self.client.post(self.url, {"asset_id": wrong_type.pk}, format="json")
        self.assertEqual(response.status_code, 400)

        foreign_project = Project.objects.create(name="foreign")
        foreign_project.users.add(self.other)
        foreign = ProjectAsset.objects.create(
            project=foreign_project,
            name="Foreign net",
            asset_type=ProjectAsset.AssetType.OCPN,
            content_json=_ocpn(),
        )
        response = self.client.post(self.url, {"asset_id": foreign.pk}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_request_validation_and_scoping(self):
        self.assertEqual(self.client.post(self.url, {}, format="json").status_code, 400)
        self.client.force_authenticate(self.other)
        response = self.client.post(self.url, {"asset_id": self.asset.pk}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_dashboard_layout_round_trip(self):
        dashboard = Dashboard.objects.create(project=self.project, name="Replay", order_in_project=0)
        layout = [
            {
                "component_name": "OCPNFlattenedReplayComponent",
                "x": 0, "y": 0, "w": 8, "h": 6,
                "ocpn_asset_id": self.asset.pk,
                "automatic_loading": True,
            }
        ]
        response = self.client.post(
            f"/api/dashboard/{dashboard.pk}/save_layout/", {"layout": layout}, format="json"
        )
        self.assertIn(response.status_code, (200, 201), getattr(response, "data", None))
        component = OCPNFlattenedReplayComponent.objects.get(dashboard=dashboard)
        self.assertEqual(component.ocpn_asset_id, self.asset.pk)
        self.assertTrue(component.automatic_loading)

        response = self.client.get(f"/api/dashboard/{dashboard.pk}/get_layout/")
        self.assertEqual(response.status_code, 200)
        (item,) = response.json()
        self.assertEqual(item["component_name"], "OCPNFlattenedReplayComponent")
        self.assertEqual(item["ocpn_asset_id"], self.asset.pk)
        self.assertTrue(item["automatic_loading"])
