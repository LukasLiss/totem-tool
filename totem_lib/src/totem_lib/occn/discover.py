import pandas as pd
import pm4py
import networkx as nx
import copy
import itertools
import scipy
import scipy.special
from collections import Counter
from tqdm.auto import tqdm
from . import OCCausalNet
from totem_lib import ObjectCentricEventLog, convert_ocel_polars_to_pm4py, filter_dead_objects


def discover_occn(
    ocel: ObjectCentricEventLog,
    relativeOccuranceThreshold: float,
    parameters: dict = None,
) -> OCCausalNet:
    """
    Discover an OCCN using the Flexible Heuristics Miner (FHM) algorithm.

    Reference:
    Liss et al. (2025). Object-Centric Causal Nets.
    CAiSE 2025. https://doi.org/10.1007/978-3-031-94571-7_6

    Parameters
    -----------
    ocel
        The object-centric event log.
    relativeOccuranceThreshold
        The threshold for relative occurrence of markers (between 0 and 1).
        Markers with occurrence below this threshold will be filtered out.
    parameters (Optional)
        A dictionary of advanced parameters for the mining process. Possible keys:
        - `object_types`: If set, only these object types will be considered 
        - `dependency_threshold`: Dependency threshold for the internal Heuristics
          Miner (default: 0.5).
        - `and_threshold`: AND threshold for the internal Heuristics Miner
          (default: 0.65).
        - `loop_two_threshold`: Length-2 loop threshold for the internal Heuristics
          Miner (default: 0.5).
        - `combo_threshold`: Threshold for combinations to avoid combinatorial
          explosion during binding mining (default: 1000).
        - `inconsumableObjects`: List of object types considered inconsumable
          (default: None).
        - `inconsumableThreshold`: Threshold for inconsumable objects (default: 1).
    
    When using multiple values for relativeOccuranceThreshold, it is recommended
    to conduct the expensive discovery only once without filtering and then 
    filter the resulting OCCN for different thresholds:
    
    ```python
    
    # Discover with no filtering
    base_occn = discover_occn(ocel, relativeOccuranceThreshold=0)
    
    # Filter for different thresholds
    occn_1 = base_occn.apply_relative_occurrence_threshold(0.1)
    occn_2 = base_occn.apply_relative_occurrence_threshold(0.2)
    ```
    
    Returns
    --------
    OCCausalNet
        An OCCausalNet object representing the discovered object-centric causal net.
    """
    if parameters is None:
        parameters = {}

    objectTypes = parameters.get("object_types", ocel.object_types)
    dependency_threshold = parameters.get("dependency_threshold", 0.5)
    and_threshold = parameters.get("and_threshold", 0.65)
    loop_two_threshold = parameters.get("loop_two_threshold", 0.5)
    combo_threshold = parameters.get("combo_threshold", 1000)
    inconsumableObjects = parameters.get("inconsumableObjects", [])
    inconsumableThreshold = parameters.get("inconsumableThreshold", 1)

    # Pre-process OCEL
    eventLog, eventLogForMiner = _prepare_ocel_for_discovery(ocel)

    # Pre-process data
    objectSet = set(eventLogForMiner["object"])
    eventLogDict = _generateEventLogDict(eventLogForMiner)

    # Mine heuristics net for every object type (causal relations)
    heuNets = _mineHeuNets(
        eventLogForMiner.rename(
            columns={
                "event_activity": "concept:name",
                "event_timestamp": "time:timestamp",
                "object": "case:concept:name",
            }
        ),
        objectTypes,
        dependency_threshold,
        and_threshold,
        loop_two_threshold,
    )
    events = _getEvents(heuNets)

    # Generate global dependency graph by aggregating all heuristic nets
    dependencyDict, startActivities, endActivities = _generateDependencyDict(
        heuNets, events, inconsumableObjects, inconsumableThreshold
    )
    dependencyGraph = _generateDependencyGraph(dependencyDict)

    # Flatten predecessors and successors into dataframes
    predecessorDict = dependencyGraph._pred
    successorDict = dependencyGraph._succ
    predecessors = _getPredecessors(events, predecessorDict)
    successors = _getSuccessors(events, successorDict)

    # Generate closest predecessor and successor per event
    closestPredecessorDF = _generateClosestPredecessorDF(
        objectSet, eventLogDict, predecessors
    )
    closestSuccessorDF = _generateClosestSuccessorDF(objectSet, eventLogDict, successors)

    # Mine input marker groups and output marker groups
    eventToActivityDict = pd.Series(
        eventLog["event_activity"].values, index=eventLog["event_id"]
    ).to_dict()
    eventIDSet = set(eventToActivityDict.keys())
    outputBindings, _ = _mineOutputBindings(
        eventIDSet,
        eventToActivityDict,
        closestPredecessorDF,
        events,
        startActivities,
        dependencyDict,
        eventLogForMiner,
        combo_threshold,
    )
    inputBindings, _ = _mineInputBindings(
        eventIDSet,
        eventToActivityDict,
        closestSuccessorDF,
        events,
        endActivities,
        dependencyDict,
        eventLogForMiner,
        combo_threshold,
    )

    # Generate activity counts for filtering
    activityCount = _generateActivityCount(eventLog, startActivities, endActivities)

    # Create intermediate SimpleOCCNet
    occnet = SimpleOCCNet(
        dependencyGraph,
        outputBindings,
        inputBindings,
        activityCount,
    )

    # Convert to final OCCausalNet object, filter markers based on threshold
    occn = occnet.to_OCCausalNet(relativeOccurenceThreshold=relativeOccuranceThreshold)
    return occn

