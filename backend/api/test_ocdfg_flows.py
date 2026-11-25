"""The OC-DFG animation endpoint (/api/new-ocdfg/flows/).

It returns the individual directly-follows steps behind /api/new-ocdfg/; the
tests check that the steps add up to that endpoint's arcs, that the filters
reach it the same way, and the access checks.
"""

import os
import shutil
import tempfile
from collections import Counter

import duckdb
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APITestCase
from totem_lib.ocel.ocel_duckdb import OcelDuckDB, create_ocel_schema

from . import views
from .models import EventLog, Project

_MEDIA_ROOT = tempfile.mkdtemp(prefix="totem-test-ocdfg-flows-")


def _write_log(path: str) -> None:
    """An order with two items.

    o1 (order): place@0 -> pack@100 -> ship@100 (a 0 s step)
    i1 (item):  place@0 -> pick@50 -> pack@100
    i2 (item):  place@0 -> pack@100
    """
    conn = duckdb.connect(":memory:")
    create_ocel_schema(conn, [], [])
    conn.executemany(
        "INSERT INTO events VALUES (?, ?, ?)",
        [("e1", "place", 0), ("e2", "pick", 50), ("e3", "pack", 100), ("e4", "ship", 100)],
    )
    conn.executemany(
        "INSERT INTO objects VALUES (?, ?)",
        [("o1", "order"), ("i1", "item"), ("i2", "item")],
    )
    conn.executemany(
        "INSERT INTO event_object VALUES (?, ?, NULL)",
        [
            ("e1", "o1"), ("e1", "i1"), ("e1", "i2"),
            ("e2", "i1"),
            ("e3", "o1"), ("e3", "i1"), ("e3", "i2"),
            ("e4", "o1"),
        ],
    )
    db = OcelDuckDB._from_prepared_connection(conn, [], [])
    db.save(path)
    db.close()


def _steps(payload):
    acts = payload["activities"]
    types = payload["object_types"]
    obj_types = payload["objects"]["type"]
    f = payload["flows"]
    return [
        (types[obj_types[o]], acts[s], acts[t], start, dur)
        for o, s, t, start, dur in zip(f["object"], f["source"], f["target"], f["start"], f["duration"])
    ]


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class OcdfgFlowsEndpointTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(_MEDIA_ROOT, ignore_errors=True)

    def setUp(self):
        cache.clear()
        views._OCEL_DB_REGISTRY.clear()
        views._OCEL_OBJECT_TYPES_REGISTRY.clear()

        self.user = User.objects.create_user("flows-user", password="pw")
        self.other = User.objects.create_user("flows-other", password="pw")
        self.project = Project.objects.create(name="flows-project")
        self.project.users.add(self.user)

        filename = f"flows-log-{self._testMethodName}.duckdb"
        os.makedirs(_MEDIA_ROOT, exist_ok=True)
        _write_log(os.path.join(_MEDIA_ROOT, filename))
        self.log = EventLog.objects.create(project=self.project, file=filename)
        self.client.force_authenticate(self.user)

    def _flows(self, **params):
        response = self.client.get("/api/new-ocdfg/flows/", {"file_id": self.log.pk, **params})
        self.assertEqual(response.status_code, 200, getattr(response, "data", None))
        return response.json()

    def _dfg_arc_weights(self, **params):
        response = self.client.get("/api/new-ocdfg/", {"file_id": self.log.pk, **params})
        self.assertEqual(response.status_code, 200, getattr(response, "data", None))
        weights = {}
        for link in response.json()["dfg"]["links"]:
            if str(link["source"]).startswith(("__start__:", "__end__:")):
                continue
            if str(link["target"]).startswith(("__start__:", "__end__:")):
                continue
            weights[(link["key"], link["source"], link["target"])] = link["weight"]
        return weights

    def test_steps(self):
        payload = self._flows()
        self.assertEqual(
            sorted(_steps(payload)),
            sorted([
                ("order", "place", "pack", 0, 100),
                ("order", "pack", "ship", 100, 0),
                ("item", "place", "pick", 0, 50),
                ("item", "pick", "pack", 50, 50),
                ("item", "place", "pack", 0, 100),
            ]),
        )
        self.assertEqual(payload["total_objects"], 3)
        self.assertIsNone(payload["objects"]["variant_rank"])

    def test_steps_add_up_to_the_graph_endpoint(self):
        counts = Counter((t, s, g) for t, s, g, _, _ in _steps(self._flows()))
        self.assertEqual(dict(counts), self._dfg_arc_weights())

    def test_filters_reach_both_endpoints_alike(self):
        for params in (
            {"object_types": "order"},
            {"activities": "place,pack"},
            {"after": 0, "before": 60},
        ):
            with self.subTest(params=params):
                counts = Counter((t, s, g) for t, s, g, _, _ in _steps(self._flows(**params)))
                self.assertEqual(dict(counts), self._dfg_arc_weights(**params))

    def test_variant_ranks(self):
        payload = self._flows(variant_ranks=1)
        ranks = payload["objects"]["variant_rank"]
        self.assertEqual(len(ranks), payload["total_objects"])
        self.assertTrue(all(r >= 1 for r in ranks))

    def test_missing_file_id(self):
        response = self.client.get("/api/new-ocdfg/flows/")
        self.assertEqual(response.status_code, 400)

    def test_other_users_log_is_not_found(self):
        self.client.force_authenticate(self.other)
        response = self.client.get("/api/new-ocdfg/flows/", {"file_id": self.log.pk})
        self.assertEqual(response.status_code, 404)

    def test_requires_login(self):
        self.client.force_authenticate(None)
        response = self.client.get("/api/new-ocdfg/flows/", {"file_id": self.log.pk})
        self.assertIn(response.status_code, (401, 403))
