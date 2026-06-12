"""Shared infrastructure for the VLDB benchmark suite."""

import csv
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
WORKER = HERE / "worker.py"
RESULTS_DIR = HERE / "results"
CACHE_DIR = Path(os.environ.get("TOTEM_BENCH_CACHE", "/tmp/totem_vldb_cache"))

TEST_DATA = HERE.parent.parent / "test_data" / "small"

REAL_LOGS = ["container_logistics", "ocel2-p2p", "order-management"]


def run_task(task: dict, timeout_s: float = 600.0) -> dict:
    """Run one operation in a fresh worker process and collect its metrics."""
    cmd = [sys.executable, str(WORKER), json.dumps(task)]
    t0 = time.time()
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout_s,
            cwd=str(HERE.parent.parent),
        )
    except subprocess.TimeoutExpired:
        return {"status": "timeout", "elapsed_s": timeout_s}
    wall = time.time() - t0
    if proc.returncode != 0:
        oom_markers = ("MemoryError", "std::bad_alloc", "Out of Memory",
                       "OutOfMemoryException", "Cannot allocate memory")
        is_oom = proc.returncode in (-9, 137) or any(
            m in proc.stderr for m in oom_markers
        )
        return {
            "status": "oom" if is_oom else "error",
            "elapsed_s": wall,
            "stderr_tail": proc.stderr.strip()[-400:],
        }
    result_lines = [l for l in proc.stdout.splitlines() if l.startswith("RESULT ")]
    if not result_lines:
        return {"status": "error", "elapsed_s": wall,
                "stderr_tail": proc.stderr.strip()[-400:]}
    out = json.loads(result_lines[-1][len("RESULT "):])
    out["status"] = "ok"
    return out


def synthetic_db_path(n_events: int) -> Path:
    return CACHE_DIR / f"synth_{n_events}.duckdb"


def ensure_synthetic(n_events: int, timeout_s: float = 1800.0) -> Path:
    """Generate (once) a synthetic log with ~n_events events (K=3, L=10)."""
    path = synthetic_db_path(n_events)
    if path.exists():
        return path
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    objects_per_type = max(n_events // (3 * 10), 1)
    res = run_task(
        {
            "op": "gen",
            "db_path": str(path),
            "gen_kwargs": {
                "n_types": 3,
                "objects_per_type": objects_per_type,
                "events_per_object": 10,
                "share_pct": 30,
                "seed": 42,
            },
        },
        timeout_s=timeout_s,
    )
    if res["status"] != "ok":
        raise RuntimeError(f"generation of {n_events} events failed: {res}")
    print(f"  generated {res['n_events']} events "
          f"({res['n_e2o']} e2o rows) in {res['elapsed_s']:.1f}s -> {path}")
    return path


def write_csv(name: str, rows: list[dict]) -> Path:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    path = RESULTS_DIR / f"{name}.csv"
    keys: list[str] = []
    for row in rows:
        for k in row:
            if k not in keys:
                keys.append(k)
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=keys)
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {path} ({len(rows)} rows)")
    return path


def median(values):
    s = sorted(values)
    return s[len(s) // 2]
