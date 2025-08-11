from ocel import ObjectCentricEventLog, load_events_from_sqlite, load_objects_from_sqlite
from totem import mine_totem, Totem
from typing import List

ocel = ObjectCentricEventLog()
events = load_events_from_sqlite("example_data/ContainerLogistics.sqlite")
obj = load_objects_from_sqlite("example_data/ContainerLogistics.sqlite")
ocel.events = events
ocel.object_df = obj

print(ocel.object_types)
# print(ocel.process_executions)
print(ocel.get_value("weigh_cr916", "event_timestamp"))
# print(ocel.obj_type_map)
print(ocel.get_value("book_vehs_td1", "Vehicle"))

# mine_totem(ocel)
