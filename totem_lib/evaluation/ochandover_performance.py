"""
Performance evaluation for the OC-Handover computation.

For each dataset the script:
  1. Imports the OCEL (not timed — import cost is shared with other evaluations).
  2. Runs MLPA discovery to derive resource / business-object type configurations
     from the detected level structure (same logic as the frontend "Pre-select from
     MLPA level" feature).  Each valid level yields one row in the results table.
     If MLPA fails or produces fewer than 2 levels the dataset falls back to the
     manual configs defined in DATASETS.
  3. Times the handover computation in three phases for both parallel=off and
     parallel=on:
       EOG  — building the Event-Object Graph (including footprint + arc
              modification when parallel is enabled)
       BFS  — bridge detection through the EOG (_resource_pairs_from_eog)
       Agg. — aggregation and normalisation of the handover edges
  4. Reports handover pairs (per BO type) and resource pairs (across BO types).

Run from the totem_lib/ directory:
    python evaluation/ochandover_performance.py
"""

import contextlib
import io
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import polars as pl

from totem_lib.ocel.importer import import_ocel
from totem_lib.ochandover.ochandover import OCHANDOVER

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR   = Path(__file__).parent
TEST_DATA    = SCRIPT_DIR.parent / "test_data" / "small"
RESULTS_FILE = SCRIPT_DIR / "OCHANDOVER_PERFORMANCE_RESULTS.md"

# ---------------------------------------------------------------------------
# Parallel filter configuration
# ---------------------------------------------------------------------------
# Activity pairs whose |dependency| <= PARALLEL_THRESHOLD and that appear at
# least MIN_PARALLEL_OBSERVATIONS times are treated as parallel.
# dependency = (count_ab - count_ba) / (count_ab + count_ba + 1); values
# near 0 indicate the strongest parallelism.

PARALLEL_THRESHOLD         = 1
MIN_PARALLEL_OBSERVATIONS  = 1

# ---------------------------------------------------------------------------
# Dataset configuration
# ---------------------------------------------------------------------------
# Add one entry per log file you want to benchmark.
# fallback_configs is used when MLPA auto-detection fails; each entry must have
# resource_types and bo_types lists.  Set it to [] to skip the dataset on
# MLPA failure.

DATASETS = [
    {
        "name": "container-logistics",
        "file": TEST_DATA / "container_logistics.json",
        "fallback_configs": [
            {"level": None, "resource_types": ["Forklift", "Truck"], "bo_types": ["Container", "Vehicle"]},
        ],
    },
    {
        "name": "ocel2-p2p",
        "file": TEST_DATA / "ocel2-p2p.json",
        "fallback_configs": [],
    },
    {
        "name": "order-management",
        "file": TEST_DATA / "order-management.json",
        "fallback_configs": [],
    },
    {
        "name": "hiring",
        "file": TEST_DATA / "03_hiring.xml",
        "fallback_configs": [],
    },
    {
        "name": "hospital",
        "file": TEST_DATA / "04_hospital.xml",
        "fallback_configs": [],
    },
]

# ---------------------------------------------------------------------------
# MLPA-based config derivation
# ---------------------------------------------------------------------------

def _mlpa_configs(ocel) -> list[dict] | None:
    """
    Run MLPA discovery and return one config per valid level.

    For each level L:
      - bo_types       = object types assigned to level L
      - resource_types = object types at any level > L

    Returns None when MLPA is unavailable or fails.
    """
    try:
        from totem_lib.totem import totemDiscovery, mlpaDiscovery  # type: ignore
    except ImportError:
        return None

    try:
        with contextlib.redirect_stdout(io.StringIO()):
            totem = totemDiscovery(ocel)
            process_view = mlpaDiscovery(totem)   # {level_float: [(ot_set, et_set), ...]}
    except Exception:
        return None

    if not process_view or len(process_view) < 2:
        return None

    sorted_levels = sorted(process_view.keys())
    configs: list[dict] = []

    for level in sorted_levels:
        bo_types = sorted({ot for ot_set, _ in process_view[level] for ot in ot_set})
        resource_types = sorted({
            ot
            for l in sorted_levels if l > level
            for ot_set, _ in process_view[l]
            for ot in ot_set
        })
        if bo_types and resource_types:
            configs.append({
                "level": int(level),
                "resource_types": resource_types,
                "bo_types": bo_types,
            })

    return configs if configs else None


