from typing import Dict, Set, List
import networkx as nx
from datetime import datetime

# temporal relation constants (constants serving as a representation that is easier to understand than just the numbers)
TR_TOTAL = "total"
TR_DEPENDENT = "D"
TR_DEPENDENT_INVERSE = "Di"
TR_INITIATING = "I"
TR_INITIATING_REVERSE = "Ii"
TR_PARALLEL = "P"

# Event cardinality constants
EC_TOTAL = "total"
EC_ZERO = "0"
EC_ONE = "1"
EC_ZERO_ONE = "0...1"
EC_MANY = "1..*"
EC_ZERO_MANY = "0...*"

# Event cardinality constants
LC_TOTAL = "total"
LC_ZERO = "0"
LC_ONE = "1"
LC_ZERO_ONE = "0...1"
LC_MANY = "1..*"
LC_ZERO_MANY = "0...*"

DATEFORMAT = "%Y-%m-%d %H:%M:%S"

class Totem:
    def __init__(self):
        self.graph = nx.DiGraph()
        self.cardinality_types = ["0", "0..1", "1", "1..", "0.."]
        self.temporal_types = ["paral", "prec", "prec_inv", "dur", "dur_inv"]

    def add_object_type(self, obj_type: str) -> None:
        self.graph.add_node(obj_type)

    def add_relation(self, source: str, target: str,
                    log_cardinalities: Dict[str, float],
                    event_cardinalities: Dict[str, float],
                    temporal_relations: Dict[str, float]) -> None:
        # use additional attributes to store cardinalities and temporal relations
        self.graph.add_edge(source, target, 
                           log_cardinalities=log_cardinalities,
                           event_cardinalities=event_cardinalities,
                           temporal_relations=temporal_relations)




def get_all_event_objects(ocel, event_id):
    obj_ids = []
    for obj_type in ocel.object_types:
        obj_ids += ocel.get_value(event_id, obj_type)
    return obj_ids


def get_most_precise_lc(directed_type_tuple, tau, log_cardinalities):
    total = 0
    if directed_type_tuple in log_cardinalities.keys() and LC_TOTAL in log_cardinalities[directed_type_tuple].keys():
        total = log_cardinalities[directed_type_tuple][LC_TOTAL]

    if total == 0:
        return "ERROR 0"

    if (LC_ZERO in log_cardinalities[directed_type_tuple].keys()) and (
            (log_cardinalities[directed_type_tuple][LC_ZERO] / total) >= tau):
        return LC_ZERO
    if (LC_ONE in log_cardinalities[directed_type_tuple].keys()) and (
            (log_cardinalities[directed_type_tuple][LC_ONE] / total) >= tau):
        return LC_ONE
    if (LC_ZERO_ONE in log_cardinalities[directed_type_tuple].keys()) and (
            (log_cardinalities[directed_type_tuple][LC_ZERO_ONE] / total) >= tau):
        return LC_ZERO_ONE
    if (LC_MANY in log_cardinalities[directed_type_tuple].keys()) and (
            (log_cardinalities[directed_type_tuple][LC_MANY] / total) >= tau):
        return LC_MANY
    if (LC_ZERO_MANY in log_cardinalities[directed_type_tuple].keys()) and (
            (log_cardinalities[directed_type_tuple][LC_ZERO_MANY] / total) >= tau):
        return LC_ZERO_MANY

    return "None"


def get_most_precise_ec(directed_type_tuple, tau, event_cardinalities):
    total = 0
    if directed_type_tuple in event_cardinalities.keys() and EC_TOTAL in event_cardinalities[
        directed_type_tuple].keys():
        total = event_cardinalities[directed_type_tuple][EC_TOTAL]

    if total == 0:
        return "ERROR 0"

    if (EC_ZERO in event_cardinalities[directed_type_tuple].keys()) and (
            (event_cardinalities[directed_type_tuple][EC_ZERO] / total) >= tau):
        return EC_ZERO
    if (EC_ONE in event_cardinalities[directed_type_tuple].keys()) and (
            (event_cardinalities[directed_type_tuple][EC_ONE] / total) >= tau):
        return EC_ONE
    if (EC_ZERO_ONE in event_cardinalities[directed_type_tuple].keys()) and (
            (event_cardinalities[directed_type_tuple][EC_ZERO_ONE] / total) >= tau):
        return EC_ZERO_ONE
    if (EC_MANY in event_cardinalities[directed_type_tuple].keys()) and (
            (event_cardinalities[directed_type_tuple][EC_MANY] / total) >= tau):
        return EC_MANY
    if (EC_ZERO_MANY in event_cardinalities[directed_type_tuple].keys()) and (
            (event_cardinalities[directed_type_tuple][EC_ZERO_MANY] / total) >= tau):
        return EC_ZERO_MANY

    return "None"


