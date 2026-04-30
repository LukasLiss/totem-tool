"""
Interactive example for the object-centric variant calculation.

Loads a .duckdb file, runs find_variants with your chosen extraction and
iso strategy, and prints a ranked summary of the results.

Usage (from the totem_lib/ directory):
    # Quickstart — defaults: leading_1hop + wl+vf2 on CustomerOrder
    python examples/example_variants.py

    # Choose a different leading type
    python examples/example_variants.py --leading-type Forklift

    # Switch extraction technique
    python examples/example_variants.py --extraction connected

    # Fastest possible (SQL-only signature, no graph construction)
    python examples/example_variants.py --iso db_signature

    # Exact VF2 oracle (slowest, most accurate)
    python examples/example_variants.py --iso exact

    # Use a different dataset
    python examples/example_variants.py --db test_data/small/ocel2-p2p.duckdb

    # Turn off progress bars (e.g. for piping output)
    python examples/example_variants.py --no-verbose

    # Treat Forklift, Truck and Vehicle as resources (excluded from the
    # iso projection but re-introduced to the rep graph as edges)
    python examples/example_variants.py --resource-types Forklift,Truck,Vehicle

    # Be explicit about which types are business; the rest become resources
    python examples/example_variants.py \
        --business-types CustomerOrder,TransportDocument,Container

Available extraction strategies:
    leading_1hop   Fast: case = leading obj ∪ direct neighbours
    leading_bfs    Paper Definition 6: BFS with per-type distance pruning
    connected      Paper Definition 5: one case per connected component

Available iso strategies (fastest → most accurate):
    db_signature   Pure SQL multiset hash — may over-merge, no graphs built
    trace          Pure SQL timestamp-ordered sequence with per-event
                   obj-type counts — over-separates concurrent events
    signature      In-Python label+edge multiset — topology-blind
    wl             Weisfeiler-Lehman graph hash
    wl+vf2         WL bucketing + VF2 refinement  ← recommended default
    exact          Full pairwise VF2 (oracle, slowest)
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from totem_lib.ocel.ocel_duckdb import OcelDuckDB
from totem_lib.variants import find_variants

SCRIPT_DIR = Path(__file__).parent
DEFAULT_DB  = SCRIPT_DIR.parent / "test_data" / "small" / "container_logistics.duckdb"
DEFAULT_LEADING_TYPE = "CustomerOrder"


# ---------------------------------------------------------------------------
# Result printer
# ---------------------------------------------------------------------------

def _sep(char: str = "─", width: int = 72) -> str:
    return char * width


def print_summary(variants, *, top_n: int = 10, resource_types=None) -> None:
    total_exec = sum(len(v.executions) for v in variants)
    print()
    print(_sep("═"))
    print(f"  {len(variants)} variant(s)   {total_exec:,} execution(s) total")
    print(_sep("═"))

    res_set = set(resource_types or [])
    for rank, v in enumerate(variants[:top_n], start=1):
        pct = 100 * v.support / total_exec if total_exec else 0
        seq = v.graph.graph.get("sequence", [])
        seq_str = " → ".join(seq) if seq else "(no sequence)"

        print(f"\n  #{rank}  support={v.support}  ({pct:.1f}%)  "
              f"{v.graph.number_of_nodes()} nodes · {v.graph.number_of_edges()} edges")
        print(f"       {seq_str}")

        if res_set:
            res_seen: dict[str, set[str]] = {}
            for _u, _w, edata in v.graph.edges(data=True):
                etypes = (edata.get("type") or "").split("|")
                if not any(t in res_set for t in etypes):
                    continue
                # We can't know which obj_id corresponds to which type without
                # joining back to the DB, but for a summary "this variant uses
                # N resources of type X" we only need to count by type.
                for t in etypes:
                    if t in res_set:
                        # Approximate: attribute all edge objects to each
                        # matching type; deduped via set.
                        res_seen.setdefault(t, set()).update(
                            edata.get("objects") or []
                        )
            if res_seen:
                summary = ", ".join(
                    f"{t}(≤{len(ids)})" for t, ids in sorted(res_seen.items())
                )
                print(f"       resources: {summary}")

    if len(variants) > top_n:
        remaining = len(variants) - top_n
        print(f"\n  … {remaining} more variant(s) not shown (use --top-n to adjust)")

    print()
    print(_sep())


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--db", type=Path, default=DEFAULT_DB,
        help="path to a .duckdb file (default: container_logistics)",
    )
    parser.add_argument(
        "--extraction",
        choices=["leading_1hop", "leading_bfs", "connected"],
        default="leading_1hop",
        help="process execution extraction technique (default: leading_1hop)",
    )
    parser.add_argument(
        "--leading-type", default=DEFAULT_LEADING_TYPE,
        help="object type used as case anchor for leading_* extractions "
             f"(default: {DEFAULT_LEADING_TYPE})",
    )
    parser.add_argument(
        "--iso",
        choices=["db_signature", "trace", "signature", "wl", "wl+vf2", "exact"],
        default="wl+vf2",
        help="isomorphism / grouping strategy (default: wl+vf2)",
    )
    parser.add_argument(
        "--top-n", type=int, default=10,
        help="how many top variants to print (default: 10)",
    )
    parser.add_argument(
        "--business-types", type=str, default=None,
        help="comma-separated obj_types to treat as business objects "
             "(others become resources unless --resource-types is also given)",
    )
    parser.add_argument(
        "--resource-types", type=str, default=None,
        help="comma-separated obj_types to treat as resources "
             "(others become business unless --business-types is also given)",
    )
    parser.add_argument(
        "--no-verbose", action="store_true",
        help="suppress progress bars",
    )
    args = parser.parse_args()

    business_obj_types = (
        [t.strip() for t in args.business_types.split(",") if t.strip()]
        if args.business_types else None
    )
    resource_types = (
        [t.strip() for t in args.resource_types.split(",") if t.strip()]
        if args.resource_types else None
    )

    if not args.db.exists():
        sys.exit(f"Error: database not found: {args.db}")

    leading_type = (
        None if args.extraction == "connected" else args.leading_type
    )

    print(_sep("═"))
    print(f"  Dataset    : {args.db.name}")
    print(f"  Extraction : {args.extraction}"
          + (f"  (leading type: {leading_type})" if leading_type else ""))
    print(f"  Iso        : {args.iso}")
    if business_obj_types is not None:
        print(f"  Business   : {business_obj_types}")
    if resource_types is not None:
        print(f"  Resources  : {resource_types}")
    print(_sep("═"))

    db = OcelDuckDB.load(str(args.db))
    try:
        variants = find_variants(
            db,
            extraction=args.extraction,
            leading_type=leading_type,
            iso=args.iso,
            business_obj_types=business_obj_types,
            resource_types=resource_types,
            verbose=not args.no_verbose,
        )
    finally:
        db.close()

    print_summary(variants, top_n=args.top_n, resource_types=resource_types)


if __name__ == "__main__":
    main()
