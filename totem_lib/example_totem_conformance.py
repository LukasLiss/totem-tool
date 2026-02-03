"""
Example script demonstrating TOTeM conformance checking.

This script:
1. Loads an OCEL (Object-Centric Event Log) from a JSON file
2. Discovers a TOTeM (Temporal Object Type Model) from the log
3. Computes conformance metrics (fitness and precision) for the model against the log
4. Prints the results in a readable format
"""

from totem_lib import import_ocel, totemDiscovery, conformance_of_totem


def print_separator(title):
    """Print a formatted section separator."""
    print(f"\n{'=' * 60}")
    print(f" {title}")
    print(f"{'=' * 60}\n")


def print_histogram(histogram, histogram_type, total_key, relation_keys):
    """
    Print a histogram in a nicely formatted table.

    :param histogram: The histogram dictionary {(type1, type2): {relation: count, ...}}
    :param histogram_type: Name of the histogram type (e.g., "Temporal Relations")
    :param total_key: The key for total count (e.g., "total")
    :param relation_keys: List of relation keys to display
    """
    if not histogram:
        print(f"  No data available for {histogram_type}")
        return

    # Build header
    header = f"{'Type Pair':<35} | {'Total':>8}"
    for rel in relation_keys:
        header += f" | {rel:>8}"
    print(header)
    print("-" * len(header))

    # Sort by type pairs for consistent output
    sorted_pairs = sorted(histogram.keys(), key=lambda x: (x[0], x[1]))

    for (t1, t2) in sorted_pairs:
        counts = histogram[(t1, t2)]
        total = counts.get(total_key, 0)
        if total == 0:
            continue

        row = f"({t1}, {t2})"
        row = f"{row:<35} | {total:>8}"

        for rel in relation_keys:
            count = counts.get(rel, 0)
            percentage = (count / total * 100) if total > 0 else 0
            row += f" | {count:>5} ({percentage:>4.1f}%)"

        # Truncate row if too long, but keep it readable
        print(row[:200] + "..." if len(row) > 200 else row)


def print_histogram_by_activity(histogram, total_key, relation_keys):
    """
    Print event cardinality histogram grouped by activity.

    :param histogram: Dictionary with (type1, type2, activity) keys
    :param total_key: The key for total count
    :param relation_keys: List of relation keys to display
    """
    if not histogram:
        print("  No data available")
        return

    # Group by type pair
    type_pair_activities = {}
    for (t1, t2, activity) in histogram.keys():
        type_pair_activities.setdefault((t1, t2), []).append(activity)

    # Sort type pairs
    sorted_pairs = sorted(type_pair_activities.keys(), key=lambda x: (x[0], x[1]))

    for (t1, t2) in sorted_pairs:
        activities = sorted(type_pair_activities[(t1, t2)])
        print(f"\n  ({t1}, {t2}):")

        # Build header
        header = f"    {'Activity':<30} | {'Total':>8}"
        for rel in relation_keys:
            header += f" | {rel:>6}"
        print(header)
        print("    " + "-" * (len(header) - 4))

        for activity in activities:
            counts = histogram[(t1, t2, activity)]
            total = counts.get(total_key, 0)
            if total == 0:
                continue

            row = f"    {activity:<30} | {total:>8}"
            for rel in relation_keys:
                count = counts.get(rel, 0)
                pct = (count / total * 100) if total > 0 else 0
                row += f" | {count:>4} ({pct:>4.1f}%)"

            print(row[:180] + "..." if len(row) > 180 else row)


