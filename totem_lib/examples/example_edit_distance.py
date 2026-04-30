"""
Edit distance between two process executions (representative variant graphs).

Loads a .duckdb file, computes its variants, then compares the most frequent
variant against the 2nd and 6th most frequent ones using
`process_execution_edit_distance`. Prints the total cost and the concrete
list of edits per comparison.

Usage (from the totem_lib/ directory):

    # Quickstart — defaults: ocel2-p2p, leading_1hop on purchase_requisition
    python examples/example_edit_distance.py

    # Different dataset
    python examples/example_edit_distance.py --db test_data/small/order-management.duckdb \\
                                             --leading-type orders

    # Compare different ranks
    python examples/example_edit_distance.py --compare 0,2 --compare 1,3

    # Override a cost (constant cost per delete_event regardless of objects)
    python examples/example_edit_distance.py --delete-event-cost 5

The default cost of every operation is the number of involved objects on the
event(s) it affects.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from totem_lib.ocel.ocel_duckdb import OcelDuckDB
from totem_lib.variants import find_variants
from totem_lib.variants.edit_distance import (
    EditCosts,
    process_execution_edit_distance,
)

SCRIPT_DIR = Path(__file__).parent
DEFAULT_DB = SCRIPT_DIR.parent / "test_data" / "small" / "ocel2-p2p.duckdb"
DEFAULT_LEADING_TYPE = "purchase_requisition"


def _sep(char: str = "-", width: int = 72) -> str:
    return char * width


def _print_variant_summary(variants, *, top_n: int = 10) -> None:
    total_exec = sum(len(v.executions) for v in variants)
    print(_sep("="))
    print(f"  {len(variants)} variant(s)   {total_exec:,} execution(s) total")
    print(_sep("="))
    for rank, v in enumerate(variants[:top_n], start=1):
        pct = 100 * v.support / total_exec if total_exec else 0
        seq = v.graph.graph.get("sequence", [])
        seq_str = " -> ".join(seq) if seq else "(no sequence)"
        print(
            f"  #{rank - 1}  support={v.support}  ({pct:.1f}%)  "
            f"{v.graph.number_of_nodes()} nodes / {v.graph.number_of_edges()} edges"
        )
        print(f"        {seq_str}")
    print()


def _compare(variants, a_idx: int, b_idx: int, ocel_db, costs: EditCosts) -> None:
    print(_sep("="))
    if a_idx >= len(variants) or b_idx >= len(variants):
        print(
            f"  Skipped v{a_idx} vs v{b_idx}: only {len(variants)} variant(s) available"
        )
        print(_sep("="))
        print()
        return

    va, vb = variants[a_idx], variants[b_idx]
    print(f"  v{a_idx} (support={va.support}) -> v{b_idx} (support={vb.support})")
    print(_sep("="))

    total_cost, edits = process_execution_edit_distance(
        va, vb, ocel_db=ocel_db, costs=costs
    )

    print(f"  Total cost: {total_cost:g}")
    print(f"  {len(edits)} edit(s):")
    for e in edits:
        src = e.source_event if e.source_event is not None else "-"
        tgt = e.target_event if e.target_event is not None else "-"
        objs_preview = ",".join(e.objects[:3])
        if len(e.objects) > 3:
            objs_preview += f",...(+{len(e.objects) - 3})"
        print(
            f"    {e.op:14s}  src={src:24s}  tgt={tgt:24s}  "
            f"|objs|={len(e.objects)} [{objs_preview}]  cost={e.cost:g}"
        )
    print()


def _build_costs(args) -> EditCosts:
    overrides = {}
    for op in (
        "delete_event",
        "add_event",
        "move_event",
        "add_objects",
        "remove_objects",
    ):
        val = getattr(args, f"{op}_cost", None)
        if val is not None:
            overrides[op] = val
    return EditCosts.from_constants(**overrides) if overrides else EditCosts()


def _parse_compare(spec: str) -> tuple[int, int]:
    a, b = spec.split(",")
    return int(a), int(b)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB,
        help="path to a .duckdb file (default: ocel2-p2p)",
    )
    parser.add_argument(
        "--extraction",
        choices=["leading_1hop", "leading_bfs", "connected"],
        default="leading_1hop",
        help="process execution extraction technique (default: leading_1hop)",
    )
    parser.add_argument(
        "--leading-type",
        default=DEFAULT_LEADING_TYPE,
        help=f"leading object type (default: {DEFAULT_LEADING_TYPE})",
    )
    parser.add_argument(
        "--iso",
        choices=["db_signature", "trace", "signature", "wl", "wl+vf2", "exact"],
        default="wl+vf2",
        help="isomorphism / grouping strategy (default: wl+vf2)",
    )
    parser.add_argument(
        "--top-n",
        type=int,
        default=10,
        help="number of top variants to summarize (default: 10)",
    )
    parser.add_argument(
        "--compare",
        action="append",
        type=_parse_compare,
        help="comma-separated pair of variant ranks to compare; may be repeated. "
             "Default: --compare 0,1 --compare 0,5",
    )
    for op in (
        "delete-event",
        "add-event",
        "move-event",
        "add-objects",
        "remove-objects",
    ):
        parser.add_argument(
            f"--{op}-cost",
            type=float,
            default=None,
            help=f"override the {op.replace('-', ' ')} cost (constant value)",
        )
    parser.add_argument(
        "--no-verbose", action="store_true", help="suppress progress bars"
    )
    args = parser.parse_args()

    if not args.db.exists():
        sys.exit(f"Error: database not found: {args.db}")

    leading_type = None if args.extraction == "connected" else args.leading_type
    pairs = args.compare if args.compare else [(0, 1), (0, 5)]
    costs = _build_costs(args)

    print(_sep("="))
    print(f"  Dataset    : {args.db.name}")
    print(f"  Extraction : {args.extraction}"
          + (f"  (leading type: {leading_type})" if leading_type else ""))
    print(f"  Iso        : {args.iso}")
    print(_sep("="))

    db = OcelDuckDB.load(str(args.db))
    try:
        variants = find_variants(
            db,
            extraction=args.extraction,
            leading_type=leading_type,
            iso=args.iso,
            verbose=not args.no_verbose,
        )

        _print_variant_summary(variants, top_n=args.top_n)

        for a, b in pairs:
            _compare(variants, a, b, db, costs)
    finally:
        db.close()


if __name__ == "__main__":
    main()
