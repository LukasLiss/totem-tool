"""
Performance and memory evaluation: totemDiscovery (Polars) vs totemDiscovery_db (DuckDB).

Measures four phases per dataset, each timed and memory-profiled independently:

  Phase              | Polars baseline        | DB alternative
  -------------------|------------------------|---------------------------
  Import             | import_ocel(src_file)  | OcelDuckDB.load(duckdb_file)
  Totem algorithm    | totemDiscovery(ocel)   | totemDiscovery_db(ocel_db)

Run from the totem_lib/ directory:
    python evaluation/totem_performance.py
"""

import os
import sys
import time
import tracemalloc
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from totem_lib.ocel.importer import import_ocel
from totem_lib.ocel.ocel_duckdb import OcelDuckDB
from totem_lib.totem.totem import totemDiscovery
from totem_lib.totem.totem_db import totemDiscovery_db

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).parent
TEST_DATA  = SCRIPT_DIR.parent / "test_data" / "small"
RESULTS_FILE = SCRIPT_DIR / "TOTEM_PERFORMANCE_RESULTS.md"

# Each entry needs a source file (for Polars import) and a .duckdb file (for DB load).
DATASETS = [
    {
        "name":   "order-management",
        "source": TEST_DATA / "order-management.json",
        "duckdb": TEST_DATA / "order-management.duckdb",
    },
    {
        "name":   "ocel2-p2p",
        "source": TEST_DATA / "ocel2-p2p.json",
        "duckdb": TEST_DATA / "ocel2-p2p.duckdb",
    },
    {
        "name":   "container_logistics",
        "source": TEST_DATA / "container_logistics.json",
        "duckdb": TEST_DATA / "container_logistics.duckdb",
    },
]


# ---------------------------------------------------------------------------
# Measurement helpers
# ---------------------------------------------------------------------------

def _measure(func, *args):
    """Return (result, elapsed_s, peak_mb)."""
    tracemalloc.start()
    t0 = time.perf_counter()
    result = func(*args)
    elapsed = time.perf_counter() - t0
    _, peak_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    return result, round(elapsed, 3), round(peak_bytes / 1024 / 1024, 2)


def evaluate_dataset(dataset: dict) -> dict | None:
    source: Path = dataset["source"]
    duckdb: Path = dataset["duckdb"]

    if not source.exists():
        print(f"  SKIP: source file not found: {source}")
        return None
    if not duckdb.exists():
        print(f"  SKIP: .duckdb file not found: {duckdb}")
        return None

    # --- Polars import ---
    print("  [polars] importing ...", end=" ", flush=True)
    ocel, import_p_t, import_p_mem = _measure(import_ocel, str(source))
    print(f"{import_p_t}s  {import_p_mem} MB")

    # --- DB load ---
    print("  [db]     loading .duckdb ...", end=" ", flush=True)
    db, import_db_t, import_db_mem = _measure(OcelDuckDB.load, str(duckdb))
    print(f"{import_db_t}s  {import_db_mem} MB")

    # --- Polars totem ---
    print("  [polars] totemDiscovery ...", end=" ", flush=True)
    _, alg_p_t, alg_p_mem = _measure(totemDiscovery, ocel)
    print(f"{alg_p_t}s  {alg_p_mem} MB")

    # --- DB totem ---
    print("  [db]     totemDiscovery_db ...", end=" ", flush=True)
    _, alg_db_t, alg_db_mem = _measure(totemDiscovery_db, db)
    print(f"{alg_db_t}s  {alg_db_mem} MB")

    db.close()

    return {
        "name":         dataset["name"],
        "src_size_mb":  round(source.stat().st_size / 1024 / 1024, 2),
        "db_size_mb":   round(duckdb.stat().st_size / 1024 / 1024, 2),
        "import_p_t":   import_p_t,
        "import_p_mem": import_p_mem,
        "import_db_t":  import_db_t,
        "import_db_mem": import_db_mem,
        "alg_p_t":      alg_p_t,
        "alg_p_mem":    alg_p_mem,
        "alg_db_t":     alg_db_t,
        "alg_db_mem":   alg_db_mem,
    }


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

HEADER = (
    "| Dataset | Src (MB) | DB (MB) "
    "| Import Polars (s) | Import Polars RAM (MB) "
    "| Import DB (s) | Import DB RAM (MB) "
    "| Totem Polars (s) | Totem Polars RAM (MB) "
    "| Totem DB (s) | Totem DB RAM (MB) |"
)
SEPARATOR = "|---|---|---|---|---|---|---|---|---|---|---|"
ROW_FMT = (
    "| {name} | {src_size_mb} | {db_size_mb} "
    "| {import_p_t} | {import_p_mem} "
    "| {import_db_t} | {import_db_mem} "
    "| {alg_p_t} | {alg_p_mem} "
    "| {alg_db_t} | {alg_db_mem} |"
)


def print_table(results: list[dict]) -> None:
    print("\n" + HEADER)
    print(SEPARATOR)
    for r in results:
        print(ROW_FMT.format(**r))


def append_results(results: list[dict]) -> None:
    if not RESULTS_FILE.exists():
        with open(RESULTS_FILE, "w") as f:
            f.write("# Totem Algorithm Performance Results\n\n")
            f.write("Compares import phase and algorithm phase for Polars vs DuckDB implementations.\n\n")
            f.write(f"{HEADER}\n{SEPARATOR}\n")

    with open(RESULTS_FILE, "a") as f:
        run_ts = datetime.now().strftime("%Y-%m-%d %H:%M")
        f.write(f"\n<!-- run: {run_ts} -->\n")
        for r in results:
            f.write(ROW_FMT.format(**r) + "\n")

    print(f"\nResults appended to {RESULTS_FILE}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    results: list[dict] = []
    for dataset in DATASETS:
        print(f"\n{dataset['name']}")
        try:
            r = evaluate_dataset(dataset)
            if r is not None:
                results.append(r)
        except Exception as exc:
            print(f"  FAILED: {exc}")

    if results:
        print_table(results)
        append_results(results)
    else:
        print("\nNo datasets could be evaluated.")


if __name__ == "__main__":
    main()
