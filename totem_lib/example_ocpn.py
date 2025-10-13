import pm4py
import os

ocel = pm4py.read_ocel2_json(os.path.join("example_data", "ContainerLogistics.json"))
model = pm4py.discover_oc_petri_net(ocel)
output_path = os.path.join("figures", "ContainerLogistics_ocpn_pm4py.png")
# pm4py.view_ocpn(model, format="png")
pm4py.save_vis_ocpn(model, output_path)