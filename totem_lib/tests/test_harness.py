"""
Contract for the shared benchmark harness (evaluation/harness.py).

These tests use plain Python callables rather than totem_lib algorithms: the
harness must work on anything callable, and the suite stays fast and dependency
free that way.
"""

import time

import pytest

from evaluation.harness import (
    DEFAULT_REPEATS,
    BenchmarkResult,
    Measurement,
    benchmark,
    measure_once,
)


# ---------------------------------------------------------------------------
# measure_once
# ---------------------------------------------------------------------------

def test_measure_once_returns_the_functions_result():
    result, _ = measure_once(lambda: "totem")
    assert result == "totem"


def test_measure_once_passes_through_args_and_kwargs():
    result, _ = measure_once(lambda a, b, c=0: (a, b, c), 1, 2, c=3)
    assert result == (1, 2, 3)


def test_measure_once_reports_elapsed_time():
    _, m = measure_once(time.sleep, 0.02)
    assert isinstance(m, Measurement)
    assert m.elapsed_s >= 0.01  # loose bound: only asserts the clock ran


def test_measure_once_reports_peak_memory():
    def allocate():
        return bytearray(20 * 1024 * 1024)

    _, m = measure_once(allocate)
    assert m.peak_mb >= 10  # loose bound: the 20 MB allocation must show up


def test_measure_once_does_not_swallow_exceptions():
    def boom():
        raise ValueError("boom")

    with pytest.raises(ValueError):
        measure_once(boom)


def test_measure_once_is_reusable_after_a_failure():
    """A raising call must not leave the memory tracer running."""
    def boom():
        raise ValueError("boom")

    with pytest.raises(ValueError):
        measure_once(boom)

    _, m = measure_once(lambda: bytearray(1024))
    assert m.peak_mb >= 0


# ---------------------------------------------------------------------------
# benchmark
# ---------------------------------------------------------------------------

def test_benchmark_runs_the_function_once_per_repeat():
    calls = []
    benchmark("counter", lambda: calls.append(1), repeats=4)
    assert len(calls) == 4


def test_benchmark_uses_default_repeats():
    calls = []
    result = benchmark("counter", lambda: calls.append(1))
    assert len(calls) == DEFAULT_REPEATS
    assert result.repeats == DEFAULT_REPEATS


def test_benchmark_forwards_args_and_kwargs():
    seen = []
    benchmark("args", lambda a, b=None: seen.append((a, b)), 1, b=2, repeats=1)
    assert seen == [(1, 2)]


def test_benchmark_reports_a_successful_run():
    result = benchmark("sleep", time.sleep, 0.01, repeats=2)
    assert result.ok
    assert result.name == "sleep"
    assert result.repeats == 2
    assert result.elapsed_s >= 0.005
    assert result.peak_mb is not None
    assert result.error is None


def test_benchmark_reports_failure_instead_of_raising():
    def boom():
        raise ValueError("boom")

    result = benchmark("boom", boom, repeats=2)
    assert not result.ok
    assert "ValueError" in result.error
    assert "boom" in result.error
    assert result.elapsed_s is None
    assert result.peak_mb is None


def test_benchmark_rejects_a_repeat_count_below_one():
    with pytest.raises(ValueError):
        benchmark("noop", lambda: None, repeats=0)


# ---------------------------------------------------------------------------
# BenchmarkResult
# ---------------------------------------------------------------------------

def test_result_averages_time_and_takes_the_worst_peak():
    measurements = [
        Measurement(elapsed_s=1.0, peak_mb=10.0),
        Measurement(elapsed_s=3.0, peak_mb=50.0),
    ]
    result = BenchmarkResult.from_measurements("agg", measurements)
    assert result.elapsed_s == 2.0   # mean
    assert result.peak_mb == 50.0    # max, not mean
    assert result.repeats == 2
    assert result.ok


def test_result_rejects_empty_measurements():
    with pytest.raises(ValueError):
        BenchmarkResult.from_measurements("agg", [])


def test_failed_result_carries_the_error_and_no_timings():
    result = BenchmarkResult.failed("boom", 3, ValueError("exploded"))
    assert not result.ok
    assert result.error == "ValueError: exploded"
    assert result.elapsed_s is None
    assert result.peak_mb is None
