import pytest
from totem_lib import discover_ocpn_db
from totem_lib.ocel.importer_db import import_ocel_db
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
def loaded_ocel_db(request):
    """Import OCEL once for all tests in this file."""
    ocel_db = import_ocel_db(request.param)
    yield ocel_db
    ocel_db.close()


def test_ocpn_discovery_no_error(loaded_ocel_db):
    model = discover_ocpn_db(loaded_ocel_db)
    assert model["format"] == "ocpn"
    assert model["transitions"]