def _prepare_ocel_for_discovery(ocel):
    """
    Prepares the OCEL and returns two DataFrames:
    1. event_log: A log of unique events.
    2. event_log_for_miner: A flattened log of event-to-object relationships.
    """
    # Pre-process OCEL
    ocel = filter_dead_objects(ocel)
    
    # Convert to PM4Py event log
    ocel_pm4py = convert_ocel_polars_to_pm4py(ocel)
    
    # Create the unique event log
    event_log = ocel_pm4py.events.rename(
        columns={
            ocel_pm4py.event_id_column: "event_id",
            ocel_pm4py.event_activity: "event_activity",
            ocel_pm4py.event_timestamp: "event_timestamp",
        }
    )
    event_log = event_log[["event_id", "event_activity", "event_timestamp"]]

    # Create the event log for the miner

    # Get relations
    event_log_for_miner = ocel_pm4py.relations.copy()

    # Rename cols to expected format
    event_log_for_miner = event_log_for_miner.rename(
        columns={
            ocel_pm4py.event_activity: "event_activity",
            ocel_pm4py.event_timestamp: "event_timestamp",
            ocel_pm4py.object_id_column: "object",
            ocel_pm4py.object_type_column: "object_type",
            ocel_pm4py.event_id_column: "event_id",
        }
    )

    # Select only necessary columns
    required_columns = [
        "event_activity",
        "event_timestamp",
        "object",
        "object_type",
        "event_id",
    ]
    event_log_for_miner = event_log_for_miner[required_columns]

    # Drop rows with missing values and sort by timestamp
    event_log_for_miner = event_log_for_miner.dropna()
    event_log_for_miner = event_log_for_miner.sort_values(
        "event_timestamp", ignore_index=True
    )

    return event_log, event_log_for_miner

def _generateEventLogDict(eventLogForMiner: pd.DataFrame) -> dict:
    """
    Groups the event log by object identifier for fast lookup.

    Parameters
    -----------
    eventLogForMiner
        The flattened event log dataframe containing an 'object' column.

    Returns
    --------
    dict
        A dictionary where keys are object IDs and values are DataFrames containing
        the events associated with that object.
    """
    eventLogDict = {k: v for k, v in eventLogForMiner.groupby("object")}
    return eventLogDict


def _mineHeuNets(
    eventLogForMiner: pd.DataFrame,
    objectTypes: list,
    dependency_threshold: float = 0.5,
    and_threshold: float = 0.65,
    loop_two_threshold: float = 0.5,
) -> dict:
    """
    Mines a standard Heuristics Net for each object type individually.

    Parameters
    -----------
    eventLogForMiner
        The event log dataframe.
    objectTypes
        List of object types to mine.
    dependency_threshold
        Dependency threshold for the Heuristics Miner (default: 0.5).
    and_threshold
        AND threshold for the Heuristics Miner (default: 0.65).
    loop_two_threshold
        Length-2 loop threshold for the Heuristics Miner (default: 0.5).

    Returns
    --------
    dict
        A dictionary mapping object types to their mined Heuristics Net objects.
    """
    heuNets = {}
    for objType in objectTypes:
        heu_net = pm4py.discovery.discover_heuristics_net(
            eventLogForMiner[eventLogForMiner["object_type"] == objType][
                ["case:concept:name", "concept:name", "time:timestamp"]
            ],
            dependency_threshold,
            and_threshold,
            loop_two_threshold,
        )
        heuNets[objType] = heu_net
    return heuNets


def _getEvents(heuNets: dict) -> set:
    """
    Extracts the set of all unique activities found across all mined Heuristics Nets.

    Parameters
    -----------
    heuNets
        Dictionary of mined Heuristics Nets.

    Returns
    --------
    set
        A set containing the names of all unique activities.
    """
    events = set()
    events.update(*[net.activities for net in heuNets.values()])
    return events