def print_histogram_by_relation_type(histogram, histogram_type, total_key, relation_keys):
    """
    Print histogram grouped by relation type (e2o or o2o qualifier).

    :param histogram: Dictionary with (type1, type2, relation_type) keys
    :param histogram_type: Name of the histogram type
    :param total_key: The key for total count
    :param relation_keys: List of relation keys to display
    """
    if not histogram:
        print(f"  No data available for {histogram_type}")
        return

    # Group by type pair
    type_pair_reltypes = {}
    for (t1, t2, rel_type) in histogram.keys():
        type_pair_reltypes.setdefault((t1, t2), []).append(rel_type)

    # Sort type pairs
    sorted_pairs = sorted(type_pair_reltypes.keys(), key=lambda x: (x[0], x[1]))

    for (t1, t2) in sorted_pairs:
        rel_types = sorted(type_pair_reltypes[(t1, t2)])
        print(f"\n  ({t1}, {t2}):")

        # Build header
        header = f"    {'Relation Type':<20} | {'Total':>8}"
        for rel in relation_keys:
            header += f" | {rel:>6}"
        print(header)
        print("    " + "-" * (len(header) - 4))

        for rel_type in rel_types:
            counts = histogram[(t1, t2, rel_type)]
            total = counts.get(total_key, 0)
            if total == 0:
                continue

            row = f"    {rel_type:<20} | {total:>8}"
            for rel in relation_keys:
                count = counts.get(rel, 0)
                pct = (count / total * 100) if total > 0 else 0
                row += f" | {count:>4} ({pct:>4.1f}%)"

            print(row[:180] + "..." if len(row) > 180 else row)


def print_histograms(histograms):
    """Print all histograms in a nicely formatted way."""

    # Temporal Relations
    print_separator("Histogram: Temporal Relations")
    print("Legend: D=Dependent, Di=Dependent-Inv, I=Initiating, Ii=Initiating-Inv, P=Parallel\n")
    tr_keys = ["D", "Di", "I", "Ii", "P"]
    print_histogram(histograms["temporal"], "Temporal Relations", "total", tr_keys)

    # Log Cardinalities
    print_separator("Histogram: Log Cardinalities")
    print("Legend: 0=Zero, 1=One, 0...1=Zero-One, 1..*=Many, 0...*=Zero-Many\n")
    lc_keys = ["0", "1", "0...1", "1..*", "0...*"]
    print_histogram(histograms["log_cardinality"], "Log Cardinalities", "total", lc_keys)

    # Event Cardinalities
    print_separator("Histogram: Event Cardinalities")
    print("Legend: 0=Zero, 1=One, 0...1=Zero-One, 1..*=Many, 0...*=Zero-Many\n")
    ec_keys = ["0", "1", "0...1", "1..*", "0...*"]
    print_histogram(histograms["event_cardinality"], "Event Cardinalities", "total", ec_keys)


def print_fine_grained_histograms(histograms):
    """Print fine-grained histograms (by activity and relation type)."""

    # Event Cardinalities by Activity
    print_separator("Histogram: Event Cardinalities by Activity")
    print("Legend: 0=Zero, 1=One, 0...1=Zero-One, 1..*=Many, 0...*=Zero-Many\n")
    ec_keys = ["0", "1", "0...1", "1..*", "0...*"]
    print_histogram_by_activity(
        histograms.get("event_cardinality_by_activity", {}),
        "total", ec_keys
    )

    # Temporal Relations by Relation Type
    print_separator("Histogram: Temporal Relations by Relation Type")
    print("Legend: D=Dependent, Di=Dependent-Inv, I=Initiating, Ii=Initiating-Inv, P=Parallel")
    print("Relation Types: e2o=event-to-object (shared events), others=o2o qualifiers\n")
    tr_keys = ["D", "Di", "I", "Ii", "P"]
    print_histogram_by_relation_type(
        histograms.get("temporal_by_relation_type", {}),
        "Temporal Relations by Relation Type", "total", tr_keys
    )

    # Log Cardinalities by Relation Type
    print_separator("Histogram: Log Cardinalities by Relation Type")
    print("Legend: 0=Zero, 1=One, 0...1=Zero-One, 1..*=Many, 0...*=Zero-Many")
    print("Relation Types: e2o=event-to-object (shared events), others=o2o qualifiers\n")
    lc_keys = ["0", "1", "0...1", "1..*", "0...*"]
    print_histogram_by_relation_type(
        histograms.get("log_cardinality_by_relation_type", {}),
        "Log Cardinalities by Relation Type", "total", lc_keys
    )


