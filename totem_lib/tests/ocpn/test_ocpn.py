import pytest
from totem_lib import (
    import_ocel,
    discover_oc_petri_net_polars,
    ocpns_are_similar,
    convert_ocel_polars_to_pm4py,
    filter_dead_objects
)
from totem_lib.ocel import schema_base_filtering, propagate_filtering
import pm4py
import os

# Resolve relative to this file so the suite also runs from the repo root.
EXAMPLE_DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "example_data")
OCEL_FILES = [
    os.path.join(EXAMPLE_DATA, "ContainerLogistics.json"),
    os.path.join(EXAMPLE_DATA, "ocel2-p2p.json"),
]


def id_fn(filepath):
    """Creates a clean name for the pytest output based on the filename."""
    return os.path.basename(filepath)


@pytest.fixture(scope="module", params=OCEL_FILES, ids=id_fn)
def loaded_ocel(request):
    """Import OCEL once for all tests in this file."""
    ocel = import_ocel(request.param)
    return ocel


def test_ocpn_discovery_no_error(loaded_ocel):
    discover_oc_petri_net_polars(loaded_ocel)