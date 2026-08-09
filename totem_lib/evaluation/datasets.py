"""
Manifest of the real OCEL logs used for runtime evaluation.

Every log here is a published dataset from https://www.ocel-standard.org/event-logs/overview/ ,
used as-is: no sampling, no synthetic logs, no cutting down to size. A log's "size"
throughout the evaluation is its **number of events**.

Logs
----

| name                  | events    | where it lives              | source                 |
|-----------------------|-----------|-----------------------------|------------------------|
| `ocel2-p2p`           |    14,671 | `test_data/small/` (in git) | 10.5281/zenodo.8412919 |
| `order-management`    |    21,008 | `test_data/small/` (in git) | 10.5281/zenodo.8337463 |
| `container_logistics` |    35,372 | `test_data/small/` (in git) | 10.5281/zenodo.8289899 |

All three span only 14.7k-35.4k events. A larger log would make runtime-vs-events plots
far more informative, but the obvious candidate is currently blocked - see below.

Blocked: Age of Empires 2 (2,372,505 events)
-------------------------------------------

https://doi.org/10.5281/zenodo.13365584 is the one dataset on ocel-standard.org large
enough to stretch the event axis by an order of magnitude, and it downloads and verifies
fine, but it cannot currently be loaded:

- `age_of_empires_ocel2.sqlite` (850.6 MB, md5 55491541beff7a55dd751c03bc4a3c6d) has
  **831 distinct activity types**. `import_ocel`'s SQLite path builds one `UNION` over
  every `event_<activity>` table, which exceeds SQLite's `SQLITE_MAX_COMPOUND_SELECT`
  limit of 500 and fails with `OperationalError: too many terms in compound SELECT`.
  Batching that query would lift the limit for any wide log.
- The `.json` (1.6 GB) and `.xml` (1.3 GB) variants are not a workaround: `import_ocel`
  is fully in-memory and parses each of those files twice.

Re-add the entry here once the importer can read it. The download machinery in
`download_logs.py` already handles logs of this size and is tested.

Where the logs live
-------------------

- **`test_data/small/`** is tracked in git, so those three logs need no setup.
- **`test_data/large/`** is gitignored (`totem_lib/test_data/large/*`), so large logs are
  never committed. Fetch them with the download script, run from the `totem_lib/` directory:

      python evaluation/download_logs.py --list
      python evaluation/download_logs.py --logs age-of-empires

  If the download fails, each log's `source_url` points at its Zenodo record so the file
  can be placed into `test_data/large/` by hand.

Event counts
------------

`event_count` is the number of events **after** `import_ocel` applies its schema and
propagation filtering, so it can differ from the count advertised on the dataset's landing
page. The recorded values are measured, not copied. Re-measure them with:

    python evaluation/log_sizes.py

That script reports any log whose recorded count no longer matches a fresh import.

Adding a log
------------

Append an `EvaluationLog` and run `log_sizes.py` to fill in its `event_count`. If the file
extension is not one `import_ocel` recognises (`.sqlite`, `.json`, `.xml`, `.csv`,
`.duckdb`) — OCEL 1.0-era suffixes such as `.jsonocel` are not — set `file_format`
explicitly. Consumers should always load a log via `import_ocel(*import_args(log))`, which
is the single place that override is applied.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

# ---------------------------------------------------------------------------
# Locations
# ---------------------------------------------------------------------------

_TEST_DATA = Path(__file__).resolve().parent.parent / "test_data"

SMALL = _TEST_DATA / "small"
LARGE = _TEST_DATA / "large"

# Formats import_ocel can infer from a file extension.
SUPPORTED_FORMATS = ("sqlite", "json", "xml", "csv", "duckdb")


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class EvaluationLog:
    """
    One real OCEL log, with everything needed to locate, fetch and load it.

    `download_url` is None for logs bundled in git; the download fields are only
    populated for logs that live in the gitignored `test_data/large/`.
    """

    name: str
    source_url: str
    path: Path
    event_count: int | None = None
    file_format: str | None = None
    download_url: str | None = None
    md5: str | None = None
    size_bytes: int | None = None

    @property
    def available(self) -> bool:
        """Whether the log is present on disk and ready to load."""
        return self.path.exists()

    @property
    def bundled(self) -> bool:
        """Whether the log ships with the repo rather than being downloaded."""
        return self.download_url is None


def _by_event_count(log: EvaluationLog) -> tuple[bool, int]:
    """Sort key: ascending event count, unmeasured logs last."""
    return (log.event_count is None, log.event_count or 0)


# Sorted by event count so plots (sub-issue #179) get their x-axis ordering for free.
LOGS: tuple[EvaluationLog, ...] = tuple(
    sorted(
        [
            EvaluationLog(
                name="ocel2-p2p",
                source_url="https://doi.org/10.5281/zenodo.8412919",
                path=SMALL / "ocel2-p2p.json",
                event_count=14671,
            ),
            EvaluationLog(
                name="order-management",
                source_url="https://doi.org/10.5281/zenodo.8337463",
                path=SMALL / "order-management.json",
                event_count=21008,
            ),
            EvaluationLog(
                name="container_logistics",
                source_url="https://doi.org/10.5281/zenodo.8289899",
                path=SMALL / "container_logistics.json",
                event_count=35372,
            ),
        ],
        key=_by_event_count,
    )
)


# ---------------------------------------------------------------------------
# Lookup
# ---------------------------------------------------------------------------

def get_log(name: str, logs: Sequence[EvaluationLog] = LOGS) -> EvaluationLog:
    """Return the log with this name, or raise ValueError naming the valid options."""
    for log in logs:
        if log.name == name:
            return log
    known = ", ".join(sorted(candidate.name for candidate in logs))
    raise ValueError(f"unknown log {name!r}; available logs: {known}")


def available_logs(logs: Sequence[EvaluationLog] = LOGS) -> list[EvaluationLog]:
    """Logs that are present on disk right now."""
    return [log for log in logs if log.available]


def downloadable_logs(logs: Sequence[EvaluationLog] = LOGS) -> list[EvaluationLog]:
    """Logs that have to be fetched rather than shipped with the repo."""
    return [log for log in logs if not log.bundled]


def import_args(log: EvaluationLog) -> tuple[str, str | None]:
    """
    Arguments for import_ocel, as `import_ocel(*import_args(log))`.

    The single place a format override is applied, so no consumer has to know which
    logs have an extension import_ocel cannot infer.
    """
    return str(log.path), log.file_format
