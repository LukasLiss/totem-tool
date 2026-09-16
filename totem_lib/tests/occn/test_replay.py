from collections import Counter

from totem_lib.occn.occn import OCCausalNet, OCCausalNetState
from totem_lib.occn.replay import (
    deduplicate_states,
    end_object_successors,
    start_object_successors,
    state_signature,
    visible_event_successors,
)
from totem_lib.occn.replay_units import OCCNReplayEvent


def _sequential_net() -> OCCausalNet:
    return OCCausalNet.from_dict(
        {
            "START_order": {"omg": [[("a", "order", (1, 1), 1)]]},
            "a": {
                "img": [[("START_order", "order", (1, 1), 1)]],
                "omg": [[("END_order", "order", (1, 1), 1)]],
            },
            "END_order": {"img": [[("a", "order", (1, 1), 1)]]},
        }
    )


def _event(activity: str = "a") -> OCCNReplayEvent:
    return OCCNReplayEvent(
        event_id="e1",
        activity=activity,
        timestamp_unix=1,
        objects_by_type=(("order", ("o1",)),),
    )


def test_state_signature_ignores_empty_entries_and_keeps_counts():
    state = OCCausalNetState(
        {
            "a": Counter({("START_order", "o1", "order"): 2}),
            "empty": Counter(),
        }
    )

    assert state_signature(state) == (("a", (("START_order", "o1", "order", 2),)),)


def test_deduplicate_states_only_removes_exact_duplicates():
    first = OCCausalNetState({"a": Counter({("START_order", "o1", "order"): 1})})
    duplicate = OCCausalNetState({"a": Counter({("START_order", "o1", "order"): 1})})
    larger = OCCausalNetState({"a": Counter({("START_order", "o1", "order"): 2})})

    assert deduplicate_states((first, duplicate, larger)) == (first, larger)


def test_start_visible_and_end_helpers_complete_a_sequence():
    occn = _sequential_net()

    started = start_object_successors(occn, OCCausalNetState(), "o1", "order")
    assert len(started) == 1
    assert not started[0].is_empty

    visible = visible_event_successors(occn, started[0], _event())
    assert len(visible) == 1
    assert not visible[0].is_empty

    ended = end_object_successors(occn, visible[0], "o1", "order")
    assert len(ended) == 1
    assert ended[0].is_empty


def test_helpers_return_no_successor_for_unknown_model_behavior():
    occn = _sequential_net()

    assert start_object_successors(occn, OCCausalNetState(), "i1", "item") == ()
    assert visible_event_successors(occn, OCCausalNetState(), _event("unknown")) == ()
