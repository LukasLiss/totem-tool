"""
Performance and memory evaluation for import_ocel().

Scans test_data/small/ and test_data/large/ for OCEL files, imports each one
using the standard Polars importer, and records:
  - wall-clock import time
  - peak RAM usage (tracemalloc)
  - event and object row counts from the resulting ObjectCentricEventLog
  - source file size on disk

Results are printed to stdout and appended as a new row to
evaluation/POLARS_PERFORMANCE_RESULTS.md (created if it does not exist).

Run from the totem_lib/ directory:
    python evaluation/import_performance.py
"""

import sys
import time
import tracemalloc
from datetime import datetime
from pathlib import Path

# Allow running without installing the package
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from totem_lib.ocel.importer import import_ocel

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR   = Path(__file__).parent
REPO_ROOT    = SCRIPT_DIR.parent          # totem_lib/
TEST_DATA    = REPO_ROOT / "test_data"
RESULTS_FILE = SCRIPT_DIR / "POLARS_PERFORMANCE_RESULTS.md"
SUPPORTED    = {".sqlite", ".json", ".xml", ".csv"}


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

def find_ocel_files() -> list[Path]:
    files: list[Path] = []
    for subdir in ("small", "large"):
        folder = TEST_DATA / subdir
        if not folder.exists():
            continue
        for p in sorted(folder.iterdir()):
            if p.suffix.lower() in SUPPORTED and p.name != ".gitkeep":
                files.append(p)
    return files


# ---------------------------------------------------------------------------
# Measurement
# ---------------------------------------------------------------------------

def measure_import(path: Path) -> dict:
    tracemalloc.start()

    t0 = time.perf_counter()
    ocel = import_ocel(str(path))
    elapsed = time.perf_counter() - t0

    _, peak_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    return {
        "file":       path.name,
        "folder":     path.parent.name,   # small or large
        "format":     path.suffix.lstrip(".").lower(),
        "size_mb":    round(path.stat().st_size / 1024 / 1024, 2),
        "events":     len(ocel.events),
        "objects":    len(ocel.objects),
        "time_s":     round(elapsed, 3),
        "peak_mb":    round(peak_bytes / 1024 / 1024, 2),
    }


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

HEADER = (
    "| File | Folder | Format | Size (MB) | Events | Objects "
    "| Import time (s) | Peak RAM (MB) |"
)
SEPARATOR = "|---|---|---|---|---|---|---|---|"
ROW_FMT = (
    "| {file} | {folder} | {format} | {size_mb} | {events} | {objects} "
    "| {time_s} | {peak_mb} |"
)


def append_results(results: list[dict]) -> None:
    """Append result rows to POLARS_PERFORMANCE_RESULTS.md, creating it if needed."""
    if not RESULTS_FILE.exists():
        with open(RESULTS_FILE, "w") as f:
            f.write("# Polars Import Performance Results\n\n")
            f.write(f"{HEADER}\n{SEPARATOR}\n")

    with open(RESULTS_FILE, "a") as f:
        run_ts = datetime.now().strftime("%Y-%m-%d %H:%M")
        f.write(f"\n<!-- run: {run_ts} -->\n")
        for r in results:
            f.write(ROW_FMT.format(**r) + "\n")

    print(f"\nResults appended to {RESULTS_FILE}")


def print_table(results: list[dict]) -> None:
    print("\n" + HEADER)
    print(SEPARATOR)
    for r in results:
        print(ROW_FMT.format(**r))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    files = find_ocel_files()
    if not files:
        print(
            f"No OCEL files found in {TEST_DATA}/small/ or {TEST_DATA}/large/.\n"
            "Place .sqlite / .json / .xml / .csv files there and re-run."
        )
        return

    results: list[dict] = []
    for path in files:
        print(f"Importing {path.name} ({path.stat().st_size // 1024} KB) ...", end=" ", flush=True)
        try:
            r = measure_import(path)
            results.append(r)
            print(f"done  ({r['time_s']}s, {r['peak_mb']} MB peak, {r['events']} events)")
        except Exception as exc:
            print(f"FAILED: {exc}")

    if results:
        print_table(results)
        append_results(results)


if __name__ == "__main__":
    main()
