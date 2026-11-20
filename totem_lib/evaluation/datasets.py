"""
Manifest of the real OCEL logs used for runtime evaluation.

Every log here is a published dataset from https://www.ocel-standard.org/event-logs/overview/ ,
used as-is: no sampling, no synthetic logs, no cutting down to size. How big a log is
gets measured several ways - see `LogStatistics` below.

Logs
----

The eight logs of the TOTeM conformance-checking paper (BPM 2026), sorted by events:

| name                   |    events | objects | E2O rel.   | act. | types | where it lives    | source |
|------------------------|-----------|---------|------------|------|-------|-------------------|--------|
| `ocel2-p2p`            |    14,671 |   9,054 |     35,927 |   10 |     7 | `small/` (in git) | 10.5281/zenodo.8412919 |
| `order-management`     |    21,008 |  10,840 |    147,463 |   11 |     6 | `small/` (in git) | 10.5281/zenodo.8337463 |
| `lrms-reasoning-steps` |    31,709 |   1,645 |     63,418 |   32 |     2 | `large/` (fetch)  | 10.5281/zenodo.21977680 |
| `container_logistics`  |    35,372 |  13,882 |     74,272 |   14 |     7 | `small/` (in git) | 10.5281/zenodo.8289899 |
| `hinge-production`     |    38,528 |  23,771 |    144,827 |   11 |    12 | `large/` (fetch)  | 10.5281/zenodo.24331838 |
| `bundestag`            |    62,719 |  37,665 |     67,185 |  148 |    44 | `large/` (fetch)  | 10.5281/zenodo.16811928 |
| `enron`                |   517,891 | 316,848 |  1,765,575 |    9 |     2 | `large/` (fetch)  | 10.5281/zenodo.21989732 |
| `age-of-empires`       | 2,372,505 | 361,935 | 10,387,384 |  829 |    30 | `large/` (fetch)  | 10.5281/zenodo.13365584 |

Note how the order changes with the metric: `order-management` has the fewest events of
the small logs but by far the most event-to-object relations. Which log counts as
"bigger" depends on what you measure, which is why runtime is plotted against several
statistics.

Things to know about the large logs:

- `hinge-production` and `lrms-reasoning-steps` are the current Zenodo versions, which
  are newer than the files the paper used (`socel2_hinge.xml`, `reasoning_benchmark.json`).
- `enron` and `age-of-empires` are read from SQLite: their JSON files (1.1 GB and 1.6 GB)
  would not fit in memory, because `import_ocel` parses JSON fully in memory, twice. The
  importers' runtimes therefore mix formats; compare import times within a format.
- Some logs carry placeholder timestamps (`bundestag` ends in 2038, `enron` spans
  1979-2044, `lrms-reasoning-steps` sits on 2 January 1970). They are recorded as found.
- Age of Empires has 829 activities. Its SQLite file used to fail with "too many terms in
  compound SELECT"; `import_ocel` now reads the per-activity tables in batches.

Where the logs live
-------------------

- **`test_data/small/`** is tracked in git, so those three logs need no setup.
- **`test_data/large/`** is gitignored (`totem_lib/test_data/large/*`), so large logs are
  never committed. Fetch them with the download script, run from the `totem_lib/` directory:

      python evaluation/download_logs.py --list
      python evaluation/download_logs.py
      python evaluation/download_logs.py --logs age-of-empires

  If the download fails, each log's `source_url` points at its Zenodo record so the file
  can be placed into `test_data/large/` by hand.

Statistics
----------

Each log records a `LogStatistics`: event count, object count, activity and object-type
counts, event-to-object and object-to-object relation counts, and the time range. Runtime
can be plotted against any of these, not just the event count. `SIZE_METRICS` lists the
ones that make sense as a plot x-axis, with their labels.

Counts are taken **after** `import_ocel` applies its schema and propagation filtering, so
they can differ from the numbers advertised on a dataset's landing page. They are
measured, not copied. Re-measure them with:

    python evaluation/log_stats.py

That script reports any statistic that no longer matches a fresh import.

Two statistics are deliberately missing. The event-object graph (`ocel.eog`) would be a
good measure of complexity, but it is slow to build and is cached on the log, so touching
it before a timed run would make that run look faster than it is. Attribute counts are
also skipped: the JSON, XML and SQLite importers drop event attributes and leave object
attributes empty, so they would read as zero for every log here.

Adding a log
------------

Append an `EvaluationLog` and run `log_stats.py` to fill in its statistics. If the file
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
# Statistics
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class LogStatistics:
    """
    How big a log is, measured several ways.

    Field names match the backend statistics endpoint (backend/api/views.py) so the
    library and the API describe a log the same way.

    Timestamps are unix seconds.
    """

    num_events: int
    num_objects: int
    num_unique_activities: int
    num_object_types: int
    num_e2o_relations: int
    num_o2o_relations: int
    earliest_timestamp: int
    newest_timestamp: int

    @property
    def duration_seconds(self) -> int:
        """How long the log spans, first event to last."""
        return self.newest_timestamp - self.earliest_timestamp

    @property
    def avg_objects_per_event(self) -> float:
        """
        Event-to-object relations per event: how object-centric the log is.

        Algorithms that look at every object of every event (the OCCN miner, variant
        extraction) scale with this rather than with the event count alone.
        """
        return self.num_e2o_relations / self.num_events if self.num_events else 0.0

    def as_dict(self) -> dict[str, int]:
        """Flat name -> value mapping, for CSV/JSON export."""
        values = {field: getattr(self, field) for field in STATISTIC_FIELDS}
        values["duration_seconds"] = self.duration_seconds
        return values


# Every field of LogStatistics, in declaration order.
STATISTIC_FIELDS = (
    "num_events",
    "num_objects",
    "num_unique_activities",
    "num_object_types",
    "num_e2o_relations",
    "num_o2o_relations",
    "earliest_timestamp",
    "newest_timestamp",
)

# Statistics that work as a plot x-axis, mapped to their axis label. Timestamps are
# left out: they say when a log happened, not how big it is. avg_objects_per_event is
# derived from two recorded fields rather than recorded itself.
SIZE_METRICS: dict[str, str] = {
    "num_events": "Number of events",
    "num_objects": "Number of objects",
    "num_e2o_relations": "Number of event-to-object relations",
    "num_o2o_relations": "Number of object-to-object relations",
    "num_unique_activities": "Number of activities",
    "num_object_types": "Number of object types",
    "avg_objects_per_event": "Average objects per event",
}


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class EvaluationLog:
    """
    One real OCEL log, with everything needed to locate, fetch and load it.

    `download_url` is None for logs bundled in git; the download fields are only
    populated for logs that live in the gitignored `test_data/large/`.

    `leading_object_type` is the object type used as the "case" when an algorithm needs
    one, such as variant discovery. The `_db` algorithms build their own DuckDB copy
    from `path` at run time, so no second file is recorded here.
    """

    name: str
    source_url: str
    path: Path
    statistics: LogStatistics | None = None
    file_format: str | None = None
    leading_object_type: str | None = None
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

    @property
    def event_count(self) -> int | None:
        """Shortcut for the most-used statistic."""
        return self.statistics.num_events if self.statistics else None


def _zenodo(record: int, file_name: str) -> str:
    """Direct download link for one file of a Zenodo record."""
    return f"https://zenodo.org/api/records/{record}/files/{file_name}/content"


def _by_event_count(log: EvaluationLog) -> tuple[bool, int]:
    """Sort key: ascending event count, unmeasured logs last."""
    return (log.event_count is None, log.event_count or 0)


# Sorted by event count, which is the default x-axis. A plot using any other metric
# has to sort by that metric itself.
LOGS: tuple[EvaluationLog, ...] = tuple(
    sorted(
        [
            EvaluationLog(
                name="ocel2-p2p",
                source_url="https://doi.org/10.5281/zenodo.8412919",
                path=SMALL / "ocel2-p2p.json",
                leading_object_type="purchase_requisition",
                statistics=LogStatistics(
                    num_events=14671,
                    num_objects=9054,
                    num_unique_activities=10,
                    num_object_types=7,
                    num_e2o_relations=35927,
                    num_o2o_relations=16757,
                    earliest_timestamp=1648805160,
                    newest_timestamp=1730406480,
                ),
            ),
            EvaluationLog(
                name="order-management",
                source_url="https://doi.org/10.5281/zenodo.8337463",
                path=SMALL / "order-management.json",
                leading_object_type="orders",
                statistics=LogStatistics(
                    num_events=21008,
                    num_objects=10840,
                    num_unique_activities=11,
                    num_object_types=6,
                    num_e2o_relations=147463,
                    num_o2o_relations=28391,
                    earliest_timestamp=1680516498,
                    newest_timestamp=1717524727,
                ),
            ),
            EvaluationLog(
                name="container_logistics",
                source_url="https://doi.org/10.5281/zenodo.8289899",
                path=SMALL / "container_logistics.json",
                leading_object_type="Customer Order",
                statistics=LogStatistics(
                    num_events=35372,
                    num_objects=13882,
                    num_unique_activities=14,
                    num_object_types=7,
                    num_e2o_relations=74272,
                    num_o2o_relations=15920,
                    earliest_timestamp=1684756482,
                    newest_timestamp=1724257239,
                ),
            ),
            # --- Large logs: gitignored, fetched by download_logs.py ---------------
            # These complete the eight logs of the TOTeM conformance-checking paper
            # (BPM 2026). Hinge and the LRM reasoning log are the current Zenodo
            # versions, which are newer than the files that paper used. Large files
            # are SQLite where JSON would not fit in memory: import_ocel parses JSON
            # fully in memory, twice.
            EvaluationLog(
                name="lrms-reasoning-steps",
                source_url="https://doi.org/10.5281/zenodo.21977680",
                path=LARGE / "lrms_reasoning_steps.json",
                download_url=_zenodo(21977680, "lrms_reasoning_steps.json"),
                md5="21c9857faf643e37f53bbe49badaed33",
                size_bytes=27_403_948,
                leading_object_type="MODQUE",
                statistics=LogStatistics(
                    num_events=31709,
                    num_objects=1645,
                    num_unique_activities=32,
                    num_object_types=2,
                    num_e2o_relations=63418,
                    num_o2o_relations=0,
                    earliest_timestamp=103601,
                    newest_timestamp=135309,
                ),
            ),
            EvaluationLog(
                name="hinge-production",
                source_url="https://doi.org/10.5281/zenodo.24331838",
                path=LARGE / "hinge_production.json",
                download_url=_zenodo(24331838, "hinge_production.json"),
                md5="8bee56f7a5fe60a4fe4482082c000019",
                size_bytes=61_314_843,
                leading_object_type="FormedPart",
                statistics=LogStatistics(
                    num_events=38528,
                    num_objects=23771,
                    num_unique_activities=11,
                    num_object_types=12,
                    num_e2o_relations=144827,
                    num_o2o_relations=20561,
                    earliest_timestamp=1680507526,
                    newest_timestamp=1680796942,
                ),
            ),
            EvaluationLog(
                name="bundestag",
                source_url="https://doi.org/10.5281/zenodo.16811928",
                path=LARGE / "Period20_procedure_steps_all_additional_event_types.json",
                download_url=_zenodo(
                    16811928, "Period20_procedure_steps_all_additional_event_types.json"
                ),
                md5="8484145ea89f825b7eb17ae182470cee",
                size_bytes=268_729_361,
                leading_object_type="Gesetzgebung",
                statistics=LogStatistics(
                    num_events=62719,
                    num_objects=37665,
                    num_unique_activities=148,
                    num_object_types=44,
                    num_e2o_relations=67185,
                    num_o2o_relations=0,
                    earliest_timestamp=1609459200,
                    newest_timestamp=2145916863,
                ),
            ),
            EvaluationLog(
                name="enron",
                source_url="https://doi.org/10.5281/zenodo.21989732",
                path=LARGE / "enron_all_mails.sqlite",
                download_url=_zenodo(21989732, "enron_all_mails.sqlite"),
                md5="7aca22bb6ac22c939f583168b992b415",
                size_bytes=1_049_350_144,
                leading_object_type="MESSAGEID",
                statistics=LogStatistics(
                    num_events=517891,
                    num_objects=316848,
                    num_unique_activities=9,
                    num_object_types=2,
                    num_e2o_relations=1765575,
                    num_o2o_relations=0,
                    earliest_timestamp=315504000,
                    newest_timestamp=2335531738,
                ),
            ),
            EvaluationLog(
                name="age-of-empires",
                source_url="https://doi.org/10.5281/zenodo.13365584",
                path=LARGE / "age_of_empires_ocel2.sqlite",
                download_url=_zenodo(13365584, "age_of_empires_ocel2.sqlite"),
                md5="55491541beff7a55dd751c03bc4a3c6d",
                size_bytes=891_867_136,
                leading_object_type="Match",
                statistics=LogStatistics(
                    num_events=2372505,
                    num_objects=361935,
                    num_unique_activities=829,
                    num_object_types=30,
                    num_e2o_relations=10387384,
                    num_o2o_relations=2541715,
                    earliest_timestamp=1681691569,
                    newest_timestamp=1702536162,
                ),
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
