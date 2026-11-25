"""
Shared benchmark harness: run any algorithm and measure its time and memory.

Evaluation scripts should go through `benchmark()` rather than writing their own
timing code, so every number in the results table is produced the same way.

The harness deliberately knows nothing about totem_lib: it takes any callable,
which keeps it unit-testable without loading an OCEL log.

How the numbers are taken
-------------------------

Time: `time.perf_counter()` around the bare call, and nothing else. Earlier versions
ran every timed call under `tracemalloc`, which slows Python-heavy code (the OCCN
miner, the Polars TOTeM miner) far more than code that works in Polars or DuckDB
natively, so the reported times were inflated by different amounts per algorithm.
Memory is now measured without touching the timed calls at all.

Optional warm-up calls run first and are left out of the statistics. They absorb
one-off costs such as lazy imports, thread pool start-up and first-touch page faults.

Every timed repeat is kept (`times_s`), along with the mean, standard deviation,
minimum, median and the half-width of a 95% confidence interval for the mean
(Student's t). Nothing is rounded here; rounding is for display only.

Memory: the process's peak resident set size (`ru_maxrss`), the operating system's
high-water mark. Unlike `tracemalloc` it includes native memory used by Polars and
DuckDB, and reading it costs nothing, so the timed calls are not affected. It is read
twice:

- `input_rss_mb`: before the first call, i.e. the peak reached by the interpreter,
  the libraries and preparing the input (importing the log, including the
  importer's transient peak).
- `peak_rss_mb`: after the last call: the peak of the whole job, input plus
  algorithm. This is the memory a machine needs to run the step.
- `added_rss_mb` (derived): how far the algorithm raised that peak. It is 0 when
  the algorithm fits inside memory the import already needed.

Measuring the algorithm alone is not possible from outside the allocator: freed
memory stays resident (Python's and the system allocator keep it for reuse, macOS
even counts it in the phys_footprint), so an algorithm that reuses the import's
freed memory never shows up in any process-level figure. The job peak is what tool
papers usually report, and it is what a user experiences.

The figures are whole-process values, so they are only meaningful in a fresh
process that prepares one input and runs one algorithm - see evaluation/worker.py.
"""

from __future__ import annotations

import math
import sys
import time
from dataclasses import dataclass
from statistics import mean, median, stdev
from typing import Any, Callable, Sequence

try:  # Not available on Windows.
    import resource
except ImportError:  # pragma: no cover - platform dependent
    resource = None

DEFAULT_REPEATS = 3
DEFAULT_WARMUP = 1


@dataclass(frozen=True)
class Measurement:
    """Wall-clock time of a single call."""

    elapsed_s: float


@dataclass(frozen=True)
class BenchmarkResult:
    """
    Outcome of benchmarking one algorithm: either the timings, or the error that
    stopped it. A failed result carries no timings.

    `elapsed_s` is the mean of the timed repeats, kept under that name because the
    plots and tables are built on it.
    """

    name: str
    repeats: int
    warmup: int = 0
    elapsed_s: float | None = None
    std_s: float | None = None
    min_s: float | None = None
    median_s: float | None = None
    ci95_s: float | None = None
    times_s: tuple[float, ...] = ()
    input_rss_mb: float | None = None
    peak_rss_mb: float | None = None
    error: str | None = None
    # What the algorithm produced, described after timing (see evaluation/outcomes.py):
    # the parameters it ran with, the model's size, fitness and precision, ... And
    # where the produced model itself was saved, relative to the run folder.
    properties: dict | None = None
    artifact: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None

    @property
    def added_rss_mb(self) -> float | None:
        """How far the algorithm raised the process's peak above the input's."""
        if self.input_rss_mb is None or self.peak_rss_mb is None:
            return None
        return max(self.peak_rss_mb - self.input_rss_mb, 0.0)

    @classmethod
    def failed(cls, name: str, repeats: int, exc: BaseException | str,
               warmup: int = 0) -> "BenchmarkResult":
        error = exc if isinstance(exc, str) else f"{type(exc).__name__}: {exc}"
        return cls(name=name, repeats=repeats, warmup=warmup, error=error)

    @classmethod
    def from_measurements(
        cls,
        name: str,
        measurements: Sequence[Measurement],
        *,
        warmup: int = 0,
        input_rss_mb: float | None = None,
        peak_rss_mb: float | None = None,
    ) -> "BenchmarkResult":
        """Summarise the timed repeats. Warm-up calls must not be passed in."""
        if not measurements:
            raise ValueError(f"{name}: no measurements to aggregate")
        times = tuple(m.elapsed_s for m in measurements)
        spread = stdev(times) if len(times) > 1 else None
        return cls(
            name=name,
            repeats=len(times),
            warmup=warmup,
            elapsed_s=mean(times),
            std_s=spread,
            min_s=min(times),
            median_s=median(times),
            ci95_s=confidence_half_width(times),
            times_s=times,
            input_rss_mb=input_rss_mb,
            peak_rss_mb=peak_rss_mb,
        )

    def as_dict(self) -> dict:
        """Everything in the result, JSON-ready."""
        return {
            "repeats": self.repeats,
            "warmup": self.warmup,
            "elapsed_s": self.elapsed_s,
            "std_s": self.std_s,
            "min_s": self.min_s,
            "median_s": self.median_s,
            "ci95_s": self.ci95_s,
            "times_s": list(self.times_s),
            "input_rss_mb": self.input_rss_mb,
            "peak_rss_mb": self.peak_rss_mb,
            "error": self.error,
            "properties": self.properties,
            "artifact": self.artifact,
        }

    @classmethod
    def from_dict(cls, name: str, values: dict) -> "BenchmarkResult":
        """Inverse of as_dict(), for results that crossed a process boundary."""
        fields = dict(values)
        fields["times_s"] = tuple(fields.get("times_s") or ())
        known = cls.__dataclass_fields__
        return cls(name=name, **{k: v for k, v in fields.items() if k in known})


