"""
Discover process areas with MLPA, then compute variants per area.

Pipeline:
  1. Load the OCEL with the polars backend and run totemDiscovery + mlpaDiscovery
     to get a layered process view. Each "process area" is a connected
     component of object types within one MLPA layer, paired with a set of
     event types assigned to it.

  2. For each area, classify object types:
       - business_obj_types  = obj_types belonging to this area
       - resource_types      = obj_types that *appear in this area's events*
                               but are NOT in the area's obj_type set
                               (i.e. they belong to other areas, but touch
                               events of this one — typical for shared
                               resources like Forklifts, Drivers, Employees)

  3. Re-load the same OCEL via the DuckDB backend and run `find_variants`
     once per area with the inferred business / resource split. The
     representative graph for each variant carries resource obj_ids on
     edges (same schema as business objects), so the output is fully
     compatible with downstream consumers like `calculate_layout`.

Usage (from the totem_lib/ directory):
    python examples/variants_from_process_areas.py
    python examples/variants_from_process_areas.py \\
        --ocel test_data/small/order-management.json
    python examples/variants_from_process_areas.py --tau 0.8 --iso wl
    python examples/variants_from_process_areas.py --extraction leading_1hop
"""

import argparse
import contextlib
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from totem_lib.ocel.importer import import_ocel
from totem_lib.ocel.importer_db import import_ocel_db
from totem_lib.totem import mlpaDiscovery, totemDiscovery
from totem_lib.variants import find_variants

SCRIPT_DIR  = Path(__file__).parent
DEFAULT_OCEL = SCRIPT_DIR.parent / "test_data" / "small" / "container_logistics.json"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sep(char: str = "─", width: int = 72) -> str:
    return char * width


def discover_process_areas(ocel_path: Path, tau: float, quiet: bool):
    """
    Run totemDiscovery + mlpaDiscovery and return a flat list of process areas.

    Each area is a dict with keys: level, index, obj_types (sorted list),
    event_types (sorted list).
    """
    ocel = import_ocel(str(ocel_path))

    # totemDiscovery and mlpaDiscovery print a lot — redirect when --quiet.
    sink = io.StringIO() if quiet else None
    redirect = (
        contextlib.redirect_stdout(sink) if quiet else contextlib.nullcontext()
    )
    with redirect:
        totem  = totemDiscovery(ocel, tau=tau)
        layers = mlpaDiscovery(totem)  # {level: [(obj_types_set, event_types_set), ...]}

    areas: list[dict] = []
    for level in sorted(layers.keys()):
        for idx, (obj_types, event_types) in enumerate(layers[level]):
            areas.append({
                "level":       float(level),
                "index":       idx,
                "obj_types":   sorted(obj_types),
                "event_types": sorted(event_types),
            })
    return areas, list(ocel.object_types)


def classify_resources_for_area(conn, area: dict, all_obj_types: list[str]) -> list[str]:
    """
    Resources of an area = obj_types appearing in the area's events but
    not in the area's own obj_type list. Computed by SQL.
    """
    if not area["event_types"]:
        return []
    rows = conn.execute(
        """
        SELECT DISTINCT o.obj_type
        FROM event_object eo
        JOIN events  e ON eo.event_id = e.event_id
        JOIN objects o ON eo.obj_id   = o.obj_id
        WHERE e.activity = ANY($acts)
          AND o.obj_type <> ALL($biz)
        """,
        {"acts": area["event_types"], "biz": area["obj_types"]},
    ).fetchall()
    return sorted(r[0] for r in rows)


def pick_leading_type(area: dict, conn) -> str | None:
    """
    For leading-* extraction, pick the obj_type with the most objects in
    this area's business set — it's usually the most informative anchor.
    """
    if not area["obj_types"]:
        return None
    rows = conn.execute(
        """
        SELECT obj_type, COUNT(*) AS n
        FROM objects
        WHERE obj_type = ANY($t)
        GROUP BY obj_type
        ORDER BY n DESC, obj_type
        LIMIT 1
        """,
        {"t": area["obj_types"]},
    ).fetchall()
    return rows[0][0] if rows else None


def print_area_header(area: dict, business: list[str], resources: list[str]) -> None:
    print()
    print(_sep("═"))
    print(f"  Process Area  L{area['level']:.0f} / #{area['index']}")
    print(_sep("═"))
    print(f"  Business obj_types : {business}")
    print(f"  Resource obj_types : {resources or '(none)'}")
    print(f"  Event types ({len(area['event_types'])}): {area['event_types']}")


