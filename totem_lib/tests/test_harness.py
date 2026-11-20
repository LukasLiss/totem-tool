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
    confidence_half_width,
    measure_once,
    peak_rss_mb,
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


def test_timed_calls_do_not_trace_memory():
    """Tracing allocations would slow the timed call down."""
    import tracemalloc

    seen = []
    measure_once(lambda: seen.append(tracemalloc.is_tracing()))
    benchmark("probe", lambda: seen.append(tracemalloc.is_tracing()), repeats=2, warmup=1)
    assert seen == [False] * 4


def test_measure_once_does_not_swallow_exceptions():
    def boom():
        raise ValueError("boom")

    with pytest.raises(ValueError):
        measure_once(boom)


def _needs_rss():
    if peak_rss_mb() is None:
        pytest.skip("no resource module on this platform")


def _allocate_touched(mb: int) -> bytearray:
    block = bytearray(mb * 1024 * 1024)
    block[::4096] = b"x" * len(block[::4096])  # touch every page so it is resident
    return block


def test_peak_rss_is_a_plausible_size():
    _needs_rss()
    assert 1 < peak_rss_mb() < 100_000


def test_peak_rss_never_goes_down():
    """It is a high-water mark: freeing memory does not lower it."""
    _needs_rss()
    block = _allocate_touched(50)
    high = peak_rss_mb()
    del block
    assert peak_rss_mb() >= high


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
    assert len(result.times_s) == 2
    assert result.peak_rss_mb is None  # memory is opt-in
    assert result.error is None


def test_benchmark_reports_failure_instead_of_raising():
    def boom():
        raise ValueError("boom")

    result = benchmark("boom", boom, repeats=2)
    assert not result.ok
    assert "ValueError" in result.error
    assert "boom" in result.error
    assert result.elapsed_s is None
    assert result.peak_rss_mb is None


def test_benchmark_runs_warmup_calls_before_the_timed_ones():
    calls = []
    result = benchmark("counter", lambda: calls.append(1), repeats=2, warmup=3)
    assert len(calls) == 5
    assert result.repeats == 2
    assert result.warmup == 3
    assert len(result.times_s) == 2


def test_a_failing_warmup_is_reported():
    def boom():
        raise ValueError("boom")

    result = benchmark("boom", boom, repeats=1, warmup=1)
    assert not result.ok
    assert result.warmup == 1


def test_benchmark_leaves_memory_out_by_default():
    result = benchmark("noop", lambda: None, repeats=1)
    assert result.input_rss_mb is None
    assert result.peak_rss_mb is None
    assert result.added_rss_mb is None


def test_benchmark_records_peak_memory_before_and_after():
    _needs_rss()
    result = benchmark("noop", lambda: None, repeats=1, memory=True)
    assert result.peak_rss_mb >= result.input_rss_mb > 0
    assert result.added_rss_mb >= 0


def test_memory_does_not_add_calls():
    calls = []
    benchmark("counter", lambda: calls.append(1), repeats=2, warmup=1, memory=True)
    assert len(calls) == 3


def test_an_allocation_above_the_previous_peak_shows_up():
    """Far above anything this test process has used before."""
    _needs_rss()
    size = int(peak_rss_mb()) + 300
    result = benchmark("alloc", lambda: len(_allocate_touched(size)), repeats=1, memory=True)
    assert result.added_rss_mb > 200


def test_added_memory_is_never_negative():
    result = BenchmarkResult(name="x", repeats=1, input_rss_mb=10.0, peak_rss_mb=10.0)
    assert result.added_rss_mb == 0.0


def test_benchmark_rejects_negative_warmup():
    with pytest.raises(ValueError):
        benchmark("noop", lambda: None, warmup=-1)


def test_benchmark_rejects_a_repeat_count_below_one():
    with pytest.raises(ValueError):
        benchmark("noop", lambda: None, repeats=0)


# ---------------------------------------------------------------------------
# BenchmarkResult
# ---------------------------------------------------------------------------

def test_result_summarises_every_repeat():
    measurements = [Measurement(1.0), Measurement(3.0), Measurement(2.0)]
    result = BenchmarkResult.from_measurements("agg", measurements, warmup=1)
    assert result.elapsed_s == 2.0          # mean
    assert result.median_s == 2.0
    assert result.min_s == 1.0
    assert result.std_s == pytest.approx(1.0)
    assert result.times_s == (1.0, 3.0, 2.0)  # in run order, unrounded
    assert result.repeats == 3
    assert result.warmup == 1
    assert result.ok


def test_result_keeps_full_precision():
    """Rounding to milliseconds used to turn 6 ms and 14 ms runs into coarse steps."""
    result = BenchmarkResult.from_measurements("agg", [Measurement(0.0061234)])
    assert result.elapsed_s == 0.0061234


def test_a_single_repeat_has_no_spread():
    result = BenchmarkResult.from_measurements("agg", [Measurement(1.0)])
    assert result.std_s is None
    assert result.ci95_s is None


def test_confidence_interval_uses_students_t():
    # n=3: t(0.975, 2) = 4.303, stdev = 1, so the half-width is 4.303 / sqrt(3).
    assert confidence_half_width([1.0, 2.0, 3.0]) == pytest.approx(4.303 / 3 ** 0.5)


def test_confidence_interval_falls_back_to_the_normal_quantile():
    times = [1.0, 2.0] * 30
    expected = 1.96 * 0.5042 / len(times) ** 0.5
    assert confidence_half_width(times) == pytest.approx(expected, rel=1e-3)


def test_result_survives_a_round_trip_through_a_dict():
    """Workers send their result to the parent as JSON."""
    import json

    original = BenchmarkResult.from_measurements(
        "agg", [Measurement(1.0), Measurement(2.0)], warmup=1,
        input_rss_mb=100.0, peak_rss_mb=150.0,
    )
    restored = BenchmarkResult.from_dict("agg", json.loads(json.dumps(original.as_dict())))
    assert restored == original


def test_result_rejects_empty_measurements():
    with pytest.raises(ValueError):
        BenchmarkResult.from_measurements("agg", [])


def test_failed_result_carries_the_error_and_no_timings():
    result = BenchmarkResult.failed("boom", 3, ValueError("exploded"))
    assert not result.ok
    assert result.error == "ValueError: exploded"
    assert result.elapsed_s is None
    assert result.peak_rss_mb is None
