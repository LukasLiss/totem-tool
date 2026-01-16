import random
from typing import Counter, Dict, Iterator, Tuple, Union

import pandas as pd
from totem_lib import ObjectCentricEventLog
from . import OCCausalNet, OCCausalNetState, OCCausalNetSemantics
from .semantics import Sequence, Binding


# Marks the final state in a state space exploration
FINAL_MARKER = "FINAL"


def occn_playout(
    occn: OCCausalNet,
    objects: dict,
    max_bindings_per_activity: int,
    branching_factor_activities: int = float("inf"),
    branching_factor_bindings: int = float("inf"),
    return_ocel: bool = False,
    make_objects_unique_per_sequence: bool = False,
) -> Union[Iterator[Sequence], ObjectCentricEventLog]:
    """
    Compute playout of an object-centric causal net generating either an iterator of binding sequences or an OCEL.
    Extensive search, generates all binding sequences in the language of the OCCN unless constrained by the parameters.
    Every binding sequence starts with the start activities of the OCCN introducing the provided objects; therefore,
    each binding sequence contains exactly the provided objects.
    This operation can be very expensive depending on the size of the OCCN and the provided parameters.

    Parameters
    -----------
    occn
        Object-centric causal net to play-out
    objects
        Dictionary mapping object types to sets of object ids. 
        Every sequence generated will contain exactly these objects.
    max_bindings_per_activity
        Maximum number of bindings per activity. 
        This limits the number of times an activity can be executed in each sequence. 
        Prevents infinite loops.
    branching_factor_activities
        Limits the number of enabled activities explored at each step (default: inf). 
        Note that the play-out will generate a subset of all sequences if this is set.
        It is strongly recommended to set this parameter when the OCCN is not very small. 
        Decimal values may be used to represent probabilities (e.g., 1.5).
    branching_factor_bindings
        Limits the number of enabled bindings explored at each step (default: inf). 
        Note that the play-out will generate a subset of all sequences if this is set.
        It is strongly recommended to set this parameter when the OCCN is not very small or `objects` is not very small. 
        Decimal values may be used to represent probabilities (e.g., 1.5).
    return_ocel
        If True, return an OCEL containing all events from the generated sequences instead of an iterator to the sequences.
        Timestamps will be generated in increasing order.
    make_objects_unique_per_sequence
        Only applies when return_ocel is True.
        If True, objects in the resulting OCEL are made unique per sequence. 
        This means that if an object 'o1' of type 'order' is used in multiple sequences, 
        it will be renamed to 'o1_1', 'o1_2', etc., in the ObjectCentricEventLog.
        This is useful to be able to extract sequences from the ObjectCentricEventLog.
        
    Returns
    --------
    Union[Iterator[Sequence], ObjectCentricEventLog]
        If return_ocel is False, an iterator over valid binding sequences.
        If return_ocel is True, an ObjectCentricEventLog containing all events from the generated sequences.
    """
    # objects may not be empty
    if not objects or all(len(v) == 0 for v in objects.values()):
        raise ValueError("No objects provided for OCCN playout.")
    # check branching factors
    if branching_factor_activities <= 0:
        raise ValueError("branching_factor_activities must be > 0.")
    if branching_factor_bindings <= 0:
        raise ValueError("branching_factor_bindings must be > 0.")
    
    # create int id for every activity for memory efficiency
    activity_to_id = {activity: i for i, activity in enumerate(occn.activities)}
    id_to_activity = {i: activity for activity, i in activity_to_id.items()}
    start_activities = set(
        i for activity, i in activity_to_id.items() if activity.startswith("START_")
    )
    # same for object types
    object_type_to_id = {
        object_type: i for i, object_type in enumerate(occn.object_types)
    }
    id_to_object_type = {i: object_type for object_type, i in object_type_to_id.items()}

    # Set up initial state with starting objects
    # In the state, we denote activities by their id, not by their name
    initial_state = OCCausalNetState()

    # Create fake obligations to start activities for all starting objects
    for object_type, object_ids in objects.items():
        ot_id = object_type_to_id[object_type]
        start_activity_id = activity_to_id[f"START_{object_type}"]
        initial_state += OCCausalNetState(
            {start_activity_id: Counter([(-1, obj_id, ot_id) for obj_id in object_ids])}
        )

    # Activity counts
    # index is from `activity_to_id`
    initial_activity_counts = (0,) * len(occn.activities)

    # State key used for memoization, see below
    initial_state_key = (initial_state, initial_activity_counts)

    # Memoization cache: Dict[state_key, Union[Set[Tuple[Binding, next_key]], str]]
    # where state_key is a tuple of (state, activity_counts) and the value is either
    # FINAL_MARKER if the state is the empty state,
    # or a set of tuples of bindings and next state keys that correspond to all successor
    # states that can be reached from the current state using the respective bindings.
    memo = {}

    # == Phase 1: Memoization DFS Graph Population ==
    _populate_memo_graph(
        initial_state_key,
        occn,
        OCCausalNetSemantics,
        max_bindings_per_activity,
        start_activities,
        activity_to_id,
        id_to_activity,
        object_type_to_id,
        branching_factor_activities,
        branching_factor_bindings,
        memo,
    )

    # == Phase 2: Reconstruct traces from memo ==
    valid_sequences_iter = _reconstruct_sequences(initial_state_key, memo, id_to_activity, id_to_object_type)

    # == Phase 3: Return data in the desired format ==
    if return_ocel:
        _valid_sequences_to_ocel(valid_sequences_iter, id_to_activity, id_to_object_type, make_objects_unique_per_sequence) 
    else:
        return valid_sequences_iter
    
