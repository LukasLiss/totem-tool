"""
Bounded-memory benchmark: DuckDB-backed discovery under a hard memory limit
(out-of-core execution with disk spilling) vs in-memory baselines under an
equivalent address-space limit.

Usage: python bench_memory.py [--quick]
"""

import sys

from common import ensure_synthetic, run_task, write_csv

TIMEOUT_S = 1800.0


def main():
    quick = "--quick" in sys.argv
    n_events = 100_000 if quick else 10_000_000
    db_path = ensure_synthetic(n_events)

    rows = []
    configs = [
        # DuckDB under decreasing memory budgets (spills to disk).
        ("ocdfg", "duckdb", "ocdfg_db", {"memory_limit": "4GB"}),
        ("ocdfg", "duckdb", "ocdfg_db", {"memory_limit": "1GB"}),
        ("ocdfg", "duckdb", "ocdfg_db", {"memory_limit": "500MB"}),
        ("totem", "duckdb", "totem_db", {"memory_limit": "4GB"}),
        ("totem", "duckdb", "totem_db", {"memory_limit": "1GB"}),
        ("totem", "duckdb", "totem_db", {"memory_limit": "500MB"}),
        # In-memory baselines under an equivalent address-space budget.
        ("ocdfg", "polars", "ocdfg_polars", {"rlimit_mb": 4096}),
        ("totem", "polars", "totem_polars", {"rlimit_mb": 4096}),
    ]
    for algo, engine, op, extra in configs:
        task = {"op": op, "db_path": str(db_path), **extra}
        res = run_task(task, timeout_s=TIMEOUT_S)
        budget = extra.get("memory_limit") or f"{extra.get('rlimit_mb')}MB rlimit"
        row = {"algo": algo, "engine": engine, "budget": budget,
               "n_events": n_events, **{k: v for k, v in res.items()
                                        if k != "stderr_tail"}}
        rows.append(row)
        print(f"  {algo}/{engine} budget={budget}: {res['status']} "
              f"{res.get('elapsed_s')} rss={res.get('peak_rss_mb')}")
    write_csv("memory", rows)


if __name__ == "__main__":
    main()
