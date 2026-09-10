"""
End-to-end contract test for the OCCN pipeline the TOTeM app relies on:
DuckDB import -> discover_occn -> serialize_occn -> JSON.

Complements test_discovery.py (discovery internals) and test_serializer.py
(serializer field shapes) by asserting the full chain on a *discovered* net,
including the frequency data that thresholding depends on.
"""

import json
from pathlib import Path

import pytest

from totem_lib import discover_occn, serialize_occn
from totem_lib.ocel.importer_db import import_ocel_db

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"


@pytest.fixture(scope="module")
def base_occn():
    """Discover once (the expensive step) and share across tests."""
    db = import_ocel_db(str(TEST_DATA / "container_logistics.duckdb"))
    try:
        return discover_occn(db, relativeOccuranceThreshold=0)
    finally:
        db.close()


@pytest.fixture(scope="module")
def payload(base_occn):
    return serialize_occn(base_occn)


def _total_groups(occn):
    return sum(len(mgs) for mgs in occn.input_marker_groups.values()) + sum(
        len(mgs) for mgs in occn.output_marker_groups.values()
    )


def test_terminal_activities_present_per_object_type(base_occn):
    activities = set(base_occn.activities)
    assert len(base_occn.object_types) > 0
    for object_type in base_occn.object_types:
        assert f"START_{object_type}" in activities
        assert f"END_{object_type}" in activities


def test_activity_counts_are_real_frequencies(base_occn):
    # Regression guard: to_OCCausalNet used to drop the mined counts, leaving
    # every activity at the {act: 1} fallback and making thresholding a no-op.
    counts = base_occn.activity_count
    assert set(counts) == set(base_occn.activities)
    assert all(c >= 1 for c in counts.values())
    assert any(c > 1 for c in counts.values())


def test_marker_group_supports_are_finite(base_occn):
    # Regression guard: supports used to be dropped and default to infinity.
    supports = [
        mg.support_count
        for groups in (base_occn.input_marker_groups, base_occn.output_marker_groups)
        for mgs in groups.values()
        for mg in mgs
    ]
    assert len(supports) > 0
    assert all(s != float("inf") and s >= 1 for s in supports)


def test_marker_groups_are_well_formed(base_occn):
    activities = set(base_occn.activities)
    for groups in (base_occn.input_marker_groups, base_occn.output_marker_groups):
        assert set(groups) <= activities
        for mgs in groups.values():
            for mg in mgs:
                assert len(mg.markers) > 0
                for marker in mg.markers:
                    assert marker.related_activity in activities
                    assert marker.object_type in base_occn.object_types
                    assert marker.min_count >= 0


def test_thresholding_prunes_monotonically(base_occn):
    mid = base_occn.apply_relative_occurrence_threshold(0.5)
    high = base_occn.apply_relative_occurrence_threshold(0.9)
    assert _total_groups(base_occn) >= _total_groups(mid) >= _total_groups(high)
    # On this log the filter must actually remove something, otherwise the
    # regression this file guards against has returned.
    assert _total_groups(mid) < _total_groups(base_occn)


def test_serialized_payload_contract(payload, base_occn):
    assert set(payload) == {
        "object_types",
        "relative_occurrence_threshold",
        "activities",
        "edges",
        "input_marker_groups",
        "output_marker_groups",
    }
    assert payload["object_types"] == sorted(base_occn.object_types)
    ids = {a["id"] for a in payload["activities"]}
    assert ids == set(base_occn.activities)
    assert all(a["count"] >= 1 for a in payload["activities"])
    for edge in payload["edges"]:
        assert edge["source"] in ids
        assert edge["target"] in ids
        assert edge["object_type"] in payload["object_types"]


def test_serialized_payload_is_json_at_every_threshold(base_occn):
    for threshold in (0, 0.5, 0.9):
        occn = base_occn.apply_relative_occurrence_threshold(threshold)
        roundtripped = json.loads(json.dumps(serialize_occn(occn)))
        assert roundtripped["relative_occurrence_threshold"] == threshold