def get_most_precise_tr(directed_type_tuple, tau, temporal_relation):
    total = 0
    if directed_type_tuple in temporal_relation.keys() and EC_TOTAL in temporal_relation[directed_type_tuple].keys():
        total = temporal_relation[directed_type_tuple][EC_TOTAL]

    if total == 0:
        return "ERROR 0"

    if (TR_DEPENDENT in temporal_relation[directed_type_tuple].keys()) and (
            (temporal_relation[directed_type_tuple][TR_DEPENDENT] / total) >= tau):
        return TR_DEPENDENT
    if (TR_DEPENDENT_INVERSE in temporal_relation[directed_type_tuple].keys()) and (
            (temporal_relation[directed_type_tuple][TR_DEPENDENT_INVERSE] / total) >= tau):
        return TR_DEPENDENT_INVERSE
    if (TR_INITIATING in temporal_relation[directed_type_tuple].keys()) and (
            (temporal_relation[directed_type_tuple][TR_INITIATING] / total) >= tau):
        return TR_INITIATING
    if (TR_INITIATING_REVERSE in temporal_relation[directed_type_tuple].keys()) and (
            (temporal_relation[directed_type_tuple][TR_INITIATING_REVERSE] / total) >= tau):
        return TR_INITIATING_REVERSE
    if (TR_PARALLEL in temporal_relation[directed_type_tuple].keys()) and (
            (temporal_relation[directed_type_tuple][TR_PARALLEL] / total) >= tau):
        return TR_PARALLEL

    return "None"

