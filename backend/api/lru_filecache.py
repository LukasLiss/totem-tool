"""
LRU eviction for the filesystem result cache — Epic #71.

Django's :class:`~django.core.cache.backends.filebased.FileBasedCache` evicts a
**random** selection of entries when ``MAX_ENTRIES`` is reached
(``random.sample`` in its ``_cull``). For expensive analysis results that is a
poor policy: a hot result can be thrown away while a stale one survives.

:class:`LRUFileBasedCache` swaps the policy for least-recently-used, using each
cache file's mtime as its "last used" timestamp:

* ``set()`` writes the file, so a new entry's mtime is *now* (inherited
  behaviour, no override needed).
* ``get()`` bumps the file's mtime on a hit, marking it recently used.
* ``_cull()`` deletes the oldest-mtime files first instead of a random sample.

Everything else — on-disk format, ``MAX_ENTRIES`` semantics, ``clear()`` — is
unchanged, so ``cache_utils`` and the Settings UI need no modification.
"""

import os

from django.core.cache.backends.filebased import FileBasedCache

# Sentinel so a cached ``None`` is still recognised as a hit (using the caller's
# ``default`` for that check would misread a stored ``None`` as a miss).
_MISS = object()


class LRUFileBasedCache(FileBasedCache):
    """``FileBasedCache`` that evicts least-recently-used entries."""

    def get(self, key, default=None, version=None):
        value = super().get(key, _MISS, version)
        if value is _MISS:
            return default
        # Mark as recently used. Best-effort: the file may have been culled or
        # removed by another process between the read and here, and a failure to
        # record the access must never fail the request.
        try:
            os.utime(self._key_to_file(key, version), None)
        except OSError:
            pass
        return value

    def _cull(self):
        """Remove the least-recently-used entries once ``MAX_ENTRIES`` is hit.

        Mirrors the superclass contract (same trigger condition and
        ``CULL_FREQUENCY`` meaning, including ``0`` -> purge everything) but
        selects by oldest mtime rather than at random.
        """
        filelist = self._list_cache_files()
        num_entries = len(filelist)
        if num_entries < self._max_entries:
            return  # no culling required
        if self._cull_frequency == 0:
            return self.clear()
        # Oldest access time first. ``or 1`` guarantees forward progress when
        # num_entries < cull_frequency, where int() would otherwise floor to 0
        # and let the cache grow past its cap.
        num_to_delete = int(num_entries / self._cull_frequency) or 1
        try:
            filelist.sort(key=os.path.getmtime)
        except OSError:
            # A concurrent delete makes the sort unreliable; fall back to the
            # superclass' random policy rather than skipping the cull entirely.
            return super()._cull()
        for fname in filelist[:num_to_delete]:
            self._delete(fname)
