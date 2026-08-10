import pytest

from totem_lib.occn.occn import OCCausalNet
from totem_lib.occn.replay_fitness import (
    OCCNReplayStatus,
    occn_replay_fitness,
)
from totem_lib.occn.replay_units import OCCNReplayEvent, OCCNReplayUnit


def _sequential_net(include_b: bool = False) -> OCCausalNet:
    next_activity = "b" if include_b else "END_order"
    marker_groups = {
        "START_order": {"omg": [[("a", "order", (1, 1), 1)]]},
        "a": {
            "img": [[("START_order", "order", (1, 1), 1)]],
            "omg": [[(next_activity, "order", (1, 1), 1)]],
        },
        "END_order": {"img": [[(("b" if include_b else "a"), "order", (1, 1), 1)]]},
    }
    if include_b:
        marker_groups["b"] = {
            "img": [[("a", "order", (1, 1), 1)]],
            "omg": [[("END_order", "order", (1, 1), 1)]],
        }
    return OCCausalNet.from_dict(marker_groups)


def _synchronizing_net() -> OCCausalNet:
    return OCCausalNet.from_dict(
        {
            "START_item": {"omg": [[("sync", "item", (1, 1), 1)]]},
            "START_order": {"omg": [[("sync", "order", (1, 1), 1)]]},
            "sync": {
                "img": [
                    [
                        ("START_item", "item", (1, 1), 1),
                        ("START_order", "order", (1, 1), 2),
                    ]
                ],
                "omg": [
                    [
                        ("END_item", "item", (1, 1), 1),
                        ("END_order", "order", (1, 1), 2),
                    ]
                ],
            },
            "END_item": {"img": [[("sync", "item", (1, 1), 1)]]},
            "END_order": {"img": [[("sync", "order", (1, 1), 1)]]},
        }
    )


def _branching_net() -> OCCausalNet:
    return OCCausalNet.from_dict(
        {
            "START_order": {"omg": [[("route", "order", (1, 1), 1)]]},
            "route": {
                "img": [[("START_order", "order", (1, 1), 1)]],
                "omg": [
                    [("finish", "order", (1, 1), 1)],
                    [("dead_end", "order", (1, 1), 1)],
                ],
            },
            "finish": {
                "img": [[("route", "order", (1, 1), 1)]],
                "omg": [[("END_order", "order", (1, 1), 1)]],
            },
            "dead_end": {
                "img": [[("route", "order", (1, 1), 1)]],
                "omg": [[("END_order", "order", (1, 1), 1)]],
            },
            "END_order": {
                "img": [
                    [("finish", "order", (1, 1), 1)],
                    [("dead_end", "order", (1, 1), 1)],
                ]
            },
        }
    )


def _same_type_join_net() -> OCCausalNet:
    return OCCausalNet.from_dict(
        {
            "START_order": {"omg": [[("join", "order", (1, 1), 1)]]},
            "join": {
                "img": [[("START_order", "order", (2, 2), 1)]],
                "omg": [[("END_order", "order", (2, 2), 1)]],
            },
            "END_order": {"img": [[("join", "order", (1, 1), 1)]]},
        }
    )


def _unit(
    unit_id: str,
    *activities: str,
    object_id: str = "o1",
    object_type: str = "order",
) -> OCCNReplayUnit:
    return OCCNReplayUnit(
        unit_id=unit_id,
        strategy="test",
        events=tuple(
            OCCNReplayEvent(
                event_id=f"{unit_id}-e{index}",
                activity=activity,
                timestamp_unix=index,
                objects_by_type=((object_type, (object_id,)),),
            )
            for index, activity in enumerate(activities, start=1)
        ),
    )


def test_replays_a_complete_sequence_to_the_empty_state():
    result = occn_replay_fitness(
        _sequential_net(),
        (_unit("fitting", "a"),),
        max_states=None,
    )

    assert result.fitness == pytest.approx(1.0)
    assert result.coverage == pytest.approx(1.0)
    assert result.fitting_units == 1
    assert result.unit_results[0].status is OCCNReplayStatus.FITTING
    assert result.unit_results[0].replayable is True


