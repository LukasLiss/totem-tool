"""Cancellable, progress-reporting computations.

Protocol
--------
A client that wants to follow or stop a long-running request picks a job id
(any unique token, e.g. a UUID) and sends it in the ``X-Totem-Job-Id``
header. The view wraps its work in :func:`job_scope`; while the request runs

    GET  /api/jobs/?ids=<id>,<id>   -> progress of those jobs
    POST /api/jobs/<id>/cancel/     -> stop the computation

Cancellation is cooperative. The DuckDB connection the job works on is
interrupted (which aborts the running SQL statement, and keeps being
interrupted until the job ends so a statement started afterwards cannot
sneak through), and the progress callback raises :class:`JobCancelled` at
the next report, which unwinds the algorithm. The view answers the original
request with HTTP 499 (``{"code": "cancelled"}``).

The registry is process-local, like the DuckDB registry. Progress and cancel
flags are additionally mirrored through the shared ``results`` file cache, so
a deployment with several worker processes still finds a job whose request is
being served by another worker (with roughly half a second of latency).
"""

from __future__ import annotations

import re
import threading
import time
from contextlib import contextmanager, nullcontext
from typing import Iterable, Optional

from django.core.cache import caches
from rest_framework.response import Response

JOB_ID_HEADER = "X-Totem-Job-Id"
HTTP_499_CLIENT_CLOSED_REQUEST = 499

_JOB_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_FINISHED_TTL = 120.0        # finished jobs stay queryable this long (seconds)
_RUNNING_TTL = 6 * 3600.0    # a job older than this is dropped as a leak
_CACHE_TTL = 6 * 3600
_MIRROR_INTERVAL = 0.5       # seconds between progress writes to the cache
_INTERRUPT_INTERVAL = 0.2    # seconds between repeated DuckDB interrupts
_POLL_INTERVAL = 0.5         # seconds between cross-process cancel checks
_CACHE_PREFIX = "totem_job:"
_CANCEL_PREFIX = "totem_job_cancel:"


class JobCancelled(Exception):
    """Raised inside a computation whose job was cancelled by the client."""


def _cache():
    # The results cache is file based and therefore shared across workers.
    return caches["results"]


def _is_interrupt_error(exc: BaseException) -> bool:
    cls = type(exc).__name__.lower()
    return "interrupt" in cls or "interrupt" in str(exc).lower()