def _generateDependencyDict(
    heuNets: dict,
    ev: set,
    inconsumableObjects: list = [],
    inconsumableThreshold: int = 1,
) -> tuple:
    """
    Aggregates dependencies from individual Heuristics Nets into a global dependency dictionary.
    Handles start and end activities for each object type.

    Parameters
    -----------
    heuNets
        Dictionary of mined Heuristics Nets.
    ev
        Set of all unique activities.
    inconsumableObjects
        List of object types considered inconsumable (default: []).
    inconsumableThreshold
        Threshold for inconsumable objects (default: 1).

    Returns
    --------
    tuple
        A tuple containing:
        - evToEvDict: Nested dictionary representing the dependency graph edges and measures.
        - startActivities: Dictionary mapping object types to their start activities and counts.
        - endActivities: Dictionary mapping object types to their end activities and counts.
    """
    evToEvDict = {act: {} for act in ev}
    startActivities = dict()
    endActivities = dict()

    for objectType, net in heuNets.items():
        if objectType not in inconsumableObjects:
            for act1, node1 in net.nodes.items():
                for node2, edge in node1.output_connections.items():
                    act2 = node2.node_name
                    dependencyValue = edge[0].dependency_value
                    if act2 in evToEvDict[act1].keys():
                        evToEvDict[act1][act2][objectType] = {
                            "dependenceMeasure": dependencyValue,
                            "objectType": objectType,
                        }
                    else:
                        evToEvDict[act1][act2] = {
                            objectType: {
                                "dependenceMeasure": dependencyValue,
                                "objectType": objectType,
                            }
                        }
                for startActivity, count in net.start_activities[0].items():
                    if objectType in startActivities.keys():
                        startActivities[objectType][startActivity] = (
                            "START_" + objectType,
                            count,
                        )
                    else:
                        startActivities[objectType] = {
                            startActivity: ("START_" + objectType, count)
                        }
                    if "START_" + objectType in evToEvDict.keys():
                        evToEvDict["START_" + objectType][startActivity] = {
                            objectType: {
                                "dependenceMeasure": count / (count + 1),
                                "objectType": objectType,
                            }
                        }
                    else:
                        evToEvDict["START_" + objectType] = {
                            startActivity: {
                                objectType: {
                                    "dependenceMeasure": count / (count + 1),
                                    "objectType": objectType,
                                }
                            }
                        }
                for endActivity, count in net.end_activities[0].items():
                    if objectType in endActivities.keys():
                        endActivities[objectType][endActivity] = (
                            "END_" + objectType,
                            count,
                        )
                    else:
                        endActivities[objectType] = {
                            endActivity: ("END_" + objectType, count)
                        }
                    if endActivity in evToEvDict.keys():
                        evToEvDict[endActivity]["END_" + objectType] = {
                            objectType: {
                                "dependenceMeasure": count / (count + 1),
                                "objectType": objectType,
                            }
                        }
                    else:
                        evToEvDict[endActivity] = {
                            "END_"
                            + objectType: {
                                objectType: {
                                    "dependenceMeasure": count / (count + 1),
                                    "objectType": objectType,
                                }
                            }
                        }
        else:
            # Handling for inconsumable objects
            for key, value in net.dfg_window_2_matrix.items():
                for key2, value2 in value.items():
                    if value2 >= inconsumableThreshold:
                        if key2 in evToEvDict[key].keys():
                            evToEvDict[key][key2][objectType] = {
                                "occurance": value2,
                                "objectType": objectType,
                            }
                        else:
                            evToEvDict[key][key2] = {
                                objectType: {
                                    "occurance": value2,
                                    "objectType": objectType,
                                }
                            }
                for startActivity, count in net.start_activities[0].items():
                    if objectType in startActivities.keys():
                        startActivities[objectType][startActivity] = (
                            "START_" + objectType,
                            count,
                        )
                    else:
                        startActivities[objectType] = {
                            startActivity: ("START_" + objectType, count)
                        }
                    if "START_" + objectType in evToEvDict.keys():
                        evToEvDict["START_" + objectType][startActivity] = {
                            objectType: {
                                "dependenceMeasure": count / (count + 1),
                                "objectType": objectType,
                            }
                        }
                    else:
                        evToEvDict["START_" + objectType] = {
                            startActivity: {
                                objectType: {
                                    "dependenceMeasure": count / (count + 1),
                                    "objectType": objectType,
                                }
                            }
                        }
                for endActivity, count in net.end_activities[0].items():
                    if objectType in endActivities.keys():
                        endActivities[objectType][endActivity] = (
                            "END_" + objectType,
                            count,
                        )
                    else:
                        endActivities[objectType] = {
                            endActivity: ("END_" + objectType, count)
                        }
                    if endActivity in evToEvDict.keys():
                        evToEvDict[endActivity]["END_" + objectType] = {
                            objectType: {
                                "dependenceMeasure": count / (count + 1),
                                "objectType": objectType,
                            }
                        }
                    else:
                        evToEvDict[endActivity] = {
                            "END_"
                            + objectType: {
                                objectType: {
                                    "dependenceMeasure": count / (count + 1),
                                    "objectType": objectType,
                                }
                            }
                        }
    return evToEvDict, startActivities, endActivities


def _generateDependencyGraph(evToEvDict: dict) -> nx.MultiDiGraph:
    """
    Converts the dependency dictionary into a NetworkX MultiDiGraph.

    Parameters
    -----------
    evToEvDict
        The dictionary representing the dependency graph structure.

    Returns
    --------
    nx.MultiDiGraph
        The resulting dependency graph.
    """
    dependencyGraph = nx.MultiDiGraph(evToEvDict)
    return dependencyGraph


