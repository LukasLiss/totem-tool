"""
Scalability benchmark on synthetic logs: DB-backed algorithms vs in-memory
baselines (totem_lib Polars implementations and pm4py) as the number of
events grows. Once an engine fails (timeout / OOM / error) at some size it
is skipped for all larger sizes.

Usage: python bench_scaling.py [--quick]
"""

import sys

from common import ensure_synthetic, median, run_task, write_csv

SIZES = [30_000, 100_000, 300_000, 1_000_000, 3_000_000, 10_000_000]
QUICK_SIZES = [30_000, 100_000]

ENGINES = [
    ("ocdfg", "duckdb", "ocdfg_db"),
    ("ocdfg", "polars", "ocdfg_polars"),
    ("ocdfg", "pm4py", "ocdfg_pm4py"),
    ("totem", "duckdb", "totem_db"),
    ("totem", "polars", "totem_polars"),
]

TIMEOUT_S = 600.0


def main():
    quick = "--quick" in sys.argv
    sizes = QUICK_SIZES if quick else SIZES
    rows = []
    failed: set[str] = set()

    for n_events in sizes:
        db_path = ensure_synthetic(n_events)
        for algo, engine, op in ENGINES:
            key = f"{algo}/{engine}"
            if key in failed:
                rows.append({"algo": algo, "engine": engine,
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
                rep = min(ok, key=lambda r: r["elapsed_s"])
                rows.append({
                    "algo": algo, "engine": engine, "n_events": n_events,
                    "status": "ok",
                    "elapsed_s": median([r["elapsed_s"] for r in ok]),
                    "load_s": rep.get("load_s"),
                    "peak_rss_mb": max(r["peak_rss_mb"] for r in ok),
                    "repeats": len(ok),
                })
            else:
                res = results[-1]
                rows.append({"algo": algo, "engine": engine,
                             "n_events": n_events, "status": res["status"],
                             "elapsed_s": res.get("elapsed_s"),
                             "stderr_tail": res.get("stderr_tail")})
                failed.add(key)
            print(f"  {key} @ {n_events}: {rows[-1]['status']} "
                  f"{rows[-1].get('elapsed_s')}")

    write_csv("scaling", rows)


if __name__ == "__main__":
    main()
