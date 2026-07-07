"""API tests for the OCPN discovery endpoint."""

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
        views._OCEL_DB_LOCKS.clear()

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
