from pm4py import discover_oc_petri_net
from totem_lib import convert_ocel_polars_to_pm4py, ObjectCentricEventLog


def discover_ocpn(ocel: ObjectCentricEventLog):
    """
    Discovers an Object-Centric Petri Net from the given Object-Centric Event Log (OCEL) implemented in Polars as in this library,
    using the pm4py library.

    Parameters:
    -----------
    ocel : ObjectCentricEventLog
        The OCEL to be used for discovering the Object-Centric Petri Net.

    Returns:
    --------
    oc_petri_net : oc_petri_net
        The discovered Object-Centric Petri Net.
    """
    pm4py_ocel = convert_ocel_polars_to_pm4py(ocel)
    oc_petri_net = discover_oc_petri_net(pm4py_ocel)
    return oc_petri_net
