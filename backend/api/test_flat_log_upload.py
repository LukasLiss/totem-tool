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
from .views._ocel_db import _OCEL_DB_REGISTRY, _close_ocel_db

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

    def test_parse_timestamps_in_a_time_zone(self):
        response = self.client.post(
            "/api/files/parse-timestamps/",
            {"values": ["01.07.2024 09:00"], "format": "dd.MM.yyyy HH:mm", "timezone": "Europe/Berlin"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["results"], ["2024-07-01T09:00:00+02:00"])

    def test_parse_timestamps_rejects_an_unknown_time_zone(self):
        response = self.client.post(
            "/api/files/parse-timestamps/",
            {"values": ["2024-01-01"], "format": "auto", "timezone": "Nowhere/Land"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Unknown time zone", response.data["error"])

    def test_parse_timestamps_resolves_auto_and_flags_ambiguity(self):
        response = self.client.post(
            "/api/files/parse-timestamps/",
            {"values": ["03/04/2024 10:00:00", "05/06/2024 11:00:00"], "format": "auto"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["format"], "dd/MM/yyyy HH:mm:ss")
        self.assertEqual(response.data["ambiguous_with"][0]["format"], "MM/dd/yyyy HH:mm:ss")

    def test_preview_detects_and_accepts_an_encoding(self):
        content = "Fall;Tätigkeit;Zeit\nc1;Prüfung;2024-01-01\n".encode("cp1252")
        response = self.client.post(
            "/api/files/preview/",
            {"file": SimpleUploadedFile("blob", content), "filename": "x.csv"},
            format="multipart",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["encoding"], "windows-1252")
        self.assertEqual(response.data["columns"][1]["name"], "Tätigkeit")
        bad = self.client.post(
            "/api/files/preview/",
            {"file": SimpleUploadedFile("blob", content), "filename": "x.csv", "encoding": "klingon"},
            format="multipart",
        )
        self.assertEqual(bad.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Unknown text encoding", bad.data["error"])

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

    def test_upload_reports_skipped_rows(self):
        content = CSV_TEXT + "c3;Register;2024-03-05 10:00;Alice\n".encode()
        response = self._upload("claims.csv", content, CSV_MAPPING)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        report = response.data["import_report"]
        self.assertEqual(report["events"], 3)
        self.assertEqual(report["skipped_bad_timestamp"], 1)
        self.assertEqual(report["bad_timestamp_example"], "2024-03-05 10:00")

    def test_windows_1252_upload_keeps_umlauts(self):
        content = "Case ID;Activity;Start Time;Resource\nc1;Prüfung;01.03.2024 09:00;Jürgen\n".encode("cp1252")
        mapping = json.loads(json.dumps(CSV_MAPPING))
        mapping["encoding"] = "windows-1252"
        response = self._upload("claims.csv", content, mapping)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        db = _OCEL_DB_REGISTRY[int(response.data["id"])]
        self.assertEqual(db.conn.execute("SELECT activity FROM events").fetchall(), [("Prüfung",)])
        self.assertEqual(
            db.conn.execute("SELECT obj_id FROM objects WHERE obj_type = 'resource'").fetchall(),
            [("Jürgen",)],
        )

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