class Job:
    """One tracked computation.

    ``report`` doubles as the progress callback handed to totem_lib (it has
    the ``callback(fraction, message)`` signature); it raises
    :class:`JobCancelled` once the job was cancelled.
    """

    def __init__(self, job_id: Optional[str], user_id, label: str = ""):
        self.id = job_id
        self.user_id = user_id
        self.label = label
        self.started = time.time()
        self.finished_at: Optional[float] = None
        self.status = "running"  # running | done | cancelled | failed
        self.fraction: Optional[float] = None
        self.message = ""
        self._cancel = threading.Event()
        self._done = threading.Event()
        self._conns: list = []
        self._lock = threading.Lock()
        self._last_mirror = 0.0

    # -- progress ---------------------------------------------------------

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    @property
    def running(self) -> bool:
        return self.status == "running"

    def report(self, fraction: Optional[float], message: Optional[str] = None) -> None:
        """Progress callback: record progress, abort when cancelled."""
        if self._cancel.is_set():
            raise JobCancelled(f"Computation {self.label or self.id} was cancelled")
        with self._lock:
            self.fraction = None if fraction is None else max(0.0, min(1.0, float(fraction)))
            if message is not None:
                self.message = message
        self._mirror()

    def check(self) -> None:
        """Raise :class:`JobCancelled` if the job was cancelled."""
        if self._cancel.is_set():
            raise JobCancelled(f"Computation {self.label or self.id} was cancelled")

    # -- connections ------------------------------------------------------

    def attach(self, conn) -> None:
        """Interrupt ``conn`` (a DuckDB connection) when the job is cancelled."""
        with self._lock:
            self._conns.append(conn)
        if self._cancel.is_set():
            self._interrupt_all()

    def detach(self, conn) -> None:
        with self._lock:
            try:
                self._conns.remove(conn)
            except ValueError:
                pass

    @contextmanager
    def watch(self, conn):
        """``attach`` for the duration of a block, then ``detach``."""
        self.attach(conn)
        try:
            yield
        finally:
            self.detach(conn)

    def _interrupt_all(self) -> None:
        with self._lock:
            conns = list(self._conns)
        for conn in conns:
            try:
                conn.interrupt()
            except Exception:
                pass

    # -- lifecycle --------------------------------------------------------

    def cancel(self) -> None:
        if self._cancel.is_set() or not self.running:
            return
        self._cancel.set()
        self._interrupt_all()
        self._mirror(force=True)
        # DuckDB's interrupt only reaches the statement running right now; a
        # statement started afterwards would run to completion. Keep nudging
        # until the computation has unwound.
        threading.Thread(target=self._keep_interrupting, daemon=True).start()

    def _keep_interrupting(self) -> None:
        deadline = time.time() + 600
        while not self._done.wait(_INTERRUPT_INTERVAL) and time.time() < deadline:
            self._interrupt_all()

    def finish(self, status: str) -> None:
        with self._lock:
            if self.status != "running":
                return
            self.status = status
            self.finished_at = time.time()
            if status == "done":
                self.fraction = 1.0
            self._conns.clear()
        self._done.set()
        self._mirror(force=True)

    # -- serialisation ----------------------------------------------------

    def to_dict(self) -> dict:
        with self._lock:
            end = self.finished_at or time.time()
            return {
                "id": self.id,
                "label": self.label,
                "status": self.status,
                "fraction": self.fraction,
                "message": self.message,
                "elapsed_s": round(end - self.started, 3),
            }

    def _mirror(self, force: bool = False) -> None:
        if self.id is None:
            return
        now = time.time()
        if not force and now - self._last_mirror < _MIRROR_INTERVAL:
            return
        self._last_mirror = now
        try:
            _cache().set(
                _CACHE_PREFIX + self.id,
                {**self.to_dict(), "user_id": self.user_id},
                timeout=_CACHE_TTL,
            )
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

_REGISTRY: dict[str, Job] = {}
_REGISTRY_LOCK = threading.Lock()
_poller_started = False


def _prune_locked(now: float) -> None:
    for job_id, job in list(_REGISTRY.items()):
        if job.running:
            if now - job.started > _RUNNING_TTL:
                _REGISTRY.pop(job_id, None)
        elif now - (job.finished_at or now) > _FINISHED_TTL:
            _REGISTRY.pop(job_id, None)


def _poll_cancel_flags() -> None:
    """Pick up cancellations requested through another worker process."""
    while True:
        time.sleep(_POLL_INTERVAL)
        with _REGISTRY_LOCK:
            running = [job for job in _REGISTRY.values() if job.running and not job.cancelled]
        for job in running:
            try:
                if _cache().get(_CANCEL_PREFIX + job.id):
                    job.cancel()
            except Exception:
                pass


def _ensure_poller() -> None:
    global _poller_started
    if _poller_started:
        return
    _poller_started = True
    threading.Thread(target=_poll_cancel_flags, daemon=True).start()


def valid_job_id(job_id) -> bool:
    return bool(job_id) and bool(_JOB_ID_RE.match(str(job_id)))


def register(job_id: str, user_id, label: str = "") -> Job:
    """Create and register a job; a cancel that arrived early is honoured."""
    job = Job(job_id, user_id, label)
    with _REGISTRY_LOCK:
        _prune_locked(time.time())
        _REGISTRY[job_id] = job
    _ensure_poller()
    try:
        if _cache().get(_CANCEL_PREFIX + job_id):
            job.cancel()
    except Exception:
        pass
    job._mirror(force=True)
    return job


