"""
Filesystem-backed result cache utilities — Epic #71 (Request Caching).

Provides deterministic cache-key generation, get/set helpers, per-event-log
invalidation, and statistics/clear functions for the Settings UI.

All results are stored in the ``"results"`` Django cache alias configured in
``settings.py`` as a ``FileBasedCache`` with a configurable ``MAX_ENTRIES``.
"""

import hashlib
import json
import os

from django.conf import settings
from django.core.cache import caches

# ---------------------------------------------------------------------------
# Cache alias
# ---------------------------------------------------------------------------
RESULTS_CACHE = caches["results"]

# Namespace prefix so keys don't collide with other cache users.
_PREFIX = "totem_result"


# ---------------------------------------------------------------------------
# Key generation  (#72)
# ---------------------------------------------------------------------------

def make_cache_key(
    event_log_id: int,
    endpoint: str,
    params: dict | None = None,
    version: str | None = None,
) -> str:
    """
    Build a deterministic, collision-resistant cache key.

    Key structure::

        totem_result:<sha256_hex[:16]>

    Hash input: canonical JSON of
    ``{"event_log_id": ..., "endpoint": ..., "params": ..., "version": ...}``

    ``version`` is a token that changes whenever the underlying file is
    replaced (see :func:`_log_version`), so a replaced log naturally misses
    the cache instead of serving stale results — no explicit invalidation
    needed.

    ``sort_keys=True`` and compact separators guarantee that two dicts with
    the same content but different insertion order produce the same key.
    """
    canonical = json.dumps(
        {
            "event_log_id": int(event_log_id),
            "endpoint": endpoint,
            "params": params or {},
            "version": version or "",
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(canonical.encode()).hexdigest()[:16]
    return f"{_PREFIX}:{digest}"


def _log_version(event_log) -> str:
    """
    Return a token that changes when the event log's file is replaced.

    Combines the file's storage mtime and size. Replacing the file on an
    existing ``EventLog`` (same PK) changes at least one of these, yielding a
    new cache key and therefore a natural miss. Falls back to ``"0"`` if the
    file is missing or the storage backend can't stat it (never blocks a
    request).
    """
    try:
        storage = event_log.file.storage
        name = event_log.file.name
        mtime = storage.get_modified_time(name).timestamp()
        size = storage.size(name)
        return f"{mtime}:{size}"
    except Exception:
        return "0"


# ---------------------------------------------------------------------------
# Get / Set helpers
# ---------------------------------------------------------------------------

def get_cached_result(event_log, endpoint: str, params: dict | None = None):
    """Return the cached result for *event_log*'s current file version, or ``None``.

    *event_log* is an ``EventLog`` instance; the key is scoped to its PK and
    the current file mtime+size, so a replaced file misses automatically.
    """
    key = make_cache_key(event_log.pk, endpoint, params, _log_version(event_log))
    return RESULTS_CACHE.get(key)


def set_cached_result(event_log, endpoint: str, result, params: dict | None = None):
    """Store *result* keyed by *event_log*'s current file version.

    No per-log key index is kept: correctness comes from the version token in
    the key (see :func:`_log_version`). A replaced file gets a new key, and a
    deleted log's PK is never reused, so stale results can't be served. Orphaned
    entries are reclaimed by the cache's own ``MAX_ENTRIES`` culling.
    """
    key = make_cache_key(event_log.pk, endpoint, params, _log_version(event_log))
    RESULTS_CACHE.set(key, result)


# ---------------------------------------------------------------------------
# Statistics & clear  (#76)
# ---------------------------------------------------------------------------

def get_cache_stats() -> dict:
    """Return cache-size information for the Settings UI."""
    cache_dir = str(settings.RESULT_CACHE_DIR)
    if not os.path.isdir(cache_dir):
        return {
            "num_files": 0,
            "total_size_bytes": 0,
            "total_size_mb": 0.0,
            "max_entries": settings.RESULT_CACHE_MAX_ENTRIES,
        }
    total = 0
    count = 0
    for dirpath, _, filenames in os.walk(cache_dir):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            total += os.path.getsize(fp)
            count += 1
    return {
        "num_files": count,
        "total_size_bytes": total,
        "total_size_mb": round(total / (1024 * 1024), 2),
        "max_entries": settings.RESULT_CACHE_MAX_ENTRIES,
    }


def clear_all_cache():
    """Nuke the entire results cache."""
    RESULTS_CACHE.clear()
