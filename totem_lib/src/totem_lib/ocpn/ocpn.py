from pm4py import discover_oc_petri_net
from totem_lib import PolarsOCELAdapter, ObjectCentricEventLog


def discover_oc_petri_net_polars(ocel: ObjectCentricEventLog):
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
    adapter = PolarsOCELAdapter(ocel)
    oc_petri_net = discover_oc_petri_net(adapter)
    return oc_petri_net