# ---------------------------------------------------------------------------
# Timed handover computation
# ---------------------------------------------------------------------------

def _timed_handover(
    path: Path,
    resource_types: list[str],
    bo_types: list[str],
    parallel_threshold: float | None = None,
    min_parallel_observations: int = 1,
) -> dict:
    """
    Execute the handover computation and return per-phase timings and statistics.

    Phases:
      EOG  — event-object graph construction (+ footprint & arc modification
             when parallel_threshold is set)
      BFS  — handover bridge detection (_resource_pairs_from_eog)
      Agg. — aggregation and normalisation of handover edges

    All debug prints from the library are suppressed.
    """

    with contextlib.redirect_stdout(io.StringIO()):

        # Fresh OCEL load for each run to avoid any shared state from previous runs.
        ocel = import_ocel(str(path))

        # ── Phase 1: EOG construction ──────────────────────────────────────
        t0 = time.perf_counter()

        resource_ids: set[str] = set()
        for ot in resource_types:
            resource_ids.update(ocel.get_object_ids_by_type(ot))

        bo_ids: set[str] = set()
        for ot in bo_types:
            bo_ids.update(ocel.get_object_ids_by_type(ot))

        event_objects = (
            ocel.events
            .select(["_eventId", "_activity", "_timestampUnix", "_objects"])
            .explode("_objects")
            .rename({"_objects": "_objId"})
        )

        event_resources = (
            event_objects
            .filter(pl.col("_objId").is_in(resource_ids))
            .group_by("_eventId")
            .agg(pl.col("_objId").unique().alias("resources"))
        )

        bo_type_by_id: dict[str, str] = {
            obj_id: ot
            for ot in bo_types
            for obj_id in ocel.get_object_ids_by_type(ot)
        }
        bo_type_df = pl.DataFrame({
            "businessobject_id":   list(bo_type_by_id.keys()),
            "businessobject_type": list(bo_type_by_id.values()),
        })

        event_bos = (
            event_objects
            .filter(pl.col("_objId").is_in(bo_ids))
            .select([
                "_eventId", "_activity", "_timestampUnix",
                pl.col("_objId").alias("businessobject_id"),
            ])
            .join(bo_type_df, on="businessobject_id", how="left")
        )

        eog_arcs = (
            event_bos
            .sort(["businessobject_id", "_timestampUnix", "_eventId"])
            .with_columns([
                pl.col("_eventId")
                  .shift(-1).over("businessobject_id")
                  .alias("next_event_id"),
                pl.col("_timestampUnix")
                  .shift(-1).over("businessobject_id")
                  .alias("next_timestampUnix"),
            ])
            .filter(pl.col("next_event_id").is_not_null())
            .select([
                pl.col("_eventId").alias("source_event"),
                pl.col("next_event_id").alias("target_event"),
                "businessobject_id",
                "businessobject_type",
            ])
        )

        # Original arc count — kept for normalisation and as the pre-parallel baseline.
        eog_arc_count = (
            eog_arcs
            .select(["source_event", "target_event"])
            .unique()
            .height
        )

        n_bo_objects = len(bo_ids)

        # Number of (BO object, resource event) co-occurrences — the actual BFS starting-point count.
        _res_event_ids = set(event_resources.get_column("_eventId").to_list())
        n_bo_resource_cooccurrences = (
            event_bos
            .filter(pl.col("_eventId").is_in(_res_event_ids))
            .select(["businessobject_id", "_eventId"])
            .unique()
            .height
        )

        # Average number of resource objects per resource event.
        # High values mean BFS generates O(k²) pairs per bridge (combinatorial fan-out).
        avg_resources_per_event = round(
            event_resources
            .with_columns(pl.col("resources").list.len().alias("n"))
            .select("n")
            .mean()
            .item() or 0.0,
            2,
        )

        # ── Parallel filter (part of EOG phase) ───────────────────────────
        if parallel_threshold is not None:
            footprint = OCHANDOVER.compute_footprint(ocel, bo_types)

            parallel_set: set[tuple[str, str, str]] = set()
            for row in footprint.filter(
                (pl.col("relation") == "||") &
                (pl.col("dependency").abs() <= parallel_threshold) &
                ((pl.col("count_ab") + pl.col("count_ba")) >= min_parallel_observations)
            ).to_dicts():
                bo_type = row["businessobject_type"]
                a, b = row["activity_a"], row["activity_b"]
                parallel_set.add((bo_type, a, b))
                parallel_set.add((bo_type, b, a))

            _bo_seqs: dict = {}
            for row in (
                event_bos
                .sort(["businessobject_id", "_timestampUnix", "_eventId"])
                .to_dicts()
            ):
                bid = row["businessobject_id"]
                if bid not in _bo_seqs:
                    _bo_seqs[bid] = {"type": row["businessobject_type"], "events": []}
                _bo_seqs[bid]["events"].append((row["_eventId"], row["_activity"]))

            _new_arcs: list[dict] = []
            for bid, bo_data in _bo_seqs.items():
                bo_type = bo_data["type"]
                events  = bo_data["events"]
                n       = len(events)
                for i in range(n - 1):
                    eid_i, act_i = events[i]
                    eid_next, act_next = events[i + 1]
                    if (bo_type, act_i, act_next) not in parallel_set:
                        _new_arcs.append({
                            "source_event": eid_i, "target_event": eid_next,
                            "businessobject_id": bid, "businessobject_type": bo_type,
                            "_orphan": False,
                        })
                    else:
                        for j in range(i + 1, n):
                            eid_j, act_j = events[j]
                            if (bo_type, act_i, act_j) not in parallel_set:
                                _new_arcs.append({
                                    "source_event": eid_i, "target_event": eid_j,
                                    "businessobject_id": bid, "businessobject_type": bo_type,
                                    "_orphan": False,
                                })
                                break
                        for j in range(i, -1, -1):
                            eid_j, act_j = events[j]
                            if (bo_type, act_j, act_next) not in parallel_set:
                                _new_arcs.append({
                                    "source_event": eid_j, "target_event": eid_next,
                                    "businessobject_id": bid, "businessobject_type": bo_type,
                                    "_orphan": True,
                                })
                                break

            if _new_arcs:
                eog_arcs = (
                    pl.DataFrame(_new_arcs)
                    .drop("_orphan")
                    .unique(subset=["source_event", "target_event", "businessobject_id"])
                )
            else:
                eog_arcs = pl.DataFrame(schema={
                    "source_event": pl.Utf8, "target_event": pl.Utf8,
                    "businessobject_id": pl.Utf8, "businessobject_type": pl.Utf8,
                })

        # Effective arc count — after parallel modification (same as original when parallel is off).
        eog_arc_count_effective = (
            eog_arcs
            .select(["source_event", "target_event"])
            .unique()
            .height
        )

        # EOG node count = unique event IDs that appear as source or target of any arc.
        # EOG density = arcs / nodes (average arc count per node, a proxy for graph connectivity).
        n_eog_nodes = (
            pl.concat([
                eog_arcs.select(pl.col("source_event").alias("e")),
                eog_arcs.select(pl.col("target_event").alias("e")),
            ])
            .unique()
            .height
        )
        eog_density = round(eog_arc_count_effective / n_eog_nodes, 2) if n_eog_nodes > 0 else 0.0

        event_ts = (
            event_bos
            .select(["_eventId", "_timestampUnix"])
            .unique("_eventId")
        )

        t_eog = time.perf_counter() - t0

        # ── Phase 2: BFS / handover detection ─────────────────────────────
        t1 = time.perf_counter()

        _resource_event_set = set(event_resources.get_column("_eventId").to_list())
        _event_resources_dict = {r["_eventId"]: r["resources"] for r in event_resources.to_dicts()}
        _event_ts_dict = {r["_eventId"]: r["_timestampUnix"] for r in event_ts.to_dicts()}

        _bo_type_map, _raw = OCHANDOVER._bfs_bridges(eog_arcs, _resource_event_set, None)
        _, _canonical = OCHANDOVER._canonical_from_raw(_raw, _event_resources_dict, _event_ts_dict)

        # Number of canonical bridges and average gap across them.
        n_canonicals = len(_canonical)
        avg_gap = round(sum(_canonical.values()) / n_canonicals, 2) if _canonical else 0.0

        # Expand canonical to (source, target, bo_type, time_delta) rows.
        _pair_rows: dict = {}
        for (_src_eid, _tgt_eid, _bid), _ in _canonical.items():
            _btype = _bo_type_map[_bid]
            _src_ts = _event_ts_dict.get(_src_eid, 0)
            _tgt_ts = _event_ts_dict.get(_tgt_eid, 0)
            for _src in _event_resources_dict.get(_src_eid, []):
                for _tgt in _event_resources_dict.get(_tgt_eid, []):
                    _k = (_src_eid, _tgt_eid, _src, _tgt, _btype)
                    if _k not in _pair_rows:
                        _pair_rows[_k] = {
                            "source": _src, "target": _tgt,
                            "businessobject_type": _btype,
                            "time_delta": _tgt_ts - _src_ts,
                        }

        _schema = {"source": pl.Utf8, "target": pl.Utf8, "businessobject_type": pl.Utf8, "time_delta": pl.Int64}
        raw_handovers = pl.DataFrame(list(_pair_rows.values()), schema=_schema) if _pair_rows else pl.DataFrame(schema=_schema)

        t_bfs = time.perf_counter() - t1

        # ── Phase 3: Aggregation & normalisation ───────────────────────────
        t2 = time.perf_counter()

        if not raw_handovers.is_empty():
            handover_edges = (
                raw_handovers
                .group_by(["source", "target", "businessobject_type"])
                .agg(pl.len().alias("weight"))
                .sort("weight", descending=True)
                .with_columns(
                    (pl.col("weight") / max(eog_arc_count, 1)).alias("norm_weight")
                )
            )
            n_pairs          = len(handover_edges)
            n_instances      = int(handover_edges.select(pl.col("weight").sum()).item())
            n_resource_pairs = handover_edges.select(["source", "target"]).unique().height
        else:
            n_pairs          = 0
            n_instances      = 0
            n_resource_pairs = 0

        t_agg = time.perf_counter() - t2

    return {
        "t_eog":                   round(t_eog, 3),
        "t_bfs":                   round(t_bfs, 3),
        "t_agg":                   round(t_agg, 3),
        "t_total":                 round(t_eog + t_bfs + t_agg, 3),
        "avg_gap":                 avg_gap,
        "n_canonicals":            n_canonicals,
        "n_pairs":                 n_pairs,
        "n_instances":             n_instances,
        "n_resource_pairs":        n_resource_pairs,
        "n_bo_objects":              n_bo_objects,
        "n_bo_res_cooc":             n_bo_resource_cooccurrences,
        "avg_res_per_event":         avg_resources_per_event,
        "eog_arc_count_effective":   eog_arc_count_effective,
        "n_eog_nodes":               n_eog_nodes,
        "eog_density":               eog_density,
    }


