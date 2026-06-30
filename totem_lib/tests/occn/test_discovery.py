from pathlib import Path

from totem_lib import import_ocel, discover_occn
from totem_lib.ocel import schema_base_filtering, propagate_filtering
from totem_lib.ocel.importer_db import import_ocel_db

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"


def test_ocfhm():
    # import ocel
    ocel = import_ocel("example_data/ContainerLogistics.json")
    # discover occn
    occn = discover_occn(ocel, relativeOccuranceThreshold=0)
    print(occn)


def test_discover_occn_db():
    """discover_occn accepts an OcelDuckDB and returns a valid OCCausalNet."""
    ocel_db = import_ocel_db(str(TEST_DATA / "container_logistics.duckdb"))
    occn = discover_occn(ocel_db, relativeOccuranceThreshold=0)
    assert len(occn.activities) > 0
    assert len(occn.object_types) > 0


def test_discover_occn_db_matches_polars():
    """DuckDB path yields an OCCausalNet equal to the Polars path on the same log.

    Both paths start from the same ObjectCentricEventLog so the underlying data
    is identical — the only difference is which OCEL type discover_occn receives.
    """
    from totem_lib.ocel.importer import import_ocel
    from totem_lib.ocel.ocel_duckdb import OcelDuckDB

    ocel_polars = import_ocel(str(TEST_DATA / "container_logistics.json"))
    ocel_db = OcelDuckDB(ocel_polars)

    occn_polars = discover_occn(ocel_polars, relativeOccuranceThreshold=0)
    occn_db = discover_occn(ocel_db, relativeOccuranceThreshold=0)

    assert occn_db == occn_polars