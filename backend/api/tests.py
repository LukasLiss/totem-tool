"""
Endpoint tests for the playout API (POST /api/playout/ and
POST /api/playout/export-ocel/).

The tiny models are hand-built in the editor JSON shapes
(frontend/src/editors/shared/model-types.ts: OcpnModelFile / OccnModelFile);
the playout itself is covered in depth by totem_lib/tests/playout/.
"""

import json

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

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
