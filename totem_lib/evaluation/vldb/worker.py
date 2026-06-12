"""
Benchmark worker: runs exactly one measured operation in a fresh process.

Invoked as  python worker.py '<task-json>'  by common.run_task(). Running
every measurement in its own process guarantees cold caches, isolates peak
RSS (resource.ru_maxrss covers the whole process), and lets the parent
enforce wall-clock timeouts and detect out-of-memory kills.

The result is printed as a single line:  RESULT {json}
"""

import json
import resource
import sys
import time


def _peak_rss_mb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0


def _open_db(task):
    from totem_lib.ocel.ocel_duckdb import OcelDuckDB

    db = OcelDuckDB.load(task["db_path"])
    if task.get("memory_limit"):
        db.conn.execute(f"SET memory_limit='{task['memory_limit']}'")
        db.conn.execute(
            f"SET temp_directory='{task.get('temp_directory', '/tmp/duckdb_spill')}'"
        )
    if task.get("threads"):
        db.conn.execute(f"SET threads={task['threads']}")
    return db


# ----------------------------------------------------------------------
# Synthetic log generation
# ----------------------------------------------------------------------

def op_gen(task):
    from totem_lib.generator import generate_synthetic_ocel

    t0 = time.perf_counter()
    db = generate_synthetic_ocel(db_path=task["db_path"], **task["gen_kwargs"])
    db.conn.execute("CHECKPOINT")
    n_events = db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    n_e2o = db.conn.execute("SELECT COUNT(*) FROM event_object").fetchone()[0]
    n_obj = db.conn.execute("SELECT COUNT(*) FROM objects").fetchone()[0]
    db.close()
    return {
        "elapsed_s": time.perf_counter() - t0,
        "n_events": n_events,
        "n_e2o": n_e2o,
        "n_objects": n_obj,
    }


# ----------------------------------------------------------------------
# DB-backed algorithms
# ----------------------------------------------------------------------

def op_ocdfg_db(task):
    from totem_lib.dfg.ocdfg_db import OCDFGDb

    db = _open_db(task)
    t0 = time.perf_counter()
    g = OCDFGDb.from_ocel_db(db)
    elapsed = time.perf_counter() - t0
    return {"elapsed_s": elapsed, "nodes": g.number_of_nodes(),
            "edges": g.number_of_edges()}


def op_ocdfg_db_naive(task):
    from totem_lib.dfg.ocdfg_db_naive import OCDFGDbNaive

    db = _open_db(task)
    t0 = time.perf_counter()
    g = OCDFGDbNaive.from_ocel_db(db)
    elapsed = time.perf_counter() - t0
    return {"elapsed_s": elapsed, "nodes": g.number_of_nodes(),
            "edges": g.number_of_edges()}


def op_totem_db(task):
    from totem_lib.totem.totem_db import totemDiscovery_db

    db = _open_db(task)
    t0 = time.perf_counter()
    totem = totemDiscovery_db(db)
    elapsed = time.perf_counter() - t0
    return {"elapsed_s": elapsed, "n_types": len(totem.tempgraph["nodes"])}


def op_totem_db_naive(task):
    from totem_lib.totem.totem_db_naive import totemDiscovery_db_naive

    db = _open_db(task)
    t0 = time.perf_counter()
    totem = totemDiscovery_db_naive(db)
    elapsed = time.perf_counter() - t0
    return {"elapsed_s": elapsed, "n_types": len(totem.tempgraph["nodes"])}


def op_variants_db(task):
    from totem_lib.variants.ocvariants_db import find_variants

    db = _open_db(task)
    t0 = time.perf_counter()
    v = find_variants(
        db,
        extraction=task.get("extraction", "leading_1hop"),
        leading_type=task["leading_type"],
        iso=task.get("iso", "exact"),
        timeout_s=None,
        verbose=False,
    )
    elapsed = time.perf_counter() - t0
    return {"elapsed_s": elapsed, "n_variants": len(v)}


# ----------------------------------------------------------------------
# In-memory (Polars) baselines
# ----------------------------------------------------------------------

def op_ocdfg_polars(task):
    from totem_lib.dfg.ocdfg import OCDFG
    from totem_lib.ocel.importer_duckdb import import_ocel_from_duckdb

    t0 = time.perf_counter()
    ocel = import_ocel_from_duckdb(task["db_path"])
    load_s = time.perf_counter() - t0
    t0 = time.perf_counter()
    g = OCDFG.from_ocel(ocel)
    elapsed = time.perf_counter() - t0
    return {"elapsed_s": elapsed, "load_s": load_s,
            "nodes": g.number_of_nodes(), "edges": g.number_of_edges()}


