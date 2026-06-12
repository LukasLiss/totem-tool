"""
Benchmark on the three public OCEL 2.0 logs (container logistics, P2P,
order management): import cost per storage format and discovery cost per
engine (DuckDB-backed vs Polars in-memory vs pm4py for the OC-DFG).

Usage: python bench_real.py [--quick]
"""

import sys

import duckdb

from common import REAL_LOGS, TEST_DATA, median, run_task, write_csv

TIMEOUT_S = 900.0

# Semantically meaningful case notions (the central business object of each
# process), mirroring the variant correctness tests.
LEADING_TYPES = {
    "container_logistics": "CustomerOrder",
    "ocel2-p2p": "purchase_order",
    "order-management": "orders",
}


def leading_type(db_path: str) -> str:
    conn = duckdb.connect(db_path, read_only=True)
    t = conn.execute("""
        SELECT obj_type FROM objects GROUP BY obj_type ORDER BY COUNT(*) DESC, obj_type
        LIMIT 1
    """).fetchone()[0]
    conn.close()
    return t


def main():
    quick = "--quick" in sys.argv
    logs = REAL_LOGS[:1] if quick else REAL_LOGS
    repeats = 1 if quick else 3
    rows = []

    for log in logs:
        json_path = TEST_DATA / f"{log}.json"
        duck_path = TEST_DATA / f"{log}.duckdb"
        lead = LEADING_TYPES.get(log) or leading_type(str(duck_path))

        measurements = [
            ("import", "json->polars", {"op": "import_json_polars",
                                        "src_path": str(json_path)}),
            ("import", "json->duckdb", {"op": "import_json_db",
                                        "src_path": str(json_path)}),
            ("import", "duckdb-open", {"op": "load_duckdb",
                                       "db_path": str(duck_path)}),
            ("ocdfg", "duckdb", {"op": "ocdfg_db", "db_path": str(duck_path)}),
            ("ocdfg", "polars", {"op": "ocdfg_polars", "db_path": str(duck_path)}),
            ("ocdfg", "pm4py", {"op": "ocdfg_pm4py", "db_path": str(duck_path)}),
            ("totem", "duckdb", {"op": "totem_db", "db_path": str(duck_path)}),
            ("totem", "polars", {"op": "totem_polars", "db_path": str(duck_path)}),
            ("variants", "duckdb", {"op": "variants_db", "db_path": str(duck_path),
                                    "leading_type": lead}),
            ("variants", "polars", {"op": "variants_polars",
                                    "db_path": str(duck_path),
                                    "leading_type": lead}),
        ]
        for algo, engine, task in measurements:
            results = []
            for _ in range(repeats):
                res = run_task(task, timeout_s=TIMEOUT_S)
                results.append(res)
                if res["status"] != "ok":
                    break
            ok = [r for r in results if r["status"] == "ok"]
            if ok:
                rep = min(ok, key=lambda r: r["elapsed_s"])
                rows.append({
                    "log": log, "algo": algo, "engine": engine, "status": "ok",
                    "elapsed_s": median([r["elapsed_s"] for r in ok]),
                    "load_s": rep.get("load_s"),
                    "peak_rss_mb": max(r["peak_rss_mb"] for r in ok),
                    "n_variants": rep.get("n_variants"),
                    "leading_type": lead if algo == "variants" else None,
                })
            else:
                res = results[-1]
                rows.append({"log": log, "algo": algo, "engine": engine,
                             "status": res["status"],
                             "elapsed_s": res.get("elapsed_s")})
            print(f"  {log} {algo}/{engine}: {rows[-1]['status']} "
                  f"{rows[-1].get('elapsed_s')}")

    write_csv("real", rows)


if __name__ == "__main__":
    main()
