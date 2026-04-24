from totem_lib import import_ocel, discover_occn
from totem_lib.ocel import schema_base_filtering, propagate_filtering


def test_ocfhm():
    # import ocel
    ocel = import_ocel("example_data/ContainerLogistics.json")
    # discover occn
    occn = discover_occn(ocel, relativeOccuranceThreshold=0)
    print(occn)