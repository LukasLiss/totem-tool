"""
The public discovery API and its MLPA-compatible output contract.

Whatever the layering engine decides, the structure handed to the backend
serializer has to be the one ``mlpaDiscovery`` produces, or the frontend breaks.
"""

import pytest

from totem_lib.ocel.importer import import_ocel
from totem_lib.process_areas.discovery import (
    FIRST_LEVEL,
    build_process_view,
    discover_process_areas,
    process_areas_from_aggregates,
)
from totem_lib.totem.totem import mlpaDiscovery, totemDiscovery

from .conftest import ORDER_MANAGEMENT


@pytest.fixture(scope="module")
def process_view(container_logistics_ocel):
    return discover_process_areas(container_logistics_ocel)


class TestOutputContract:
    def test_matches_the_mlpa_structure(self, process_view, container_logistics_ocel):
        reference = mlpaDiscovery(totemDiscovery(container_logistics_ocel))

        assert set(map(type, process_view)) == {int}
        for areas in process_view.values():
            assert isinstance(areas, list)
            for object_types, event_types in areas:
                assert all(isinstance(t, str) for t in object_types)
                assert all(isinstance(e, str) for e in event_types)
        # Same nesting depth and tuple arity as the reference implementation.
        reference_area = next(iter(reference.values()))[0]
        our_area = next(iter(process_view.values()))[0]
        assert len(reference_area) == len(our_area) == 2

    def test_serializes_without_touching_the_serializer(self, process_view):
        # Mirrors _serialize_mlpa in backend/api/views.py.
        layers = [
            {
                "level": int(level),
                "areas": [
                    {
                        "objectTypes": sorted(object_types),
                        "eventTypes": sorted(event_types),
                    }
                    for object_types, event_types in process_view[level]
                ],
            }
            for level in sorted(process_view)
        ]
        assert layers
        assert all(layer["areas"] for layer in layers)

    def test_levels_are_contiguous_from_the_first_level(self, process_view):
        levels = sorted(process_view)
        assert levels == list(range(FIRST_LEVEL, FIRST_LEVEL + len(levels)))

    def test_no_layer_is_empty(self, process_view):
        assert all(areas for areas in process_view.values())


class TestEventTypeAssignment:
    def test_every_event_type_lands_in_exactly_one_area(
        self, process_view, container_logistics_ocel, container_logistics_aggregates
    ):
        seen = []
        for areas in process_view.values():
            for _object_types, event_types in areas:
                seen.extend(event_types)
        assert len(seen) == len(set(seen))
        assert set(seen) == set(container_logistics_aggregates.all_event_types)

    def test_activities_land_on_the_lowest_layer_that_touches_them(
        self, process_view, container_logistics_aggregates
    ):
        level_of_activity = {
            activity: level
            for level, areas in process_view.items()
            for _object_types, event_types in areas
            for activity in event_types
        }
        level_of_type = {
            object_type: level
            for level, areas in process_view.items()
            for object_types, _event_types in areas
            for object_type in object_types
        }
        for object_type, activities in (
            container_logistics_aggregates.event_types_by_object_type.items()
        ):
            for activity in activities:
                assert level_of_activity[activity] <= level_of_type[object_type]

    def test_every_object_type_appears_exactly_once(
        self, process_view, container_logistics_aggregates
    ):
        placed = [
            object_type
            for areas in process_view.values()
            for object_types, _ in areas
            for object_type in object_types
        ]
        assert len(placed) == len(set(placed))
        assert set(placed) == set(container_logistics_aggregates.object_types)


class TestHierarchyDirection:
    def test_resources_render_above_the_types_they_serve(self, process_view):
        level_of_type = {
            object_type: level
            for level, areas in process_view.items()
            for object_types, _ in areas
            for object_type in object_types
        }
        # buildLayersFromBackend sorts levels descending, so a higher level
        # renders further up. Vehicles and equipment must end up there.
        assert level_of_type["Forklift"] > level_of_type["Container"]
        assert level_of_type["Truck"] > level_of_type["Handling Unit"]


class TestWithinLayerSplitting:
    def test_a_layer_splits_into_connected_components(self):
        # a--b and c--d relate pairwise but not across, so one layer holding all
        # four must render as two areas.
        view = build_process_view(
            layer_of={"a": 1, "b": 1, "c": 1, "d": 1},
            type_relations={frozenset({"a", "b"}), frozenset({"c", "d"})},
            event_types_by_object_type={
                "a": frozenset({"A"}),
                "b": frozenset({"B"}),
                "c": frozenset({"C"}),
                "d": frozenset({"D"}),
            },
            all_event_types=frozenset({"A", "B", "C", "D"}),
        )
        assert list(view) == [FIRST_LEVEL]
        components = sorted(sorted(types) for types, _ in view[FIRST_LEVEL])
        assert components == [["a", "b"], ["c", "d"]]

    def test_gaps_in_the_ilp_layer_numbers_are_closed(self):
        view = build_process_view(
            layer_of={"low": 1, "high": 7},
            type_relations=set(),
            event_types_by_object_type={"low": frozenset({"L"}), "high": frozenset({"H"})},
            all_event_types=frozenset({"L", "H"}),
        )
        assert sorted(view) == [FIRST_LEVEL, FIRST_LEVEL + 1]


class TestParameters:
    def test_weights_change_the_result(self, container_logistics_aggregates):
        temporal_only = process_areas_from_aggregates(
            container_logistics_aggregates,
            weights={"temporal": 1.0, "cardinality": 0.0, "divergence": 0.0},
        )
        divergence_only = process_areas_from_aggregates(
            container_logistics_aggregates,
            weights={"temporal": 0.0, "cardinality": 0.0, "divergence": 1.0},
        )
        assert temporal_only != divergence_only

    def test_defaults_match_the_convenience_entry_point(
        self, container_logistics_ocel, container_logistics_aggregates
    ):
        assert discover_process_areas(
            container_logistics_ocel
        ) == process_areas_from_aggregates(container_logistics_aggregates)

    def test_order_management_runs_end_to_end(self):
        view = discover_process_areas(import_ocel(str(ORDER_MANAGEMENT)))
        assert view
        assert all(areas for areas in view.values())


class TestMlpaIsUntouched:
    def test_mlpa_still_produces_its_own_layering(self, container_logistics_ocel):
        reference = mlpaDiscovery(totemDiscovery(container_logistics_ocel))
        placed = [
            object_type
            for areas in reference.values()
            for object_types, _ in areas
            for object_type in object_types
        ]
        assert set(placed) == set(container_logistics_ocel.object_types)
