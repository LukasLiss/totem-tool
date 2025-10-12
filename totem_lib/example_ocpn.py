import pm4py
import os

ocel = pm4py.read_ocel2_json(os.path.join("example_data", "ContainerLogistics.json"))
model = pm4py.discover_oc_petri_net(ocel)
pm4py.view_ocpn(model, format="png")