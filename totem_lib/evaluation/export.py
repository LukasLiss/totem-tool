"""
Write benchmark results to disk as CSV, JSON and a Markdown summary.

The runner prints results while it works, but they are gone once the terminal closes.
This module saves them: CSV and JSON for the plots and for any other tool, Markdown for
people to read in a pull request.

Each run overwrites the files. The runner already prints every row as it lands, so there
is no need to append, and a clean snapshot is easier to parse and to commit.

Used by evaluation/run_benchmarks.py, or directly:

    from evaluation.export import export
    export(rows, out_dir=Path("somewhere"))
"""

from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Sequence

from evaluation.datasets import SIZE_METRICS, STATISTIC_FIELDS
from evaluation.environment import describe

DEFAULT_OUT_DIR = Path(__file__).resolve().parent / "results"
BASE_NAME = "benchmark_results"
FORMATS = ("csv", "json", "md")

# Fixed column order. Rows for a log with no recorded statistics are shorter, so the
# columns must come from here and not from whichever row happens to be first.
CSV_FIELDS = (
    "log",
    "algorithm",
    "repeats",
    "warmup",
    "elapsed_s",
    "std_s",
    "min_s",
    "median_s",
    "ci95_s",
    "times_s",
    "input_rss_mb",
    "peak_rss_mb",
    "error",
    *STATISTIC_FIELDS,
    "duration_seconds",
)

# Shown instead of a number when an algorithm failed.
MISSING = "-"

