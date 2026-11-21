"""
Contract for the live status report (evaluation/status.py).

It reads only the files a run writes, so it is tested against hand-made run folders.
"""

import json
import os
import socket
from datetime import datetime, timedelta

from evaluation.harness import BenchmarkResult, Measurement
from evaluation.runs import BenchmarkRow, RunDirectory
from evaluation.status import describe_running, report

SETTINGS = {"repeats": 1, "warmup": 0, "timeout_s": 3600, "isolated": True}
NOW = datetime(2026, 11, 20, 12, 0, 0)


def _run(path, logs=("enron",), algorithms=("works", "breaks")) -> RunDirectory:
    return RunDirectory.create(settings=SETTINGS, environment=None, logs=list(logs),
                               algorithms=list(algorithms), folder=path)


def _row(log, algorithm, error=None) -> BenchmarkRow:
    result = (BenchmarkResult.failed(algorithm, 1, error) if error
              else BenchmarkResult.from_measurements(algorithm, [Measurement(1.0)]))
    return BenchmarkRow(log, algorithm, result)


def _marker(started_minutes_ago, timeout_s=3600, host=None, pid=None) -> dict:
    return {"log": "enron", "algorithm": "breaks", "timeout_s": timeout_s,
            "started_at": (NOW - timedelta(minutes=started_minutes_ago)).isoformat(),
            "host": host or "elsewhere", "pid": pid or 1}


def test_a_running_pair_shows_how_long_against_its_timeout():
    line = describe_running(_marker(12), NOW)
    assert "enron / breaks" in line and "12m00s" in line and "1h00m timeout" in line
    assert "STALE" not in line


def test_a_marker_far_past_its_timeout_is_stale():
    assert "STALE" in describe_running(_marker(90), NOW)


def test_a_marker_from_a_dead_process_on_this_host_is_stale():
    dead = _marker(1, host=socket.gethostname(), pid=2**22 + 12345)
    assert "STALE" in describe_running(dead, NOW)
    alive = _marker(1, host=socket.gethostname(), pid=os.getpid())
    assert "STALE" not in describe_running(alive, NOW)


def test_nothing_running_gives_an_empty_line():
    assert describe_running(None) == ""


def test_the_report_covers_every_run_in_a_batch(tmp_path):
    done = _run(tmp_path / "batch" / "p2p", logs=["p2p"])
    done.append(_row("p2p", "works"))
    done.append(_row("p2p", "breaks", error="Timeout: no result after 3600 s"))
    busy = _run(tmp_path / "batch" / "enron")
    busy.append(_row("enron", "works"))
    busy.running_file.write_text(json.dumps(_marker(5)))

    text = report([done, busy], NOW)
    assert "p2p" in text and "2/2" in text and "1 failed" in text
    assert "failed: p2p / breaks: Timeout" in text
    assert "1/2" in text and "running enron / breaks for 5m00s" in text
    assert "All runs: 3/4 measured, 1 failed" in text


def test_an_unstarted_run_reads_as_idle(tmp_path):
    text = report([_run(tmp_path / "r")], NOW)
    assert "0/2" in text and "idle, 2 left" in text


def test_no_runs_says_so():
    assert "No benchmark runs" in report([])