# ---------------------------------------------------------------------------
# Dataset evaluation
# ---------------------------------------------------------------------------

def _fmt_types(types: list[str]) -> str:
    return ", ".join(types)


def evaluate_dataset(dataset: dict) -> list[dict]:
    path: Path = dataset["file"]
    name: str  = dataset["name"]

    if not path.exists():
        print(f"  SKIP: file not found: {path}")
        return []

    print(f"  importing ...", end=" ", flush=True)
    with contextlib.redirect_stdout(io.StringIO()):
        ocel = import_ocel(str(path))
    n_events = len(ocel.events)
    print(f"{n_events} events, {len(ocel.object_types)} object types")

    print(f"  running MLPA ...", end=" ", flush=True)
    configs = _mlpa_configs(ocel)
    if configs:
        print(f"{len(configs)} level config(s) found")
    else:
        print("failed or single level — using fallback configs")
        configs = dataset.get("fallback_configs", [])

    if not configs:
        print("  SKIP: no valid resource/BO type configuration available")
        return []

    rows: list[dict] = []
    for cfg in configs:
        level          = cfg["level"]
        resource_types = cfg["resource_types"]
        bo_types       = cfg["bo_types"]
        label          = f"level {level}" if level is not None else "manual"

        for parallel in (False, True):
            pt    = PARALLEL_THRESHOLD if parallel else None
            p_col = f"{PARALLEL_THRESHOLD}" if parallel else "—"

            print(
                f"  [{label}] parallel={p_col}  "
                f"res={resource_types}  bo={bo_types} ...",
                end=" ", flush=True,
            )

            try:
                stats = _timed_handover(
                    path, resource_types, bo_types,
                    parallel_threshold=pt,
                    min_parallel_observations=MIN_PARALLEL_OBSERVATIONS,
                )
                print(
                    f"total={stats['t_total']}s  "
                    f"({stats['n_pairs']} pairs, {stats['n_resource_pairs']} resource pairs)"
                )
                rows.append({
                    "name":                    name,
                    "events":                  n_events,
                    "level":                   str(level) if level is not None else "—",
                    "resource_types":          _fmt_types(resource_types),
                    "bo_types":                _fmt_types(bo_types),
                    "parallel":                p_col,
                    "n_bo_objects":            stats["n_bo_objects"],
                    "n_bo_res_cooc":           stats["n_bo_res_cooc"],
                    "avg_res_per_event":       stats["avg_res_per_event"],
                    "complexity_est":          round(
                        stats["n_bo_res_cooc"] * stats["eog_density"] * stats["avg_res_per_event"], 1
                    ),
                    "eog_arc_count_effective": stats["eog_arc_count_effective"],
                    "n_eog_nodes":             stats["n_eog_nodes"],
                    "eog_density":             stats["eog_density"],
                    "t_eog":                   stats["t_eog"],
                    "t_bfs":                   stats["t_bfs"],
                    "t_agg":                   stats["t_agg"],
                    "t_total":                 stats["t_total"],
                    "avg_gap":                 stats["avg_gap"],
                    "n_canonicals":            stats["n_canonicals"],
                    "n_pairs":                 stats["n_pairs"],
                    "n_instances":             stats["n_instances"],
                    "n_resource_pairs":        stats["n_resource_pairs"],
                })
            except Exception as exc:
                print(f"FAILED: {exc}")

    return rows


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

