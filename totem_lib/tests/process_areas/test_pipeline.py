"""
End-to-end: import a log, discover process areas, serialize the result.

The other test modules check the pieces. This one runs the whole path the web
application runs — DuckDB import through to the JSON the frontend receives — and
pins the hierarchy it produces on `container_logistics`, so a change in any
indicator, in the ILP, or in the grouping shows up as a diff here rather than as
a surprise in the visualizer.
"""

import pytest

from totem_lib.ocel.importer_db import import_ocel_db
from totem_lib.process_areas.discovery_db import discover_process_areas_db
from totem_lib.process_areas.preparation_db import prepare_db
from totem_lib.process_areas.discovery import process_areas_from_aggregates

from .conftest import CONTAINER_LOGISTICS

# Discovered with default parameters: uniform indicator weights, alpha = beta = 1.
# Resources sit on the higher levels.
EXPECTED_HIERARCHY = [
    (0, [["Handling Unit"]]),
    (1, [["Container"]]),
    (2, [["Customer Order", "Transport Document", "Vehicle"], ["Truck"]]),
    (3, [["Forklift"]]),
]


def serialize(process_view):
    """Mirror of `_serialize_process_layers` in backend/api/views.py."""
    return [
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


@pytest.fixture(scope="module")
def payload():
    db = import_ocel_db(str(CONTAINER_LOGISTICS))
    try:
        return serialize(discover_process_areas_db(db))
    finally:
        db.close()


class TestPipeline:
    def test_hierarchy_matches_the_recorded_regression(self, payload):
        actual = [
            (
                layer["level"],
                sorted((area["objectTypes"] for area in layer["areas"]), key=str),
            )
            for layer in payload
        ]
        expected = [
            (level, sorted(areas, key=str)) for level, areas in EXPECTED_HIERARCHY
        ]
        assert actual == expected

    def test_payload_is_json_serializable(self, payload):
        import json

        json.dumps(payload)

    def test_every_activity_appears_exactly_once(self, payload):
        activities = [
            activity
            for layer in payload
            for area in layer["areas"]
            for activity in area["eventTypes"]
        ]
        assert len(activities) == len(set(activities))
        assert len(activities) == 14

    def test_levels_are_contiguous_and_start_at_zero(self, payload):
        assert [layer["level"] for layer in payload] == list(range(len(payload)))

    def test_parameters_reach_the_result(self):
        db = import_ocel_db(str(CONTAINER_LOGISTICS))
        try:
            aggregates = prepare_db(db)
        finally:
            db.close()

        default = process_areas_from_aggregates(aggregates)
        separated = process_areas_from_aggregates(aggregates, alpha=8.0)
        assert len(separated) > len(default)