def mine_totem(ocel, tau=1):
    # temporal relations results
    h_temporal_relations: dict[tuple[str, str], dict[str, int]] = dict()  # stores all the temporal relations found
    # event cardinality results
    h_event_cardinalities: dict[tuple[str, str], dict[str, int]] = dict()  # stores all the temporal cardinalities found
    # event cardinality results
    h_log_cardinalities: dict[tuple[str, str], dict[str, int]] = dict()  # stores all the temporal cardinalities found

    # object min times (omint_L(o))
    o_min_times: dict[
        str, datetime] = dict()  # str identifier of the object maps to the earliest time recorded for that object in the event log
    # object max times (omaxt_L(o))
    o_max_times: dict[
        str, datetime] = dict()  # str identifier of the object maps to the last time recorded for that object in the event log

    # get a list of all object types (or variable that is filled while passing through the process executions)
    type_relations: set[set[str, str]] = set()  # stores all connected types

    o2o_o2o: dict[str, dict[str, set[
        str]]] = dict()  # dict that describes which objects are connected to which types and for each type which object
    # o2o[obj1][type3] = [obj5, obj6]
    o2o_e2o: dict[str, dict[str, set[str]]] = dict()
    o2o: dict[str, dict[str, set[str]]] = dict()

    # a mapping from type to its objects
    type_to_object = dict()

    for px in ocel.process_executions:
        for ev in px:
            # event infos: objects and timestamps
            ev_timestamp = datetime.strptime(str(ocel.get_value(ev, 'event_timestamp')), DATEFORMAT)

            objects_of_event = get_all_event_objects(ocel, ev)
            for obj in objects_of_event:
                # o2o updating
                o2o.setdefault(obj, dict())
                for type in ocel.object_types:
                    o2o[obj].setdefault(type, set())
                    o2o[obj][type].update(
                        ocel.get_value(ev, type))  # add all objects connected via e2o to each object involved
                # update lifespan information
                o_min_times.setdefault(obj, ev_timestamp)
                if ev_timestamp < o_min_times[obj]:  # todo check if comparison of datetimes works correctly here
                    o_min_times[obj] = ev_timestamp
                o_max_times.setdefault(obj, ev_timestamp)
                if ev_timestamp > o_max_times[obj]:  # todo check if comparison of datetimes works correctly here
                    o_max_times[obj] = ev_timestamp

            # compute event cardinality
            involved_types = []
            obj_count_per_type = dict()
            for type in ocel.object_types:
                obj_list = ocel.get_value(ev, type)
                if not obj_list:
                    continue
                else:
                    type_to_object.setdefault(type, set())
                    type_to_object[type].update(obj_list)
                    involved_types.append(type)
                    obj_count_per_type[type] = len(obj_list)
            # created related types
            for t1 in involved_types:
                for t2 in involved_types:
                    if t1 != t2:
                        type_relations.add(frozenset({t1, t2}))
            # for all type pairs determine
            for type_source in involved_types:
                for type_target in ocel.object_types:
                    # add one to total
                    h_event_cardinalities.setdefault((type_source, type_target), dict())
                    h_event_cardinalities[(type_source, type_target)].setdefault(EC_TOTAL, 0)
                    h_event_cardinalities[(type_source, type_target)][EC_TOTAL] += 1
                    # determine cardinality
                    cardinality = 0
                    if type_target in obj_count_per_type.keys():
                        cardinality = obj_count_per_type[type_target]
                    # add one to matching cardinalities
                    if cardinality == 0:
                        h_event_cardinalities[(type_source, type_target)].setdefault(EC_ZERO, 0)
                        h_event_cardinalities[(type_source, type_target)][EC_ZERO] += 1
                        h_event_cardinalities[(type_source, type_target)].setdefault(EC_ZERO_ONE, 0)
                        h_event_cardinalities[(type_source, type_target)][EC_ZERO_ONE] += 1
                        h_event_cardinalities[(type_source, type_target)].setdefault(EC_ZERO_MANY, 0)
                        h_event_cardinalities[(type_source, type_target)][EC_ZERO_MANY] += 1
                    elif cardinality == 1:
                        h_event_cardinalities[(type_source, type_target)].setdefault(EC_ONE, 0)
                        h_event_cardinalities[(type_source, type_target)][EC_ONE] += 1
                        h_event_cardinalities[(type_source, type_target)].setdefault(EC_ZERO_ONE, 0)
                        h_event_cardinalities[(type_source, type_target)][EC_ZERO_ONE] += 1
                        h_event_cardinalities[(type_source, type_target)].setdefault(EC_MANY, 0)
                        h_event_cardinalities[(type_source, type_target)][EC_MANY] += 1
                        h_event_cardinalities[(type_source, type_target)].setdefault(EC_ZERO_MANY, 0)
                        h_event_cardinalities[(type_source, type_target)][EC_ZERO_MANY] += 1
                    elif cardinality > 1:
                        h_event_cardinalities[(type_source, type_target)].setdefault(EC_MANY, 0)
                        h_event_cardinalities[(type_source, type_target)][EC_MANY] += 1
                        h_event_cardinalities[(type_source, type_target)].setdefault(EC_ZERO_MANY, 0)
                        h_event_cardinalities[(type_source, type_target)][EC_ZERO_MANY] += 1

    # merge o2o and e2o connected objects
    for (source_o, target_o) in ocel.o2o_graph.graph.edges:
        print(f"{source_o} - {target_o}")
        type_of_target_o = None
        for type in ocel.object_types:
            if target_o in type_to_object[type]:
                type_of_target_o = type
                break
        if type_of_target_o == None:
            continue
        o2o.setdefault(source_o, dict())
        o2o[source_o].setdefault(type_of_target_o, set())
        o2o[source_o][type_of_target_o].update([source_o])

    # compute log cardinality
    for type_source in ocel.object_types:
        for type_target in ocel.object_types:
            h_temporal_relations.setdefault((type_source, type_target), dict())
            for obj in type_to_object[type_source]:
                h_log_cardinalities.setdefault((type_source, type_target), dict())
                h_log_cardinalities[(type_source, type_target)].setdefault(LC_TOTAL, 0)
                h_log_cardinalities[(type_source, type_target)][LC_TOTAL] += 1

                cardinality = len(o2o[obj][type_target])
                if type_source == 'products':
                    print(f"Obj: {obj} Typ: {type_target} Card: {cardinality}")

                if cardinality == 0:
                    h_log_cardinalities[(type_source, type_target)].setdefault(LC_ZERO, 0)
                    h_log_cardinalities[(type_source, type_target)][LC_ZERO] += 1
                    h_log_cardinalities[(type_source, type_target)].setdefault(LC_ZERO_ONE, 0)
                    h_log_cardinalities[(type_source, type_target)][LC_ZERO_ONE] += 1
                    h_log_cardinalities[(type_source, type_target)].setdefault(LC_ZERO_MANY, 0)
                    h_log_cardinalities[(type_source, type_target)][LC_ZERO_MANY] += 1
                elif cardinality == 1:
                    h_log_cardinalities[(type_source, type_target)].setdefault(LC_ONE, 0)
                    h_log_cardinalities[(type_source, type_target)][LC_ONE] += 1
                    h_log_cardinalities[(type_source, type_target)].setdefault(LC_ZERO_ONE, 0)
                    h_log_cardinalities[(type_source, type_target)][LC_ZERO_ONE] += 1
                    h_log_cardinalities[(type_source, type_target)].setdefault(LC_MANY, 0)
                    h_log_cardinalities[(type_source, type_target)][LC_MANY] += 1
                    h_log_cardinalities[(type_source, type_target)].setdefault(LC_ZERO_MANY, 0)
                    h_log_cardinalities[(type_source, type_target)][LC_ZERO_MANY] += 1
                elif cardinality > 1:
                    h_log_cardinalities[(type_source, type_target)].setdefault(LC_MANY, 0)
                    h_log_cardinalities[(type_source, type_target)][LC_MANY] += 1
                    h_log_cardinalities[(type_source, type_target)].setdefault(LC_ZERO_MANY, 0)
                    h_log_cardinalities[(type_source, type_target)][LC_ZERO_MANY] += 1

                # compute temporal relations
                for obj_target in o2o[obj][type_target]:
                    h_temporal_relations[(type_source, type_target)].setdefault(TR_TOTAL, 0)
                    h_temporal_relations[(type_source, type_target)][TR_TOTAL] += 1
                    if o_min_times[obj_target] <= o_min_times[obj] <= o_max_times[obj] <= o_max_times[obj_target]:
                        h_temporal_relations[(type_source, type_target)].setdefault(TR_DEPENDENT, 0)
                        h_temporal_relations[(type_source, type_target)][TR_DEPENDENT] += 1
                    if o_min_times[obj] <= o_min_times[obj_target] <= o_max_times[obj_target] <= o_max_times[obj]:
                        h_temporal_relations[(type_source, type_target)].setdefault(TR_DEPENDENT_INVERSE, 0)
                        h_temporal_relations[(type_source, type_target)][TR_DEPENDENT_INVERSE] += 1
                    if (o_min_times[obj] <= o_max_times[obj] <= o_min_times[obj_target] <= o_max_times[obj_target]) or (
                            o_min_times[obj] < o_min_times[obj_target] <= o_max_times[obj] < o_max_times[obj_target]):
                        h_temporal_relations[(type_source, type_target)].setdefault(TR_INITIATING, 0)
                        h_temporal_relations[(type_source, type_target)][TR_INITIATING] += 1
                    if (o_min_times[obj_target] <= o_max_times[obj_target] <= o_min_times[obj] <= o_max_times[obj]) or (
                            o_min_times[obj_target] < o_min_times[obj] <= o_max_times[obj_target] < o_max_times[obj]):
                        h_temporal_relations[(type_source, type_target)].setdefault(TR_INITIATING_REVERSE, 0)
                        h_temporal_relations[(type_source, type_target)][TR_INITIATING_REVERSE] += 1
                    # allways parallel
                    h_temporal_relations[(type_source, type_target)].setdefault(TR_PARALLEL, 0)
                    h_temporal_relations[(type_source, type_target)][TR_PARALLEL] += 1

        additional_t2t = {}
        # additional_t2t = {frozenset({'Customer Order', 'Transportation Documents'})}
        # merge type relations
        merged_type_relations = type_relations.union(additional_t2t)
        # for each connection give the 6 relations
        for connected_types in merged_type_relations:
            t1, t2 = connected_types
            print(f"{t1} -> {t2}")

            # get log cardinality
            lc = get_most_precise_lc((t1, t2), tau, h_log_cardinalities)
            lc_i = get_most_precise_lc((t2, t1), tau, h_log_cardinalities)
            print(f"LC: {lc_i} - {lc}")
            # get event cardinality
            ec = get_most_precise_ec((t1, t2), tau, h_event_cardinalities)
            ec_i = get_most_precise_ec((t2, t1), tau, h_event_cardinalities)
            print(f"EC: {ec_i} - {ec}")
            # get temporal relation
            tr = get_most_precise_tr((t1, t2), tau, h_temporal_relations)
            tr_i = get_most_precise_tr((t2, t1), tau, h_temporal_relations)
            print(f"TR: {tr}")
            # print(f"TRi: {tr_i}")
            print("")
    return