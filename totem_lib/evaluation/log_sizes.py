"""
Measure and verify the number of events in each evaluation log.

Imports every available log from the manifest with `import_ocel` and reports its event
count. This is what fills in (and keeps honest) the `event_count` values recorded in
evaluation/datasets.py — the "size" axis of the runtime plots.

Logs that have not been downloaded are skipped, not treated as failures.

Run from the totem_lib/ directory:
    python evaluation/log_sizes.py
"""

import sys
from pathlib import Path

# Run either as a script (`python evaluation/log_sizes.py`) or imported as
# `evaluation.log_sizes`, so both totem_lib/src and totem_lib itself go on the path.
_TOTEM_LIB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_TOTEM_LIB / "src"))
sys.path.insert(0, str(_TOTEM_LIB))

from evaluation.datasets import LOGS, EvaluationLog, import_args
from totem_lib.ocel.importer import import_ocel


# ---------------------------------------------------------------------------
# Measurement
# ---------------------------------------------------------------------------

def count_events(log: EvaluationLog) -> int:
    """
    Import the log and return its event count.

    Raises if the import yields zero events. An OCEL 1.0 file read by the OCEL 2.0
    loader produces an empty log rather than an error, and a silent zero would
    otherwise sail through as a legitimate measurement.
    """
    ocel = import_ocel(*import_args(log))
    events = ocel.events.height
    if events == 0:
        raise ValueError(
            f"{log.name}: imported 0 events from {log.path.name} — "
            "wrong OCEL version or unexpected schema?"
        )
    return events


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    mismatches: list[str] = []

    for log in LOGS:
        print(f"\n{log.name}")
        print(f"  source:   {log.source_url}")
        print(f"  file:     {log.path}")

        if not log.available:
            # ASCII only: the Windows console default codepage mangles non-ASCII dashes.
            hint = "" if log.bundled else (
                f" - run: python evaluation/download_logs.py --logs {log.name}"
            )
            print(f"  SKIP: not present{hint}")
            continue

        size_mb = log.path.stat().st_size / 1024 / 1024
        print(f"  size:     {size_mb:.1f} MB")
        print("  importing ...", end=" ", flush=True)

        try:
            events = count_events(log)
        except Exception as exc:
            print(f"FAILED: {type(exc).__name__}: {exc}")
            continue

        print(f"{events} events")

        if log.event_count is None:
            print(f"  NOT RECORDED -> add to datasets.py:  event_count={events},")
            mismatches.append(log.name)
        elif log.event_count != events:
            print(
                f"  MISMATCH: recorded {log.event_count}, measured {events}"
                f" -> update datasets.py:  event_count={events},"
            )
            mismatches.append(log.name)

    if mismatches:
        print(f"\n{len(mismatches)} log(s) need their event_count updated: {', '.join(mismatches)}")
    else:
        print("\nAll available logs match their recorded event counts.")


if __name__ == "__main__":
    main()
