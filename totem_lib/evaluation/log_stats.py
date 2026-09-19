"""
Measure and verify the statistics of each evaluation log.

Imports every available log with `import_ocel` and reports how big it is: event count,
object count, activity and object-type counts, relation counts and time range. These are
the values recorded in evaluation/datasets.py, and the axes the runtime plots use.

Logs that have not been downloaded are skipped, not treated as failures.

Run from the totem_lib/ directory:
    python evaluation/log_stats.py
"""

import sys
from datetime import datetime, timezone
from pathlib import Path

# Run either as a script (`python evaluation/log_stats.py`) or imported as
# `evaluation.log_stats`, so both totem_lib/src and totem_lib itself go on the path.
_TOTEM_LIB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_TOTEM_LIB / "src"))
sys.path.insert(0, str(_TOTEM_LIB))

from evaluation.datasets import (
    LOGS,
    STATISTIC_FIELDS,
    EvaluationLog,
    LogStatistics,
    import_args,
)
from totem_lib.ocel.importer import import_ocel


# ---------------------------------------------------------------------------
# Measurement
# ---------------------------------------------------------------------------

def compute_statistics(ocel) -> LogStatistics:
    """
    Measure one imported log.

    The only place the statistics are actually computed, so every consumer gets the
    same numbers.

    Raises if the log has no events. An OCEL 1.0 file read by the OCEL 2.0 loader comes
    out empty instead of raising, and a silent zero would look like a real measurement.
    """
    if ocel.events.height == 0:
        raise ValueError("imported 0 events - wrong OCEL version or unexpected schema?")

    return LogStatistics(
        num_events=ocel.events.height,
        num_objects=ocel.objects.height,
        num_unique_activities=ocel.events["_activity"].n_unique(),
        num_object_types=ocel.objects["_objType"].n_unique(),
        # _objects and _targetObjects are list columns, so the total list length is
        # the number of relations.
        num_e2o_relations=int(ocel.events["_objects"].list.len().sum()),
        num_o2o_relations=int(ocel.objects["_targetObjects"].list.len().sum()),
        earliest_timestamp=int(ocel.events["_timestampUnix"].min()),
        newest_timestamp=int(ocel.events["_timestampUnix"].max()),
    )


def measure(log: EvaluationLog) -> LogStatistics:
    """Import a log and measure it."""
    return compute_statistics(import_ocel(*import_args(log)))


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def _date(unix_seconds: int) -> str:
    return datetime.fromtimestamp(unix_seconds, timezone.utc).strftime("%Y-%m-%d")


def print_statistics(stats: LogStatistics) -> None:
    for field in STATISTIC_FIELDS:
        value = getattr(stats, field)
        if field.endswith("_timestamp"):
            print(f"  {field:24}{value} ({_date(value)})")
        else:
            print(f"  {field:24}{value:,}")
    days = stats.duration_seconds / 86400
    print(f"  {'duration':24}{days:,.0f} days")


def as_source(stats: LogStatistics) -> str:
    """The statistics as a code snippet, ready to paste into datasets.py."""
    lines = [f"                    {f}={getattr(stats, f)}," for f in STATISTIC_FIELDS]
    return "                statistics=LogStatistics(\n" + "\n".join(lines) + "\n                ),"


def compare(recorded: LogStatistics, measured: LogStatistics) -> list[str]:
    """Names of the statistics that changed since they were recorded."""
    return [
        field
        for field in STATISTIC_FIELDS
        if getattr(recorded, field) != getattr(measured, field)
    ]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    needs_update: list[str] = []

    for log in LOGS:
        print(f"\n{log.name}")
        print(f"  source:                 {log.source_url}")
        print(f"  file:                   {log.path}")

        if not log.available:
            # ASCII only: the Windows console default codepage mangles non-ASCII dashes.
            hint = "" if log.bundled else (
                f" - run: python evaluation/download_logs.py --logs {log.name}"
            )
            print(f"  SKIP: not present{hint}")
            continue

        size_mb = log.path.stat().st_size / 1024 / 1024
        print(f"  size on disk:           {size_mb:.1f} MB")
        print("  importing ...", end=" ", flush=True)

        try:
            measured = measure(log)
        except Exception as exc:
            print(f"FAILED: {type(exc).__name__}: {exc}")
            continue

        print("done")
        print_statistics(measured)

        if log.statistics is None:
            print("\n  NOT RECORDED -> paste into datasets.py:\n")
            print(as_source(measured))
            needs_update.append(log.name)
            continue

        changed = compare(log.statistics, measured)
        if changed:
            print(f"\n  MISMATCH in {', '.join(changed)} -> update datasets.py:\n")
            print(as_source(measured))
            needs_update.append(log.name)

    if needs_update:
        print(f"\n{len(needs_update)} log(s) need updating: {', '.join(needs_update)}")
    else:
        print("\nAll available logs match their recorded statistics.")


if __name__ == "__main__":
    main()