def op_totem_polars(task):
    from totem_lib.ocel.importer_duckdb import import_ocel_from_duckdb
    from totem_lib.totem.totem import totemDiscovery

    t0 = time.perf_counter()
    ocel = import_ocel_from_duckdb(task["db_path"])
    load_s = time.perf_counter() - t0
    t0 = time.perf_counter()
    totem = totemDiscovery(ocel)
    elapsed = time.perf_counter() - t0
    return {"elapsed_s": elapsed, "load_s": load_s,
            "n_types": len(totem.tempgraph["nodes"])}


def op_variants_polars(task):
    from totem_lib.ocel.importer_duckdb import import_ocel_from_duckdb
    from totem_lib.variants.ocvariants import find_variants_naive

    t0 = time.perf_counter()
    ocel = import_ocel_from_duckdb(task["db_path"])
    load_s = time.perf_counter() - t0
    t0 = time.perf_counter()
    v = find_variants_naive(ocel, task["leading_type"])
    elapsed = time.perf_counter() - t0
    return {"elapsed_s": elapsed, "load_s": load_s, "n_variants": len(v)}


# ----------------------------------------------------------------------
# pm4py baseline
# ----------------------------------------------------------------------

def _pm4py_ocel_from_duckdb(db_path):
    import duckdb
    from pm4py.objects.ocel.obj import OCEL

    conn = duckdb.connect(db_path, read_only=True)
    ev = conn.execute("""
        SELECT event_id AS "ocel:eid", activity AS "ocel:activity",
               to_timestamp(timestamp_unix) AS "ocel:timestamp"
        FROM events
    """).df()
    obj = conn.execute("""
        SELECT obj_id AS "ocel:oid", obj_type AS "ocel:type" FROM objects
    """).df()
    rel = conn.execute("""
        SELECT e.event_id AS "ocel:eid", e.activity AS "ocel:activity",
               to_timestamp(e.timestamp_unix) AS "ocel:timestamp",
               o.obj_id AS "ocel:oid", o.obj_type AS "ocel:type",
               COALESCE(eo.qualifier, '') AS "ocel:qualifier"
        FROM events e
        JOIN event_object eo ON e.event_id = eo.event_id
        JOIN objects o       ON eo.obj_id  = o.obj_id
    """).df()
    conn.close()
    return OCEL(events=ev, objects=obj, relations=rel)


def op_ocdfg_pm4py(task):
    import pm4py

    t0 = time.perf_counter()
    ocel = _pm4py_ocel_from_duckdb(task["db_path"])
    load_s = time.perf_counter() - t0
    t0 = time.perf_counter()
    pm4py.discover_ocdfg(ocel)
    elapsed = time.perf_counter() - t0
    return {"elapsed_s": elapsed, "load_s": load_s}


# ----------------------------------------------------------------------
# Import / storage measurements
# ----------------------------------------------------------------------

def op_import_json_polars(task):
    from totem_lib.ocel.importer import import_ocel

    t0 = time.perf_counter()
    ocel = import_ocel(task["src_path"])
    elapsed = time.perf_counter() - t0
    return {"elapsed_s": elapsed, "n_events": len(ocel.events)}


def op_import_json_db(task):
    from totem_lib.ocel.importer_db import import_ocel_db

    t0 = time.perf_counter()
    db = import_ocel_db(task["src_path"])
    elapsed = time.perf_counter() - t0
    n = db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    db.close()
    return {"elapsed_s": elapsed, "n_events": n}


def op_load_duckdb(task):
    from totem_lib.ocel.ocel_duckdb import OcelDuckDB

    t0 = time.perf_counter()
    db = OcelDuckDB.load(task["db_path"])
    n = db.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    elapsed = time.perf_counter() - t0
    db.close()
    return {"elapsed_s": elapsed, "n_events": n}


# ----------------------------------------------------------------------
# Incremental maintenance scenario
# ----------------------------------------------------------------------

