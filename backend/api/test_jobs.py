"""Tests for cancellable computations (``api/jobs.py``) and the endpoints
that expose them, plus the large-log time window suggestion."""

import threading
import time
from types import SimpleNamespace
from unittest.mock import patch

import duckdb
from django.contrib.auth.models import User
from django.core.cache import caches
from django.test import TestCase
from rest_framework.test import APIClient

from . import jobs
from .jobs import Job, JobCancelled, job_scope
from .models import EventLog, Project


class JobUnitTests(TestCase):
    def setUp(self):
        caches["results"].clear()
        with jobs._REGISTRY_LOCK:
            jobs._REGISTRY.clear()

    def test_report_records_progress_and_raises_after_cancel(self):
        job = Job("job-unit-1", user_id=1, label="Test")
        job.report(0.25, "Working")
        self.assertEqual(job.to_dict()["fraction"], 0.25)
        self.assertEqual(job.to_dict()["message"], "Working")
        job.cancel()
        with self.assertRaises(JobCancelled):
            job.report(0.5, "More")
        with self.assertRaises(JobCancelled):
            job.check()

    def test_cancel_interrupts_running_duckdb_statement(self):
        conn = duckdb.connect()
        job = Job("job-unit-2", user_id=1, label="Slow query")
        job.attach(conn)
        outcome = {}

        def run():
            try:
                # A cross join big enough to take a while without the interrupt.
                conn.execute(
                    "SELECT COUNT(*) FROM range(200000) a, range(200000) b WHERE a.range + b.range = -1"
                ).fetchone()
                outcome["result"] = "finished"
            except Exception as exc:  # duckdb.InterruptException
                outcome["result"] = type(exc).__name__

        worker = threading.Thread(target=run)
        started = time.time()
        worker.start()
        time.sleep(0.3)
        job.cancel()
        worker.join(timeout=20)
        job.finish("cancelled")
        self.assertFalse(worker.is_alive(), "the statement was not interrupted")
        self.assertIn("interrupt", outcome["result"].lower())
        self.assertLess(time.time() - started, 15)

    def test_job_scope_without_header_is_unregistered(self):
        request = SimpleNamespace(headers={}, query_params={}, user=SimpleNamespace(pk=1))
        with job_scope(request, "x") as job:
            self.assertIsNone(job.id)
            job.report(0.5, "half")
        self.assertEqual(job.status, "done")
        self.assertEqual(jobs.status_of(["anything-at-all"], 1)["anything-at-all"]["status"], "unknown")

    def test_job_scope_registers_and_turns_errors_after_cancel_into_cancelled(self):
        request = SimpleNamespace(
            headers={"X-Totem-Job-Id": "job-scope-1"}, query_params={}, user=SimpleNamespace(pk=7)
        )
        with self.assertRaises(JobCancelled):
            with job_scope(request, "Scoped") as job:
                self.assertEqual(jobs.status_of(["job-scope-1"], 7)["job-scope-1"]["status"], "running")
                job.cancel()
                raise RuntimeError("Query interrupted by user")
        self.assertEqual(jobs.status_of(["job-scope-1"], 7)["job-scope-1"]["status"], "cancelled")
        # Another user cannot see the job.
        self.assertEqual(jobs.status_of(["job-scope-1"], 8)["job-scope-1"]["status"], "unknown")

    def test_cancel_before_registration_is_honoured(self):
        jobs.cancel("job-early-1", user_id=3)
        job = jobs.register("job-early-1", user_id=3, label="Late starter")
        self.assertTrue(job.cancelled)
        with self.assertRaises(JobCancelled):
            job.report(0.1)


