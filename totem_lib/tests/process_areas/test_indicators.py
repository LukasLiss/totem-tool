"""
Structural properties of the three resource indicators.

The thesis requires the resource force to be antisymmetric and the attractive
force symmetric. Both hold only because the O2O relation is built symmetrically;
an asymmetry bug in preparation would show up here first.
"""

import pytest

from totem_lib.process_areas.aggregates import (
    CardinalityCounts,
    DivergenceCounts,
    LogAggregates,
    TemporalCounts,
)
from totem_lib.process_areas.indicators import (
    INDICATOR_CLASSES,
    INDICATOR_NAMES,
    CardinalityIndicator,
    DivergenceIndicator,
    JoinedIndicator,
    TemporalIndicator,
)

TOLERANCE = 1e-12


@pytest.fixture(params=INDICATOR_CLASSES, ids=INDICATOR_NAMES)
def indicator(request, container_logistics_aggregates):
    instance = request.param()
    instance.prepare(container_logistics_aggregates)
    return instance


class TestForceProperties:
    def test_resource_force_is_antisymmetric(
        self, indicator, container_logistics_aggregates
    ):
        types = container_logistics_aggregates.object_types
        for type_a in types:
            for type_b in types:
                forward = indicator.resource_force(type_a, type_b)
                reverse = indicator.resource_force(type_b, type_a)
                assert forward == pytest.approx(-reverse, abs=TOLERANCE), (
                    type_a,
                    type_b,
                )

    def test_attractive_force_is_symmetric(
        self, indicator, container_logistics_aggregates
    ):
        types = container_logistics_aggregates.object_types
        for type_a in types:
            for type_b in types:
                forward = indicator.attractive_force(type_a, type_b)
                reverse = indicator.attractive_force(type_b, type_a)
                assert forward == pytest.approx(reverse, abs=TOLERANCE), (type_a, type_b)

    def test_forces_stay_in_range(self, indicator, container_logistics_aggregates):
        types = container_logistics_aggregates.object_types
        for type_a in types:
            for type_b in types:
                assert -1.0 <= indicator.resource_force(type_a, type_b) <= 1.0
                assert 0.0 <= indicator.attractive_force(type_a, type_b) <= 1.0

    def test_scoring_before_prepare_is_an_error(self):
        with pytest.raises(RuntimeError, match="prepare"):
            TemporalIndicator().resource_force("a", "b")


class TestJoinedIndicator:
    def test_is_the_weighted_mean_of_its_parts(self, container_logistics_aggregates):
        weights = {"temporal": 2.0, "cardinality": 1.0, "divergence": 3.0}
        joined = JoinedIndicator.from_weights(weights)
        joined.prepare(container_logistics_aggregates)

        parts = [TemporalIndicator(), CardinalityIndicator(), DivergenceIndicator()]
        for part in parts:
            part.prepare(container_logistics_aggregates)

        type_a, type_b = container_logistics_aggregates.object_types[:2]
        expected = sum(
            part.resource_force(type_a, type_b) * weights[part.name] for part in parts
        ) / sum(weights.values())
        assert joined.resource_force(type_a, type_b) == pytest.approx(expected)

    def test_zero_weight_drops_the_indicator(self, container_logistics_aggregates):
        joined = JoinedIndicator.from_weights(
            {"temporal": 1.0, "cardinality": 0.0, "divergence": 0.0}
        )
        joined.prepare(container_logistics_aggregates)
        temporal = TemporalIndicator()
        temporal.prepare(container_logistics_aggregates)

        assert [type(i).__name__ for i in joined.indicators] == ["TemporalIndicator"]
        type_a, type_b = container_logistics_aggregates.object_types[:2]
        assert joined.resource_force(type_a, type_b) == pytest.approx(
            temporal.resource_force(type_a, type_b)
        )

    def test_all_weights_zero_is_rejected(self):
        with pytest.raises(ValueError, match="greater than zero"):
            JoinedIndicator.from_weights(
                {"temporal": 0.0, "cardinality": 0.0, "divergence": 0.0}
            )

    def test_negative_weight_is_rejected(self):
        with pytest.raises(ValueError, match=">= 0"):
            JoinedIndicator.from_weights({"temporal": -1.0})

    def test_unknown_weight_is_rejected(self):
        with pytest.raises(ValueError, match="unknown indicator weights"):
            JoinedIndicator.from_weights({"temporl": 1.0})

    def test_diagonal_is_scored_zero(self, container_logistics_aggregates):
        joined = JoinedIndicator.from_weights()
        joined.prepare(container_logistics_aggregates)
        forces, attractions = joined.score(container_logistics_aggregates.object_types)
        for object_type in container_logistics_aggregates.object_types:
            assert forces[(object_type, object_type)] == 0.0
            assert attractions[(object_type, object_type)] == 0.0


class TestMissingData:
    """
    An object type that shares no event and no O2O edge with anything has no
    entry in any counter. Scoring it must yield "no evidence", not a KeyError or
    a division by zero.
    """

    @pytest.fixture
    def isolated(self):
        return LogAggregates(
            object_types=("lonely", "busy"),
            object_counts={"lonely": 3, "busy": 5},
            temporal={("busy", "busy"): TemporalCounts(total=5)},
            cardinality={("busy", "busy"): CardinalityCounts(total=5, constant=5)},
            divergence={("busy", "busy"): DivergenceCounts(related_sources=5)},
        )

    @pytest.mark.parametrize("indicator_cls", INDICATOR_CLASSES, ids=INDICATOR_NAMES)
    def test_unrelated_types_score_zero(self, indicator_cls, isolated):
        indicator = indicator_cls()
        indicator.prepare(isolated)
        assert indicator.resource_force("lonely", "busy") == 0.0
        assert indicator.attractive_force("lonely", "busy") == 0.0

    @pytest.mark.parametrize("indicator_cls", INDICATOR_CLASSES, ids=INDICATOR_NAMES)
    def test_type_without_objects_does_not_divide_by_zero(self, indicator_cls):
        empty = LogAggregates(
            object_types=("a", "b"),
            object_counts={"a": 0, "b": 0},
            temporal={("a", "b"): TemporalCounts(), ("b", "a"): TemporalCounts()},
            cardinality={
                ("a", "b"): CardinalityCounts(),
                ("b", "a"): CardinalityCounts(),
            },
            divergence={
                ("a", "b"): DivergenceCounts(),
                ("b", "a"): DivergenceCounts(),
            },
        )
        indicator = indicator_cls()
        indicator.prepare(empty)
        assert indicator.resource_force("a", "b") == 0.0
        assert indicator.attractive_force("a", "b") == 0.0
