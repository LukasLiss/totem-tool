


#def flatten_event


if __name__ == "__main__":
    from datetime import datetime

    from totem_lib import totemDiscovery, import_ocel, mlpaDiscovery

    # load a sample OCEL
    print(f'Start importing Event Log, start time: {datetime.now()}')
    ocel = import_ocel(r'C:\Users\basti\Documents\Studium\MA\container_logistics.xml')

    print(f'Start totem Discovery, start time: {datetime.now()}')
    #totem = totemDiscovery(ocel)

    print(f'Start MLPA Discovery, start time: {datetime.now()}')
    #mlpa = mlpaDiscovery(totem)

    print(ocel.filter_by_multiple_object_types(['Transport Document', 'Customer Order', 'Container']))