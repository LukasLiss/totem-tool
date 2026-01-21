from totem_lib import import_ocel, discover_occn, convert_ocel_polars_to_pm4py
import pm4py

from totem_lib.occn.discover import _prepare_ocel_for_discovery


def test_ocfhm():
    # import ocel
    ocel = import_ocel("example_data/ContainerLogistics.json")
    #ocel = pm4py.read_ocel2("example_data/ContainerLogistics.json") TODO remove
    # discover occn
    occn = discover_occn(ocel, relativeOccuranceThreshold=0)
    print(occn)


# TODO REMOVE
if __name__ == "__main__":
    ocel_pm4py = pm4py.read_ocel2("example_data/ContainerLogistics.json")
    ocel_totem = import_ocel("example_data/ContainerLogistics.json")
    ocel_converted = convert_ocel_polars_to_pm4py(ocel_totem)
    
    print("PM4PY OCEL:")
    print(ocel_pm4py)
    print("TOTEM OCEL:")
    print(ocel_totem)
    print("CONVERTED OCEL:")
    print(ocel_converted)
    
    
    # prepare
    log_from_pm4py, log_miner_from_pm4py = _prepare_ocel_for_discovery(ocel_pm4py)
    log_from_converted, log_miner_from_converted = _prepare_ocel_for_discovery(ocel_converted)
    
    print(f"log_from_pm4py == log_from_converted: {log_from_pm4py.equals(log_from_converted)}")
    print(f"log_miner_from_pm4py == log_miner_from_converted: {log_miner_from_pm4py.equals(log_miner_from_converted)}")
    
    print("log_from_pm4py:")
    print(log_from_pm4py)
    print("log_from_converted:")
    print(log_from_converted)
    print("log_miner_from_pm4py:")
    print(log_miner_from_pm4py)
    print("log_miner_from_converted:")
    print(log_miner_from_converted)