def op_incremental(task):
    from totem_lib.dfg.ocdfg_db import OCDFGDb
    from totem_lib.incremental import (
        IncrementalOCDFG,
        IncrementalTotem,
        empty_ocel_db,
        split_batches,
    )
    from totem_lib.ocel.ocel_duckdb import OcelDuckDB
    from totem_lib.totem.totem_db import totemDiscovery_db

    algo = task["algo"]  # "totem" | "ocdfg"
    n_batches = task.get("n_batches", 10)
    base_fraction = task.get("base_fraction", 0.5)

    src = OcelDuckDB.load(task["db_path"])
    batches = split_batches(src, n_batches=n_batches, base_fraction=base_fraction)
    src.close()

    target = empty_ocel_db()
    inc = IncrementalTotem(target) if algo == "totem" else IncrementalOCDFG(target)

    base = batches[0]
    t0 = time.perf_counter()
    inc.append_batch(base.events, base.event_object, base.objects,
                     base.object_relations)
    base_s = time.perf_counter() - t0

    append_times, refresh_times = [], []
    for b in batches[1:]:
        t0 = time.perf_counter()
        inc.append_batch(b.events, b.event_object, b.objects, b.object_relations)
        append_times.append(time.perf_counter() - t0)
        t0 = time.perf_counter()
        if algo == "totem":
            inc.refresh()
        else:
            inc.get_ocdfg()
        refresh_times.append(time.perf_counter() - t0)

    t0 = time.perf_counter()
    if algo == "totem":
        totemDiscovery_db(target)
    else:
        OCDFGDb.from_ocel_db(target)
    full_s = time.perf_counter() - t0

    # Baseline: plain ingestion of the same batches without any summary
    # maintenance, to separate ingestion cost from maintenance overhead.
    plain = empty_ocel_db()
    insert_times = []
    for b in batches[1:]:
        t0 = time.perf_counter()
        plain.conn.register("pb_events", b.events)
        plain.conn.register("pb_eo", b.event_object)
        plain.conn.register("pb_objects", b.objects)
        plain.conn.execute(
            "INSERT INTO objects (obj_id, obj_type) SELECT obj_id, obj_type FROM pb_objects"
        )
        plain.conn.execute(
            "INSERT INTO events (event_id, activity, timestamp_unix) "
            "SELECT event_id, activity, timestamp_unix FROM pb_events"
        )
        plain.conn.execute(
            "INSERT INTO event_object (event_id, obj_id, qualifier) "
            "SELECT event_id, obj_id, qualifier FROM pb_eo"
        )
        if len(b.object_relations) > 0:
            plain.conn.register("pb_o2o", b.object_relations)
            plain.conn.execute(
                "INSERT INTO object_relations SELECT * FROM pb_o2o "
                "ON CONFLICT DO NOTHING"
            )
            plain.conn.unregister("pb_o2o")
        insert_times.append(time.perf_counter() - t0)
        for v in ("pb_events", "pb_eo", "pb_objects"):
            plain.conn.unregister(v)
    plain.close()

    return {
        "base_s": base_s,
        "mean_append_s": sum(append_times) / len(append_times),
        "max_append_s": max(append_times),
        "mean_insert_s": sum(insert_times) / len(insert_times),
        "mean_refresh_s": sum(refresh_times) / len(refresh_times),
        "full_recompute_s": full_s,
        "elapsed_s": sum(append_times) + sum(refresh_times),
        "batch_events": len(batches[1].events),
    }


OPS = {
    "gen": op_gen,
    "ocdfg_db": op_ocdfg_db,
    "ocdfg_db_naive": op_ocdfg_db_naive,
    "totem_db": op_totem_db,
    "totem_db_naive": op_totem_db_naive,
    "variants_db": op_variants_db,
    "ocdfg_polars": op_ocdfg_polars,
    "totem_polars": op_totem_polars,
    "variants_polars": op_variants_polars,
    "ocdfg_pm4py": op_ocdfg_pm4py,
    "import_json_polars": op_import_json_polars,
    "import_json_db": op_import_json_db,
    "load_duckdb": op_load_duckdb,
    "incremental": op_incremental,
}


def main():
    task = json.loads(sys.argv[1])
    if task.get("rlimit_mb"):
        lim = int(task["rlimit_mb"]) * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (lim, lim))
    out = OPS[task["op"]](task)
    out["peak_rss_mb"] = round(_peak_rss_mb(), 1)
    print("RESULT " + json.dumps(out))


if __name__ == "__main__":
    main()
