"""
Organizational mining example: handover of work and resource profiling.

Runs both discovery functions of ``totem_lib.orgamining`` on the small running
example (employees and machines working on items and packages). Both accept an
``ObjectCentricEventLog`` or an ``OcelDuckDB``.

Run from the totem_lib directory:

    python3 examples/example_orgamining.py
"""

from pathlib import Path

from totem_lib import discover_handover, discover_resource_profiles, import_ocel

DATASET = Path(__file__).parent.parent / "test_data" / "small" / "runningexample.json"


def main():
    ocel = import_ocel(str(DATASET))

    # Handover of work: which resources pass business objects to each other.
    # Each edge carries the number of handovers (count) and that count
    # normalised according to `normalization` (weight).
    handovers = discover_handover(
        ocel,
        resource_types=["employee", "machine"],
        business_object_types=["item", "package"],
        # "by_arcs_in_eog" (default), "by_source", "by_target" or "by_total_weight"
        normalization="by_source",
        # "global" (default) or "per_bo_type": one denominator per business object type
        normalization_scope="global",
        # Max. events without a resource between two resource events; None = no limit
        max_gap=None,
    )

    print(handovers.nodes(data=True))



    print("Handovers (source -> target [business object type]: count, weight)")
    for source, target, edge in handovers.edges(data=True):
        print(f"  {source} -> {target} [{edge['businessobject_type']}]: "
              f"{edge['count']}, {edge['weight']:.3f}")

    # Resource profiling: one feature profile per resource, here with every
    # feature group (also available as totem_lib.orgamining.FEATURE_GROUPS).
    profiles = discover_resource_profiles(
        ocel,
        resource_types=["employee", "machine"],
        feature_groups=[
            "activity_fractions",              # share of events per activity
            "cooccurrence_fractions",          # resources sharing the same events
            "object_collaboration_fractions",  # resources working on the same business objects
            "object_portfolio_fractions",      # share of business objects per type
            "time_fractions",                  # share of events per hour of day
            "weekday_fractions",               # share of events per weekday
        ],
        # Business objects for collaboration and portfolio; None = all non-resource types
        business_object_types=["item", "package"],
    )

    print(profiles.profiles)

    print("\nActivity profiles")
    for profile in profiles.profiles:
        shares = ", ".join(f"{a} {f:.0%}" for a, f in sorted(profile.activity_fractions.items()))
        print(f"  {profile.resource_id} ({profile.object_type}): {shares}")

    # Distances between the profiles, combined over the computed groups.
    distances = profiles.combined_distance_matrix(
        # "euclidean" (default) or "hellinger"
        distance_metric="hellinger",
        # Weight per feature group; groups not listed count 1.0, 0 leaves a group out
        weights={"activity_fractions": 2.0, "time_fractions": 1.0},
    )

    # Group resources with similar profiles.
    labels = profiles.cluster(
        # "hdbscan" (default), "agglomerative" or "kmeans".
        # kmeans ignores precomputed_D and uses the raw features instead.
        method="agglomerative",
        n_clusters=2,               # agglomerative / kmeans
        # min_cluster_size=2,       # hdbscan; noise points get label -1
        precomputed_D=distances,
    )
    print("\nClusters")
    for resource, label in zip(profiles.resources, labels):
        print(f"  {resource}: cluster {label}")


if __name__ == "__main__":
    main()