def main():
    # Step 1: Load the OCEL
    print_separator("Loading OCEL")
    ocel = import_ocel("example_data/ContainerLogistics.json")
    print(f"Loaded OCEL with object types: {ocel.object_types}")

    # Step 2: Discover TOTeM model
    print_separator("Discovering TOTeM Model")
    totem = totemDiscovery(ocel)
    print(
        f"Discovered temporal graph with nodes: {totem.tempgraph.get('nodes', set())}"
    )

    # Step 3: Compute conformance
    print_separator("Computing Conformance")
    conformance = conformance_of_totem(totem, ocel)

    # Step 4: Print results

    # Overall Metrics
    print_separator("Overall Conformance Metrics")
    overall = conformance["overall_metrics"]

    print("Temporal Relations:")
    print(
        f"  Fitness:   {overall['temporal']['fitness']:.4f}"
        if overall["temporal"]["fitness"]
        else "  Fitness:   N/A"
    )
    print(
        f"  Precision: {overall['temporal']['precision']:.4f}"
        if overall["temporal"]["precision"]
        else "  Precision: N/A"
    )

    print("\nLog Cardinalities:")
    print(
        f"  Fitness:   {overall['log_cardinality']['fitness']:.4f}"
        if overall["log_cardinality"]["fitness"]
        else "  Fitness:   N/A"
    )
    print(
        f"  Precision: {overall['log_cardinality']['precision']:.4f}"
        if overall["log_cardinality"]["precision"]
        else "  Precision: N/A"
    )

    print("\nEvent Cardinalities:")
    print(
        f"  Fitness:   {overall['event_cardinality']['fitness']:.4f}"
        if overall["event_cardinality"]["fitness"]
        else "  Fitness:   N/A"
    )
    print(
        f"  Precision: {overall['event_cardinality']['precision']:.4f}"
        if overall["event_cardinality"]["precision"]
        else "  Precision: N/A"
    )

    # Per Object Type Metrics
    print_separator("Per Object Type Metrics")
    for obj_type, metrics in conformance["object_type_metrics"].items():
        print(f"\n{obj_type}:")

        tr = metrics["temporal"]
        if tr["avg_fitness"] is not None:
            print(
                f"  Temporal:         fitness={tr['avg_fitness']:.4f}, precision={tr['avg_precision']:.4f}"
            )
        else:
            print(f"  Temporal:         N/A")

        lc = metrics["log_cardinality"]
        if lc["avg_fitness"] is not None:
            print(
                f"  Log Cardinality:  fitness={lc['avg_fitness']:.4f}, precision={lc['avg_precision']:.4f}"
            )
        else:
            print(f"  Log Cardinality:  N/A")

        ec = metrics["event_cardinality"]
        if ec["avg_fitness"] is not None:
            print(
                f"  Event Cardinality: fitness={ec['avg_fitness']:.4f}, precision={ec['avg_precision']:.4f}"
            )
        else:
            print(f"  Event Cardinality: N/A")

    # Per Type Pair Metrics (summary)
    print_separator("Per Type Pair Metrics (Sample)")
    type_pairs = list(conformance["type_pair_metrics"].items())[:5]  # Show first 5
    for (t1, t2), metrics in type_pairs:
        print(f"\n({t1}, {t2}):")

        tr = metrics["temporal"]
        print(
            f"  Temporal: relation={tr['model_relation']}, fitness={tr['fitness']}, precision={tr['precision']}"
        )

        lc = metrics["log_cardinality"]
        print(
            f"  Log Card: relation={lc['model_relation']}, fitness={lc['fitness']}, precision={lc['precision']}"
        )

        ec = metrics["event_cardinality"]
        print(
            f"  Event Card: relation={ec['model_relation']}, fitness={ec['fitness']}, precision={ec['precision']}"
        )

    print(f"\n... and {len(conformance['type_pair_metrics']) - 5} more type pairs")

    # Print histograms
    print_histograms(conformance["histograms"])

    # Print fine-grained histograms
    print_fine_grained_histograms(conformance["histograms"])

    print_separator("Done")


if __name__ == "__main__":
    main()
