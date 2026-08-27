"""
Parity between the DuckDB preparation and the Polars preparation.

Two readers over the same log are two chances to be wrong, so this is the guard
that keeps them from drifting: identical aggregates, identical layers, on two
logs with very different shapes.
"""

import pytest

from totem_lib.ocel.importer import import_ocel
from totem_lib.ocel.importer_db import import_ocel_db
from totem_lib.process_areas.discovery import (
    discover_process_areas,
    process_areas_from_aggregates,
)
from totem_lib.process_areas.discovery_db import discover_process_areas_db
from totem_lib.process_areas.preparation import prepare
from totem_lib.process_areas.preparation_db import prepare_db

from .conftest import CONTAINER_LOGISTICS, ORDER_MANAGEMENT

LOGS = [
    pytest.param(CONTAINER_LOGISTICS, id="container_logistics"),
    pytest.param(ORDER_MANAGEMENT, id="order-management"),
]


@pytest.fixture(scope="module", params=LOGS)
def both_aggregates(request):
    source = request.param
    db = import_ocel_db(str(source))
    try:
        return prepare(import_ocel(str(source))), prepare_db(db)
    finally:
        db.close()


class TestParity:
    def test_aggregates_are_identical(self, both_aggregates):
        polars, duckdb = both_aggregates
        assert polars == duckdb

    def test_layer_assignment_is_identical(self, both_aggregates):
        polars, duckdb = both_aggregates
        assert process_areas_from_aggregates(
            polars
        ) == process_areas_from_aggregates(duckdb)

    def test_entry_points_agree(self):
        db = import_ocel_db(str(CONTAINER_LOGISTICS))
        try:
            from_db = discover_process_areas_db(db)
        finally:
            db.close()
        assert from_db == discover_process_areas(import_ocel(str(CONTAINER_LOGISTICS)))


class TestO2OClosure:
    def test_explicit_object_relations_are_included_symmetrically(self):
        """
        Two objects that never share an event but are linked by an explicit O2O
        edge must still relate -- in both directions, since Def. 3.3.2 is a
        symmetric relation and the attractive force depends on that.
        """
        db = import_ocel_db(str(CONTAINER_LOGISTICS))
        try:
            db.conn.execute(
                "INSERT INTO objects (obj_id, obj_type) VALUES ('pa-x', 'Truck'), ('pa-y', 'Container')"
            )
            db.conn.execute(
                "INSERT INTO events (event_id, activity, timestamp_unix) VALUES ('pa-e1', 'pa-act', 1), ('pa-e2', 'pa-act', 2)"
            )
            db.conn.execute(
                "INSERT INTO event_object (event_id, obj_id) VALUES ('pa-e1', 'pa-x'), ('pa-e2', 'pa-y')"
            )
            without_edge = prepare_db(db)

            db.conn.execute(
                "INSERT INTO object_relations (source_obj_id, target_obj_id) VALUES ('pa-x', 'pa-y')"
            )
            with_edge = prepare_db(db)
        finally:
            db.close()

        forward = ("Truck", "Container")
        reverse = ("Container", "Truck")
        assert (
            with_edge.temporal[forward].total == without_edge.temporal[forward].total + 1
        )
        assert (
            with_edge.temporal[reverse].total == without_edge.temporal[reverse].total + 1
        )


class TestMemoryShape:
    def test_only_type_pair_sized_data_reaches_python(self):
        """
        Everything is aggregated inside DuckDB, so what crosses into Python is
        bounded by the number of object types -- not by the number of objects or
        events. This is what lets a log larger than memory go through.
        """
        db = import_ocel_db(str(CONTAINER_LOGISTICS))
        try:
            aggregates = prepare_db(db)
            objects = db.conn.execute("SELECT COUNT(*) FROM objects").fetchone()[0]
        finally:
            db.close()

        pairs = len(aggregates.object_types) ** 2
        assert len(aggregates.temporal) == pairs
        assert len(aggregates.cardinality) == pairs
        assert len(aggregates.divergence) == pairs
        assert objects > pairs
