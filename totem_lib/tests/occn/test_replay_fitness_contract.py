import json

import pytest
import totem_lib

from totem_lib.occn.replay_fitness import (
    OCCNReplayFitnessResult,
    OCCNReplayStatus,
    OCCNReplayUnitResult,
    occn_replay_fitness,
)


def _unit_result(unit_id: str, status: OCCNReplayStatus):
    return OCCNReplayUnitResult(
        unit_id=unit_id,
        status=status,
        event_count=2,
        explored_state_count=3,
        object_types=("order", "item"),
    )


def test_replay_fitness_contract_is_available_from_the_public_api():
    assert totem_lib.occn_replay_fitness is occn_replay_fitness
    assert totem_lib.OCCNReplayFitnessResult is OCCNReplayFitnessResult
    assert totem_lib.OCCNReplayStatus is OCCNReplayStatus
    assert totem_lib.OCCNReplayUnitResult is OCCNReplayUnitResult


def test_unit_result_exposes_binary_and_inconclusive_outcomes():
    fitting = _unit_result("u1", OCCNReplayStatus.FITTING)
    non_fitting = _unit_result("u2", OCCNReplayStatus.NON_FITTING)
    inconclusive = _unit_result("u3", OCCNReplayStatus.INCONCLUSIVE)

    assert fitting.replayable is True
    assert non_fitting.replayable is False
    assert inconclusive.replayable is None
    assert inconclusive.to_dict()["status"] == "inconclusive"
    assert inconclusive.object_types == ("item", "order")
    assert inconclusive.to_dict()["object_types"] == ["item", "order"]


def test_unit_result_rejects_invalid_object_type_summaries():
    for object_types in (("order", "order"), ("",), (1,), "order"):
        with pytest.raises(ValueError, match="object_types"):
            OCCNReplayUnitResult(
                unit_id="invalid-object-types",
                status=OCCNReplayStatus.FITTING,
                event_count=1,
                explored_state_count=1,
                object_types=object_types,
            )


def test_object_types_do_not_change_existing_positional_arguments():
    result = OCCNReplayUnitResult(
        "positional",
        OCCNReplayStatus.NON_FITTING,
        2,
        3,
        1,
        "event-2",
        None,
        ("order",),
    )

    assert result.failure_event_index == 1
    assert result.failure_event_id == "event-2"
    assert result.object_types == ("order",)


def test_aggregate_result_reports_fitness_coverage_and_counts():
    result = OCCNReplayFitnessResult(
        unit_results=(
            _unit_result("u1", OCCNReplayStatus.FITTING),
            _unit_result("u2", OCCNReplayStatus.NON_FITTING),
            _unit_result("u3", OCCNReplayStatus.INCONCLUSIVE),
        )
    )

    assert result.fitness == pytest.approx(0.5)
    assert result.coverage == pytest.approx(2 / 3)
    assert result.total_units == 3
    assert result.fitting_units == 1
    assert result.non_fitting_units == 1
    assert result.inconclusive_units == 1
    assert len(result.to_dict()["unit_results"]) == 3
    json.dumps(result.to_dict())


def test_aggregate_result_rejects_duplicate_unit_identifiers():
    with pytest.raises(ValueError, match="identifiers must be unique"):
        OCCNReplayFitnessResult(
            unit_results=(
                _unit_result("duplicate", OCCNReplayStatus.FITTING),
                _unit_result("duplicate", OCCNReplayStatus.NON_FITTING),
            )
        )