MEMORY_NOTE = (
    "Time is the mean of the timed repeats; warm-up runs are excluded. "
    "\u00b1 is the half-width of the 95% confidence interval for that mean. "
    "Memory is the peak resident set size (RSS) of a process that ran just one "
    "algorithm on one log, so it includes native Polars/DuckDB memory. Input RSS is "
    "the peak before the algorithm ran (interpreter, libraries, importing the log), "
    "Peak RSS the peak of the whole job, and Added how far the algorithm raised it - "
    "0 when it fits in memory the import already needed. Only reported when each "
    "measurement runs in its own process."
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _count(value: Any) -> str:
    """Format a number with thousands separators, or a dash if it is missing."""
    if value is None:
        return MISSING
    return f"{value:,.2f}" if isinstance(value, float) else f"{value:,}"


def _cell(value: Any) -> str:
    """
    Make a value safe for a Markdown table cell.

    Error text is free-form, so it can contain a pipe, which would otherwise add
    columns and break the table.
    """
    if value is None:
        return MISSING
    return str(value).replace("|", "\\|").replace("\n", " ")


def _seconds(value: Any) -> str:
    """Three significant digits: enough to compare, short enough to read."""
    return MISSING if value is None else f"{value:.3g}"


def _megabytes(value: Any) -> str:
    return MISSING if value is None else f"{value:,.0f}"


def _logs_of(rows: Iterable) -> list[tuple[str, Any]]:
    """Each log that appears in the rows, in order, with its statistics."""
    logs: dict[str, Any] = {}
    for row in rows:
        if row.log not in logs:
            logs[row.log] = row.statistics
    return list(logs.items())


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------

def write_csv(rows: Sequence, path: Path) -> Path:
    """Write one line per measurement, with every column always present."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS, restval="")
        writer.writeheader()
        for row in rows:
            values = row.as_dict()
            # A cell holds one value, so the repeats go in as a ;-separated list.
            values["times_s"] = ";".join(repr(t) for t in values.get("times_s") or [])
            writer.writerow(values)
    return path


def write_json(
    rows: Sequence,
    path: Path,
    *,
    repeats: int | None = None,
    settings: dict | None = None,
    environment: dict | None = None,
) -> Path:
    """Write the results plus the settings, machine and code that produced them."""
    path.parent.mkdir(parents=True, exist_ok=True)
    document = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "repeats": repeats,
        "settings": settings,
        "environment": environment,
        "logs": [
            {"name": name, "statistics": stats.as_dict() if stats else None}
            for name, stats in _logs_of(rows)
        ],
        "results": [row.as_dict() for row in rows],
    }
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2)
        handle.write("\n")
    return path


def write_markdown(
    rows: Sequence,
    path: Path,
    *,
    repeats: int | None = None,
    settings: dict | None = None,
    environment: dict | None = None,
) -> Path:
    """
    Write a summary for people to read.

    Two tables: the logs and their sizes once each, then the measurements. Repeating
    every size metric on all result rows would make the table far too wide.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = ["# Benchmark Results", ""]

    when = datetime.now().strftime("%Y-%m-%d %H:%M")
    run_info = f"Generated {when}"
    if repeats is not None:
        run_info += f", {repeats} timed repeat(s) per algorithm"
    if settings:
        if settings.get("warmup") is not None:
            run_info += f", {settings['warmup']} warm-up run(s)"
        if settings.get("isolated") is not None:
            run_info += (", one process per measurement" if settings["isolated"]
                         else ", all in one process")
    lines += [run_info, ""]
    if environment:
        lines += [f"Machine: {describe(environment)}", ""]
    lines += [MEMORY_NOTE, ""]

    # --- logs ---
    labels = list(SIZE_METRICS.values())
    lines += [
        "## Logs",
        "",
        "| Log | " + " | ".join(labels) + " |",
        "|---" * (len(labels) + 1) + "|",
    ]
    for name, stats in _logs_of(rows):
        if stats is None:
            cells = [MISSING] * len(SIZE_METRICS)
        else:
            cells = [_count(getattr(stats, metric)) for metric in SIZE_METRICS]
        lines.append(f"| {_cell(name)} | " + " | ".join(cells) + " |")

    # --- results ---
    lines += [
        "",
        "## Results",
        "",
        "| Log | Events | Algorithm | Time (s) | \u00b1 95% CI | Std (s) | Min (s) "
        "| Input RSS (MB) | Peak RSS (MB) | Added RSS (MB) |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for row in rows:
        events = _count(row.statistics.num_events if row.statistics else None)
        result = row.result
        lines.append(
            f"| {_cell(row.log)} | {events} | {_cell(row.algorithm)} "
            f"| {_seconds(result.elapsed_s)} | {_seconds(result.ci95_s)} "
            f"| {_seconds(result.std_s)} | {_seconds(result.min_s)} "
            f"| {_megabytes(result.input_rss_mb)} | {_megabytes(result.peak_rss_mb)} "
            f"| {_megabytes(result.added_rss_mb)} |"
        )

    # --- failures ---
    failures = [row for row in rows if not row.ok]
    if failures:
        lines += ["", "## Failures", ""]
        for row in failures:
            lines.append(f"- `{_cell(row.log)}` / `{_cell(row.algorithm)}`: {_cell(row.result.error)}")

    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def export(
    rows: Sequence,
    out_dir: Path = DEFAULT_OUT_DIR,
    formats: Sequence[str] = FORMATS,
    *,
    repeats: int | None = None,
    settings: dict | None = None,
    environment: dict | None = None,
) -> list[Path]:
    """
    Write the results in each requested format and return the files written.

    Unknown format names raise, so a typo does not silently write nothing.
    """
    unknown = [name for name in formats if name not in FORMATS]
    if unknown:
        raise ValueError(
            f"unknown format(s): {', '.join(unknown)}; available: {', '.join(FORMATS)}"
        )

    out_dir = Path(out_dir)
    written: list[Path] = []
    if "csv" in formats:
        written.append(write_csv(rows, out_dir / f"{BASE_NAME}.csv"))
    if "json" in formats:
        written.append(write_json(rows, out_dir / f"{BASE_NAME}.json", repeats=repeats,
                                  settings=settings, environment=environment))
    if "md" in formats:
        written.append(write_markdown(rows, out_dir / f"{BASE_NAME}.md", repeats=repeats,
                                      settings=settings, environment=environment))
    return written
