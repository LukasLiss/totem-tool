import pytest
from totem_lib import import_ocel, discover_oc_petri_net_polars, ocpns_are_similar
import pm4py
import os


@pytest.mark.skip(reason="Temporarily disabled: Discuss discrepancy between totem-lib and PM4Py implementaion and address this test.")
def test_ocpn_against_pm4py():
    """
    Test to compare the output of OCPN discovery against PM4Py's implementation.
    """
    # Setup: Prepare your inputs
    input_data_path = os.path.join("example_data", "ContainerLogistics.json")
    ocel = import_ocel(input_data_path)
    lib_result = discover_oc_petri_net_polars(ocel)
    ocel = pm4py.read_ocel2_json(input_data_path)
    pm4py_result = pm4py.discover_oc_petri_net(ocel)

    assert ocpns_are_similar(lib_result, pm4py_result)
