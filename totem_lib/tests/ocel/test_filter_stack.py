"""
Tests for apply_filter_stack.

Minimum set for 100 % line + branch coverage of filter_stack.py.
Uses container_logistics.duckdb (test_data/small) as the OCEL source.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.ocel.ocel_duckdb import OcelDuckDB
from totem_lib.ocel.filter_stack import apply_filter_stack, FilterRule, FilterStack

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"
DUCKDB_SOURCE = TEST_DATA / "container_logistics.duckdb"

TOTAL_EVENTS = 35372
TOTAL_OBJECTS = 13882


@pytest.fixture(scope="module")
def ocel_db() -> OcelDuckDB:
    return OcelDuckDB.load(str(DUCKDB_SOURCE))

def test_activity_filter(ocel_db: OcelDuckDB) -> None:
    _, stats = apply_filter_stack(
        ocel_db,
        {"filters": [
            {"id": "r1", "type": "activity", "enabled": True, "params": {"include": ["LoadTruck"]}},
        ]},
    )
    assert stats["event_count_after"] == 10553
    assert stats["object_count_after"] == 12553
    assert stats["event_count_before"] == TOTAL_EVENTS
    assert stats["object_count_before"] == TOTAL_OBJECTS
    assert 0.0 < stats["event_percentage"] < 1.0
    assert 0.0 < stats["object_percentage"] < 1.0

def test_dict_empty_filters(ocel_db: OcelDuckDB) -> None:
    _, stats = apply_filter_stack(ocel_db, {"filters": []})
    assert stats["event_count_after"] == TOTAL_EVENTS
    assert stats["object_count_after"] == TOTAL_OBJECTS

def test_filterstack_no_args(ocel_db: OcelDuckDB) -> None:
    _, stats = apply_filter_stack(ocel_db, FilterStack())
    assert stats["event_count_after"] == TOTAL_EVENTS
    assert stats["object_count_after"] == TOTAL_OBJECTS

def test_filterstack_disabled_and_no_include(ocel_db: OcelDuckDB) -> None:
    stack = FilterStack(filters=[
        FilterRule(id="r1", type="activity",     enabled=False, params={"include": ["LoadTruck"]}),
        FilterRule(id="r2", type="activity",     enabled=True,  params={}),
        FilterRule(id="r3", type="object_types", enabled=True,  params={}),
        FilterRule(id="r4", type="unknown",      enabled=True,  params={}),
    ])
    _, stats = apply_filter_stack(ocel_db, stack)
    assert stats["event_count_after"] == TOTAL_EVENTS
    assert stats["object_count_after"] == TOTAL_OBJECTS


def test_activity_empty_include(ocel_db: OcelDuckDB) -> None:
    _, stats = apply_filter_stack(
        ocel_db,
        {"filters": [
            {"id": "r1", "type": "activity", "enabled": True, "params": {"include": []}},
        ]},
    )
    assert stats["event_count_after"] == 0
    assert stats["object_count_after"] == 0
    assert stats["event_percentage"] == 0.0
    assert stats["object_percentage"] == 0.0


def test_object_types_filter(ocel_db: OcelDuckDB) -> None:
    _, stats = apply_filter_stack(
        ocel_db,
        {"filters": [
            {"id": "r1", "type": "object_types", "enabled": True, "params": {"include": ["Truck", "Container"]}},
        ]},
    )
    assert stats["object_count_after"] == 2005
    assert stats["event_count_after"] == 23029



def test_object_types_empty_include(ocel_db: OcelDuckDB) -> None:
    _, stats = apply_filter_stack(
        ocel_db,
        {"filters": [
            {"id": "r1", "type": "object_types", "enabled": True, "params": {"include": []}},
        ]},
    )
    assert stats["event_count_after"] == 0
    assert stats["object_count_after"] == 0

def test_time_range_after_only(ocel_db: OcelDuckDB) -> None:
    _, stats = apply_filter_stack(
        ocel_db,
        {"filters": [
            {"id": "r1", "type": "time_range", "enabled": True, "params": {"after": 1704000000}},
        ]},
    )
    assert stats["event_count_after"] == 17774
    assert stats["object_count_after"] == 7026

def test_time_range_before_and_no_match(ocel_db: OcelDuckDB) -> None:
    _, stats = apply_filter_stack(
        ocel_db,
        {"filters": [
            {"id": "r1", "type": "time_range", "enabled": True, "params": {"before": 1704000000}},
            {"id": "r2", "type": "activity",   "enabled": True, "params": {"include": ["__nonexistent__"]}},
        ]},
    )
    assert stats["event_count_after"] == 0
    assert stats["object_count_after"] == 0
    assert stats["event_count_before"] == TOTAL_EVENTS