def _getPredecessors(ev: set, predecessorDict: dict) -> pd.DataFrame:
    """
    Flattens the graph predecessor dictionary into a DataFrame for easier lookup.

    Parameters
    -----------
    ev
        Set of activities.
    predecessorDict
        Dictionary of predecessors from the NetworkX graph.

    Returns
    --------
    pd.DataFrame
        DataFrame with columns ['activity', 'object_type', 'predecessors'].
    """
    predecessors = []
    for activity in ev:
        for pred, ots in predecessorDict[activity].items():
            for ot in ots.keys():
                predecessors.append([activity, ot, pred])
    predecessors = pd.DataFrame(
        predecessors, columns=["activity", "object_type", "predecessors"]
    )
    return predecessors


def _getSuccessors(ev: set, successorDict: dict) -> pd.DataFrame:
    """
    Flattens the graph successor dictionary into a DataFrame for easier lookup.

    Parameters
    -----------
    ev
        Set of activities.
    successorDict
        Dictionary of successors from the NetworkX graph.

    Returns
    --------
    pd.DataFrame
        DataFrame with columns ['activity', 'object_type', 'successors'].
    """
    successors = []
    for activity in ev:
        for succ, ots in successorDict[activity].items():
            for ot in ots.keys():
                successors.append([activity, ot, succ])
    successors = pd.DataFrame(
        successors, columns=["activity", "object_type", "successors"]
    )
    return successors


def _getClosestPredecessor(
    position: int,
    activityList: list,
    predecessors: list,
) -> tuple:
    """
    Finds the closest preceding event in a trace that matches the allowed predecessors.

    Parameters
    -----------
    position
        The current index in the trace.
    activityList
        List of activities in the trace.
    predecessors
        List of allowed predecessor activities.

    Returns
    --------
    tuple
        (Closest Predecessor Activity Name, Index in Trace) or (None, None).
    """
    if position == 0:
        return None, None
    else:
        if len(predecessors) == 0:
            return None, None
        else:
            for i in range(position - 1, -1, -1):
                if activityList[i] in predecessors:
                    return activityList[i], i
            return None, None


def _getClosestSuccessor(
    log: pd.DataFrame,
    position: int,
    activityList: pd.Series,
    successors: list,
) -> tuple:
    """
    Finds the closest succeeding event in a trace that matches the allowed successors.

    Parameters
    -----------
    log
        The trace (DataFrame) for a specific object.
    position
        The current index in the trace.
    activityList
        Series of activities in the trace.
    successors
        List of allowed successor activities.

    Returns
    --------
    tuple
        (Closest Successor Activity Name, Index in Trace) or (None, None).
    """
    if position == len(log) - 1:
        return None, None

    else:
        if len(successors) == 0:
            return None, None
        else:
            for i in range(position + 1, len(log)):
                if activityList.iloc[i] in successors:
                    return activityList.iloc[i], i
            return None, None


def _generateClosestPredecessorDF(
    objectSet: set, eventLogDict: dict, predecessors: pd.DataFrame
) -> pd.DataFrame:
    """
    Generates a DataFrame mapping every event instance to its closest valid predecessor instance.

    Parameters
    -----------
    objectSet
        Set of all object IDs.
    eventLogDict
        Dictionary mapping object IDs to their trace DataFrames.
    predecessors
        DataFrame of allowed predecessors (skeleton).

    Returns
    --------
    pd.DataFrame
        DataFrame mapping event IDs to predecessor event IDs for each object.
    """
    closestPredecessorList = []
    predecessorActObjDict = {
        k: v["predecessors"].to_list()
        for k, v in predecessors.groupby(["activity", "object_type"])
    }
    predecessorActObjDictDefault = []
    for objectID in objectSet:
        uniqueLogSnippet = eventLogDict[objectID]
        activityList = uniqueLogSnippet["event_activity"].to_list()
        for i in range(len(uniqueLogSnippet)):
            activity = activityList[i]
            objectType = uniqueLogSnippet["object_type"].iloc[0]
            event_id = uniqueLogSnippet["event_id"].iloc[i]
            closestPredecessor, index = _getClosestPredecessor(
                i,
                activityList,
                predecessorActObjDict.get(
                    (activity, objectType), predecessorActObjDictDefault
                ),
            )
            if index is not None:
                closestPredecessorID = uniqueLogSnippet["event_id"].iloc[index]
            else:
                closestPredecessorID = None
            closestPredecessorTuple = (
                activity,
                event_id,
                closestPredecessor,
                closestPredecessorID,
                objectType,
                objectID,
            )
            closestPredecessorList.append(closestPredecessorTuple)
    closestPredecessorDF = pd.DataFrame(
        closestPredecessorList,
        columns=[
            "event_activity",
            "event_id",
            "predecessor",
            "predecessor_event_id",
            "object_type",
            "object",
        ],
    )
    return closestPredecessorDF


