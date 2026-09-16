"""
Contract for the benchmark runner (evaluation/run_benchmarks.py).

These use fake algorithms so the suite stays fast. What matters here is that one broken
algorithm cannot take the whole run down with it, and that each row carries the log's
size along with the measurement.
"""

from pathlib import Path

import pytest

from evaluation.algorithms import Algorithm, LogContext, MissingInput
from evaluation.datasets import EvaluationLog, LogStatistics
from evaluation.run_benchmarks import BenchmarkRow, measure, run

STATS = LogStatistics(
    num_events=100,
    num_objects=50,
    num_unique_activities=5,
    num_object_types=3,
    num_e2o_relations=200,
    num_o2o_relations=80,
    earliest_timestamp=1_600_000_000,
    newest_timestamp=1_600_086_400,
)


def _log(**overrides) -> EvaluationLog:
    fields = {
        "name": "fake-log",
        "source_url": "https://example.org",
        "path": Path("fake.json"),
        "statistics": STATS,
    }
    fields.update(overrides)
    return EvaluationLog(**fields)


def _works(value="done") -> Algorithm:
    return Algorithm("works", lambda context: lambda: value)


def _raises_when_run() -> Algorithm:
    def boom():
        raise RuntimeError("algorithm exploded")

    return Algorithm("explodes", lambda context: boom)


def _raises_during_setup() -> Algorithm:
    def make_call(context):
        raise MissingInput("fake-log has no DuckDB copy")

    return Algorithm("needs-db", make_call)


def _prints() -> Algorithm:
    def noisy():
        print("chatter from inside the algorithm")
        return "done"

    return Algorithm("noisy", lambda context: noisy)


# ---------------------------------------------------------------------------
# measure
# ---------------------------------------------------------------------------

def test_measure_reports_a_successful_run():
    result = measure(_works(), LogContext(_log()), repeats=2)
    assert result.ok
    assert result.repeats == 2
    assert result.elapsed_s is not None


def test_measure_reports_a_failing_algorithm_instead_of_raising():
    result = measure(_raises_when_run(), LogContext(_log()), repeats=1)
    assert not result.ok
    assert "algorithm exploded" in result.error


def test_measure_reports_a_missing_input_instead_of_raising():
    """A log without a DuckDB copy should be a skipped row, not a crashed run."""
    result = measure(_raises_during_setup(), LogContext(_log()), repeats=1)
    assert not result.ok
    assert "MissingInput" in result.error
    assert "DuckDB" in result.error


def test_measure_swallows_algorithm_output(capsys):
    measure(_prints(), LogContext(_log()), repeats=1)
    assert "chatter" not in capsys.readouterr().out


# ---------------------------------------------------------------------------
# run
# ---------------------------------------------------------------------------

def test_run_covers_every_log_and_algorithm():
    logs = [_log(name="a"), _log(name="b")]
    rows = run(logs, [_works(), _works()], repeats=1, echo=False)
    assert len(rows) == 4
    assert {row.log for row in rows} == {"a", "b"}


def test_one_broken_algorithm_does_not_stop_the_others():
    rows = run([_log()], [_raises_when_run(), _works()], repeats=1, echo=False)
    assert [row.ok for row in rows] == [False, True]


def test_a_broken_algorithm_does_not_stop_later_logs():
    logs = [_log(name="a"), _log(name="b")]
    rows = run(logs, [_raises_when_run()], repeats=1, echo=False)
    assert len(rows) == 2
    assert all(not row.ok for row in rows)


def test_repeats_reach_the_harness():
    rows = run([_log()], [_works()], repeats=4, echo=False)
    assert rows[0].result.repeats == 4


def test_rows_are_printed_as_they_finish(capsys):
    run([_log()], [_works()], repeats=1, echo=True)
    printed = capsys.readouterr().out
    assert "fake-log" in printed
    assert "works" in printed


def test_nothing_is_printed_when_echo_is_off(capsys):
    run([_log()], [_works()], repeats=1, echo=False)
    assert capsys.readouterr().out == ""


# ---------------------------------------------------------------------------
# BenchmarkRow
# ---------------------------------------------------------------------------

def test_a_row_carries_the_logs_size_next_to_the_measurement():
    rows = run([_log()], [_works()], repeats=1, echo=False)
    values = rows[0].as_dict()
    assert values["log"] == "fake-log"
    assert values["algorithm"] == "works"
    assert values["num_events"] == 100
    assert values["num_e2o_relations"] == 200
    assert values["elapsed_s"] is not None


def test_a_failed_row_exports_its_error_and_no_timings():
    rows = run([_log()], [_raises_when_run()], repeats=1, echo=False)
    values = rows[0].as_dict()
    assert values["elapsed_s"] is None
    assert values["peak_mb"] is None
    assert "algorithm exploded" in values["error"]


def test_a_row_without_statistics_still_exports():
    rows = run([_log(statistics=None)], [_works()], repeats=1, echo=False)
    values = rows[0].as_dict()
    assert values["log"] == "fake-log"
    assert "num_events" not in values


# ---------------------------------------------------------------------------
# One real algorithm, to prove the wiring
# ---------------------------------------------------------------------------

def test_the_cheapest_real_algorithm_runs_on_a_real_log():
    from evaluation.algorithms import get_algorithm
    from evaluation.datasets import available_logs

    logs = available_logs()
    if not logs:
        pytest.skip("no evaluation logs present on disk")

    rows = run(logs[:1], [get_algorithm("OCDFG.from_ocel")], repeats=1, echo=False)
    assert rows[0].ok, rows[0].result.error
    assert rows[0].result.elapsed_s > 0
