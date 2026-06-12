"""
Second ablation dimension: effect of trace length on the eager vs lazy
TOTeM formulation and the window vs self-join OC-DFG formulation, at a
fixed number of events (~300k). The naive intermediates grow with trace
length L (lazy: pairs x L^2 rows; self-join: events x L pairs), the
optimized ones do not.

Usage: python bench_ablation_tracelen.py [--quick]
"""

import sys

from common import CACHE_DIR, median, run_task, write_csv

N_EVENTS = 300_000
TRACE_LENGTHS = [10, 30, 100, 300]
QUICK_TRACE_LENGTHS = [10, 30]

VARIANTS = [
    ("ocdfg", "window", "ocdfg_db"),
    ("ocdfg", "selfjoin", "ocdfg_db_naive"),
    ("totem", "eager", "totem_db"),
    ("totem", "lazy", "totem_db_naive"),
]

TIMEOUT_S = 600.0


def ensure_synthetic_tracelen(events_per_object: int):
    path = CACHE_DIR / f"synth_tl{events_per_object}_{N_EVENTS}.duckdb"
    if path.exists():
        return path
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    objects_per_type = max(N_EVENTS // (3 * events_per_object), 1)
    res = run_task(
        {
            "op": "gen",
            "db_path": str(path),
            "gen_kwargs": {
                "n_types": 3,
                "objects_per_type": objects_per_type,
                "events_per_object": events_per_object,
                "share_pct": 30,
                "seed": 42,
            },
        },
        timeout_s=TIMEOUT_S,
    )
    if res["status"] != "ok":
        raise RuntimeError(f"generation failed: {res}")
    print(f"  generated {res['n_events']} events (L={events_per_object})")
    return path


def main():
    quick = "--quick" in sys.argv
    lengths = QUICK_TRACE_LENGTHS if quick else TRACE_LENGTHS
    rows = []
    failed: set[str] = set()
    for L in lengths:
        db_path = ensure_synthetic_tracelen(L)
        for algo, variant, op in VARIANTS:
            key = f"{algo}/{variant}"
            if key in failed:
                rows.append({"algo": algo, "variant": variant, "trace_len": L,
                             "status": "skipped"})
                continue
            results = []
            for _ in range(1 if quick else 3):
                res = run_task({"op": op, "db_path": str(db_path)},
                               timeout_s=TIMEOUT_S)
                results.append(res)
                if res["status"] != "ok":
                    break
            ok = [r for r in results if r["status"] == "ok"]
            if ok:
                rows.append({
                    "algo": algo, "variant": variant, "trace_len": L,
                    "status": "ok",
                    "elapsed_s": median([r["elapsed_s"] for r in ok]),
                    "peak_rss_mb": max(r["peak_rss_mb"] for r in ok),
                })
            else:
                res = results[-1]
                rows.append({"algo": algo, "variant": variant, "trace_len": L,
                             "status": res["status"],
                             "elapsed_s": res.get("elapsed_s")})
                failed.add(key)
            print(f"  {key} @ L={L}: {rows[-1]['status']} "
                  f"{rows[-1].get('elapsed_s')}")
    write_csv("ablation_tracelen", rows)


if __name__ == "__main__":
    main()
