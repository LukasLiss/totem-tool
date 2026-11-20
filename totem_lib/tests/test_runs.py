"""
Contract for benchmark run folders (evaluation/runs.py) and resuming in the runner.

The point of a run folder is that nothing measured is ever lost: every row is on disk
before the next measurement starts, and a resumed run skips exactly what is done.
"""

import json
from datetime import datetime
from pathlib import Path

import pytest

from evaluation.algorithms import Algorithm
from evaluation.datasets import EvaluationLog, LogStatistics
from evaluation.harness import BenchmarkResult, Measurement
from evaluation.run_benchmarks import run
from evaluation.runs import (
    BenchmarkRow,
    RunDirectory,
    SettingsMismatch,
    combined_rows,
    find_runs,
    latest_per_pair,
)

STATS = LogStatistics(
    num_events=100, num_objects=50, num_unique_activities=5, num_object_types=3,
    num_e2o_relations=200, num_o2o_relations=0,
    earliest_timestamp=1_600_000_000, newest_timestamp=1_600_086_400,
)
SETTINGS = {"repeats": 2, "warmup": 1, "timeout_s": 60, "isolated": True}
ENV = {"cpu": "Test CPU", "cpu_count": 8, "ram_gb": 16.0, "os": "TestOS",
       "python": "3.13", "packages": {"polars": "1.0"},
       "git": {"commit": "abc", "dirty": False}}


def _row(log="a", algorithm="works", elapsed=1.0, error=None) -> BenchmarkRow:
    if error:
        result = BenchmarkResult.failed(algorithm, 2, error)
    else:
        result = BenchmarkResult.from_measurements(
            algorithm, [Measurement(elapsed), Measurement(elapsed * 2)], warmup=1,
            input_rss_mb=100.0, peak_rss_mb=120.0,
        )
    return BenchmarkRow(log, algorithm, result, STATS)


def _create(tmp_path, **overrides) -> RunDirectory:
    fields = dict(settings=SETTINGS, environment=ENV, logs=["a", "b"], algorithms=["works"])
    fields.update(overrides)
    return RunDirectory.create(tmp_path, **fields)


# ---------------------------------------------------------------------------
# Creating
# ---------------------------------------------------------------------------

def test_a_run_gets_a_timestamped_folder_with_its_plan(tmp_path):
    run_dir = _create(tmp_path, now=datetime(2026, 11, 20, 14, 3, 12), name="laptop")
    assert run_dir.path.name == "2026-11-20_14-03-12_laptop"
    meta = run_dir.meta()
    assert meta["settings"] == SETTINGS
    assert meta["logs"] == ["a", "b"]
    assert meta["environments"] == [ENV]
    assert run_dir.measurements_file.exists()


def test_two_runs_in_the_same_second_get_separate_folders(tmp_path):
    now = datetime(2026, 11, 20, 14, 3, 12)
    first = _create(tmp_path, now=now)
    second = _create(tmp_path, now=now)
    assert first.path != second.path


def test_opening_a_folder_that_is_not_a_run_fails(tmp_path):
    with pytest.raises(FileNotFoundError):
        RunDirectory.open(tmp_path)


# ---------------------------------------------------------------------------
# Saving and reading rows
# ---------------------------------------------------------------------------

def test_rows_survive_a_round_trip(tmp_path):
    run_dir = _create(tmp_path)
    run_dir.append(_row(), commit="abc")
    run_dir.append(_row(log="b", error="ValueError: boom"))
    rows = RunDirectory.open(run_dir.path).rows()
    assert rows[0] == _row()
    assert not rows[1].ok and rows[1].result.error == "ValueError: boom"


def test_each_line_records_when_and_on_which_commit(tmp_path):
    run_dir = _create(tmp_path)
    run_dir.append(_row(), commit="abc")
    line = json.loads(run_dir.measurements_file.read_text().splitlines()[0])
    assert line["commit"] == "abc"
    assert line["recorded_at"]
    assert line["times_s"] == [1.0, 2.0]


def test_a_torn_last_line_is_ignored(tmp_path):
    """A crash in the middle of a write must not make the whole run unreadable."""
    run_dir = _create(tmp_path)
    run_dir.append(_row())
    with open(run_dir.measurements_file, "a") as handle:
        handle.write('{"log": "b", "algori')
    assert [row.log for row in run_dir.rows()] == ["a"]


def test_the_newest_line_for_a_pair_wins_and_keeps_its_place():
    rows = [_row("a", error="boom"), _row("b"), _row("a", elapsed=5.0)]
    latest = latest_per_pair(rows)
    assert [row.log for row in latest] == ["a", "b"]
    assert latest[0].ok and latest[0].result.elapsed_s == 7.5


# ---------------------------------------------------------------------------
# Resuming
# ---------------------------------------------------------------------------

def test_completed_skips_failures_unless_asked_to_retry(tmp_path):
    run_dir = _create(tmp_path)
    run_dir.append(_row("a"))
    run_dir.append(_row("b", error="Timeout"))
    assert run_dir.completed() == {("a", "works"), ("b", "works")}
    assert run_dir.completed(retry_failed=True) == {("a", "works")}


def test_a_resumed_run_refuses_different_settings(tmp_path):
    run_dir = _create(tmp_path)
    run_dir.check_settings(dict(SETTINGS))  # same settings are fine
    with pytest.raises(SettingsMismatch, match="repeats"):
        run_dir.check_settings({**SETTINGS, "repeats": 10})


