from totem_lib import import_ocel, totemDiscovery, mlpaDiscovery
import cProfile


ocel = import_ocel("example_data/ContainerLogistics.sqlite")

# testing the main hooks exposed to the mine_totem algo
print(ocel.object_types)
# print(ocel.process_executions)
print(ocel.get_value("weigh_cr916", "event_timestamp"))  # get timestamp of an event
print(ocel.get_event_timestamp("weigh_cr916"))  # get timestamp of an event

print(ocel.get_value("weigh_cr916", "event_activity"))  # get activity of an event
print(ocel.get_event_activity("weigh_cr916"))  # get activity of an event

# print(ocel.obj_type_map)
print(ocel.get_value("book_vehs_td1", "Vehicle"))  # get objects of type "Vehicle" related to event "book_vehs_td1"
print(ocel.get_event_objects_by_type("book_vehs_td1", "Vehicle"))  # get objects of type "Vehicle" related to event "book_vehs_td1"
print(ocel.get_event_objectIDs("book_vehs_td1"))  # get objects related to event "book_vehs_td1"
# print(ocel.o2o_graph_edges)  # new interface for ocel.o2o_graph.graph.edges

print("\n\n\n-------------------- Totem Discovery --------------------")
totem = totemDiscovery(ocel)
print(totem.tempgraph)
print("\n\n\n-------------------- MLPA Discovery --------------------")
view = mlpaDiscovery(totem)
# cProfile.run('mlpaDiscovery(ocel)')