def _generateClosestSuccessorDF(
    objectSet: set, eventLogDict: dict, successors: pd.DataFrame
) -> pd.DataFrame:
    """
    Generates a DataFrame mapping every event instance to its closest valid successor instance.

    Parameters
    -----------
    objectSet
        Set of all object IDs.
    eventLogDict
        Dictionary mapping object IDs to their trace DataFrames.
    successors
        DataFrame of allowed successors (skeleton).

    Returns
    --------
    pd.DataFrame
        DataFrame mapping event IDs to successor event IDs for each object.
    """
    closestSuccessorList = []
    successorActObjDict = {
        k: v["successors"].to_list()
        for k, v in successors.groupby(["activity", "object_type"])
    }
    successorActObjDictDefault = []
    for objectID in objectSet:
        uniqueLogSnippet = eventLogDict[objectID]
        for i in range(len(uniqueLogSnippet)):
            activity = uniqueLogSnippet["event_activity"].iloc[i]
            objectType = uniqueLogSnippet["object_type"].iloc[0]
            event_id = uniqueLogSnippet["event_id"].iloc[i]
            closestSuccessor, index = _getClosestSuccessor(
                uniqueLogSnippet,
                i,
                uniqueLogSnippet["event_activity"],
                successorActObjDict.get(
                    (activity, objectType), successorActObjDictDefault
                ),
            )
            if index is not None:
                closestSuccessorID = uniqueLogSnippet["event_id"].iloc[index]
            else:
                closestSuccessorID = None
            closestSuccessorTuple = (
                activity,
                event_id,
                closestSuccessor,
                closestSuccessorID,
                objectType,
                objectID,
            )
            closestSuccessorList.append(closestSuccessorTuple)
    closestSuccessorDF = pd.DataFrame(
        closestSuccessorList,
        columns=[
            "event_activity",
            "event_id",
            "successor",
            "successor_event_id",
            "object_type",
            "object",
        ],
    )
    return closestSuccessorDF


def _sorted_k_partitions(seq: list, k: int):
    """
    Returns a list of all unique k-partitions of `seq`.
    Each partition is a list of parts, and each part is a tuple.

    Parameters
    -----------
    seq
        The sequence to partition.
    k
        The number of partitions.

    Returns
    --------
    list
        List of sorted k-partitions.
    """
    n = len(seq)
    groups = []  # a list of lists, currently empty

    def generate_partitions(i):
        if i >= n:
            yield list(map(tuple, groups))
        else:
            if n - i > k - len(groups):
                for group in groups:
                    group.append(seq[i])
                    yield from generate_partitions(i + 1)
                    group.pop()

            if len(groups) < k:
                groups.append([seq[i]])
                yield from generate_partitions(i + 1)
                groups.pop()

    result = generate_partitions(0)

    # Sort the parts in each partition in shortlex order
    result = [sorted(ps, key=lambda p: (len(p), p)) for ps in result]
    # Sort partitions by the length of each part, then lexicographically.
    result = sorted(result, key=lambda ps: (*map(len, ps), ps))

    return result


def _generate_partitions(seq: list, combo_threshold: int, event_id) -> tuple:
    """
    Helper function to generate partitions for a sequence of obligations.
    Handles the combinatorics check and index assignment.

    Returns
    -------
    tuple
        (list_of_partitions, is_skipped)
    """
    partitions = []
    is_skipped = False
    foundPartition = False
    totalCombinations = 0

    for k in range(len(seq) + 1):
        totalCombinations += scipy.special.stirling2(len(seq), k)
        if totalCombinations > combo_threshold:
            print("Too many possibilities for bindings. Skipped event " + str(event_id))
            is_skipped = True
            break

        for groups in _sorted_k_partitions(seq, k):
            # Check if all groups are valid
            if all(
                len({x for xs in group for x in xs[3]})
                == len([x for xs in group for x in xs[3]])
                for group in groups
            ):
                partitions.append(copy.deepcopy(groups))
                foundPartition = True

        if foundPartition:
            break

    # Assign indexIDs to the partitions
    if not is_skipped:
        for i in partitions:
            indexID = 0
            for j in i:
                for k_item in j:
                    k_item[3] = indexID
                indexID += 1
                

    return partitions, is_skipped