def test_the_plan_can_grow_but_keeps_its_order(tmp_path):
    run_dir = _create(tmp_path)
    logs, algorithms = run_dir.extend_plan(["c", "a"], ["other"])
    assert logs == ["a", "b", "c"]
    assert algorithms == ["works", "other"]
    assert run_dir.meta()["logs"] == ["a", "b", "c"]


def test_a_new_machine_or_commit_is_recorded_once(tmp_path):
    run_dir = _create(tmp_path)
    assert run_dir.record_environment(ENV) is False  # same machine
    other = {**ENV, "git": {"commit": "def", "dirty": False}}
    assert run_dir.record_environment(other) is True
    assert run_dir.record_environment(other) is False
    assert len(run_dir.meta()["environments"]) == 2
    assert run_dir.environment == other


def test_a_run_can_be_created_in_an_exact_folder_once(tmp_path):
    """A batch job names its folder so a resubmitted job finds the same run."""
    run_dir = _create(tmp_path, folder=tmp_path / "batch" / "enron")
    assert run_dir.path == tmp_path / "batch" / "enron"
    with pytest.raises(FileExistsError):
        _create(tmp_path, folder=tmp_path / "batch" / "enron")


# ---------------------------------------------------------------------------
# Live status
# ---------------------------------------------------------------------------

def test_the_running_pair_is_marked_and_cleared(tmp_path):
    run_dir = _create(tmp_path)
    assert run_dir.running() is None
    run_dir.mark_running("a", "works", timeout_s=3600)
    running = run_dir.running()
    assert (running["log"], running["algorithm"], running["timeout_s"]) == ("a", "works", 3600)
    assert running["pid"] and running["host"] and running["started_at"]
    run_dir.clear_running()
    assert run_dir.running() is None
    run_dir.clear_running()  # clearing twice is harmless


def test_progress_counts_against_the_plan(tmp_path):
    run_dir = _create(tmp_path, algorithms=["works", "breaks"])
    run_dir.append(_row("a", "works"))
    run_dir.append(_row("a", "breaks", error="Timeout"))
    progress = run_dir.progress()
    assert progress["planned"] == 4
    assert progress["done"] == 1
    assert progress["failed"] == [("a", "breaks")]
    assert progress["remaining"] == [("b", "works"), ("b", "breaks")]
    assert progress["last_recorded_at"]


def test_find_runs_takes_a_run_or_a_folder_of_runs(tmp_path):
    one = _create(tmp_path / "batch", folder=tmp_path / "batch" / "a")
    two = _create(tmp_path / "batch", folder=tmp_path / "batch" / "b")
    (tmp_path / "batch" / "slurm").mkdir()  # not a run, ignored
    assert [r.path for r in find_runs([tmp_path / "batch"])] == [one.path, two.path]
    assert [r.path for r in find_runs([one.path])] == [one.path]
    assert len(find_runs([one.path, tmp_path / "batch"])) == 2  # no duplicates
    assert find_runs([tmp_path / "nothing"]) == []


def test_combined_rows_merge_runs_and_keep_the_later_run_for_a_repeat(tmp_path):
    one = _create(tmp_path, folder=tmp_path / "a")
    two = _create(tmp_path, folder=tmp_path / "b")
    one.append(_row("a", "works", elapsed=1.0))
    one.append(_row("b", "works", elapsed=5.0))
    two.append(_row("b", "works", elapsed=2.0))
    rows = combined_rows([one, two])
    assert [(r.log, r.result.min_s) for r in rows] == [("a", 1.0), ("b", 2.0)]


# ---------------------------------------------------------------------------
# The runner's side
# ---------------------------------------------------------------------------

def _log(name) -> EvaluationLog:
    return EvaluationLog(name=name, source_url="https://example.org",
                         path=Path(f"{name}.json"), statistics=STATS)


def test_run_hands_each_row_over_as_soon_as_it_is_ready():
    seen = []
    calls = []

    def make_call(context):
        # By the time the second algorithm runs, the first row must be saved.
        calls.append(len(seen))
        return lambda: None

    algorithms = [Algorithm("one", make_call), Algorithm("two", make_call)]
    run([_log("a")], algorithms, repeats=1, echo=False, warmup=0, isolated=False,
        on_row=seen.append)
    assert calls == [0, 1]
    assert [row.algorithm for row in seen] == ["one", "two"]


def test_run_skips_pairs_that_are_already_measured():
    calls = []
    counting = Algorithm("counting", lambda context: lambda: calls.append(context.log.name))
    rows = run([_log("a"), _log("b")], [counting], repeats=1, echo=False, warmup=0,
               isolated=False, skip={("a", "counting")})
    assert [row.log for row in rows] == ["b"]
    assert calls == ["b"]


def test_run_announces_each_measurement_before_it_starts():
    events = []
    algorithm = Algorithm("one", lambda context: lambda: events.append("measure"))
    run([_log("a")], [algorithm], repeats=1, echo=False, warmup=0, isolated=False,
        on_start=lambda log, name: events.append(("start", log, name)),
        on_row=lambda row: events.append("saved"))
    assert events == [("start", "a", "one"), "measure", "saved"]
