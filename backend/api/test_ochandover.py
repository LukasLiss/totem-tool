"""Organizational mining endpoints and dashboard widgets.

The handover, profile-matrix and event-log endpoints run on the DuckDB
registry like every other analysis endpoint; these tests exercise them on a
small on-disk ``.duckdb`` log and check the dashboard layout round-trip of the
two widgets, including the server-side clamping of their settings.
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
    OCHandoverComponent,
    Project,
    ResourceProfilingComponent,
)

_MEDIA_ROOT = tempfile.mkdtemp(prefix="totem-test-ochandover-")


def _write_resource_log(path: str) -> None:
    """Two employees and a machine handing two orders over to each other.

    o1: e1 (Mike) -> e2 (Anna) -> e3 (Anna, robot) -> e4 (Mike)
    o2: e5 (Mike) -> e6 (robot) -> e7 (Anna)
    e6 has no employee, so Mike -> Anna on o2 has a gap of one event for the
    ``employee`` resource type alone.
    """
    conn = duckdb.connect(":memory:")
    create_ocel_schema(conn, [], [])
    conn.executemany(
        "INSERT INTO events VALUES (?, ?, ?)",
        [
            ("e1", "receive", 1_700_000_000),
            ("e2", "check", 1_700_003_600),
            ("e3", "pack", 1_700_007_200),
            ("e4", "ship", 1_700_010_800),
            ("e5", "receive", 1_700_014_400),
            ("e6", "pack", 1_700_018_000),
            ("e7", "ship", 1_700_021_600),
        ],
    )
    conn.executemany(
        "INSERT INTO objects VALUES (?, ?)",
        [
            ("Mike", "employee"),
            ("Anna", "employee"),
            ("robot", "machine"),
            ("o1", "order"),
            ("o2", "order"),
        ],
    )
    conn.executemany(
        "INSERT INTO event_object VALUES (?, ?, NULL)",
        [
            ("e1", "Mike"), ("e1", "o1"),
            ("e2", "Anna"), ("e2", "o1"),
            ("e3", "Anna"), ("e3", "robot"), ("e3", "o1"),
            ("e4", "Mike"), ("e4", "o1"),
            ("e5", "Mike"), ("e5", "o2"),
            ("e6", "robot"), ("e6", "o2"),
            ("e7", "Anna"), ("e7", "o2"),
        ],
    )
    db = OcelDuckDB._from_prepared_connection(conn, [], [])
    db.save(path)
    db.close()


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class OrganizationalMiningEndpointTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(_MEDIA_ROOT, ignore_errors=True)

    def setUp(self):
        cache.clear()
        RESULTS_CACHE.clear()
        views._OCEL_DB_REGISTRY.clear()
        views._OCEL_OBJECT_TYPES_REGISTRY.clear()

        self.user = User.objects.create_user("orga-user", password="pw")
        self.other = User.objects.create_user("orga-other", password="pw")
        self.project = Project.objects.create(name="orga-project")
        self.project.users.add(self.user)

        filename = f"resource-log-{self._testMethodName}.duckdb"
        os.makedirs(_MEDIA_ROOT, exist_ok=True)
        _write_resource_log(os.path.join(_MEDIA_ROOT, filename))
        self.log = EventLog.objects.create(project=self.project, file=filename)
        self.client.force_authenticate(self.user)

    def _handover(self, **params):
        query = {
            "file_id": self.log.pk,
            "resource_types": "employee",
            "businessobject_types": "order",
        }
        query.update(params)
        return self.client.get("/api/handover/", query)

    # -- handover -----------------------------------------------------------

    def test_handover_requires_file_id_and_types(self):
        self.assertEqual(self.client.get("/api/handover/").status_code, 400)
        response = self.client.get("/api/handover/", {"file_id": self.log.pk})
        self.assertEqual(response.status_code, 400)
        self.assertIn("resource_types", response.json()["error"])

    def test_handover_rejects_foreign_or_bogus_file(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self._handover().status_code, 404)
        self.client.force_authenticate(self.user)
        self.assertEqual(self._handover(file_id="abc").status_code, 404)

    def test_handover_validates_parameters(self):
        self.assertEqual(self._handover(normalization="nope").status_code, 400)
        self.assertEqual(self._handover(normalization_scope="nope").status_code, 400)
        self.assertEqual(self._handover(parallel_threshold="1.5").status_code, 400)
        self.assertEqual(self._handover(parallel_threshold="x").status_code, 400)
        self.assertEqual(self._handover(min_parallel_observations="0").status_code, 400)
        self.assertEqual(self._handover(max_gap="-1").status_code, 400)
        self.assertEqual(self._handover(method="weird").status_code, 400)
        response = self.client.get("/api/handover/", {"file_id": self.log.pk, "method": "flattened"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("case_type", response.json()["error"])

    def test_handover_graph_from_duckdb_log(self):
        response = self._handover()
        self.assertEqual(response.status_code, 200, response.data)
        body = response.json()
        node_ids = {n["id"] for n in body["nodes"]}
        self.assertEqual(node_ids, {"Mike", "Anna"})
        for node in body["nodes"]:
            self.assertEqual(node["object_type"], "employee")
        edges = {(e["source"], e["target"]): e for e in body["edges"]}
        # o1: Mike->Anna, Anna->Anna (e2->e3), Anna->Mike; o2: Mike->Anna (via the robot event).
        self.assertEqual(set(edges), {("Mike", "Anna"), ("Anna", "Anna"), ("Anna", "Mike")})
        self.assertEqual(edges[("Mike", "Anna")]["raw_weight"], 2)
        self.assertEqual(edges[("Mike", "Anna")]["businessobject_type"], "order")
        self.assertGreater(edges[("Mike", "Anna")]["weight"], 0)
        self.assertNotIn("flows", body)
        self.assertNotIn("bindings", body)

    def test_handover_max_gap_drops_gapped_handover(self):
        response = self._handover(max_gap=0)
        self.assertEqual(response.status_code, 200, response.data)
        edges = {(e["source"], e["target"]): e for e in response.json()["edges"]}
        # Only the direct o1 handover survives; the o2 one passes the robot event.
        self.assertEqual(edges[("Mike", "Anna")]["raw_weight"], 1)

    def test_handover_flows_and_bindings_are_optional_extras(self):
        response = self._handover(include_flows="true", include_bindings="true")
        self.assertEqual(response.status_code, 200, response.data)
        body = response.json()
        self.assertIn("flows", body)
        self.assertIn("timeline", body)
        self.assertIn("bindings", body)
        self.assertGreater(len(body["flows"]), 0)
        self.assertEqual(body["timeline"]["start"], 1_700_000_000)

    def test_handover_flattened_method(self):
        response = self.client.get(
            "/api/handover/",
            {"file_id": self.log.pk, "method": "flattened", "case_type": "order", "resource_type": "employee"},
        )
        self.assertEqual(response.status_code, 200, response.data)
        body = response.json()
        self.assertEqual({n["id"] for n in body["nodes"]}, {"Mike", "Anna"})
        self.assertTrue(all(e["businessobject_type"] == "order" for e in body["edges"]))

    def test_handover_post_with_cluster_map_collapses_resources(self):
        response = self.client.post(
            "/api/handover/",
            {
                "file_id": self.log.pk,
                "resource_types": "employee",
                "businessobject_types": "order",
                "cluster_map": {"Mike": "Cluster 1", "Anna": "Cluster 1"},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        body = response.json()
        self.assertEqual({n["id"] for n in body["nodes"]}, {"Cluster 1"})
        self.assertEqual(body["nodes"][0]["object_type"], "cluster")

    def test_handover_cluster_by_object_type(self):
        response = self._handover(resource_types="employee,machine", cluster_by_ot="true")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual({n["id"] for n in response.json()["nodes"]}, {"employee", "machine"})

    def test_handover_respects_global_object_type_filter(self):
        # The global filter removes the business object type; the algorithm
        # then sees no orders at all and the graph is empty, not a 500.
        response = self._handover(object_types="employee")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()["edges"], [])
        # Filtering to the first order's time window keeps only o1's handovers.
        response = self._handover(before=1_700_010_800)
        self.assertEqual(response.status_code, 200, response.data)
        edges = {(e["source"], e["target"]): e for e in response.json()["edges"]}
        self.assertEqual(edges[("Mike", "Anna")]["raw_weight"], 1)

    def test_handover_result_is_cached_per_parameters(self):
        first = self._handover().json()
        with self.settings():
            # A second identical request is served from the results cache and
            # never touches the registry lock.
            from unittest.mock import patch
            with patch("api.views.ochandover._with_ocel_db") as locked:
                self.assertEqual(self._handover().json(), first)
                locked.assert_not_called()
            # Different parameters compute again.
            with patch("api.views.ochandover._with_ocel_db", wraps=views._with_ocel_db) as locked:
                self.assertEqual(self._handover(max_gap=0).status_code, 200)
                locked.assert_called_once()

    # -- profile matrix -----------------------------------------------------

    def test_profile_matrix_from_duckdb_log(self):
        response = self.client.get(
            "/api/profile-matrix/",
            {
                "file_id": self.log.pk,
                "resource_types": "employee",
                "feature_groups": "activity_fractions,time_fractions",
                "width": 400,
                "height": 300,
                "cluster_method": "kmeans",
                "n_clusters": 2,
            },
        )
        self.assertEqual(response.status_code, 200, response.data)
        body = response.json()
        self.assertEqual(body["resources"], ["Anna", "Mike"])
        self.assertEqual(body["resource_object_types"], {"Anna": "employee", "Mike": "employee"})
        self.assertEqual(body["activities"], ["check", "pack", "receive", "ship"])
        self.assertEqual(body["time_bins"], list(range(24)))
        self.assertEqual(len(body["values"]), 2)
        self.assertEqual(body["n_clusters"], 2)
        self.assertEqual(len(body["mds_positions"]), 2)

    def test_profile_matrix_defaults_and_validation(self):
        self.assertEqual(self.client.get("/api/profile-matrix/").status_code, 400)
        self.assertEqual(
            self.client.get("/api/profile-matrix/", {"file_id": self.log.pk, "width": "x", "height": "3"}).status_code,
            400,
        )
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get("/api/profile-matrix/", {"file_id": self.log.pk}).status_code, 404)
        self.client.force_authenticate(self.user)

        # No resource types: every object type is profiled; unknown feature
        # groups fall back to activity fractions; clustering can be disabled.
        response = self.client.get(
            "/api/profile-matrix/",
            {"file_id": self.log.pk, "feature_groups": "nonsense", "compute_clusters": "false"},
        )
        self.assertEqual(response.status_code, 200, response.data)
        body = response.json()
        self.assertEqual(body["feature_groups"], ["activity_fractions"])
        self.assertEqual(set(body["resource_object_types"].values()), {"employee", "machine", "order"})
        self.assertNotIn("cluster_labels", body)

    def test_profile_matrix_business_objects_and_tooltip_groups(self):
        response = self.client.get(
            "/api/profile-matrix/",
            {
                "file_id": self.log.pk,
                "resource_types": "employee",
                "business_object_types": "order",
                "feature_groups": "object_collaboration_fractions",
                "tooltip_feature_groups": "object_portfolio_fractions",
            },
        )
        self.assertEqual(response.status_code, 200, response.data)
        body = response.json()
        self.assertEqual(body["collaborating_resources"], ["Anna", "Mike"])
        self.assertEqual(body["portfolio_object_types"], ["order"])
        self.assertIn("mds_feature_mask", body)

    # -- event log table ----------------------------------------------------

    def test_event_log_table(self):
        response = self.client.get("/api/event-log/", {"file_id": self.log.pk})
        self.assertEqual(response.status_code, 200, response.data)
        body = response.json()
        self.assertEqual(body["object_types"], ["employee", "machine", "order"])
        self.assertEqual(body["total_events"], 7)
        self.assertEqual([e["event_id"] for e in body["events"]], ["e1", "e2", "e3", "e4", "e5", "e6", "e7"])
        e3 = body["events"][2]
        self.assertEqual(e3["activity"], "pack")
        self.assertEqual(e3["timestamp"], 1_700_007_200 * 1000)
        self.assertEqual(e3["objects"], {"employee": ["Anna"], "machine": ["robot"], "order": ["o1"]})

    def test_event_log_table_limit_and_filter(self):
        response = self.client.get("/api/event-log/", {"file_id": self.log.pk, "limit": 2})
        self.assertEqual(response.status_code, 200, response.data)
        body = response.json()
        self.assertEqual(len(body["events"]), 2)
        self.assertEqual(body["total_events"], 7)

        response = self.client.get("/api/event-log/", {"file_id": self.log.pk, "activities": "ship"})
        self.assertEqual(response.status_code, 200, response.data)
        body = response.json()
        self.assertEqual([e["event_id"] for e in body["events"]], ["e4", "e7"])
        self.assertEqual(body["total_events"], 2)

        self.assertEqual(self.client.get("/api/event-log/", {"file_id": self.log.pk, "limit": 0}).status_code, 400)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get("/api/event-log/", {"file_id": self.log.pk}).status_code, 404)


class OrganizationalMiningLayoutTests(APITestCase):
    """Dashboard layout round-trip of the two organizational mining widgets."""

    def setUp(self):
        self.user = User.objects.create_user(username="orga-dash-owner")
        self.project = Project.objects.create(name="Mine")
        self.project.users.add(self.user)
        self.dashboard = Dashboard.objects.create(project=self.project, name="D", order_in_project=0)
        self.client.force_authenticate(user=self.user)

    def _save(self, layout):
        return self.client.post(
            f"/api/dashboard/{self.dashboard.pk}/save_layout/", {"layout": layout}, format="json"
        )

    def _layout(self):
        response = self.client.get(f"/api/dashboard/{self.dashboard.pk}/get_layout/")
        self.assertEqual(response.status_code, 200)
        return {item["component_name"]: item for item in response.data}

    def test_components_round_trip(self):
        response = self._save([
            {
                "x": 0, "y": 0, "w": 8, "h": 6,
                "component_name": "OCHandoverComponent",
                "show_controls": False,
                "automatic_loading": True,
                "method": "oc",
                "resource_types": ["employee", "machine"],
                "businessobject_types": ["order"],
                "max_gap": 2,
                "normalization": "by_source",
                "normalization_scope": "per_bo_type",
                "parallel_filter_enabled": True,
                "parallel_threshold": 0.25,
                "min_parallel_observations": 3,
                "cluster_by_ot": True,
                "view_mode": "table",
            },
            {
                "x": 0, "y": 6, "w": 8, "h": 6,
                "component_name": "ResourceProfilingComponent",
                "show_controls": False,
                "automatic_loading": True,
                "resource_types": ["employee"],
                "business_object_types": ["order"],
                "feature_groups": ["activity_fractions", "time_fractions"],
                "tooltip_feature_groups": ["weekday_fractions", "time_fractions"],
                "compute_clusters": False,
                "cluster_method": "kmeans",
                "n_clusters": 4,
                "min_cluster_size": 5,
                "distance_metric": "hellinger",
                "view_mode": "table",
            },
        ])
        self.assertEqual(response.status_code, 200, response.data)
        layout = self._layout()

        handover = layout["OCHandoverComponent"]
        self.assertFalse(handover["show_controls"])
        self.assertTrue(handover["automatic_loading"])
        self.assertEqual(handover["resource_types"], ["employee", "machine"])
        self.assertEqual(handover["businessobject_types"], ["order"])
        self.assertEqual(handover["max_gap"], 2)
        self.assertEqual(handover["normalization"], "by_source")
        self.assertEqual(handover["normalization_scope"], "per_bo_type")
        self.assertTrue(handover["parallel_filter_enabled"])
        self.assertEqual(handover["parallel_threshold"], 0.25)
        self.assertEqual(handover["min_parallel_observations"], 3)
        self.assertTrue(handover["cluster_by_ot"])
        self.assertEqual(handover["view_mode"], "table")

        profiling = layout["ResourceProfilingComponent"]
        self.assertFalse(profiling["show_controls"])
        self.assertTrue(profiling["automatic_loading"])
        self.assertEqual(profiling["resource_types"], ["employee"])
        self.assertEqual(profiling["business_object_types"], ["order"])
        self.assertEqual(profiling["feature_groups"], ["activity_fractions", "time_fractions"])
        # A tooltip group that is also a main group is dropped from the extras.
        self.assertEqual(profiling["tooltip_feature_groups"], ["weekday_fractions"])
        self.assertFalse(profiling["compute_clusters"])
        self.assertEqual(profiling["cluster_method"], "kmeans")
        self.assertEqual(profiling["n_clusters"], 4)
        self.assertEqual(profiling["min_cluster_size"], 5)
        self.assertEqual(profiling["distance_metric"], "hellinger")
        self.assertEqual(profiling["view_mode"], "table")

    def test_defaults_and_clamping(self):
        response = self._save([
            {
                "x": 0, "y": 0, "w": 8, "h": 6,
                "component_name": "OCHandoverComponent",
                "method": "bogus",
                "resource_types": "not-a-list",
                "max_gap": "",
                "normalization": "bogus",
                "parallel_threshold": 7,
                "min_parallel_observations": 0,
                "view_mode": "bogus",
            },
            {
                "x": 0, "y": 6, "w": 8, "h": 6,
                "component_name": "ResourceProfilingComponent",
                "feature_groups": ["bogus", "time_fractions"],
                "cluster_method": "bogus",
                "n_clusters": 0,
                "min_cluster_size": 1,
                "distance_metric": "bogus",
                "view_mode": "log",
            },
        ])
        self.assertEqual(response.status_code, 200, response.data)
        layout = self._layout()

        handover = layout["OCHandoverComponent"]
        self.assertTrue(handover["show_controls"])
        self.assertFalse(handover["automatic_loading"])
        self.assertEqual(handover["method"], "oc")
        self.assertEqual(handover["resource_types"], [])
        self.assertIsNone(handover["max_gap"])
        self.assertEqual(handover["normalization"], "by_arcs_in_eog")
        self.assertEqual(handover["normalization_scope"], "global")
        self.assertEqual(handover["parallel_threshold"], 1.0)
        self.assertEqual(handover["min_parallel_observations"], 1)
        self.assertEqual(handover["view_mode"], "graph")

        profiling = layout["ResourceProfilingComponent"]
        self.assertTrue(profiling["show_controls"])
        self.assertEqual(profiling["feature_groups"], ["time_fractions"])
        self.assertEqual(profiling["cluster_method"], "hdbscan")
        self.assertEqual(profiling["n_clusters"], 1)
        self.assertEqual(profiling["min_cluster_size"], 2)
        self.assertEqual(profiling["distance_metric"], "euclidean")
        self.assertEqual(profiling["view_mode"], "graph")

        self.assertEqual(OCHandoverComponent.objects.count(), 1)
        self.assertEqual(ResourceProfilingComponent.objects.count(), 1)
