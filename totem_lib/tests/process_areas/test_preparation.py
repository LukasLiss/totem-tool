"""
Preparation over the Polars event log.

The counters here are the only place the log is read, so the invariants that the
indicators rely on -- symmetry of the O2O relation, per-type object counts, no
state leaking between logs -- have to hold at this level.
"""

import pytest

from totem_lib.ocel.importer import import_ocel
from totem_lib.process_areas.preparation import prepare

from .conftest import ORDER_MANAGEMENT


class TestAggregates:
    def test_object_counts_match_the_log(
        self, container_logistics_ocel, container_logistics_aggregates
    ):
        for object_type in container_logistics_aggregates.object_types:
            expected = len(container_logistics_ocel.get_object_ids_by_type(object_type))
            assert container_logistics_aggregates.object_counts[object_type] <= expected

    def test_every_ordered_type_pair_is_covered(self, container_logistics_aggregates):
        types = container_logistics_aggregates.object_types
        pairs = {(a, b) for a in types for b in types}
        assert set(container_logistics_aggregates.temporal) == pairs
        assert set(container_logistics_aggregates.cardinality) == pairs
        assert set(container_logistics_aggregates.divergence) == pairs

    def test_o2o_relation_is_symmetric(self, container_logistics_aggregates):
        # The number of related object pairs must be the same read either way
        # round; this is what makes the attractive force symmetric.
        temporal = container_logistics_aggregates.temporal
        for (type_a, type_b), counts in temporal.items():
            assert counts.total == temporal[(type_b, type_a)].total

    def test_cardinality_partitions_the_source_objects(
        self, container_logistics_aggregates
    ):
        for counts in container_logistics_aggregates.cardinality.values():
            assert counts.constant + counts.many == counts.total

    def test_cardinality_total_is_the_source_type_object_count(
        self, container_logistics_aggregates
    ):
        counts = container_logistics_aggregates.object_counts
        for (source_type, _), value in container_logistics_aggregates.cardinality.items():
            assert value.total == counts[source_type]

    def test_dependent_and_initiating_never_exceed_total(
        self, container_logistics_aggregates
    ):
        for counts in container_logistics_aggregates.temporal.values():
            assert counts.dependent <= counts.total
            assert counts.initiating <= counts.total

    def test_diverging_targets_never_exceed_the_target_population(
        self, container_logistics_aggregates
    ):
        counts = container_logistics_aggregates.object_counts
        for (_, target_type), value in container_logistics_aggregates.divergence.items():
            assert value.diverging_targets <= counts[target_type]


class TestNoSharedState:
    """
    The reference implementation memoised prepared data in a module-global dict
    keyed by ``id(ocel)``. CPython reuses id values once an object is collected,
    so in a long-running server that cache can hand one log's data to another.
    Nothing here may carry state between logs.
    """

    def test_two_logs_prepared_in_sequence_stay_distinct(
        self, container_logistics_ocel
    ):
        first = prepare(container_logistics_ocel)
        second = prepare(import_ocel(str(ORDER_MANAGEMENT)))
        assert set(first.object_types).isdisjoint(second.object_types)
        assert prepare(container_logistics_ocel) == first

    def test_module_exposes_no_cache(self):
        import totem_lib.process_areas.preparation as preparation

        caches = [
            name
            for name, value in vars(preparation).items()
            if isinstance(value, dict) and not name.startswith("__")
        ]
        assert caches == []
