"""
Benchmark runs as folders on disk: one per run, saved as it goes, resumable.

A full evaluation can take hours, and a crash, a reboot or Ctrl+C used to lose every
measurement that had not been printed. Now each run gets its own timestamped folder,
and every measurement is appended to it the moment it finishes:

    evaluation/results/runs/2026-11-20_14-03-12/
        run.json              settings, the planned logs and algorithms, and the
                              machine(s) and commit(s) the run was measured on
        measurements.jsonl    one line per finished measurement, appended and flushed
                              immediately - the source of truth
        running.json          the pair being measured right now (only while running)
        benchmark_results.*   CSV / JSON / Markdown, rebuilt from measurements.jsonl
        artifacts/<log>/      what each measurement produced (model, fitness, ...),
                              one JSON file per measurement - see outcomes.py
        figures/<chapter>/    the plots per dissertation chapter, rebuilt from
                              measurements.jsonl and the artifacts

Resuming (`run_benchmarks.py --resume <folder>`) reads measurements.jsonl and skips every
(log, algorithm) pair already in it, so an interrupted run picks up where it stopped.
`--retry-failed` measures failed pairs again; the newest line for a pair wins.

A run keeps one set of settings (repeats, warm-up, timeout, isolation) so all its
numbers are comparable. A resumed run that comes from a different machine or commit is
allowed but recorded: run.json lists every environment, and each line notes the commit
it was measured on.
"""

from __future__ import annotations

import json
import os
import socket
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import Iterable, Sequence

from evaluation.datasets import STATISTIC_FIELDS, LogStatistics
from evaluation.harness import BenchmarkResult

# TOTEM_EVAL_RUNS moves new runs elsewhere, e.g. out of a read-only container image.
DEFAULT_RUNS_DIR = (
    Path(os.environ["TOTEM_EVAL_RUNS"]).expanduser() if os.environ.get("TOTEM_EVAL_RUNS")
    else Path(__file__).resolve().parent / "results" / "runs"
)
RUN_FILE = "run.json"
MEASUREMENTS_FILE = "measurements.jsonl"
# Which pair is being measured right now, for status.py. Gone between measurements.
RUNNING_FILE = "running.json"
# One JSON file per measurement: the model or result it produced.
ARTIFACTS_DIR = "artifacts"

# Settings a resumed run must share with the original, or its numbers would not be
# comparable with the ones already measured.
FIXED_SETTINGS = ("repeats", "warmup", "timeout_s", "isolated")


# ---------------------------------------------------------------------------
# Rows
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

    @property
    def key(self) -> tuple[str, str]:
        return self.log, self.algorithm

    def as_dict(self) -> dict:
        """Flat mapping of everything in the row, for CSV or JSON export."""
        row = {"log": self.log, "algorithm": self.algorithm, **self.result.as_dict()}
        if self.statistics is not None:
            row.update(self.statistics.as_dict())
        return row

    @classmethod
    def from_dict(cls, values: dict) -> "BenchmarkRow":
        """Inverse of as_dict(), for rows read back from JSON."""
        statistics = None
        if values.get("num_events") is not None:
            statistics = LogStatistics(**{field: values[field] for field in STATISTIC_FIELDS})
        return cls(
            log=values["log"],
            algorithm=values["algorithm"],
            result=BenchmarkResult.from_dict(values["algorithm"], values),
            statistics=statistics,
        )


def latest_per_pair(rows: Iterable[BenchmarkRow]) -> list[BenchmarkRow]:
    """The newest row for each (log, algorithm), in the order pairs first appeared."""
    newest: dict[tuple[str, str], BenchmarkRow] = {}
    for row in rows:
        # Assigning to an existing key keeps its position, so a retried pair stays
        # where it was in the table.
        newest[row.key] = row
    return list(newest.values())


# ---------------------------------------------------------------------------
# Run folders
# ---------------------------------------------------------------------------

class SettingsMismatch(ValueError):
    """A resumed run was asked to use different settings than it started with."""


