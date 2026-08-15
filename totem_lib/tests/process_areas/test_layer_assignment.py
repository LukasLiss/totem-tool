"""
Layer-assignment ILP and its parity with the thesis reference implementation.

The expected assignments below were produced by running the reference
implementation (``discovery/scorables/*`` plus ``discovery/ilp.py`` from
Schlegelmilch's thesis repository) against the same logs with default
parameters, and verified to be reproduced bit-for-bit by this port -- both the
individual forces and the resulting layers. They are checked in as fixtures
because the reference implementation is not vendored here.
"""

import pytest

from totem_lib.process_areas.indicators import JoinedIndicator
from totem_lib.process_areas.layer_assignment import assign_layers
from totem_lib.process_areas.preparation import prepare

# Reference implementation, uniform weights, alpha = beta = 1, margin_scale = 0.
REFERENCE_LAYERS = {
    "container_logistics": {
        "Container": 2,
        "Customer Order": 3,
        "Forklift": 4,
        "Handling Unit": 1,
        "Transport Document": 3,
        "Truck": 3,
        "Vehicle": 3,
    },
    "order-management": {
        "customers": 2,
        "employees": 3,
        "items": 1,
        "orders": 1,
        "packages": 1,
        "products": 3,
    },
}


def solve_for(aggregates, **kwargs):
    joined = JoinedIndicator.from_weights(kwargs.pop("weights", None))
    joined.prepare(aggregates)
    forces, attractions = joined.score(aggregates.object_types)
    return assign_layers(aggregates.object_types, forces, attractions, **kwargs)


class TestReferenceParity:
    def test_container_logistics(self, container_logistics_aggregates):
        assert (
            solve_for(container_logistics_aggregates)
            == REFERENCE_LAYERS["container_logistics"]
        )

    def test_order_management(self):
        from totem_lib.ocel.importer import import_ocel

        from .conftest import ORDER_MANAGEMENT

        aggregates = prepare(import_ocel(str(ORDER_MANAGEMENT)))
        assert solve_for(aggregates) == REFERENCE_LAYERS["order-management"]


class TestHierarchy:
    def test_resources_land_above_the_types_they_serve(
        self, container_logistics_aggregates
    ):
        layers = solve_for(container_logistics_aggregates)
        # Vehicles and handling equipment serve containers and handling units,
        # which is the hierarchy the thesis discusses for this log.
        assert layers["Forklift"] > layers["Container"]
        assert layers["Truck"] > layers["Handling Unit"]
        assert layers["Container"] > layers["Handling Unit"]

    def test_repeated_runs_agree(self, container_logistics_aggregates):
        first = solve_for(container_logistics_aggregates)
        second = solve_for(container_logistics_aggregates)
        assert first == second

    def test_preparation_is_reproducible(self, container_logistics_ocel):
        assert prepare(container_logistics_ocel) == prepare(container_logistics_ocel)

    def test_object_types_are_sorted(self, container_logistics_aggregates):
        types = container_logistics_aggregates.object_types
        assert list(types) == sorted(types)


class TestParameters:
    def test_alpha_pushes_the_hierarchy_apart(self, container_logistics_aggregates):
        flat = solve_for(container_logistics_aggregates, alpha=0.0, beta=1.0)
        steep = solve_for(container_logistics_aggregates, alpha=20.0, beta=1.0)
        assert max(flat.values()) - min(flat.values()) == 0
        assert max(steep.values()) - min(steep.values()) > 0

    def test_beta_pulls_the_hierarchy_together(self, container_logistics_aggregates):
        loose = solve_for(container_logistics_aggregates, alpha=1.0, beta=0.0)
        tight = solve_for(container_logistics_aggregates, alpha=1.0, beta=20.0)
        assert max(loose.values()) - min(loose.values()) >= max(tight.values()) - min(
            tight.values()
        )

    def test_margin_scale_defaults_to_the_thesis_margin(
        self, container_logistics_aggregates
    ):
        assert solve_for(container_logistics_aggregates) == solve_for(
            container_logistics_aggregates, margin_scale=0.0
        )

    @pytest.mark.parametrize(
        "kwargs", [{"alpha": -1.0}, {"beta": -1.0}, {"margin_scale": -1.0}]
    )
    def test_negative_parameters_are_rejected(
        self, kwargs, container_logistics_aggregates
    ):
        with pytest.raises(ValueError):
            solve_for(container_logistics_aggregates, **kwargs)


class TestDegenerateInputs:
    def test_empty_log_yields_no_layers(self):
        assert assign_layers([], {}, {}) == {}

    def test_type_without_any_force_still_gets_a_layer(self):
        types = ["alone", "high", "low"]
        forces = {("high", "low"): 0.9}
        attractions = {("high", "low"): 0.1}
        layers = assign_layers(types, forces, attractions)
        assert set(layers) == set(types)
        assert all(1 <= layer <= len(types) for layer in layers.values())
        assert layers["high"] > layers["low"]

    def test_object_type_names_with_punctuation_do_not_collide(self):
        # PuLP rewrites illegal characters in variable names; naming variables
        # after object types would merge these two into one.
        types = ["handling unit", "handling_unit"]
        forces = {("handling unit", "handling_unit"): 0.8}
        layers = assign_layers(types, forces, {})
        assert layers["handling unit"] > layers["handling_unit"]
