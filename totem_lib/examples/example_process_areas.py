"""
End-to-end process area example: DuckDB import -> discovery -> hierarchy.

This is the pipeline the TOTeM web application runs behind its
/api/files/<pk>/discover_process_areas/ endpoint. See examples/PROCESS_AREAS.md
for the full documentation, the indicator definitions, and the list of
deviations from the thesis text.

Run from the totem_lib directory:

    python3 examples/example_process_areas.py
"""

from pathlib import Path

from totem_lib.ocel import import_ocel_db
from totem_lib.process_areas import prepare_db, process_areas_from_aggregates

DATASET = Path(__file__).parent.parent / "test_data" / "small" / "container_logistics.duckdb"


def print_hierarchy(title, process_view):
    print(f"\n{title}")
    # Highest level first -- that is how the visualizer stacks them, with the
    # resources on top.
    for level in sorted(process_view, reverse=True):
        for object_types, event_types in process_view[level]:
            types = ", ".join(sorted(object_types))
            print(f"  level {level}: {types}  ({len(event_types)} activities)")


def main():
    db = import_ocel_db(str(DATASET))

    # Preparation reads the log and is the expensive half; the parameters never
    # touch it. Prepare once, then solve as often as you like.
    aggregates = prepare_db(db)

    print(f"Object types: {', '.join(aggregates.object_types)}")
    print(f"Activities:   {len(aggregates.all_event_types)}")

    print_hierarchy(
        "Default (alpha = beta = 1, uniform indicator weights)",
        process_areas_from_aggregates(aggregates),
    )

    # alpha weights the resource force, so raising it pushes resources further
    # above the types they serve and yields a taller hierarchy.
    print_hierarchy(
        "Separation-heavy (alpha = 8)",
        process_areas_from_aggregates(aggregates, alpha=8.0),
    )

    # Dropping an indicator is a weight of zero; it is not scored at all.
    print_hierarchy(
        "Temporal indicator only",
        process_areas_from_aggregates(
            aggregates,
            weights={"temporal": 1.0, "cardinality": 0.0, "divergence": 0.0},
        ),
    )

    db.close()


if __name__ == "__main__":
    main()