def print_variant_summary(variants, *, top_n: int = 5,
                          resource_types: list[str] | None = None) -> None:
    total_exec = sum(len(v.executions) for v in variants)
    print(f"\n  → {len(variants)} variant(s), {total_exec:,} execution(s)")
    res_set = set(resource_types or [])
    for rank, v in enumerate(variants[:top_n], start=1):
        pct = 100 * v.support / total_exec if total_exec else 0
        seq = v.graph.graph.get("sequence", [])
        seq_str = " → ".join(seq[:8]) + ("…" if len(seq) > 8 else "")
        print(f"    #{rank:<2} support={v.support:<5} ({pct:5.1f}%)  "
              f"{v.graph.number_of_nodes()} nodes · "
              f"{v.graph.number_of_edges()} edges")
        print(f"        {seq_str or '(no sequence)'}")
        if res_set:
            seen: dict[str, set[str]] = {}
            for _u, _w, edata in v.graph.edges(data=True):
                etypes = (edata.get("type") or "").split("|")
                if not any(t in res_set for t in etypes):
                    continue
                for t in etypes:
                    if t in res_set:
                        seen.setdefault(t, set()).update(
                            edata.get("objects") or []
                        )
            if seen:
                print(
                    "        resources: "
                    + ", ".join(
                        f"{t}(≤{len(ids)})" for t, ids in sorted(seen.items())
                    )
                )
    if len(variants) > top_n:
        print(f"    … {len(variants) - top_n} more variant(s) not shown")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--ocel", type=Path, default=DEFAULT_OCEL,
        help="path to OCEL file (.json/.sqlite/.xml). "
             f"Default: {DEFAULT_OCEL.name}",
    )
    parser.add_argument(
        "--tau", type=float, default=0.9,
        help="totemDiscovery support threshold (default: 0.9)",
    )
    parser.add_argument(
        "--extraction",
        choices=["connected", "leading_1hop", "leading_bfs"],
        default="connected",
        help="extraction technique. 'connected' is recommended — it works "
             "for any area without picking a leading type. The leading_* "
             "options pick the most populous obj_type in each area as anchor.",
    )
    parser.add_argument(
        "--iso",
        choices=["db_signature", "trace", "signature", "wl", "wl+vf2", "exact"],
        default="wl+vf2",
        help="isomorphism / grouping strategy (default: wl+vf2)",
    )
    parser.add_argument(
        "--top-n", type=int, default=5,
        help="how many top variants to show per area (default: 5)",
    )
    parser.add_argument(
        "--quiet-mlpa", action="store_true",
        help="suppress the (very verbose) totemDiscovery / mlpaDiscovery "
             "internal prints",
    )
    parser.add_argument(
        "--no-verbose", action="store_true",
        help="suppress find_variants progress bars",
    )
    args = parser.parse_args()

    if not args.ocel.exists():
        sys.exit(f"Error: OCEL file not found: {args.ocel}")

    print(_sep("═"))
    print(f"  Variants per Process Area")
    print(f"  Dataset    : {args.ocel.name}")
    print(f"  tau        : {args.tau}")
    print(f"  Extraction : {args.extraction}")
    print(f"  Iso        : {args.iso}")
    print(_sep("═"))

    # ---- Step 1: discover process areas ----
    print("\n[1/3] Discovering process areas via mlpaDiscovery …", flush=True)
    areas, all_obj_types = discover_process_areas(
        args.ocel, args.tau, quiet=args.quiet_mlpa
    )
    print(f"      Found {len(areas)} process area(s) "
          f"across {len({a['level'] for a in areas})} level(s).")

    # ---- Step 2 & 3: classify and compute variants per area ----
    print("\n[2/3] Loading OCEL into DuckDB …", flush=True)
    db = import_ocel_db(str(args.ocel))

    print("\n[3/3] Computing variants per area …", flush=True)
    try:
        for area in areas:
            resources = classify_resources_for_area(db.conn, area, all_obj_types)
            print_area_header(area, area["obj_types"], resources)

            if not area["obj_types"]:
                print("  (no business obj_types — skipping)")
                continue
            if not area["event_types"]:
                # MLPA assigns each event type to exactly one area (the lowest
                # level that requests it). Areas at higher levels can therefore
                # end up without any unique event types — they are effectively
                # "resource-only" areas in the process model. Computing variants
                # for them would just trace these objects through events
                # belonging to *other* areas, which is rarely meaningful.
                print("  (resource-only area — no events assigned by MLPA, "
                      "skipping)")
                continue

            leading_type = (
                pick_leading_type(area, db.conn)
                if args.extraction.startswith("leading") else None
            )
            if args.extraction.startswith("leading"):
                print(f"  Leading type : {leading_type}")

            try:
                variants = find_variants(
                    db,
                    extraction=args.extraction,
                    leading_type=leading_type,
                    iso=args.iso,
                    business_obj_types=area["obj_types"],
                    resource_types=resources or None,
                    verbose=not args.no_verbose,
                )
            except ValueError as e:
                print(f"  Skipped: {e}")
                continue

            if not variants:
                print("  → no variants (no business edges in this area)")
                continue

            print_variant_summary(
                variants, top_n=args.top_n, resource_types=resources
            )
    finally:
        db.close()

    print()
    print(_sep("═"))


if __name__ == "__main__":
    main()