# ---------------------------------------------------------------------------
# Statistics
# ---------------------------------------------------------------------------

# Two-sided 97.5% quantiles of Student's t for 1..30 degrees of freedom. Kept inline
# so the harness has no dependency beyond the standard library.
_T_975 = (
    12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
    2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
    2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042,
)


def confidence_half_width(times: Sequence[float]) -> float | None:
    """
    Half-width of the 95% confidence interval for the mean, or None below two samples.

    The interval is mean +- this value. Above 30 degrees of freedom the normal
    quantile 1.96 is used.
    """
    n = len(times)
    if n < 2:
        return None
    t = _T_975[n - 2] if n - 1 <= len(_T_975) else 1.96
    return t * stdev(times) / math.sqrt(n)


# ---------------------------------------------------------------------------
# Memory
# ---------------------------------------------------------------------------

def peak_rss_mb() -> float | None:
    """
    The process's resident-set high-water mark so far, in MB, or None if unknown.

    `ru_maxrss` is in bytes on macOS and in kilobytes on Linux.
    """
    if resource is None:
        return None
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    divisor = 1024 * 1024 if sys.platform == "darwin" else 1024
    return peak / divisor


# ---------------------------------------------------------------------------
# Measuring
# ---------------------------------------------------------------------------

def measure_once(func: Callable[..., Any], *args: Any, **kwargs: Any) -> tuple[Any, Measurement]:
    """
    Call `func(*args, **kwargs)` once and time it.

    Returns the function's own return value alongside its Measurement, so a
    caller can feed the output into the next stage without a second run.

    Exceptions are NOT caught here - `benchmark()` owns failure handling.
    """
    start = time.perf_counter()
    result = func(*args, **kwargs)
    elapsed_s = time.perf_counter() - start
    return result, Measurement(elapsed_s=elapsed_s)


def benchmark(
    name: str,
    func: Callable[..., Any],
    *args: Any,
    repeats: int = DEFAULT_REPEATS,
    warmup: int = 0,
    memory: bool = False,
    keep_output: Callable[[Any], None] | None = None,
    **kwargs: Any,
) -> BenchmarkResult:
    """
    Run `func` `warmup` times untimed, then `repeats` times timed.

    `keep_output` receives what the last timed call returned, after all timing is
    done, so the result can be described and saved without running it again.

    `memory=True` records the peak memory before and after, see the module
    docstring. Only ask for it in a fresh process, since the high-water mark would
    otherwise describe earlier work too.

    A failing algorithm is reported, not raised: it comes back as a
    BenchmarkResult with `ok == False` so one bad algorithm cannot stop a whole
    benchmark run.
    """
    if repeats < 1:
        raise ValueError(f"{name}: repeats must be at least 1, got {repeats}")
    if warmup < 0:
        raise ValueError(f"{name}: warmup cannot be negative, got {warmup}")

    before = peak_rss_mb() if memory else None
    measurements: list[Measurement] = []
    try:
        for _ in range(warmup):
            func(*args, **kwargs)
        for repeat in range(repeats):
            # Keep only the Measurement, except from the last call. Binding every
            # output to a name would hold the previous run's result in memory while
            # the next call allocates.
            output, measurement = measure_once(func, *args, **kwargs)
            measurements.append(measurement)
            if repeat < repeats - 1:
                del output
    except Exception as exc:
        # Only Exception: KeyboardInterrupt/SystemExit must still abort the run.
        return BenchmarkResult.failed(name, repeats, exc, warmup=warmup)
    # Read before keep_output runs: describing and saving the output must not count
    # towards the algorithm's memory.
    after = peak_rss_mb() if memory else None
    if keep_output is not None:
        keep_output(output)
    del output
    return BenchmarkResult.from_measurements(
        name, measurements, warmup=warmup, input_rss_mb=before, peak_rss_mb=after,
    )
