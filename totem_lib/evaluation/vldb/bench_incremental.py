"""
Incremental maintenance benchmark: per-batch maintenance + refresh cost of
IncrementalOCDFG / IncrementalTotem vs full recomputation, as the log grows.

Usage: python bench_incremental.py [--quick]
"""

import sys

from common import ensure_synthetic, run_task, write_csv

SIZES = [300_000, 1_000_000, 3_000_000]
QUICK_SIZES = [30_000]

TIMEOUT_S = 1800.0


def main():
    quick = "--quick" in sys.argv
    sizes = QUICK_SIZES if quick else SIZES
    rows = []
    for n_events in sizes:
        db_path = ensure_synthetic(n_events)
        for algo in ("ocdfg", "totem"):
            res = run_task(
                {
                    "op": "incremental",
                    "algo": algo,
                    "db_path": str(db_path),
                    "n_batches": 10,
                    "base_fraction": 0.5,
                },
                timeout_s=TIMEOUT_S,
            )
            res.update({"algo": algo, "n_events": n_events})
            rows.append(res)
            print(f"  incremental/{algo} @ {n_events}: {res['status']} "
                  f"append={res.get('mean_append_s')} "
                  f"refresh={res.get('mean_refresh_s')} "
                  f"full={res.get('full_recompute_s')}")
    write_csv("incremental", rows)


if __name__ == "__main__":
    main()
