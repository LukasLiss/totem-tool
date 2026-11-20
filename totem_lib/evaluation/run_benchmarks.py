"""
Run every main totem_lib algorithm on every evaluation log and report time and memory.

This is the one command behind the runtime evaluation. Each run gets its own folder,
evaluation/results/runs/<date>_<time>/, and every measurement is saved there the moment
it finishes (see evaluation/runs.py). An interrupted run loses nothing, and
--resume <folder> continues it, skipping what is already measured. The CSV, JSON,
Markdown and figures in the folder are rebuilt from all its measurements at the end of
each session. Use --logs and --algorithms to run a part of the grid.

A failing, crashing or timed-out algorithm is reported and the run carries on. Ctrl+C
stops the whole run, including the measurement in progress.

How the numbers are taken
-------------------------

By default every (log, algorithm) pair runs in a fresh Python process (see
evaluation/worker.py) that imports the log, runs --warmup untimed calls, then
--repeats timed ones. Each measurement therefore starts from a clean state, its peak
memory belongs to it alone, and a hung run is killed after --timeout seconds. The
input preparation (importing the log) happens in that process too but is never timed.
--in-process runs everything in this process instead: faster to start, but memory is
not reported and earlier algorithms can influence later ones.

The JSON results keep every timed repeat, plus the machine, library versions and git
commit the run used.

Costs vary enormously, and not with the number of events. Averages of three runs on an
idle machine, measured with an earlier version of the harness that traced memory during
the timed calls - which inflates Python-heavy algorithms such as discover_occn and
totemDiscovery more than the DuckDB ones. Treat them as orders of magnitude until the
next full run replaces them:

    algorithm       ocel2-p2p (14.7k)  order-management (21k)  container_logistics (35.4k)
    discover_occn            18.4 s              415.2 s                  36.6 s
    import_ocel_db            6.1 s                8.6 s                   4.4 s
    totemDiscovery            3.3 s                7.4 s                   6.5 s
    import_ocel               2.9 s                3.5 s                   3.5 s
    totemDiscovery_db        0.29 s               0.80 s                  0.40 s
    OCDFG.from_ocel          0.09 s               0.13 s                  0.10 s
    find_variants             1.6 s        out of memory            not measured

Both loaders are measured. A Polars algorithm costs import_ocel plus its own time, a
DuckDB one costs import_ocel_db plus its own. totemDiscovery_db beats totemDiscovery
clearly on its own, but loading into DuckDB is the slower of the two loaders, so the
whole job is much closer.

order-management is the smaller log of the last two, yet it is where the slow algorithms
blow up. It has the most event-to-object relations by far (147k, against 74k), which is
what they actually scale with. Start anything new on ocel2-p2p with --repeats 1
--warmup 0.

find_variants only runs when named in --algorithms: it exhausts memory on
order-management, and the swapping slows the whole machine down before the process is
killed.

Run from the totem_lib/ directory:
    python evaluation/run_benchmarks.py
    python evaluation/run_benchmarks.py --list
    python evaluation/run_benchmarks.py --logs ocel2-p2p --repeats 1 --warmup 0
    python evaluation/run_benchmarks.py --repeats 10 --timeout 7200
    python evaluation/run_benchmarks.py --algorithms OCDFG.from_ocel,totemDiscovery
    python evaluation/run_benchmarks.py --name laptop --logs age-of-empires
    python evaluation/run_benchmarks.py --resume evaluation/results/runs/2026-11-20_14-03-12
    python evaluation/run_benchmarks.py --resume <folder> --retry-failed
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import signal
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable, Iterable, Sequence

# Run either as a script or imported as `evaluation.run_benchmarks`.
_TOTEM_LIB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_TOTEM_LIB / "src"))
sys.path.insert(0, str(_TOTEM_LIB))

from evaluation.algorithms import (
    ALGORITHMS,
    DEFAULT_ALGORITHMS,
    Algorithm,
    LogContext,
    get_algorithm,
)
from evaluation.datasets import (
    EvaluationLog,
    available_logs,
    get_log,
)
from evaluation.environment import collect_environment, describe
from evaluation.export import FORMATS, export
from evaluation.figures import draw_all
from evaluation.harness import DEFAULT_REPEATS, DEFAULT_WARMUP, BenchmarkResult, benchmark
from evaluation.runs import (
    DEFAULT_RUNS_DIR,
    BenchmarkRow,
    RUN_FILE,
    RunDirectory,
    SettingsMismatch,
)

WORKER = Path(__file__).resolve().parent / "worker.py"

# Generous enough for discover_occn on order-management (about 7 minutes per call)
# with a warm-up and three repeats, short enough to stop a run that has hung.
DEFAULT_TIMEOUT_S = 3600


# ---------------------------------------------------------------------------
# Running in this process
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


def measure(algorithm: Algorithm, context: LogContext, repeats: int,
            warmup: int = 0) -> BenchmarkResult:
    """
    Benchmark one algorithm against one prepared log, in this process.

    Memory is not reported: this process has already done other work, so its
    high-water mark would not describe this algorithm.

    Preparing the input can fail on its own - a log may lack a leading object type -
    and that is reported the same way a failing algorithm is, so the run continues.
    """
    with silenced():
        try:
            call = algorithm.make_call(context)
        except Exception as exc:
            return BenchmarkResult.failed(algorithm.name, repeats, exc, warmup=warmup)
        return benchmark(algorithm.name, call, repeats=repeats, warmup=warmup, memory=False)


# ---------------------------------------------------------------------------
# Running in a process of its own
# ---------------------------------------------------------------------------

def _kill(process: subprocess.Popen) -> None:
    """Kill the worker and anything it started, such as a PuLP solver binary."""
    if process.poll() is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:  # pragma: no cover - Windows
            process.kill()
    except ProcessLookupError:
        pass
    process.wait()


def _last_line(path: Path) -> str:
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    return next((line.strip() for line in reversed(lines) if line.strip()), "")


def _crash_message(returncode: int, output: Path) -> str:
    if returncode < 0:
        try:
            name = signal.Signals(-returncode).name
        except ValueError:
            name = str(-returncode)
        message = f"WorkerCrashed: killed by {name}"
        if -returncode == signal.SIGKILL:
            message += " (often the system running out of memory)"
        return message
    detail = _last_line(output)
    return f"WorkerCrashed: exit code {returncode}" + (f": {detail}" if detail else "")


def measure_isolated(
    log: EvaluationLog,
    algorithm: Algorithm,
    repeats: int,
    warmup: int = 0,
    timeout_s: float | None = DEFAULT_TIMEOUT_S,
) -> BenchmarkResult:
    """
    Benchmark one algorithm on one log in a fresh Python process.

    The timeout covers the whole worker, including importing the log. A worker that
    times out, crashes or is killed comes back as a failed result.
    """
    with tempfile.TemporaryDirectory(prefix="totem-bench-") as scratch:
        result_file = Path(scratch) / "result.json"
        output_file = Path(scratch) / "output.log"
        command = [
            sys.executable, str(WORKER),
            "--log", log.name,
            "--algorithm", algorithm.name,
            "--repeats", str(repeats),
            "--warmup", str(warmup),
            "--result-file", str(result_file),
        ]
        with open(output_file, "wb") as output:
            # A session of its own, so a timeout can kill the whole process group and
            # Ctrl+C in the terminal reaches only this process, which then cleans up.
            process = subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.STDOUT,
                start_new_session=(os.name == "posix"),
            )
            try:
                process.wait(timeout=timeout_s)
            except subprocess.TimeoutExpired:
                _kill(process)
                return BenchmarkResult.failed(
                    algorithm.name, repeats, f"Timeout: no result after {timeout_s:g} s",
                    warmup=warmup,
                )
            except BaseException:
                _kill(process)
                raise

        if result_file.exists():
            values = json.loads(result_file.read_text(encoding="utf-8"))
            return BenchmarkResult.from_dict(algorithm.name, values)
        return BenchmarkResult.failed(
            algorithm.name, repeats, _crash_message(process.returncode, output_file),
            warmup=warmup,
        )


def _check_registered(logs: Sequence[EvaluationLog], algorithms: Sequence[Algorithm]) -> None:
    """A worker finds its log and algorithm by name, so both must be in the registries."""
    for log in logs:
        if get_log(log.name) != log:
            raise ValueError(f"log {log.name!r} differs from the registered one")
    for algorithm in algorithms:
        if get_algorithm(algorithm.name) != algorithm:
            raise ValueError(f"algorithm {algorithm.name!r} differs from the registered one")


# ---------------------------------------------------------------------------
# The grid
# ---------------------------------------------------------------------------

def run(
    logs: Sequence[EvaluationLog],
    algorithms: Sequence[Algorithm] = DEFAULT_ALGORITHMS,
    repeats: int = DEFAULT_REPEATS,
    echo: bool = True,
    *,
    warmup: int = DEFAULT_WARMUP,
    timeout_s: float | None = DEFAULT_TIMEOUT_S,
    isolated: bool = True,
    skip: Iterable[tuple[str, str]] = (),
    on_row: Callable[[BenchmarkRow], None] | None = None,
    on_start: Callable[[str, str], None] | None = None,
) -> list[BenchmarkRow]:
    """
    Run every algorithm on every log.

    With `isolated` (the default) each pair runs in its own process - see
    measure_isolated(). Logs and algorithms must then come from the registries in
    datasets.py and algorithms.py. Without it everything runs here, and `timeout_s`
    does not apply.

    `skip` lists (log, algorithm) pairs that are already measured, for resuming.
    `on_row` is called with each row the moment it is ready, before the next
    measurement starts - that is where a run saves it to disk. `on_start` is called
    with (log, algorithm) just before a measurement begins, for live status.

    Rows are printed as they finish so partial progress is visible, and returned so the
    export and plotting steps can use them.
    """
    if isolated:
        _check_registered(logs, algorithms)
    skip = set(skip)

    rows: list[BenchmarkRow] = []
    for log in logs:
        todo = [a for a in algorithms if (log.name, a.name) not in skip]
        if echo:
            done = len(algorithms) - len(todo)
            already = f", {done} already measured" if done else ""
            print(f"\n{log.name}  ({log.event_count or '?'} events{already})", flush=True)
        if not todo:
            continue
        context = None if isolated else LogContext(log)
        try:
            for algorithm in todo:
                if on_start is not None:
                    on_start(log.name, algorithm.name)
                if isolated:
                    result = measure_isolated(log, algorithm, repeats, warmup, timeout_s)
                else:
                    result = measure(algorithm, context, repeats, warmup)
                row = BenchmarkRow(log.name, algorithm.name, result, log.statistics)
                rows.append(row)
                if on_row is not None:
                    on_row(row)
                if echo:
                    print("  " + format_row(row), flush=True)
        finally:
            if context is not None:
                context.close()

    return rows


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def format_row(row: BenchmarkRow) -> str:
    if not row.ok:
        return f"{row.algorithm:30}{'SKIPPED':>10}  {row.result.error}"
    result = row.result
    spread = f" ± {result.std_s:.3f}" if result.std_s is not None else ""
    memory = (
        f"peak {result.peak_rss_mb:>6.0f} MB (+{result.added_rss_mb:.0f} over input)"
        if result.added_rss_mb is not None else ""
    )
    return (
        f"{row.algorithm:30}{result.elapsed_s:>9.3f}s{spread:<10} "
        f"(min {result.min_s:.3f}s, x{result.repeats}) {memory}"
    )


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
        print(
            f"  {log.name:24}{log.event_count or '?':>9} events  "
            f"leading_type={log.leading_object_type!r}"
        )
    print("\nAlgorithms:")
    for algorithm in algorithms:
        print(f"  {algorithm.name}")
    skipped = [a.name for a in ALGORITHMS if a not in algorithms]
    if skipped:
        print(f"\nNot in this run (name them in --algorithms): {', '.join(skipped)}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _resolve(names: Iterable[str], lookup) -> list:
    try:
        return [lookup(name) for name in names]
    except ValueError as exc:
        raise SystemExit(str(exc))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--logs", type=_csv, default=None,
                        help="comma-separated log names (default: every available log)")
    parser.add_argument("--algorithms", type=_csv, default=None,
                        help="comma-separated algorithm names (default: all but find_variants)")
    # None means "not given", so a resumed run can tell a deliberate change apart.
    parser.add_argument("--repeats", type=int, default=None,
                        help=f"timed runs per algorithm (default: {DEFAULT_REPEATS})")
    parser.add_argument("--warmup", type=int, default=None,
                        help=f"untimed runs before the timed ones (default: {DEFAULT_WARMUP})")
    parser.add_argument("--timeout", type=float, default=None,
                        help="seconds before one log/algorithm measurement is killed, "
                             f"0 for none (default: {DEFAULT_TIMEOUT_S})")
    parser.add_argument("--in-process", action="store_true", default=None,
                        help="run everything in this process: no isolation, no memory "
                             "figures, no timeout")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_RUNS_DIR,
                        help=f"where new run folders go (default: {DEFAULT_RUNS_DIR})")
    parser.add_argument("--name", default=None,
                        help="suffix for the run folder, e.g. 'laptop-baseline'")
    parser.add_argument("--resume", type=Path, default=None, metavar="RUN_DIR",
                        help="continue an earlier run: skip what it already measured. "
                             "--logs/--algorithms add to its plan")
    parser.add_argument("--run-dir", type=Path, default=None,
                        help="use exactly this folder: start a run there, or resume the one "
                             "already in it. For batch jobs that get restarted")
    parser.add_argument("--retry-failed", action="store_true",
                        help="with --resume, measure failed pairs again")
    parser.add_argument("--formats", type=_csv, default=list(FORMATS),
                        help=f"result formats to write (default: {','.join(FORMATS)})")
    parser.add_argument("--no-figures", action="store_true", help="skip plotting")
    parser.add_argument("--list", action="store_true",
                        help="show the logs and algorithms, then exit")
    args = parser.parse_args()

    if args.run_dir is not None:
        if args.resume is not None:
            raise SystemExit("give --run-dir or --resume, not both")
        if (args.run_dir / RUN_FILE).exists():
            args.resume = args.run_dir
    if args.retry_failed and args.resume is None and args.run_dir is None:
        raise SystemExit("--retry-failed only makes sense with --resume or --run-dir")

    # --- what to run -------------------------------------------------------
    run_dir = RunDirectory.open(args.resume) if args.resume else None
    if run_dir is not None:
        stored = run_dir.settings
        settings = {
            "repeats": stored["repeats"] if args.repeats is None else args.repeats,
            "warmup": stored["warmup"] if args.warmup is None else args.warmup,
            "isolated": stored["isolated"] if args.in_process is None else not args.in_process,
        }
        if args.timeout is None:
            settings["timeout_s"] = stored["timeout_s"]
        else:
            settings["timeout_s"] = (args.timeout or None) if settings["isolated"] else None
        try:
            run_dir.check_settings(settings)
        except SettingsMismatch as exc:
            raise SystemExit(str(exc))
        log_names, algorithm_names = run_dir.extend_plan(args.logs or [], args.algorithms or [])
    else:
        isolated = not args.in_process
        timeout = DEFAULT_TIMEOUT_S if args.timeout is None else args.timeout
        settings = {
            "repeats": DEFAULT_REPEATS if args.repeats is None else args.repeats,
            "warmup": DEFAULT_WARMUP if args.warmup is None else args.warmup,
            "timeout_s": (timeout or None) if isolated else None,
            "isolated": isolated,
        }
        log_names = args.logs or [log.name for log in available_logs()]
        algorithm_names = args.algorithms or [a.name for a in DEFAULT_ALGORITHMS]

    logs = _resolve(log_names, get_log)
    algorithms = _resolve(algorithm_names, get_algorithm)

    if args.list:
        print_plan(logs, algorithms)
        return

    missing = [log.name for log in logs if not log.available]
    if missing:
        raise SystemExit(
            f"Not on disk: {', '.join(missing)}. Fetch with: "
            f"python evaluation/download_logs.py --logs {','.join(missing)}"
        )
    if not logs:
        raise SystemExit(
            "No logs available. Small logs ship with the repo; larger ones need "
            "python evaluation/download_logs.py"
        )
    if settings["repeats"] < 1:
        raise SystemExit(f"--repeats must be at least 1, got {settings['repeats']}")
    if settings["warmup"] < 0:
        raise SystemExit(f"--warmup cannot be negative, got {settings['warmup']}")
    if (settings["timeout_s"] or 0) < 0:
        raise SystemExit(f"--timeout cannot be negative, got {settings['timeout_s']}")
    unknown = [name for name in args.formats if name not in FORMATS]
    if unknown:
        raise SystemExit(f"unknown format(s): {', '.join(unknown)}; available: {', '.join(FORMATS)}")

    # --- the run folder ----------------------------------------------------
    environment = collect_environment()
    if run_dir is None:
        run_dir = RunDirectory.create(
            args.out_dir, settings=settings, environment=environment,
            logs=log_names, algorithms=algorithm_names, name=args.name,
            folder=args.run_dir,
        )
        skip: set = set()
        print(f"Run folder: {run_dir.path}")
    else:
        if run_dir.record_environment(environment):
            print("Note: this session runs on a different machine or commit than the "
                  "earlier part of the run. run.json records both.")
        skip = run_dir.completed(retry_failed=args.retry_failed)
        print(f"Resuming {run_dir.path}: {len(skip)} measurement(s) already done")
    print(f"Machine: {describe(environment)}")
    print(f"Settings: {settings}")

    commit = (environment.get("git") or {}).get("commit")
    interrupted = False
    try:
        run(logs, algorithms, settings["repeats"], warmup=settings["warmup"],
            timeout_s=settings["timeout_s"], isolated=settings["isolated"],
            skip=skip, on_row=lambda row: run_dir.append(row, commit=commit),
            on_start=lambda log, algorithm: run_dir.mark_running(
                log, algorithm, timeout_s=settings["timeout_s"]))
    except KeyboardInterrupt:
        interrupted = True
        print("\nInterrupted. Everything measured so far is saved.")
    finally:
        run_dir.clear_running()

    # --- summaries, rebuilt from everything the run folder holds -----------
    rows = run_dir.rows()
    print_summary(rows)
    written = export(rows, run_dir.path, args.formats, repeats=settings["repeats"],
                     settings=settings, environment=run_dir.environment)
    if not args.no_figures and rows:
        try:
            written += draw_all(rows, run_dir.figures_dir, run_dir.path)
        except Exception as exc:
            # The measurements are safe on disk; a plotting bug must not hide that.
            print(f"\nDrawing the figures failed ({type(exc).__name__}: {exc}). "
                  f"Redraw with: python evaluation/figures.py {run_dir.path}")
    print("\nSaved:")
    for path in [run_dir.measurements_file, *written]:
        print(f"  {path}")

    if interrupted:
        print(f"\nContinue with: python evaluation/run_benchmarks.py --resume {run_dir.path}")
        raise SystemExit(130)


if __name__ == "__main__":
    main()