def _process_binding_statistics(raw_binding_list: list, events: set) -> dict:
    """
    Helper function to process the list of raw bindings into the final dictionary format.
    Handles flattening, counting, and min/max range calculation.
    """
    allBindings = []

    # Flatten bindings using itertools.product
    for event in raw_binding_list:
        act_of_marker = event[1]
        set_of_markers = []
        for objType, list_of_subgroups in event[2].items():
            set_of_markers.append([])
            for subgroup in list_of_subgroups:
                markers = []
                for object_set in subgroup:
                    object_set_as_tuples = [tuple(x) for x in object_set]
                    object_counter = Counter(object_set_as_tuples)
                    markers.extend(
                        tuple([m[0], m[1], m[2] * object_counter[m], m[3]])
                        for m in object_counter
                    )
                set_of_markers[-1].append(markers)
        combinations_of_markers = list(itertools.product(*set_of_markers))
        for combo in combinations_of_markers:
            allBindings.append(
                (act_of_marker, frozenset([tuple(x) for xs in combo for x in xs]))
            )

    # Count single bindings
    bindingsSingleCounts = Counter(allBindings)

    # Group by key for range calculation
    bindingsRanges = {}
    for binding in bindingsSingleCounts:
        key = (
            binding[0],
            frozenset((act, objType, index) for act, objType, _, index in binding[1]),
        )
        range_entry = tuple(
            {(act, objType): count} for act, objType, count, _ in binding[1]
        )
        if key in bindingsRanges.keys():
            bindingsRanges[key].append(range_entry)
        else:
            bindingsRanges[key] = [range_entry]

    # Calculate Min/Max ranges
    bindingsRanges2 = {}
    for key, value in bindingsRanges.items():
        bindingsRanges2[key] = dict()
        for tupleOfDicts in value:
            for dict1 in tupleOfDicts:
                for key2, value2 in dict1.items():
                    if key2 in bindingsRanges2[key].keys():
                        if value2 < bindingsRanges2[key][key2][0]:
                            bindingsRanges2[key][key2][0] = value2
                        if value2 > bindingsRanges2[key][key2][1]:
                            bindingsRanges2[key][key2][1] = value2
                    else:
                        bindingsRanges2[key][key2] = [value2, value2]

    # Update counts with ranges
    bindingsRangesCounts = Counter()
    for binding in bindingsSingleCounts:
        key = (
            binding[0],
            frozenset((act, objType, index) for act, objType, _, index in binding[1]),
        )
        value = bindingsSingleCounts[binding]
        bindingsRangesCounts.update({key: value})

    # Format final dictionary
    finalBindings = {act: [] for act in events}
    for key in bindingsRanges2.keys():
        value = []
        count = bindingsRangesCounts[key]
        for i in range(len(key[1])):
            act, objType, index = list(key[1])[i]
            rangeTuple = tuple(bindingsRanges2[key][(act, objType)])
            value.append((act, objType, index, rangeTuple))
        binding = (value, count)
        finalBindings[key[0]].append(binding)

    return finalBindings


def _index_event_log(eventLogForMiner: pd.DataFrame) -> dict:
    """
    Helper to index the event log for fast lookup of objects per event and object type.

    Structure: {event_id: {object_type: [list_of_objects]}}
    """
    event_objects_map = {}
    # iterate efficiently over relevant columns
    for row in eventLogForMiner[["event_id", "object_type", "object"]].itertuples(
        index=False
    ):
        e_id, ot, obj = row.event_id, row.object_type, row.object
        if e_id not in event_objects_map:
            event_objects_map[e_id] = {}
        if ot not in event_objects_map[e_id]:
            event_objects_map[e_id][ot] = []
        event_objects_map[e_id][ot].append(obj)
    return event_objects_map


def _index_relations(df: pd.DataFrame, group_col: str, target_key_col: str) -> dict:
    """
    Helper to index predecessor or successor dataframes.

    Parameters
    ----------
    df : pd.DataFrame
        The dataframe to index (closestPredecessorDF or closestSuccessorDF).
    group_col : str
        The primary grouping column (e.g., 'predecessor_event_id' or 'successor_event_id').
    target_key_col : str
        The secondary key column (e.g., 'event_id' for output bindings,
        'event_activity' for input bindings).

    Returns
    -------
    dict
        Structure: {group_id: {object_type: {target_key: {set_of_objects}}}}
    """
    relations_map = {}
    cols = [group_col, "object_type", target_key_col, "object"]

    for row in df[cols].itertuples(index=False):
        group_id = getattr(row, group_col)
        ot = row.object_type
        target_key = getattr(row, target_key_col)
        obj = row.object

        if group_id not in relations_map:
            relations_map[group_id] = {}
        if ot not in relations_map[group_id]:
            relations_map[group_id][ot] = {}
        if target_key not in relations_map[group_id][ot]:
            relations_map[group_id][ot][target_key] = set()

        relations_map[group_id][ot][target_key].add(obj)

    return relations_map