def _populate_memo_graph(
    state_key: tuple,
    occn: OCCausalNet,
    semantics,
    max_bindings: int,
    start_activities,
    act_to_idx: dict,
    idx_to_act: dict,
    ot_to_idx: dict,
    bf_act: float,
    bf_bind: float,
    memo: dict,
) -> bool:
    """
    Recursively explores the state space to build a compact, memoized graph of all valid binding sequences.

    This function performs a depth-first search from a given state_key. It populates a memoization
    cache (`memo`). For each state (defined by the state_key), it stores the set of "next steps" (as tuples of
    (binding, next_state_key)) that lie on a path to the empty state,
    where binding is of type Binding.

    This approach avoids duplicate computation of two different sequences leading to the same state key.

    Parameters
    -----------
    state_key : tuple
        A tuple representing the current state in the form (state, activity_counts).
    occn : OCCausalNet
        The object-centric causal net being used.
    semantics
        The semantics to be used for the causal net.
    max_bindings : int
        Maximum number of bindings per activity.
    start_activities
        Collection of indices for start activities.
    act_to_idx : dict
        Dictionary mapping activities to their id.
    idx_to_act : dict
        Dictionary mapping activity ids to their names.
    ot_to_idx : dict
        Dictionary mapping object types to their id.
    bf_act : float
        Traversal will only explore this many enabled activities per step. If set, the play-out will generate a subset
        of all sequences. Will be stochastically rounded if not an integer.
    bf_bind : float
        Traversal will only explore this many enabled bindings per activity. If set, the play-out will generate a subset
        of all sequences. Will be stochastically rounded if not an integer.
    memo : dict
        The memoization cache where the state_key is mapped to a set of next steps or FINAL_MARKER if the state is the empty state.

    Returns
    -------
    bool
        Returns True if the state_key is reachable (i.e., not a deadlock), False otherwise.
        If the state_key is a deadlock, it will be represented by an empty set in the memo.
    """
    if state_key in memo:
        # a deadlock is indicated by an empty set in the memo.
        # an entry that is not empty indicates that the empty state is reachable
        return bool(memo[state_key])

    # state_key has not been explored yet, so we explore it
    state, activity_counts = state_key
    if not state.activities:
        # empty state
        memo[state_key] = FINAL_MARKER
        return True

    next_steps = set()
    enabled_activities = _get_enabled_activities(
        occn, semantics, state, start_activities, act_to_idx, idx_to_act, ot_to_idx
    )
    
    # Limit the number of enabled activities to bf_act
    if bf_act < float("inf"):
        # Stochastically round bf_act to an integer
        bf_act_rounded = int(bf_act) + (1 if random.random() < (bf_act % 1) else 0)
        # Select random subset of enabled activities
        enabled_activities = set(random.sample(list(enabled_activities), min(bf_act_rounded, len(enabled_activities))))

    # explore all sucessor states by binding all enabled activities
    for act in enabled_activities:
        act_id = act_to_idx[act]

        if activity_counts[act_id] >= max_bindings:
            continue

        new_activiy_counts = list(activity_counts)
        new_activiy_counts[act_id] += 1
        new_activity_counts_tuple = tuple(new_activiy_counts)

        # Get all enabled bindings for this activity
        if act_id in start_activities:
            enabled_bindings = _get_bindings_start_activity(
                occn, act, state, act_to_idx, ot_to_idx
            )
        else:
            enabled_bindings = semantics.enabled_bindings(occn, act, state, act_to_idx, ot_to_idx)

        # Limit the number of enabled bindings to bf_bind
        if bf_bind < float("inf"):
            # Stochastically round bf_bind to an integer
            bf_bind_rounded = int(bf_bind) + (1 if random.random() < (bf_bind % 1) else 0)
            # Select random subset of enabled bindings
            enabled_bindings = set(random.sample(list(enabled_bindings), min(bf_bind_rounded, len(enabled_bindings))))

        # explore all bindings
        for binding in enabled_bindings:
            new_state = semantics.bind_activity(
                binding=binding,
                state=state,
            )
            # clean up fake obligations for start activities
            if act_id in start_activities:
                new_state = _clean_fake_obligations(
                    occn, new_state, act, binding[2], act_to_idx, ot_to_idx
                )
            new_state_key = (new_state, new_activity_counts_tuple)

            if _populate_memo_graph(
                new_state_key,
                occn,
                semantics,
                max_bindings,
                start_activities,
                act_to_idx,
                idx_to_act,
                ot_to_idx,
                bf_act,
                bf_bind,
                memo
            ):
                next_steps.add((binding, new_state_key))

    # Add all next steps to memo
    # If state_key is a deadlock, this will be an empty set
    memo[state_key] = next_steps
    return bool(next_steps)

