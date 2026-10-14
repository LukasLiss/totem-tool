from totem_lib.ocel.importer import import_ocel
from totem_lib import ocel
from ochandover import OCHANDOVER
from orgamining import ResourceActivityMatrix
import polars as pl

if __name__ == "__main__":

    

    ocel = import_ocel("runningexample.json")

    print("Object types", ocel.object_types)
    for obj_type in ocel.object_types:
        print(obj_type, len(ocel.get_object_ids_by_type(obj_type)))

    """
    
    handover_graph_flattened = OCHANDOVER.from_ocel_flattened(ocel, "Container", "Forklift")
    
    handover_graph_flattened.plot()


    handover_graph = OCHANDOVER.from_ocel(ocel, ["Forklift"], ["Container"])
    handover_graph.plot()

    handover_graph = OCHANDOVER.from_ocel(ocel, ["Truck", "Forklift"], ["Container", "Vehicle"])
    handover_graph.plot()

    """

    print("\n---------------- Resource-Activity Matrix ----------------")
    ram = ResourceActivityMatrix.from_ocel(ocel, resource_types=["employee", "machine"])
    print("\nResources:", ram.resources)
    print("Activities:", ram.activities)
    print("\nDistance matrix (euclidean):")
    print(ram.distance_matrix())

    """



    ocel = import_ocel("runningexample.json")

    print("---------------- Flattening Approach ----------------")

    handover_graph_flattened = OCHANDOVER.from_ocel_flattened(ocel, "item", "employee")
    handover_graph_flattened.plot()

    print("---------------- Object-Centric Approach ----------------")

    handover_graph = OCHANDOVER.from_ocel(ocel, ["employee", "machine"], ["item", "package"])
    handover_graph.plot()

    """





    