"""
Performance evaluation for `find_variants` across the (extraction, iso) grid
on every `.duckdb` file in `test_data/small/`.

For each `.duckdb`, we discover the object types from the DB itself, run
`find_variants` for every (extraction, leading_type, iso) combination with a
hard per-cell timeout, and append each row to `VARIANTS_PERFORMANCE_RESULTS.md`
as soon as it completes — partial runs leave usable data behind.

Run from the totem_lib/ directory:
    python evaluation/variants_performance.py
    python evaluation/variants_performance.py --timeout 60
    python evaluation/variants_performance.py --extractions leading_1hop,connected
    python evaluation/variants_performance.py --isos db_signature,wl,wl+vf2
"""

import argparse
import signal
import sys
import time
import tracemalloc
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from totem_lib.ocel.ocel_duckdb import OcelDuckDB
from totem_lib.variants import find_variants

SCRIPT_DIR   = Path(__file__).parent
TEST_DATA    = SCRIPT_DIR.parent / "test_data" / "small"
RESULTS_FILE = SCRIPT_DIR / "VARIANTS_PERFORMANCE_RESULTS.md"

DEFAULT_TIMEOUT_S  = 8
DEFAULT_EXTRACTIONS = ["leading_1hop", "leading_bfs", "connected"]
DEFAULT_ISOS        = ["db_signature", "trace", "signature", "wl", "wl+vf2", "exact"]


# ---------------------------------------------------------------------------
# Timeout machinery
# ---------------------------------------------------------------------------

class _Timeout(Exception):
    pass


def _alarm(_sig, _frame):
    raise _Timeout()


signal.signal(signal.SIGALRM, _alarm)


def _measure(extraction, leading_type, iso, db, timeout_s,
             business_obj_types=None, resource_types=None):
    tracemalloc.start()
    t0 = time.perf_counter()
    try:
        signal.alarm(timeout_s)
        v = find_variants(
            db,
            extraction=extraction,
            leading_type=leading_type,
            iso=iso,
            business_obj_types=business_obj_types,
            resource_types=resource_types,
            verbose=False,
        )
        signal.alarm(0)
        elapsed = round(time.perf_counter() - t0, 3)
        _, peak = tracemalloc.get_traced_memory()
        return {
            "status":  "ok",
            "time":    f"{elapsed}s",
            "ram_mb":  round(peak / 1024 / 1024, 2),
            "n_var":   len(v),
            "n_exec":  sum(len(x.executions) for x in v),
        }
    except _Timeout:
        return {"status": "TIMEOUT", "time": f">{timeout_s}s",
                "ram_mb": "-", "n_var": "-", "n_exec": "-"}
    except Exception as e:
        signal.alarm(0)
        # SIGALRM that fires inside a DuckDB C-level call surfaces as
        # RuntimeError("...interrupted...") instead of our _Timeout.
        elapsed = time.perf_counter() - t0
        if elapsed >= timeout_s - 0.5:
            return {"status": "TIMEOUT", "time": f">{timeout_s}s",
                    "ram_mb": "-", "n_var": "-", "n_exec": "-"}
        return {"status": f"ERR: {type(e).__name__}", "time": "-",
                "ram_mb": "-", "n_var": "-", "n_exec": "-"}
    finally:
        tracemalloc.stop()


# ---------------------------------------------------------------------------
# Reporting (incremental — one row at a time)
# ---------------------------------------------------------------------------

HEADER = (
    "| Dataset | Extraction | Leading | Iso "
    "| Time | RAM (MB) | #Variants | #Executions | Status |"
)
SEPARATOR = "|---|---|---|---|---|---|---|---|---|"
ROW_FMT = (
    "| {dataset} | {extraction} | {leading} | {iso} "
    "| {time} | {ram_mb} | {n_var} | {n_exec} | {status} |"
)


def ensure_results_header(timeout_s: int) -> None:
    if not RESULTS_FILE.exists():
        with open(RESULTS_FILE, "w") as f:
            f.write("# Variants Algorithm Performance Results\n\n")
            f.write(
                "Per (dataset, extraction, leading_type, iso) cell with "
                f"{timeout_s}s timeout.\n\n"
            )
            f.write(f"{HEADER}\n{SEPARATOR}\n")


