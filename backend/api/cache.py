"""
Centralized result-caching service for the totem backend.

Caches only serialized response payloads (plain dicts/lists), never raw
data-model objects. This makes the cache layer completely agnostic to the
underlying data model (ObjectCentricEventLog, OcelDuckDB, etc.).

Usage in views::

    from api.cache import result_cache

    # Try cache first (respects ?use_cache query param)
    cached = result_cache.get(request, "discover_totem", file_pk=pk)
    if cached is not None:
        return Response(cached)

    # ... compute result ...

    result_cache.set("discover_totem", result, file_pk=pk)

    # Invalidate all cached results for a file
    result_cache.invalidate_file(file_pk=pk)
"""

import json
import logging
from hashlib import sha1
from django.core.cache import cache
from django.conf import settings

logger = logging.getLogger(__name__)


class ResultCache:
    """
    Thin wrapper around Django's cache framework with:
    - Deterministic, content-addressed keys
    - Per-request opt-out via ``?use_cache=false``
    - Scoped invalidation by file PK
    - A registry of active keys per file (for bulk invalidation)
    """

    # Prefix for all keys managed by this service
    PREFIX = "totem"
    # Key that stores the set of cache keys associated with a file PK
    REGISTRY_PREFIX = "totem_registry"

    def _build_key(self, operation: str, file_pk: int, **params) -> str:
        """Deterministic cache key: ``totem:{operation}:{file_pk}:{param_hash}``"""
        param_str = json.dumps(params, sort_keys=True, default=str)
        param_hash = sha1(param_str.encode()).hexdigest()[:12]
        return f"{self.PREFIX}:{operation}:{file_pk}:{param_hash}"

    def _registry_key(self, file_pk: int) -> str:
        return f"{self.REGISTRY_PREFIX}:{file_pk}"

    def _register(self, cache_key: str, file_pk: int) -> None:
        """Track a cache key against a file PK for later bulk invalidation."""
        reg_key = self._registry_key(file_pk)
        keys: set = cache.get(reg_key) or set()
        keys.add(cache_key)
        timeout = getattr(settings, "TOTEM_CACHE_TIMEOUT", 3600)
        cache.set(reg_key, keys, timeout=timeout)

    @staticmethod
    def _should_use_cache(request) -> bool:
        """Check if the request allows cached results."""
        if request is None:
            return True
        return request.query_params.get("use_cache", "true").lower() != "false"

    def get(self, request, operation: str, *, file_pk: int, **params):
        """
        Attempt to retrieve a cached result.

        Returns the cached value, or None on miss / opt-out.
        """
        if not self._should_use_cache(request):
            logger.debug("Cache bypass requested for %s (file %s)", operation, file_pk)
            return None

        key = self._build_key(operation, file_pk, **params)
        result = cache.get(key)
        if result is not None:
            logger.debug("Cache HIT: %s", key)
        else:
            logger.debug("Cache MISS: %s", key)
        return result

    def set(self, operation: str, value, *, file_pk: int, **params) -> None:
        """Store a computed result in the cache."""
        key = self._build_key(operation, file_pk, **params)
        timeout = getattr(settings, "TOTEM_CACHE_TIMEOUT", 3600)
        cache.set(key, value, timeout=timeout)
        self._register(key, file_pk)
        logger.debug("Cache SET: %s (timeout=%ds)", key, timeout)

    def invalidate_file(self, file_pk: int) -> None:
        """Remove all cached results associated with a given file PK."""
        reg_key = self._registry_key(file_pk)
        keys: set = cache.get(reg_key) or set()
        for key in keys:
            cache.delete(key)
            logger.debug("Cache DELETE: %s", key)
        cache.delete(reg_key)
        logger.info("Invalidated %d cached entries for file %s", len(keys), file_pk)

    def clear_all(self) -> None:
        """Flush the entire cache. Use sparingly."""
        cache.clear()
        logger.info("Cache cleared entirely")


# Module-level singleton — import this in views
result_cache = ResultCache()