def _get_enabled_activities(
    occn: OCCausalNet,
    semantics,
    state: OCCausalNetState,
    start_activities,
    act_to_idx: dict,
    idx_to_act: dict,
    ot_to_idx: dict,
) -> set:
    """
    Returns the enabled activities in the given state, including start activities
    if they have "fake obligations".

    Parameters
    -----------
    occn : OCCausalNet
        The causal net being used.
    semantics
        The semantics to be used for the causal net.
    state : OCCausalNetState
        The current state of the causal net.
    start_activities
        Collection of indices for start activities
    act_to_idx
        Dictionary mapping activities to their id.
    idx_to_act
        Dictionary mapping activity ids to their names.
    ot_to_idx
        Dictionary mapping object types to their id.

    Returns
    --------
    set
        A set of ids for enabled activities in the given state.
    """
    enabled_activities = set()

    # get start activities with outstanding fake obligations
    start_activities_with_obligations = state.activities.intersection(start_activities)
    # add names, not ids
    enabled_activities.update(idx_to_act[act_id] for act_id in start_activities_with_obligations)

    # get all other enabled activities
    enabled_activities.update(
        semantics.enabled_activities(
            occn,
            state,
            include_start_activities=False,
            act_to_idx=act_to_idx,
            ot_to_idx=ot_to_idx,
        )
    )

    return enabled_activities

