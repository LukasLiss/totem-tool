"""Importing case-centric logs (XES, plain CSV) through a column mapping.

Covers the three endpoints the import dialog uses: ``files/preview/`` (the
columns and first rows of the file), ``files/parse-timestamps/`` (does a
timestamp format fit) and ``files/`` with a ``mapping``.
"""

import json
import os
import shutil
import tempfile

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from .models import EventLog
from .views._ocel_db import _close_ocel_db

XES_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "totem_lib", "example_data", "order_handling_case_log.xes"
)

CSV_TEXT = (
    "Case ID;Activity;Start Time;Resource\n"
    "c1;Register;01.03.2024 09:00;Alice\n"
    "c1;Approve;01.03.2024 10:30;Bob\n"
    "c2;Register;02.03.2024 08:00;Alice\n"
).encode()

CSV_MAPPING = {
    "delimiter": ";",
    "columns": [
        {"column": "Case ID", "role": "object_id", "object_type": "Claim"},
        {"column": "Activity", "role": "activity"},
        {"column": "Start Time", "role": "timestamp", "format": "dd.MM.yyyy HH:mm"},
        {"column": "Resource", "role": "resource"},
    ],
}


class FlatLogImportTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="flat-user")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media, ignore_errors=True)
        media_override = self.settings(MEDIA_ROOT=self.media)
        media_override.enable()
        self.addCleanup(media_override.disable)
        with open(XES_PATH, "rb") as handle:
            self.xes = handle.read()

    def _upload(self, name, content, mapping=None):
        data = {"file": SimpleUploadedFile(name, content)}
        if mapping is not None:
            data["mapping"] = json.dumps(mapping)
        response = self.client.post("/api/files/", data, format="multipart")
        if response.status_code == status.HTTP_201_CREATED:
            self.addCleanup(_close_ocel_db, int(response.data["id"]))
        return response

    # -- preview ------------------------------------------------------------

    def test_preview_of_an_xes_file(self):
        response = self.client.post(
            "/api/files/preview/",
            {"file": SimpleUploadedFile("blob", self.xes), "filename": "orders.xes"},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["format"], "xes")
        self.assertEqual(response.data["kind"], "flat")
        roles = {c["name"]: c["suggestion"]["role"] for c in response.data["columns"]}
        self.assertEqual(roles["case:concept:name"], "object_id")
        self.assertEqual(roles["concept:name"], "activity")
        self.assertEqual(roles["time:timestamp"], "timestamp")
        self.assertEqual(len(response.data["rows"]), 8)
        # Nothing is stored by a preview.
        self.assertFalse(EventLog.objects.exists())

    def test_preview_of_a_truncated_sample(self):
        response = self.client.post(
            "/api/files/preview/",
            {
                "file": SimpleUploadedFile("blob", self.xes[: len(self.xes) // 2]),
                "filename": "orders.xes",
                "truncated": "true",
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertTrue(response.data["truncated"])
        self.assertGreater(len(response.data["rows"]), 0)

    def test_preview_rejects_other_formats(self):
        response = self.client.post(
            "/api/files/preview/",
            {"file": SimpleUploadedFile("blob", b"{}"), "filename": "log.json"},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_preview_reports_unreadable_xes(self):
        response = self.client.post(
            "/api/files/preview/",
            {"file": SimpleUploadedFile("blob", b"<log><trace><event>"), "filename": "x.xes"},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_parse_timestamps(self):
        response = self.client.post(
            "/api/files/parse-timestamps/",
            {"values": ["01.03.2024 09:00", "nope"], "format": "dd.MM.yyyy HH:mm"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["results"], ["2024-03-01T09:00:00+00:00", None])

    # -- upload -------------------------------------------------------------

    def test_xes_upload_without_mapping_uses_the_suggestion(self):
        response = self._upload("orders.xes", self.xes)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        stats = self.client.get(f"/api/files/{response.data['id']}/object_types/")
        self.assertEqual(stats.status_code, status.HTTP_200_OK)

    def test_csv_upload_with_mapping(self):
        response = self._upload("claims.csv", CSV_TEXT, CSV_MAPPING)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        event_log = EventLog.objects.get(pk=response.data["id"])
        self.assertTrue(event_log.file.name.endswith(".duckdb"))
        types = self.client.get(f"/api/files/{event_log.pk}/object_types/").data
        self.assertIn("Claim", json.dumps(types))
        self.assertIn("resource", json.dumps(types))

    def test_invalid_mapping_is_rejected_before_anything_is_stored(self):
        bad = {"columns": [{"column": "Activity", "role": "activity"}]}
        response = self._upload("claims.csv", CSV_TEXT, bad)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("object id", response.data["error"])
        self.assertFalse(EventLog.objects.exists())

    def test_wrong_timestamp_format_explains_itself(self):
        mapping = json.loads(json.dumps(CSV_MAPPING))
        mapping["columns"][2]["format"] = "yyyy-MM-dd"
        response = self._upload("claims.csv", CSV_TEXT, mapping)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("01.03.2024 09:00", response.data["error"])
        self.assertFalse(EventLog.objects.exists())
        # The rejected upload leaves no files behind.
        leftovers = [f for _, _, files in os.walk(self.media) for f in files]
        self.assertEqual(leftovers, [])

    def test_mapping_on_a_non_flat_format_is_rejected(self):
        response = self._upload("log.json", b"{}", CSV_MAPPING)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