class JobEndpointTests(TestCase):
    def setUp(self):
        caches["results"].clear()
        with jobs._REGISTRY_LOCK:
            jobs._REGISTRY.clear()
        self.user = User.objects.create_user("alice", password="pw")
        self.other = User.objects.create_user("bob", password="pw")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_status_and_cancel_endpoints(self):
        job = jobs.register("job-endpoint-1", self.user.pk, "Endpoint test")
        job.report(0.4, "Working")

        response = self.client.get("/api/jobs/", {"ids": "job-endpoint-1,unknown-id-xyz"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["job-endpoint-1"]["status"], "running")
        self.assertEqual(response.data["job-endpoint-1"]["fraction"], 0.4)
        self.assertEqual(response.data["unknown-id-xyz"]["status"], "unknown")

        response = self.client.post("/api/jobs/job-endpoint-1/cancel/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(job.cancelled)

    def test_other_users_cannot_cancel(self):
        job = jobs.register("job-endpoint-2", self.other.pk, "Bob's job")
        response = self.client.post("/api/jobs/job-endpoint-2/cancel/")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(job.cancelled)
        response = self.client.get("/api/jobs/", {"ids": "job-endpoint-2"})
        self.assertEqual(response.data["job-endpoint-2"]["status"], "unknown")

    def test_invalid_job_id_rejected(self):
        response = self.client.post("/api/jobs/bad%20id/cancel/")
        self.assertEqual(response.status_code, 400)

    def test_requires_authentication(self):
        anonymous = APIClient()
        self.assertEqual(anonymous.get("/api/jobs/", {"ids": "x"}).status_code, 401)


class CancelledComputationViewTests(TestCase):
    """A cancelled job makes the computing view answer 499."""

    def setUp(self):
        caches["results"].clear()
        with jobs._REGISTRY_LOCK:
            jobs._REGISTRY.clear()
        self.user = User.objects.create_user("carol", password="pw")
        self.project = Project.objects.create(name="p")
        self.project.users.add(self.user)
        self.log = EventLog.objects.create(project=self.project, file="legacy/does-not-matter.duckdb")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_statistics_returns_499_when_cancelled_while_computing(self):
        conn = duckdb.connect()
        conn.execute("CREATE TABLE events (event_id VARCHAR, activity VARCHAR, timestamp_unix BIGINT)")
        conn.execute("CREATE TABLE objects (obj_id VARCHAR, obj_type VARCHAR)")
        conn.execute("CREATE TABLE event_object (event_id VARCHAR, obj_id VARCHAR, qualifier VARCHAR)")
        fake_db = SimpleNamespace(conn=conn, lock=threading.RLock())

        def counts(fp, db):
            jobs.cancel("job-view-1", self.user.pk)
            db.conn.execute("SELECT 1")
            raise RuntimeError("Query interrupted by user")

        from contextlib import contextmanager

        @contextmanager
        def fake_with_db(user_file, job=None):
            if job is not None:
                job.attach(conn)
            yield fake_db

        with patch("api.views.event_log._with_ocel_db", fake_with_db), patch(
            "api.views.event_log._filtered_event_counts", counts
        ):
            response = self.client.get(
                f"/api/files/{self.log.pk}/statistics/", HTTP_X_TOTEM_JOB_ID="job-view-1"
            )
        self.assertEqual(response.status_code, 499)
        self.assertEqual(response.data["code"], "cancelled")
        self.assertEqual(jobs.status_of(["job-view-1"], self.user.pk)["job-view-1"]["status"], "cancelled")


class SuggestedTimeWindowTests(TestCase):
    def setUp(self):
        caches["results"].clear()
        self.user = User.objects.create_user("dave", password="pw")
        self.project = Project.objects.create(name="p2")
        self.project.users.add(self.user)
        self.log = EventLog.objects.create(project=self.project, file="legacy/window.duckdb")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        conn = duckdb.connect()
        conn.execute("CREATE TABLE events (event_id VARCHAR, activity VARCHAR, timestamp_unix BIGINT)")
        conn.execute(
            "INSERT INTO events SELECT 'e' || i, 'a', 1000 + i * 10 FROM range(100) t(i)"
        )
        self.db = SimpleNamespace(conn=conn, lock=threading.RLock())

    def _with_db(self):
        from contextlib import contextmanager

        db = self.db

        @contextmanager
        def fake(user_file, job=None):
            yield db

        return patch("api.views.event_log._with_ocel_db", fake)

    def test_window_covers_first_n_events(self):
        with self._with_db():
            response = self.client.get(
                f"/api/files/{self.log.pk}/suggested_time_window/", {"max_events": 25}
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["needed"])
        self.assertEqual(response.data["total_events"], 100)
        self.assertEqual(response.data["after"], 1000)
        self.assertEqual(response.data["before"], 1000 + 24 * 10)
        self.assertEqual(response.data["selected_events"], 25)

    def test_small_log_needs_no_window(self):
        with self._with_db():
            response = self.client.get(
                f"/api/files/{self.log.pk}/suggested_time_window/", {"max_events": 100}
            )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["needed"])
        self.assertIsNone(response.data["after"])

    def test_rejects_non_integer_limit(self):
        with self._with_db():
            response = self.client.get(
                f"/api/files/{self.log.pk}/suggested_time_window/", {"max_events": "many"}
            )
        self.assertEqual(response.status_code, 400)
