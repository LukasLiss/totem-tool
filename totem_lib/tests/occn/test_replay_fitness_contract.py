import json

import pytest

from totem_lib.occn.replay_fitness import (
    OCCNReplayFitnessResult,
    OCCNReplayStatus,
    OCCNReplayUnitResult,
)


def _unit_result(unit_id: str, status: OCCNReplayStatus):
    return OCCNReplayUnitResult(
        unit_id=unit_id,
        status=status,
        event_count=2,
        explored_state_count=3,
    )


def test_unit_result_exposes_binary_and_inconclusive_outcomes():
    fitting = _unit_result("u1", OCCNReplayStatus.FITTING)
    non_fitting = _unit_result("u2", OCCNReplayStatus.NON_FITTING)
    inconclusive = _unit_result("u3", OCCNReplayStatus.INCONCLUSIVE)

    assert fitting.replayable is True
    assert non_fitting.replayable is False
    assert inconclusive.replayable is None
    assert inconclusive.to_dict()["status"] == "inconclusive"


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