def test_replays_one_event_that_synchronizes_multiple_object_types():
    unit = OCCNReplayUnit(
        unit_id="synchronized",
        strategy="test",
        events=(
            OCCNReplayEvent(
                event_id="e1",
                activity="sync",
                timestamp_unix=1,
                objects_by_type=(
                    ("item", ("i1",)),
                    ("order", ("o1",)),
                ),
            ),
        ),
    )

    result = occn_replay_fitness(
        _synchronizing_net(),
        (unit,),
        max_states=None,
    )

    assert result.unit_results[0].status is OCCNReplayStatus.FITTING


def test_keeps_alternative_output_bindings_until_one_fits():
    result = occn_replay_fitness(
        _branching_net(),
        (_unit("branch", "route", "finish"),),
        max_states=None,
    )

    assert result.unit_results[0].status is OCCNReplayStatus.FITTING


def test_respects_same_type_object_cardinality():
    two_orders = OCCNReplayUnit(
        unit_id="two-orders",
        strategy="test",
        events=(
            OCCNReplayEvent(
                event_id="join-two",
                activity="join",
                timestamp_unix=1,
                objects_by_type=(("order", ("o1", "o2")),),
            ),
        ),
    )
    one_order = _unit("one-order", "join")

    result = occn_replay_fitness(
        _same_type_join_net(),
        (two_orders, one_order),
        max_states=None,
    )

    assert result.unit_results[0].status is OCCNReplayStatus.FITTING
    assert result.unit_results[1].status is OCCNReplayStatus.NON_FITTING
    assert result.unit_results[1].failure_event_index == 0


def test_reports_the_first_visible_event_that_cannot_be_replayed():
    result = occn_replay_fitness(
        _sequential_net(),
        (_unit("unknown", "unknown"),),
        max_states=None,
    )

    unit_result = result.unit_results[0]
    assert unit_result.status is OCCNReplayStatus.NON_FITTING
    assert unit_result.failure_event_index == 0
    assert unit_result.failure_event_id == "unknown-e1"


def test_reports_an_object_type_missing_from_the_model_as_non_fitting():
    result = occn_replay_fitness(
        _sequential_net(),
        (_unit("missing-type", "a", object_id="i1", object_type="item"),),
        max_states=None,
    )

    unit_result = result.unit_results[0]
    assert unit_result.status is OCCNReplayStatus.NON_FITTING
    assert unit_result.failure_event_index == 0
    assert unit_result.failure_event_id == "missing-type-e1"


def test_reports_completion_failure_after_visible_events_replay():
    result = occn_replay_fitness(
        _sequential_net(include_b=True),
        (_unit("unfinished", "a"),),
        max_states=None,
    )

    unit_result = result.unit_results[0]
    assert unit_result.status is OCCNReplayStatus.NON_FITTING
    assert unit_result.failure_event_index is None
    assert unit_result.failure_event_id is None


def test_aggregates_fitting_and_non_fitting_units():
    result = occn_replay_fitness(
        _sequential_net(),
        (
            _unit("fitting", "a", object_id="o1"),
            _unit("non-fitting", "unknown", object_id="o2"),
        ),
        max_states=None,
    )

    assert result.total_units == 2
    assert result.fitting_units == 1
    assert result.non_fitting_units == 1
    assert result.fitness == pytest.approx(0.5)


def test_state_limit_returns_inconclusive_without_false_deviation():
    result = occn_replay_fitness(
        _sequential_net(),
        (_unit("limited", "a"),),
        max_states=1,
    )

    unit_result = result.unit_results[0]
    assert unit_result.status is OCCNReplayStatus.INCONCLUSIVE
    assert unit_result.replayable is None
    assert unit_result.explored_state_count == 1
    assert result.fitness is None
    assert result.coverage == pytest.approx(0.0)


def test_state_limit_is_deterministic_for_a_branching_replay():
    first = occn_replay_fitness(
        _branching_net(),
        (_unit("limited-branch", "route", "finish"),),
        max_states=2,
    )
    second = occn_replay_fitness(
        _branching_net(),
        (_unit("limited-branch", "route", "finish"),),
        max_states=2,
    )

    assert first.to_dict() == second.to_dict()
    assert first.unit_results[0].status is OCCNReplayStatus.INCONCLUSIVE
    assert first.unit_results[0].explored_state_count == 2
