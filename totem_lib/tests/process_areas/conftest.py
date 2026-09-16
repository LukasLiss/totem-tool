"""Shared fixtures for the process-area discovery tests."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from totem_lib.ocel.importer import import_ocel
from totem_lib.process_areas.preparation import prepare

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"

CONTAINER_LOGISTICS = TEST_DATA / "container_logistics.json"
ORDER_MANAGEMENT = TEST_DATA / "order-management.json"


@pytest.fixture(scope="session")
def container_logistics_ocel():
    return import_ocel(str(CONTAINER_LOGISTICS))


@pytest.fixture(scope="session")
def container_logistics_aggregates(container_logistics_ocel):
    return prepare(container_logistics_ocel)
