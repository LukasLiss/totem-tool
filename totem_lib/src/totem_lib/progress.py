"""Progress reporting and cooperative cancellation for long-running algorithms.

Algorithms accept an optional ``progress`` argument: either a plain callback
``callback(fraction, message)`` or a :class:`Progress` instance. They report
``fraction`` in ``[0, 1]`` (or ``None`` while the amount of work is unknown)
together with a short human-readable ``message`` describing the phase.

Cancellation is cooperative: a callback that wants to stop the computation
simply raises. The exception propagates through the algorithm unchanged, so
callers can use their own exception type (the backend raises
``JobCancelled``). Algorithms report at every phase boundary and inside their
long Python loops, which bounds how long a cancellation takes to be noticed.
SQL statements running on DuckDB are stopped by the caller through
``connection.interrupt()``; algorithms do not need to do anything for that.
"""

from __future__ import annotations

from typing import Callable, Optional, Union

ProgressCallback = Callable[[Optional[float], str], None]


class Progress:
    """A reporter covering the range ``[lo, hi]`` of an overall task.

    ``report(fraction, message)`` maps ``fraction`` (``0..1`` within this
    reporter's own range) onto the overall range before forwarding it to the
    callback; :meth:`sub` derives a reporter for a sub-phase. Reporting on a
    reporter without a callback is free, so algorithms always call it.
    """

    __slots__ = ("_callback", "_lo", "_hi", "_message", "_fraction")

    def __init__(
        self,
        callback: Optional[ProgressCallback] = None,
        lo: float = 0.0,
        hi: float = 1.0,
        message: str = "",
    ):
        self._callback = callback
        self._lo = float(lo)
        self._hi = float(hi)
        self._message = message
        self._fraction: Optional[float] = None

    @property
    def enabled(self) -> bool:
        return self._callback is not None

    def report(self, fraction: Optional[float], message: Optional[str] = None) -> None:
        """Report progress; ``fraction`` may be ``None`` for "unknown"."""
        if message is not None:
            self._message = message
        self._fraction = fraction
        if self._callback is None:
            return
        if fraction is None:
            overall: Optional[float] = None
        else:
            fraction = max(0.0, min(1.0, float(fraction)))
            overall = self._lo + (self._hi - self._lo) * fraction
        self._callback(overall, self._message)

    __call__ = report

    def check(self) -> None:
        """Re-report the current state.

        Cheap enough for tight loops; gives a cancelling callback a chance to
        raise between iterations even when the fraction did not change.
        """
        self.report(self._fraction, None)

    def sub(self, lo: float, hi: float, message: Optional[str] = None) -> "Progress":
        """A reporter for the sub-phase spanning ``[lo, hi]`` of this one."""
        span = self._hi - self._lo
        return Progress(
            self._callback,
            self._lo + span * lo,
            self._lo + span * hi,
            self._message if message is None else message,
        )

    def steps(self, n: int, message: Optional[str] = None):
        """Iterate ``range(n)`` while reporting ``i / n`` before each step."""
        n = max(1, int(n))
        for i in range(n):
            self.report(i / n, message)
            yield i
        self.report(1.0, message)


def as_progress(progress: Union[Progress, ProgressCallback, None]) -> Progress:
    """Normalise a callback (or ``None``) into a :class:`Progress`."""
    if isinstance(progress, Progress):
        return progress
    return Progress(progress)


__all__ = ["Progress", "ProgressCallback", "as_progress"]
