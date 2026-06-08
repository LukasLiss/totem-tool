"""
Timer context manager and a measure_runtime decorator-style
wrapper around an arbitrary callable. Used to report wall-clock time in seconds.
"""

import time
from collections.abc import Callable
from typing import Any


class Timer:
    """
    Context manager that measures wall-clock runtime.
    """

    def __init__(self) -> None:
        self.elapsed_s: float = 0.0
        self._start: float | None = None

    def __enter__(self) -> "Timer":
        self._start = time.perf_counter()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._start is not None:
            self.elapsed_s = time.perf_counter() - self._start


def measure_runtime(fn: Callable[..., Any], *args, **kwargs) -> tuple[Any, float]:
    """
    Returns the result of the function call and the measured runtime in seconds.
    """
    with Timer() as t:
        result = fn(*args, **kwargs)
    return result, t.elapsed_s