def _mineOutputBindings(
    eventIDSet: set,
    eventToActivityDict: dict,
    closestPredecessorDF: pd.DataFrame,
    events: set,
    startActivities: dict,
    dependencyDict: dict,
    eventLogForMiner: pd.DataFrame,
    combo_threshold: int,
) -> tuple:
    """
    Mines output bindings by analyzing how objects flow into succeeding events.
    Uses partitions to determine if objects move together or separately.

    Parameters
    -----------
    eventIDSet
        Set of all event IDs.
    eventToActivityDict
        Dictionary mapping event IDs to activity names.
    closestPredecessorDF
        DataFrame of closest predecessors per instance.
    events
        Set of all activities.
    startActivities
        Dictionary of start activities.
    dependencyDict
        Global dependency dictionary.
    eventLogForMiner
        Event log DataFrame.
    combo_threshold
        Threshold for combinations to avoid combinatorial explosion.

    Returns
    --------
    tuple
        - outputBindings: Dictionary of mined output bindings.
        - skippedEvents: List of events skipped due to high combinatorics.
    """
    outputBindingList = []
    skippedEvents = []

    # Pre-index DataFrames for efficient access
    event_objects_map = _index_event_log(eventLogForMiner)
    relations_map = _index_relations(
        closestPredecessorDF,
        group_col="predecessor_event_id",
        target_key_col="event_id",
    )

    for event in tqdm(eventIDSet, desc="Mining OCCN: Step 1/2 (Output Bindings)"):

        activity = eventToActivityDict[event]

        # Retrieve Snippet Relations
        event_relations = relations_map.get(event, {})

        binding = [event, activity, dict()]
        allCombinations = [event, activity, dict()]

        # Retrieve objects for this event
        current_event_objects = event_objects_map.get(event, {})

        allObjectTypes = set(current_event_objects.keys())

        # Create a deep copy of the objects list because we remove items from it later
        allObjectsDict = {ot: list(objs) for ot, objs in current_event_objects.items()}

        tooManyCombinations = False

        for objType in allObjectTypes:
            binding[2][objType] = []

            # Identify Successors and form Obligations
            successors_map = event_relations.get(objType, {})
            succSet = set(successors_map.keys())

            for succ in succSet:
                succActivity = eventToActivityDict[succ]

                # Retrieve objects involved in this specific successor relation
                objSet = frozenset(successors_map[succ])

                for obj in objSet:
                    try:
                        allObjectsDict[objType].remove(obj)
                    except ValueError:
                        pass

                obligation = [succActivity, objType, len(objSet), objSet]
                binding[2][objType].append(obligation)

            # Handle End Activities
            if allObjectsDict[objType]:
                if activity in dependencyDict.keys():
                    if "END_" + objType in dependencyDict[activity].keys():
                        obligation = [
                            "END_" + objType,
                            objType,
                            len(allObjectsDict[objType]),
                            frozenset(allObjectsDict[objType]),
                        ]
                        binding[2][objType].append(obligation)

            # Generate Partitions
            seq = copy.deepcopy(binding[2][objType])
            partitions, is_skipped = _generate_partitions(seq, combo_threshold, event)

            if is_skipped:
                skippedEvents.append(event)
                tooManyCombinations = True
                print(f"[WARNING] Skipping event {event} due to combinatorial explosion.")
                break

            allCombinations[2][objType] = partitions

        if not tooManyCombinations:
            outputBindingList.append(allCombinations)

    # Process Statistics
    outputBindings = _process_binding_statistics(outputBindingList, events)

    # Add Start Activities
    for objectType, activityDict in startActivities.items():
        for activity, (startActivity, count) in activityDict.items():
            if startActivity in outputBindings.keys():
                outputBindings[startActivity].append(
                    ([(activity, objectType, 0, (1, float("inf")))], count)
                )
            else:
                outputBindings[startActivity] = [
                    ([(activity, objectType, 0, (1, float("inf")))], count)
                ]

    return outputBindings, skippedEvents


def _mineInputBindings(
    eventIDSet: set,
    eventToActivityDict: dict,
    closestSuccessorDF: pd.DataFrame,
    events: set,
    endActivities: dict,
    dependencyDict: dict,
    eventLogForMiner: pd.DataFrame,
    combo_threshold: int,
) -> tuple:
    """
    Mines input bindings by analyzing how objects flow from preceding events.

    Parameters
    -----------
    eventIDSet
        Set of all event IDs.
    eventToActivityDict
        Dictionary mapping event IDs to activity names.
    closestSuccessorDF
        DataFrame of closest successors per instance.
    events
        Set of all activities.
    endActivities
        Dictionary of end activities.
    dependencyDict
        Global dependency dictionary.
    eventLogForMiner
        Event log DataFrame.
    combo_threshold
        Threshold for combinations.

    Returns
    --------
    tuple
        - inputBindings: Dictionary of mined input bindings.
        - skippedEvents: List of events skipped due to high combinatorics.
    """
    inputBindingList = []
    skippedEvents = []

    # Pre-index DataFrames for efficient access
    event_objects_map = _index_event_log(eventLogForMiner)
    relations_map = _index_relations(
        closestSuccessorDF,
        group_col="successor_event_id",
        target_key_col="event_activity",
    )

    for event in tqdm(eventIDSet, desc="Mining OCCN: Step 1/2 (Output Bindings)"):

        activity = eventToActivityDict[event]

        # Retrieve Snippet Relations
        event_relations = relations_map.get(event, {})

        binding = [event, activity, dict()]
        allCombinations = [event, activity, dict()]

        # Retrieve Objects for this Event
        current_event_objects = event_objects_map.get(event, {})
        allObjectTypes = set(current_event_objects.keys())
        allObjectsDict = {ot: list(objs) for ot, objs in current_event_objects.items()}

        tooManyCombinations = False

        for objType in allObjectTypes:
            binding[2][objType] = []

            # Identify Predecessors and form Obligations
            predecessors_map = event_relations.get(objType, {})
            predSet = set(predecessors_map.keys())

            for pred in predSet:
                # Retrieve objects involved in this specific predecessor relation
                objSet = frozenset(predecessors_map[pred])

                for obj in objSet:
                    try:
                        allObjectsDict[objType].remove(obj)
                    except ValueError:
                        pass
                obligation = [pred, objType, len(objSet), objSet]
                binding[2][objType].append(obligation)

            # Handle Start Activities
            if "START_" + objType in dependencyDict.keys():
                if activity in dependencyDict["START_" + objType].keys():
                    if allObjectsDict[objType]:
                        obligation = [
                            "START_" + objType,
                            objType,
                            len(allObjectsDict[objType]),
                            frozenset(allObjectsDict[objType]),
                        ]
                        binding[2][objType].append(obligation)

            # Generate Partitions
            seq = copy.deepcopy(binding[2][objType])
            partitions, is_skipped = _generate_partitions(seq, combo_threshold, event)

            if is_skipped:
                skippedEvents.append(event)
                tooManyCombinations = True
                print(f"[WARNING] Skipping event {event} due to combinatorial explosion.")
                break

            allCombinations[2][objType] = partitions

        if not tooManyCombinations:
            inputBindingList.append(allCombinations)

    # Process Statistics
    inputBindings = _process_binding_statistics(inputBindingList, events)

    # Add End Activities
    for objectType, activityDict in endActivities.items():
        for activity, (endActivity, count) in activityDict.items():
            if endActivity in inputBindings.keys():
                inputBindings[endActivity].append(
                    ([(activity, objectType, 0, (1, float("inf")))], count)
                )
            else:
                inputBindings[endActivity] = [
                    ([(activity, objectType, 0, (1, float("inf")))], count)
                ]

    return inputBindings, skippedEvents


