"""
Timer context manager used to report wall-clock time in seconds.
"""

import time


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
