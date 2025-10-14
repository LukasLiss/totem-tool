import pm4py
import os
from totem_lib import import_ocel, discover_oc_petri_net_polars, ocpns_are_similar
from datetime import datetime

# Using pm4py
start_pm4py = datetime.now()
ocel = pm4py.read_ocel2_json(os.path.join("example_data", "ContainerLogistics.json"))
ocpn_from_pm4py = pm4py.discover_oc_petri_net(ocel)
end_pm4py = datetime.now()
print(f"PM4Py OCPN discovery took: {end_pm4py - start_pm4py}")
pm4py.save_vis_ocpn(ocpn_from_pm4py, os.path.join("figures", "ContainerLogistics_ocpn_pm4py.png"))

# Using totem_lib with Polars and the adapter
start_lib = datetime.now()
ocel = import_ocel(os.path.join("example_data", "ContainerLogistics.json"))
ocpn_from_lib = discover_oc_petri_net_polars(ocel)  # uses an adapter internally
end_lib = datetime.now()
print(f"totem_lib OCPN discovery took: {end_lib - start_lib}")
pm4py.save_vis_ocpn(ocpn_from_lib, os.path.join("figures", "ContainerLogistics_ocpn_lib.png"))

print("Are the two OCPNs similar?", ocpns_are_similar(ocpn_from_pm4py, ocpn_from_lib))