def _get_bindings_start_activity(
    occn: OCCausalNet,
    act: str,
    state: OCCausalNetState,
    act_to_idx: dict,
    ot_to_idx: dict,
):
    """
    Computes all enabled bindings for a start activity with the given fake obligations
    in the state.

    Parameters
    -----------
    occn : OCCausalNet
        The object-centric causal net
    act : str
        The start activity to bind
    state : OCCausalNetState
        The current state of the causal net, which contains the fake obligations for the start activity.
    act_to_idx : dict
        Dictionary mapping activities to their id.
    ot_to_idx : dict
        Dictionary mapping object types to their id.

    Returns
    -----------
    tuple
        A tuple of enabled bindings for the start activity.
        Each binding is a tuple of (activity_id, consumed, produced).
        The consumed and produced are tuples of (predecessor/successor activity id, objects_per_ot),
        where objects_per_ot is a tuple of entries (object_type_id, objects).
    """
    # get the outstanding fake obligations for the start activity
    act_id = act_to_idx[act]
    obligations = state[act_id]
    if not obligations:
        return ()
    outstanding_objects = set()
    for (_, obj_id, _), _ in obligations.items():
        outstanding_objects.add(obj_id)

    # Extract object type
    object_type = act.split("_", 1)[1]

    # Compute enabled bindings
    bindings = OCCausalNetSemantics.enabled_bindings_start_activity(
        occn, act, object_type, outstanding_objects, act_to_idx, ot_to_idx
    )

    return bindings

def _clean_fake_obligations(
    occn: OCCausalNet,
    state: OCCausalNetState,
    act: str,
    produced: tuple,
    act_to_idx: dict,
    ot_to_idx: dict,
) -> OCCausalNetState:
    """
    Cleans up fake obligations for start activities in the state after binding the start activity.
    Since a firing of a start activity consumes no obligations,
    we need to manually remove the fake obligations that were created for the start activity
    for all objects that were bound to it.

    Parameters
    -----------
    occn : OCCausalNet
        The object-centric causal net.
    state : OCCausalNetState
        The current state of the causal net.
    act : str
        The activity that was bound.
    produced : tuple
        The produced tuple from the binding.
    act_to_idx : dict
        Dictionary mapping activities to their id.
    ot_to_idx : dict
        Dictionary mapping object types to their id.

    Returns
    -----------
    OCCausalNetState
        The updated state with cleaned fake obligations.
    """
    # get the set of all objects involved
    objects = set()
    object_types = set()
    for _, ot_to_obj in produced:
        for ot, obj_ids in ot_to_obj:
            objects.update(obj_ids)
            object_types.add(ot)
    
    assert len(object_types) == 1, "Only one object type should be involved in a start activity binding"
    ot_id = next(iter(object_types))

    act_id = act_to_idx[act]
    # remove all obligations for the start activity that are related to the objects
    state -= OCCausalNetState(
        {act_id: Counter([(-1, obj_id, ot_id) for obj_id in objects])}
    )
    
    return state

def _reconstruct_sequences(state_key: tuple, memo: dict, idx_to_act: dict, idx_to_ot: dict) -> Iterator[Sequence]:
    """
    Reconstructs valid binding sequences from the memoization cache.

    This function iterates over the memoization cache and reconstructs all valid binding sequences
    that lead to the empty state. It yields each sequence tuple of Binding objects.

    Parameters
    ----------
    state_key : tuple
        The key representing the current state in the memoization cache.
    memo : dict
        The memoization cache containing state keys and their corresponding next steps.
    idx_to_act : dict
        Dictionary mapping activity ids to their names.
    idx_to_ot : dict
        Dictionary mapping object type ids to their names.

    Returns
    -------
    Iterator[Sequence]
        An iterator yielding valid binding sequences.
    """
    def convert_ids_to_names(binding: Binding) -> Binding:
        act = idx_to_act[binding[0]]
        cons = tuple(
            (idx_to_act[pred_act_id],
             tuple((idx_to_ot[ot_id], obj_ids) for ot_id, obj_ids in ot_to_obj))
            for pred_act_id, ot_to_obj in binding[1]
        ) if binding[1] is not None else None
        prod = tuple(
            (idx_to_act[succ_act_id],
             tuple((idx_to_ot[ot_id], obj_ids) for ot_id, obj_ids in ot_to_obj))
            for succ_act_id, ot_to_obj in binding[2]
        ) if binding[2] is not None else None
        return (act, cons, prod)
    
    next_steps = memo.get(state_key)

    if next_steps == FINAL_MARKER:
        # If we reached the empty state, yield an empty sequence
        yield ()
        return

    if not next_steps:
        # Deadlock state; this should only happen when there are 0 valid sequences
        # Do not yield anything
        return

    for binding, next_state_key in next_steps:
        # Recursively reconstruct sequences from the next state
        for sub_sequence in _reconstruct_sequences(next_state_key, memo, idx_to_act, idx_to_ot):
            # Yield the current binding followed by the sub-sequence
            # binding is converted to human-readable format (no ids)
            yield (convert_ids_to_names(binding),) + sub_sequence
            
            
