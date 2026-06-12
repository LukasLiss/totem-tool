"""
Ablation benchmark: optimized SQL formulations vs naive ones.

- OC-DFG: window-function adjacency vs self-join + NOT EXISTS.
- TOTeM: eager lifetime aggregation vs pair-level event expansion.

Usage: python bench_ablation.py [--quick]
"""

import sys

from common import ensure_synthetic, median, run_task, write_csv

SIZES = [30_000, 100_000, 300_000, 1_000_000, 3_000_000]
QUICK_SIZES = [30_000]

VARIANTS = [
    ("ocdfg", "window", "ocdfg_db"),
    ("ocdfg", "selfjoin", "ocdfg_db_naive"),
    ("totem", "eager", "totem_db"),
    ("totem", "lazy", "totem_db_naive"),
]

TIMEOUT_S = 600.0


def main():
    quick = "--quick" in sys.argv
    sizes = QUICK_SIZES if quick else SIZES
    rows = []
    failed: set[str] = set()

    for n_events in sizes:
        db_path = ensure_synthetic(n_events)
        for algo, variant, op in VARIANTS:
            key = f"{algo}/{variant}"
            if key in failed:
                rows.append({"algo": algo, "variant": variant,
                             "n_events": n_events, "status": "skipped"})
                continue
            repeats = 3 if n_events <= 300_000 and not quick else 1
            results = []
            for _ in range(repeats):
                res = run_task({"op": op, "db_path": str(db_path)},
                               timeout_s=TIMEOUT_S)
                results.append(res)
                if res["status"] != "ok":
                    break
            ok = [r for r in results if r["status"] == "ok"]
            if ok:
                rows.append({
                    "algo": algo, "variant": variant, "n_events": n_events,
                    "status": "ok",
                    "elapsed_s": median([r["elapsed_s"] for r in ok]),
                    "peak_rss_mb": max(r["peak_rss_mb"] for r in ok),
                    "repeats": len(ok),
                })
            else:
                res = results[-1]
                rows.append({"algo": algo, "variant": variant,
                             "n_events": n_events, "status": res["status"],
                             "elapsed_s": res.get("elapsed_s")})
                failed.add(key)
            print(f"  {key} @ {n_events}: {rows[-1]['status']} "
                  f"{rows[-1].get('elapsed_s')}")

    write_csv("ablation", rows)


if __name__ == "__main__":
    main()
