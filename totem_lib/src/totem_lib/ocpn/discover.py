from pm4py import discover_oc_petri_net
from totem_lib import convert_ocel_polars_to_pm4py, ObjectCentricEventLog
from .factory import create_from_dict


def discover_ocpn(ocel: ObjectCentricEventLog):
    """
    Discovers an object-centric Petri net from the given object-centric event log (OCEL)
    using discovery from the PM4Py library.

    Parameters:
    -----------
    ocel : ObjectCentricEventLog
        The OCEL to be used for discovering the object-centric Petri net.

    Returns:
    --------
    ocpn : OCPetriNet
        The discovered object-centric Petri net.
    """
    pm4py_ocel = convert_ocel_polars_to_pm4py(ocel)
    oc_petri_net_dict = discover_oc_petri_net(pm4py_ocel)
    ocpn = create_from_dict(oc_petri_net_dict)
    return ocpn
