"""
Shared benchmark harness: run any algorithm and measure its time and memory.

Evaluation scripts should go through `benchmark()` rather than writing their own
timing code, so every number in the results table is produced the same way.

The harness deliberately knows nothing about totem_lib: it takes any callable,
which keeps it unit-testable without loading an OCEL log.

Note on memory: `tracemalloc` only sees Python-level allocations. Polars and
DuckDB do most of their work in native memory, so `peak_mb` understates the real
working set for those paths. Swapping the probe in `measure_once()` is the only
change needed if we move to RSS sampling later.
"""

from __future__ import annotations

import time
import tracemalloc
from dataclasses import dataclass
from statistics import mean
from typing import Any, Callable, Sequence

DEFAULT_REPEATS = 3


@dataclass(frozen=True)
class Measurement:
    """Time and peak memory of a single call."""

    elapsed_s: float
    peak_mb: float


@dataclass(frozen=True)
class BenchmarkResult:
    """
    Outcome of benchmarking one algorithm: either aggregated numbers, or the
    error that stopped it. A failed result carries no timings.
    """

    name: str
    repeats: int
    elapsed_s: float | None = None
    peak_mb: float | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None

    @classmethod
    def failed(cls, name: str, repeats: int, exc: BaseException) -> "BenchmarkResult":
        return cls(name=name, repeats=repeats, error=f"{type(exc).__name__}: {exc}")

    @classmethod
    def from_measurements(
        cls, name: str, measurements: Sequence[Measurement]
    ) -> "BenchmarkResult":
        """
        Aggregate repeated runs: mean elapsed time, worst-case peak memory.

        Peak memory is a max rather than a mean — the interesting figure is the
        high-water mark the algorithm actually reached, not a typical run.
        """
        if not measurements:
            raise ValueError(f"{name}: no measurements to aggregate")
        return cls(
            name=name,
            repeats=len(measurements),
            elapsed_s=round(mean(m.elapsed_s for m in measurements), 3),
            peak_mb=round(max(m.peak_mb for m in measurements), 2),
        )


def measure_once(func: Callable[..., Any], *args: Any, **kwargs: Any) -> tuple[Any, Measurement]:
    """
    Call `func(*args, **kwargs)` once and measure it.

    Returns the function's own return value alongside its Measurement, so a
    caller can feed the output into the next stage (e.g. import -> discovery)
    without paying for a second run.

    Exceptions are NOT caught here — `benchmark()` owns failure handling.
    Values are returned unrounded; rounding happens once, at aggregation.
    """
    tracemalloc.start()
    try:
        start = time.perf_counter()
        result = func(*args, **kwargs)
        elapsed_s = time.perf_counter() - start
        _, peak_bytes = tracemalloc.get_traced_memory()
    finally:
        # Stop even when func raises, so a failed run cannot leave the tracer
        # running and corrupt the next measurement.
        tracemalloc.stop()
    return result, Measurement(elapsed_s=elapsed_s, peak_mb=peak_bytes / 1024 / 1024)


def benchmark(
    name: str,
    func: Callable[..., Any],
    *args: Any,
    repeats: int = DEFAULT_REPEATS,
    **kwargs: Any,
) -> BenchmarkResult:
    """
    Run `func` `repeats` times and return its aggregated result.

    A failing algorithm is reported, not raised: it comes back as a
    BenchmarkResult with `ok == False` so one bad algorithm cannot stop a whole
    benchmark run.
    """
    if repeats < 1:
        raise ValueError(f"{name}: repeats must be at least 1, got {repeats}")

    measurements: list[Measurement] = []
    for _ in range(repeats):
        try:
            _, measurement = measure_once(func, *args, **kwargs)
        except Exception as exc:
            # Only Exception: KeyboardInterrupt/SystemExit must still abort the run.
            return BenchmarkResult.failed(name, repeats, exc)
        measurements.append(measurement)

    return BenchmarkResult.from_measurements(name, measurements)