class RunDirectory:
    """One benchmark run on disk. Create with `create()`, reopen with `open()`."""

    def __init__(self, path: Path):
        self.path = Path(path)

    # --- files -------------------------------------------------------------

    @property
    def run_file(self) -> Path:
        return self.path / RUN_FILE

    @property
    def measurements_file(self) -> Path:
        return self.path / MEASUREMENTS_FILE

    @property
    def figures_dir(self) -> Path:
        return self.path / "figures"

    @property
    def artifacts_dir(self) -> Path:
        """The models and results each measurement produced, one JSON file each."""
        return self.path / ARTIFACTS_DIR

    # --- creating and opening ---------------------------------------------

    @classmethod
    def create(
        cls,
        base: Path | str = DEFAULT_RUNS_DIR,
        *,
        settings: dict,
        environment: dict | None,
        logs: Sequence[str],
        algorithms: Sequence[str],
        name: str | None = None,
        now: datetime | None = None,
        folder: Path | str | None = None,
    ) -> "RunDirectory":
        """
        Start a new run in a fresh folder named after the current time.

        With `folder`, the run goes exactly there instead (a batch job that has to find
        its run again after a restart). That folder must not already hold a run.
        """
        if folder is not None:
            folder = Path(folder)
            if (folder / RUN_FILE).exists():
                raise FileExistsError(f"{folder} already holds a run; resume it instead")
            folder.mkdir(parents=True, exist_ok=True)
        else:
            stamp = (now or datetime.now()).strftime("%Y-%m-%d_%H-%M-%S")
            folder = Path(base) / (f"{stamp}_{name}" if name else stamp)
            # Two runs started in the same second must not share a folder.
            suffix = 1
            while folder.exists():
                suffix += 1
                folder = folder.with_name(f"{folder.name.rsplit('~', 1)[0]}~{suffix}")
            folder.mkdir(parents=True)

        run = cls(folder)
        run._write_meta({
            "created_at": (now or datetime.now()).isoformat(timespec="seconds"),
            "settings": settings,
            "logs": list(logs),
            "algorithms": list(algorithms),
            "environments": [environment] if environment else [],
        })
        run.measurements_file.touch()
        return run

    @classmethod
    def open(cls, path: Path | str) -> "RunDirectory":
        run = cls(Path(path))
        if not run.run_file.exists():
            raise FileNotFoundError(f"{path} is not a benchmark run (no {RUN_FILE})")
        return run

    # --- metadata ----------------------------------------------------------

    def meta(self) -> dict:
        return json.loads(self.run_file.read_text(encoding="utf-8"))

    def _write_meta(self, meta: dict) -> None:
        # Write-then-rename, so a crash mid-write cannot leave a truncated run.json.
        tmp = self.run_file.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, self.run_file)

    @property
    def settings(self) -> dict:
        return self.meta()["settings"]

    def check_settings(self, requested: dict) -> None:
        """Refuse to resume with settings that would make the numbers incomparable."""
        stored = self.settings
        different = [
            f"{key}: run has {stored.get(key)!r}, asked for {requested[key]!r}"
            for key in FIXED_SETTINGS
            if key in requested and requested[key] != stored.get(key)
        ]
        if different:
            raise SettingsMismatch(
                "a resumed run keeps its original settings - " + "; ".join(different)
            )

    def extend_plan(self, logs: Sequence[str], algorithms: Sequence[str]) -> tuple[list[str], list[str]]:
        """Add logs and algorithms to the plan, keeping order. Returns the full plan."""
        meta = self.meta()
        meta["logs"] = list(dict.fromkeys([*meta["logs"], *logs]))
        meta["algorithms"] = list(dict.fromkeys([*meta["algorithms"], *algorithms]))
        self._write_meta(meta)
        return meta["logs"], meta["algorithms"]

    def record_environment(self, environment: dict | None) -> bool:
        """
        Note the machine and commit of a resumed session. Returns True if they differ
        from every environment the run has seen so far.
        """
        if not environment:
            return False
        meta = self.meta()
        known = meta.setdefault("environments", [])
        fingerprint = _fingerprint(environment)
        if any(_fingerprint(seen) == fingerprint for seen in known):
            return False
        is_new_machine = bool(known)
        known.append(environment)
        self._write_meta(meta)
        return is_new_machine

    @property
    def environment(self) -> dict | None:
        """The most recent environment, for the result summaries."""
        environments = self.meta().get("environments") or []
        return environments[-1] if environments else None

    # --- what is running now ----------------------------------------------

    @property
    def running_file(self) -> Path:
        return self.path / RUNNING_FILE

    def mark_running(self, log: str, algorithm: str, *, timeout_s: float | None = None) -> None:
        """Note the pair that is about to be measured, so status.py can show it."""
        values = {
            "log": log,
            "algorithm": algorithm,
            "started_at": datetime.now().isoformat(timespec="seconds"),
            "timeout_s": timeout_s,
            "host": socket.gethostname(),
            "pid": os.getpid(),
        }
        tmp = self.running_file.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(values) + "\n", encoding="utf-8")
        os.replace(tmp, self.running_file)

    def clear_running(self) -> None:
        self.running_file.unlink(missing_ok=True)

    def running(self) -> dict | None:
        """The pair being measured, or None. May be stale if the process was killed."""
        try:
            return json.loads(self.running_file.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return None

    def progress(self) -> dict:
        """How far the run is: planned, finished and failed pairs, and what is left."""
        from evaluation.algorithms import planned_pairs  # loads totem_lib, so only here

        meta = self.meta()
        planned = planned_pairs(meta["logs"], meta["algorithms"])
        rows = {row.key: row for row in self.rows()}
        failed = [key for key in planned if key in rows and not rows[key].ok]
        return {
            "planned": len(planned),
            "done": sum(1 for key in planned if key in rows and rows[key].ok),
            "failed": failed,
            "remaining": [key for key in planned if key not in rows],
            "last_recorded_at": max(
                (line.get("recorded_at") for line in self._raw_lines() if line.get("recorded_at")),
                default=None,
            ),
        }

    def _raw_lines(self) -> list[dict]:
        lines = []
        if self.measurements_file.exists():
            for line in self.measurements_file.read_text(encoding="utf-8").splitlines():
                try:
                    lines.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return lines

    # --- measurements ------------------------------------------------------

    def append(self, row: BenchmarkRow, *, commit: str | None = None) -> None:
        """
        Save one finished measurement, durably, before the next one starts.

        Flushed and fsynced: losing the last line to a power cut would cost the
        longest measurement of the night.
        """
        values = row.as_dict()
        values["recorded_at"] = datetime.now().isoformat(timespec="seconds")
        values["commit"] = commit
        with open(self.measurements_file, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(values) + "\n")
            handle.flush()
            os.fsync(handle.fileno())

    def all_rows(self) -> list[BenchmarkRow]:
        """Every saved line, in order. A torn last line (crash mid-write) is skipped."""
        rows = []
        if not self.measurements_file.exists():
            return rows
        for line in self.measurements_file.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                row = BenchmarkRow.from_dict(json.loads(line))
            except (json.JSONDecodeError, KeyError, TypeError):
                continue
            # Saved relative to the run folder; resolved here, so rows read from
            # several runs can still find their artifacts.
            if row.result.artifact and not Path(row.result.artifact).is_absolute():
                row = replace(row, result=replace(
                    row.result, artifact=str(self.path / row.result.artifact)))
            rows.append(row)
        return rows

    def rows(self) -> list[BenchmarkRow]:
        """The current result of every measured pair: its newest line."""
        return latest_per_pair(self.all_rows())

    def completed(self, *, retry_failed: bool = False) -> set[tuple[str, str]]:
        """Pairs a resumed run should skip."""
        return {row.key for row in self.rows() if row.ok or not retry_failed}


def _fingerprint(environment: dict) -> tuple:
    git = environment.get("git") or {}
    return (
        environment.get("cpu"),
        environment.get("cpu_count"),
        environment.get("ram_gb"),
        environment.get("os"),
        environment.get("python"),
        tuple(sorted((environment.get("packages") or {}).items())),
        git.get("commit"),
        git.get("dirty"),
    )


def find_runs(paths: Iterable[Path | str]) -> list[RunDirectory]:
    """
    The runs in these paths: a run folder itself, or any run folders beneath it.

    A cluster batch writes one run per log into a shared parent folder; pointing at
    the parent picks them all up, in name order.
    """
    found: dict[Path, RunDirectory] = {}
    for path in map(Path, paths):
        if (path / RUN_FILE).exists():
            candidates = [path / RUN_FILE]
        else:
            candidates = sorted(path.glob(f"**/{RUN_FILE}"))
        for run_file in candidates:
            found.setdefault(run_file.parent.resolve(), RunDirectory(run_file.parent))
    return list(found.values())


def combined_rows(runs: Iterable[RunDirectory]) -> list[BenchmarkRow]:
    """
    Every run's rows together. A pair measured in more than one run keeps the line
    from the run listed last (find_runs lists them in folder-name order).
    """
    lines = []
    for run in runs:
        lines.extend(run.all_rows())
    return latest_per_pair(lines)