HEADER = (
    "| Log | Events | Level | Resource Types | BO Types | Parallel "
    "| BO Objects | BO×Res Co-occ. | Avg Res/Event | Complexity Est. | EOG Arcs | EOG Nodes | EOG Density "
    "| EOG (s) | BFS (s) | Agg. (s) | Total (s) "
    "| Avg Gap | Canonicals | Handover Pairs | Handover Instances | Resource Pairs |"
)
SEPARATOR = "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"
ROW_FMT = (
    "| {name} | {events} | {level} | {resource_types} | {bo_types} | {parallel} "
    "| {n_bo_objects} | {n_bo_res_cooc} | {avg_res_per_event} | {complexity_est} | {eog_arc_count_effective} "
    "| {n_eog_nodes} | {eog_density} "
    "| {t_eog} | {t_bfs} | {t_agg} | {t_total} "
    "| {avg_gap} | {n_canonicals} | {n_pairs} | {n_instances} | {n_resource_pairs} |"
)


def print_table(rows: list[dict]) -> None:
    print("\n" + HEADER)
    print(SEPARATOR)
    for r in rows:
        print(ROW_FMT.format(**r))


def write_results(rows: list[dict]) -> None:
    with open(RESULTS_FILE, "w") as f:
        f.write("# OC-Handover Performance Results\n\n")
        f.write(
            "Three-phase timing: **EOG** = event-object graph construction "
            "(includes footprint & arc modification when Parallel is set), "
            "**BFS** = handover bridge detection, "
            "**Agg.** = aggregation & normalisation.  "
            f"Parallel threshold: {PARALLEL_THRESHOLD}, "
            f"min observations: {MIN_PARALLEL_OBSERVATIONS}.\n"
            "Level is the MLPA level used as business-object layer "
            "(types at higher levels become resources).\n\n"
        )
        f.write(f"{HEADER}\n{SEPARATOR}\n")
        for r in rows:
            f.write(ROW_FMT.format(**r) + "\n")

    print(f"\nResults written to {RESULTS_FILE}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    all_rows: list[dict] = []

    for dataset in DATASETS:
        print(f"\n{dataset['name']}")
        try:
            rows = evaluate_dataset(dataset)
            all_rows.extend(rows)
        except Exception as exc:
            print(f"  FAILED: {exc}")

    if all_rows:
        print_table(all_rows)
        write_results(all_rows)
    else:
        print("\nNo results — place OCEL files in test_data/small/ and check DATASETS.")


if __name__ == "__main__":
    main()