def write_run_marker(timeout_s: int, extractions, isos) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    with open(RESULTS_FILE, "a") as f:
        f.write(
            f"\n<!-- run: {ts} | timeout={timeout_s}s "
            f"| extractions={','.join(extractions)} "
            f"| isos={','.join(isos)} -->\n"
        )


def append_row(row: dict) -> None:
    with open(RESULTS_FILE, "a") as f:
        f.write(ROW_FMT.format(**row) + "\n")


# ---------------------------------------------------------------------------
# Per-dataset run
# ---------------------------------------------------------------------------

def evaluate(
    duckdb_path: Path, timeout_s: int, extractions, isos,
    business_obj_types=None, resource_types=None,
) -> None:
    print(f"\n=== {duckdb_path.name} ===", flush=True)
    db = OcelDuckDB.load(str(duckdb_path))
    types = sorted(
        r[0] for r in db.conn.execute(
            "SELECT DISTINCT obj_type FROM objects"
        ).fetchall()
    )

    # Skip leading-type cells that would be invalid under the chosen split.
    resource_set = set(resource_types or [])
    business_set = set(business_obj_types or [])

    last_status = "ok"
    for ext in extractions:
        type_iter = types if ext.startswith("leading") else [None]
        for lt in type_iter:
            if lt is not None:
                if lt in resource_set:
                    continue  # invalid: leading_type cannot be a resource
                if business_set and lt not in business_set:
                    continue  # invalid: leading_type must be in business set
            for iso in isos:
                # DuckDB connections get poisoned when SIGALRM fires mid-query.
                # After any non-ok cell, force a fresh connection.
                if last_status != "ok":
                    try:
                        db.close()
                    except Exception:
                        pass
                    db = OcelDuckDB.load(str(duckdb_path))

                m = _measure(
                    ext, lt, iso, db, timeout_s,
                    business_obj_types=business_obj_types,
                    resource_types=resource_types,
                )
                last_status = m["status"]
                row = {
                    "dataset":    duckdb_path.stem,
                    "extraction": ext,
                    "leading":    lt or "-",
                    "iso":        iso,
                    **m,
                }
                append_row(row)
                print(
                    f"  {ext:13s} {str(lt or '-'):20s} {iso:13s} "
                    f"{m['time']:>6} {str(m['ram_mb']):>7}MB "
                    f"#v={m['n_var']!s:>4} exec={m['n_exec']!s:>5} {m['status']}",
                    flush=True,
                )
    db.close()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _csv(s: str) -> list[str]:
    return [x.strip() for x in s.split(",") if x.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_S,
                        help="per-cell timeout in seconds")
    parser.add_argument("--extractions", type=_csv,
                        default=DEFAULT_EXTRACTIONS,
                        help="comma-separated subset of: "
                             "leading_1hop,leading_bfs,connected")
    parser.add_argument("--isos", type=_csv, default=DEFAULT_ISOS,
                        help="comma-separated subset of: "
                             "db_signature,trace,signature,wl,wl+vf2,exact")
    parser.add_argument("--data-dir", type=Path, default=TEST_DATA,
                        help="directory containing .duckdb files")
    parser.add_argument("--business-types", type=_csv, default=None,
                        help="comma-separated obj_types to treat as business "
                             "(others become resources unless --resource-types "
                             "is also given)")
    parser.add_argument("--resource-types", type=_csv, default=None,
                        help="comma-separated obj_types to treat as resources "
                             "(others become business unless --business-types "
                             "is also given)")
    args = parser.parse_args()

    duckdb_paths = sorted(args.data_dir.glob("*.duckdb"))
    if not duckdb_paths:
        print(f"No .duckdb files found in {args.data_dir}")
        return

    ensure_results_header(args.timeout)
    write_run_marker(args.timeout, args.extractions, args.isos)
    print(f"Writing rows to {RESULTS_FILE}", flush=True)

    for p in duckdb_paths:
        try:
            evaluate(
                p, args.timeout, args.extractions, args.isos,
                business_obj_types=args.business_types,
                resource_types=args.resource_types,
            )
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"  FAILED on {p.name}: {e}")


if __name__ == "__main__":
    main()
