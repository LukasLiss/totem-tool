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


def print_summary(variants, *, top_n: int = 10) -> None:
    total_exec = sum(len(v.executions) for v in variants)
    print()
    print(_sep("═"))
    print(f"  {len(variants)} variant(s)   {total_exec:,} execution(s) total")
    print(_sep("═"))

    for rank, v in enumerate(variants[:top_n], start=1):
        pct = 100 * v.support / total_exec if total_exec else 0
        seq = v.graph.graph.get("sequence", [])
        seq_str = " → ".join(seq) if seq else "(no sequence)"

        print(f"\n  #{rank}  support={v.support}  ({pct:.1f}%)  "
              f"{v.graph.number_of_nodes()} nodes · {v.graph.number_of_edges()} edges")
        print(f"       {seq_str}")

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
        "--no-verbose", action="store_true",
        help="suppress progress bars",
    )
    args = parser.parse_args()

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
    print(_sep("═"))

    db = OcelDuckDB.load(str(args.db))
    try:
        variants = find_variants(
            db,
            extraction=args.extraction,
            leading_type=leading_type,
            iso=args.iso,
            verbose=not args.no_verbose,
        )
    finally:
        db.close()

    print_summary(variants, top_n=args.top_n)


if __name__ == "__main__":
    main()