def _valid_sequences_to_ocel(valid_sequences_iter, idx_to_act, idx_to_ot, objects_unique_per_sequence):
    """
    Converts the valid sequences of bindings into an OCEL object.

    Parameters
    ----------
    valid_sequences_iter : iter
        An iterator over valid sequences of bindings, where each sequence is a tuple of Binding objects
    idx_to_act : dict
        Mapping from indices to activity names
    idx_to_ot : dict
        Mapping from indices to object types
    objects_unique_per_sequence : bool
        If True, objects in the resulting OCEL are made unique per sequence. 
        This means that if an object 'o1' of type 'order' is used in multiple sequences, 
        it will be renamed to 'o1_1', 'o1_2', etc., in the OCEL.
        This is useful to be able to extract sequences from the OCEL.    

    Returns
    -------
    ObjectCentricEventLog
        The resulting OCEL object.
    """
    raise NotImplementedError("Verify ObjectCentricEventLog implementation; then adapt this function to use it instead of PM4Py OCEL.")
    # Convert all found traces to OCEL format

    # Create the OCEL object
    events_list = []
    objects_list = []
    relations_list = []

    all_objects_seen = set()
    event_id_counter = 0
    # assigns to each event an increased timestamp from 1970
    curr_timestamp = 10000000
    
    if objects_unique_per_sequence:
        object_id_counter = 0

    for sequence in valid_sequences_iter:
        # For each sequence, create events and objects
        for binding in sequence:
            activity_id = binding[0]
            consumed = binding[1]
            produced = binding[2]

            act = idx_to_act[activity_id]

            # do not add START / END activities
            if act.startswith("START_") or act.startswith("END_"):
                continue

            # Create event
            event_id = f"event_{event_id_counter}"
            event_id_counter += 1
            curr_timestamp += 1

            events_list.append(
                {
                    event_id_column: event_id,
                    event_activity: act,
                    event_timestamp: pd.to_datetime(curr_timestamp, unit="s"),
                }
            )

            # Create objects and relations
            # consumed and produced contain the same objects; we only need to create them once
            for _, ot_to_obj in consumed:
                for ot_id, objects in ot_to_obj:
                    obj_type = idx_to_ot[ot_id]
                    for obj_id in objects:
                        if objects_unique_per_sequence:
                            obj_id = f"{obj_id}_{object_id_counter}"
                        
                        # Add object
                        if obj_id not in all_objects_seen:
                            all_objects_seen.add(obj_id)
                            objects_list.append(
                                {object_id_column: obj_id, object_type_column: obj_type}
                            )

                        # Add relation
                        relations_list.append(
                            {
                                event_id_column: event_id,
                                event_activity: act,
                                event_timestamp: pd.to_datetime(
                                    curr_timestamp, unit="s"
                                ),
                                object_id_column: obj_id,
                                object_type_column: obj_type,
                            }
                        )
        if objects_unique_per_sequence:
            object_id_counter += 1

    # Convert to dataframes
    events_df = pd.DataFrame(events_list)
    objects_df = pd.DataFrame(objects_list)
    relations_df = pd.DataFrame(relations_list)

    # Create the OCEL object
    ocel = OCEL(
        events=events_df,
        objects=objects_df,
        relations=relations_df,
    )

    return ocel
