"""
How far a benchmark run has got, while it runs.

    python evaluation/status.py <run folder or parent folder> [--watch 30]

Reads only what the run writes to disk (run.json, measurements.jsonl, running.json),
so it works from another terminal, a login node while the job runs on a compute node,
or after the job has died. Pointing it at a parent folder shows every run beneath it,
which is how a cluster batch with one run per log is followed.

For each run it shows finished / planned measurements, failures, and the pair being
measured right now with how long it has been going against its timeout. A pair that
has been "running" for much longer than its timeout belongs to a job that was killed;
it is flagged as stale.
"""

from __future__ import annotations

import argparse
import os
import socket
import sys
import time
from datetime import datetime
from pathlib import Path

_TOTEM_LIB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_TOTEM_LIB / "src"))
sys.path.insert(0, str(_TOTEM_LIB))

from evaluation.runs import RunDirectory, find_runs  # noqa: E402

# A worker gets the timeout plus this much for starting up and reporting back before a
# "running" marker is treated as left behind by a killed job.
STALE_GRACE_S = 300


def _duration(seconds: float) -> str:
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds}s"
    minutes, seconds = divmod(seconds, 60)
    if minutes < 60:
        return f"{minutes}m{seconds:02d}s"
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h{minutes:02d}m"


def _alive(running: dict) -> bool | None:
    """Whether the process that wrote the marker still exists; None if we cannot tell."""
    if running.get("host") != socket.gethostname() or not running.get("pid"):
        return None
    try:
        os.kill(running["pid"], 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def describe_running(running: dict | None, now: datetime | None = None) -> str:
    """One line about the pair being measured, or '' when nothing is."""
    if not running:
        return ""
    now = now or datetime.now()
    elapsed = (now - datetime.fromisoformat(running["started_at"])).total_seconds()
    timeout = running.get("timeout_s")
    limit = f" of {_duration(timeout)} timeout" if timeout else ""
    stale = _alive(running) is False or (timeout and elapsed > timeout + STALE_GRACE_S)
    flag = "  STALE (job gone? resume it)" if stale else ""
    return (f"running {running['log']} / {running['algorithm']} for "
            f"{_duration(elapsed)}{limit} on {running.get('host', '?')}{flag}")


def report(runs: list[RunDirectory], now: datetime | None = None) -> str:
    if not runs:
        return "No benchmark runs found there."
    lines = []
    total_planned = total_done = total_failed = 0
    width = max(len(run.path.name) for run in runs)
    for run in runs:
        progress = run.progress()
        total_planned += progress["planned"]
        total_done += progress["done"]
        total_failed += len(progress["failed"])
        finished = progress["done"] + len(progress["failed"])
        share = f"{100 * finished / progress['planned']:.0f}%" if progress["planned"] else "-"
        failed = f", {len(progress['failed'])} failed" if progress["failed"] else ""
        lines.append(f"{run.path.name:<{width}}  {finished:>3}/{progress['planned']:<3} {share:>4}{failed}")
        running = describe_running(run.running(), now)
        if running:
            lines.append(f"{'':<{width}}  {running}")
        elif progress["remaining"]:
            last = progress["last_recorded_at"] or "never"
            lines.append(f"{'':<{width}}  idle, {len(progress['remaining'])} left "
                         f"(last result {last}) - not running or between logs")
        for log, algorithm in progress["failed"]:
            error = next(r.result.error for r in run.rows() if r.key == (log, algorithm))
            lines.append(f"{'':<{width}}  failed: {log} / {algorithm}: {error}")
    if len(runs) > 1:
        finished = total_done + total_failed
        lines.append(f"\nAll runs: {finished}/{total_planned} measured, {total_failed} failed")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="+", type=Path,
                        help="run folders, or folders holding several runs")
    parser.add_argument("--watch", type=float, default=None, metavar="SECONDS",
                        help="refresh every SECONDS until Ctrl+C")
    args = parser.parse_args()

    while True:
        text = report(find_runs(args.paths))
        if args.watch is None:
            print(text)
            return
        print("\033[2J\033[H" + datetime.now().strftime("%H:%M:%S") + "\n" + text, flush=True)
        try:
            time.sleep(args.watch)
        except KeyboardInterrupt:
            return


if __name__ == "__main__":
    main()
