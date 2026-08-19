"""
Run every main totem_lib algorithm on every evaluation log and report time and memory.

This is the one command behind the runtime evaluation. Each result is printed as soon as
it is ready, so a long run stays readable and an interrupted one still leaves everything
measured so far. Use --logs and --algorithms to run a part of the grid and fill the rest
in later.

A failing algorithm is reported and the run carries on. Ctrl+C stops the whole run.

The algorithms differ hugely in cost. discover_occn is the slow one - about 20 seconds on
the smallest log, and it grows fast. Try a new algorithm on the smallest log with
--repeats 1 before running the whole grid.

Run from the totem_lib/ directory:
    python evaluation/run_benchmarks.py
    python evaluation/run_benchmarks.py --list
    python evaluation/run_benchmarks.py --logs ocel2-p2p --repeats 1
    python evaluation/run_benchmarks.py --algorithms OCDFG.from_ocel,totemDiscovery
"""

from __future__ import annotations

import argparse
import contextlib
import io
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

# Run either as a script or imported as `evaluation.run_benchmarks`.
_TOTEM_LIB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_TOTEM_LIB / "src"))
sys.path.insert(0, str(_TOTEM_LIB))

from evaluation.algorithms import (
    ALGORITHMS,
    Algorithm,
    LogContext,
    get_algorithm,
)
from evaluation.datasets import (
    EvaluationLog,
    LogStatistics,
    available_logs,
    get_log,
)
from evaluation.harness import DEFAULT_REPEATS, BenchmarkResult, benchmark


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class BenchmarkRow:
    """One algorithm measured on one log, with that log's size next to it."""

    log: str
    algorithm: str
    result: BenchmarkResult
    statistics: LogStatistics | None = None

    @property
    def ok(self) -> bool:
        return self.result.ok

    def as_dict(self) -> dict:
        """Flat mapping of everything in the row, for CSV or JSON export."""
        row = {
            "log": self.log,
            "algorithm": self.algorithm,
            "repeats": self.result.repeats,
            "elapsed_s": self.result.elapsed_s,
            "peak_mb": self.result.peak_mb,
            "error": self.result.error,
        }
        if self.statistics is not None:
            row.update(self.statistics.as_dict())
        return row


# ---------------------------------------------------------------------------
# Running
# ---------------------------------------------------------------------------

@contextlib.contextmanager
def silenced():
    """
    Hide everything an algorithm prints while it runs.

    Two layers are needed. Python prints and tqdm progress bars are caught by swapping
    sys.stdout and sys.stderr, but mlpaDiscovery solves an LP with PuLP, which runs a
    solver binary that writes straight to the operating system's output. Only swapping
    the file descriptors catches that too.

    Falls back to the Python-level swap alone where the descriptors cannot be taken,
    such as under some test runners.
    """
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        try:
            saved = os.dup(1), os.dup(2)
        except (OSError, ValueError):
            yield
            return
        try:
            with open(os.devnull, "w") as devnull:
                os.dup2(devnull.fileno(), 1)
                os.dup2(devnull.fileno(), 2)
                yield
        finally:
            os.dup2(saved[0], 1)
            os.dup2(saved[1], 2)
            os.close(saved[0])
            os.close(saved[1])


def measure(algorithm: Algorithm, context: LogContext, repeats: int) -> BenchmarkResult:
    """
    Benchmark one algorithm against one prepared log.

    Algorithm output is hidden - see silenced() - so it neither buries the results nor
    slows down what is being timed. Errors still come back in the result.

    Preparing the input can fail on its own - a log may have no DuckDB copy - and that
    is reported the same way a failing algorithm is, so the run continues either way.
    """
    with silenced():
        try:
            call = algorithm.make_call(context)
        except Exception as exc:
            return BenchmarkResult.failed(algorithm.name, repeats, exc)
        return benchmark(algorithm.name, call, repeats=repeats)


def run(
    logs: Sequence[EvaluationLog],
    algorithms: Sequence[Algorithm] = ALGORITHMS,
    repeats: int = DEFAULT_REPEATS,
    echo: bool = True,
) -> list[BenchmarkRow]:
    """
    Run every algorithm on every log.

    Rows are printed as they finish so partial progress is visible, and returned so the
    export and plotting steps can use them.
    """
    rows: list[BenchmarkRow] = []

    for log in logs:
        if echo:
            print(f"\n{log.name}  ({log.event_count or '?'} events)", flush=True)
        context = LogContext(log)
        try:
            for algorithm in algorithms:
                result = measure(algorithm, context, repeats)
                row = BenchmarkRow(log.name, algorithm.name, result, log.statistics)
                rows.append(row)
                if echo:
                    print("  " + format_row(row), flush=True)
        finally:
            context.close()

    return rows


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def format_row(row: BenchmarkRow) -> str:
    if row.ok:
        return (
            f"{row.algorithm:30}{row.result.elapsed_s:>9.3f}s "
            f"{row.result.peak_mb:>9.1f} MB  (x{row.result.repeats})"
        )
    return f"{row.algorithm:30}{'SKIPPED':>10}  {row.result.error}"


def print_summary(rows: Sequence[BenchmarkRow]) -> None:
    done = [row for row in rows if row.ok]
    failed = [row for row in rows if not row.ok]

    print(f"\n{len(done)} of {len(rows)} measurements succeeded.")
    if failed:
        print("\nNot measured:")
        for row in failed:
            print(f"  {row.log} / {row.algorithm}: {row.result.error}")

    # CCDFG gets its input prepared during setup, so its number is not comparable with
    # a full DFG discovery.
    if any(row.algorithm == "CCDFG.from_ocel" and row.ok for row in rows):
        print(
            "\nNote: CCDFG.from_ocel excludes the flattening step its input needs, "
            "so it is not comparable with OCDFG.from_ocel."
        )


def print_plan(logs: Sequence[EvaluationLog], algorithms: Sequence[Algorithm]) -> None:
    """Show what a run would cover, without running anything."""
    print("Logs:")
    for log in logs:
        duckdb = "yes" if log.has_duckdb else "NO"
        print(
            f"  {log.name:24}{log.event_count or '?':>9} events  "
            f"duckdb={duckdb}  leading_type={log.leading_object_type!r}"
        )
    print("\nAlgorithms:")
    for algorithm in algorithms:
        print(f"  {algorithm.name}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--logs", type=_csv, default=None,
                        help="comma-separated log names (default: every available log)")
    parser.add_argument("--algorithms", type=_csv, default=None,
                        help="comma-separated algorithm names (default: all)")
    parser.add_argument("--repeats", type=int, default=DEFAULT_REPEATS,
                        help=f"runs per algorithm (default: {DEFAULT_REPEATS})")
    parser.add_argument("--list", action="store_true",
                        help="show the logs and algorithms, then exit")
    args = parser.parse_args()

    try:
        logs = [get_log(name) for name in args.logs] if args.logs else available_logs()
        algorithms = (
            [get_algorithm(name) for name in args.algorithms]
            if args.algorithms
            else list(ALGORITHMS)
        )
    except ValueError as exc:
        raise SystemExit(str(exc))

    if args.list:
        print_plan(logs, algorithms)
        return

    if not logs:
        raise SystemExit(
            "No logs available. Small logs ship with the repo; larger ones need "
            "python evaluation/download_logs.py"
        )
    if args.repeats < 1:
        raise SystemExit(f"--repeats must be at least 1, got {args.repeats}")

    rows = run(logs, algorithms, args.repeats)
    print_summary(rows)


if __name__ == "__main__":
    main()