def get(job_id: str, user_id) -> Optional[Job]:
    with _REGISTRY_LOCK:
        job = _REGISTRY.get(job_id)
    if job is not None and job.user_id != user_id:
        return None
    return job


def _mirrored(job_id: str, user_id) -> Optional[dict]:
    """The cached copy of a job run by another worker process, if it is the
    caller's own job."""
    try:
        mirrored = _cache().get(_CACHE_PREFIX + job_id)
    except Exception:
        return None
    if not mirrored or mirrored.get("user_id") != user_id:
        return None
    return {k: v for k, v in mirrored.items() if k != "user_id"}


def status_of(job_ids: Iterable[str], user_id) -> dict:
    """Progress of the given jobs; unknown ids map to ``{"status": "unknown"}``."""
    result = {}
    for job_id in job_ids:
        if not valid_job_id(job_id):
            continue
        job = get(job_id, user_id)
        if job is not None:
            result[job_id] = job.to_dict()
            continue
        mirrored = _mirrored(job_id, user_id)
        result[job_id] = mirrored if mirrored else {"id": job_id, "status": "unknown"}
    return result


def cancel(job_id: str, user_id) -> dict:
    """Cancel a job, wherever it runs; a job that has not started yet is
    cancelled as soon as it registers."""
    job = get(job_id, user_id)
    if job is not None:
        job.cancel()
        return job.to_dict()
    mirrored = _mirrored(job_id, user_id)
    try:
        owner = _cache().get(_CACHE_PREFIX + job_id)
    except Exception:
        owner = None
    if owner and owner.get("user_id") != user_id:
        # Someone else's job: pretend not to know it.
        return {"id": job_id, "status": "unknown"}
    try:
        _cache().set(_CANCEL_PREFIX + job_id, True, timeout=3600)
    except Exception:
        pass
    if mirrored:
        if mirrored.get("status") == "running":
            mirrored["status"] = "cancelling"
        return mirrored
    return {"id": job_id, "status": "cancelled"}


# ---------------------------------------------------------------------------
# View helpers
# ---------------------------------------------------------------------------

def job_id_from_request(request) -> Optional[str]:
    job_id = request.headers.get(JOB_ID_HEADER) if hasattr(request, "headers") else None
    if not job_id:
        params = getattr(request, "query_params", None) or getattr(request, "GET", {})
        job_id = params.get("job_id")
    return job_id if valid_job_id(job_id) else None


@contextmanager
def job_scope(request, label: str = ""):
    """Track the computation of a view as a job (when the client asked for it).

    Yields a :class:`Job`. Without a job id in the request the job is not
    registered and only records progress locally, so views can always pass
    ``job.report`` as the progress callback and ``job`` to ``_with_ocel_db``.
    Any exception raised after a cancellation (including DuckDB's interrupt
    error) is turned into :class:`JobCancelled`.
    """
    job_id = job_id_from_request(request)
    user = getattr(request, "user", None)
    user_id = getattr(user, "pk", None)
    job = register(job_id, user_id, label) if job_id else Job(None, user_id, label)
    try:
        yield job
    except JobCancelled:
        job.finish("cancelled")
        raise
    except BaseException as exc:
        if job.cancelled:
            job.finish("cancelled")
            raise JobCancelled(str(exc)) from exc
        job.finish("failed")
        raise
    else:
        job.finish("done")


def watch_connection(job: Optional[Job], conn):
    """Context manager attaching ``conn`` to ``job`` (no-op without a job)."""
    if job is None:
        return nullcontext()
    return job.watch(conn)


def cancelled_response() -> Response:
    return Response(
        {"error": "Computation cancelled", "code": "cancelled"},
        status=HTTP_499_CLIENT_CLOSED_REQUEST,
    )