def _generateActivityCount(
    eventLog: pd.DataFrame, startActivities: dict, endActivities: dict
) -> Counter:
    """
    Generates a count of all activities, including synthetic start and end activities.

    Parameters
    -----------
    eventLog
        The event log dataframe.
    startActivities
        Dictionary of start activities.
    endActivities
        Dictionary of end activities.

    Returns
    --------
    Counter
        Counter object with activity frequencies.
    """
    activityCount = Counter(eventLog["event_activity"])
    for _, activityDict in startActivities.items():
        for _, (startActivity, count) in activityDict.items():
            activityCount[startActivity] += count
    for _, activityDict in endActivities.items():
        for _, (endActivity, count) in activityDict.items():
            activityCount[endActivity] += count
    return activityCount


class SimpleOCCNet:
    """
    Intermediate representation of the Object-Centric Causal Net during discovery.
    """

    def __init__(
        self,
        dependencyGraph,
        outputBindings,
        inputBindings,
        activityCount,
    ):
        self.dependencyGraph = dependencyGraph
        self.activities = list(dependencyGraph._node.keys())
        self.edges = dependencyGraph._succ
        self.inputBindings = inputBindings
        self.outputBindings = outputBindings
        self.objectTypes = {
            objectType
            for bindings in self.inputBindings.values()
            for binding in bindings
            for (_, objectType, _, _) in binding[0]
        }
        self.activityCount = activityCount
        self.emptyState = {
            act1: {
                act2: {obj: [] for obj in self.edges[act1][act2].keys()}
                for act2 in self.edges[act1].keys()
            }
            for act1 in self.activities
        }
        self.state = self.emptyState

    def to_OCCausalNet(self, relativeOccurenceThreshold: int) -> OCCausalNet:
        """
        Converts the SimpleOCCNet to an OCCausalNet object.
        
        Parameters
        -----------
        relativeOccurenceThreshold
            The relative occurrence threshold for the OCCausalNet. This is used to filter out infrequent marker groups.
        """

        def _convet_marker_group(marker_group):
            """
            Converts a marker group as a tuple of (list, int) where the list
            contains marker of the form (activity, object_type, key, count)
            to a MarkerGroup object.
            """
            markers = []
            for marker in marker_group[0]:
                markers.append(
                    OCCausalNet.Marker(
                        marker[0], marker[1], (marker[3][0], marker[3][1]), marker[2]
                    )
                )
            return OCCausalNet.MarkerGroup(markers)

        dependency_graph = self.dependencyGraph
        input_bindings = {
            act: [_convet_marker_group(binding) for binding in bindings]
            for act, bindings in self.inputBindings.items()
        }
        output_bindings = {
            act: [_convet_marker_group(binding) for binding in bindings]
            for act, bindings in self.outputBindings.items()
        }
        return OCCausalNet(
            dependency_graph,
            output_bindings,
            input_bindings,
            relative_occurrence_threshold=relativeOccurenceThreshold,
        )

    @classmethod
    def _create_from_OCCausalNet(cls, occn: OCCausalNet):
        """
        Create a SimpleOCCNet from the OCCausalNet class representation.
        """

        def _convert_marker_group(marker_group):
            """
            Converts a OCCausalNet.MarkerGroup object to a tuple of a list of makers
            and the support count.
            """
            return (
                [
                    (
                        marker.related_activity,
                        marker.object_type,
                        marker.marker_key,
                        (marker.min_count, marker.max_count),
                    )
                    for marker in marker_group.markers
                ],
                marker_group.support_count,
            )

        dependencyGraph = occn.dependency_graph
        input_bindings = {
            act: [_convert_marker_group(marker_group) for marker_group in marker_groups]
            for act, marker_groups in occn.input_marker_groups.items()
        }
        output_bindings = {
            act: [_convert_marker_group(marker_group) for marker_group in marker_groups]
            for act, marker_groups in occn.output_marker_groups.items()
        }
        activity_count = {act: 1 for act in occn.activities}

        return cls(dependencyGraph, output_bindings, input_bindings, activity_count)