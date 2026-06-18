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
    event_log_id: int, endpoint: str, params: dict | None = None
) -> str:
    """
    Build a deterministic, collision-resistant cache key.

    Key structure::

        totem_result:<sha256_hex[:16]>

    Hash input: canonical JSON of
    ``{"event_log_id": ..., "endpoint": ..., "params": ...}``

    ``sort_keys=True`` and compact separators guarantee that two dicts with
    the same content but different insertion order produce the same key.
    """
    canonical = json.dumps(
        {
            "event_log_id": int(event_log_id),
            "endpoint": endpoint,
            "params": params or {},
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(canonical.encode()).hexdigest()[:16]
    return f"{_PREFIX}:{digest}"


# ---------------------------------------------------------------------------
# Get / Set helpers
# ---------------------------------------------------------------------------

def get_cached_result(
    event_log_id: int, endpoint: str, params: dict | None = None
):
    """Return the cached result or ``None``."""
    key = make_cache_key(event_log_id, endpoint, params)
    return RESULTS_CACHE.get(key)


def set_cached_result(
    event_log_id: int, endpoint: str, result, params: dict | None = None
):
    """Store *result* in the filesystem cache and track the key for invalidation."""
    key = make_cache_key(event_log_id, endpoint, params)
    RESULTS_CACHE.set(key, result)
    _track_key_for_log(event_log_id, key)


# ---------------------------------------------------------------------------
# Per-event-log key index  (used by invalidation, #75)
# ---------------------------------------------------------------------------

def _track_key_for_log(event_log_id: int, key: str):
    """Maintain a set of cache keys associated with an event_log_id."""
    index_key = f"{_PREFIX}:index:{int(event_log_id)}"
    existing: set = RESULTS_CACHE.get(index_key) or set()
    existing.add(key)
    RESULTS_CACHE.set(index_key, existing)


def invalidate_log_cache(event_log_id: int):
    """Delete **all** cached results for a given event log."""
    index_key = f"{_PREFIX}:index:{int(event_log_id)}"
    keys: set = RESULTS_CACHE.get(index_key) or set()
    for key in keys:
        RESULTS_CACHE.delete(key)
    RESULTS_CACHE.delete(index_key)


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
