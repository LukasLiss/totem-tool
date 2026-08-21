"""
Plot benchmark runtime against how big each log is.

One figure per size metric: runtime on the y-axis, the metric on the x-axis, one line
per algorithm. Figures are saved to totem_lib/figures/.

Why several metrics and not just the event count: discover_occn takes about 15 times
longer on order-management (21k events) than on container_logistics (35k events). Drawn
against the event count that line dips and then rises, which looks wrong. Drawn against
event-to-object relations (147k against 74k) it rises steadily. Different algorithms
scale with different things, so one x-axis is not enough.

The y-axis is logarithmic because runtimes here span five orders of magnitude, from
0.008 s to over 900 s. On a linear axis every fast algorithm sits flat on zero.

import_ocel is drawn as a grey dashed baseline rather than as one of the coloured
lines. It is the loading step all the other algorithms build on, and it is mostly file
parsing, so it is a different kind of measurement.

Colours are the validated categorical palette, assigned in a fixed order so an algorithm
keeps its colour even if a run covers only some of them. Three of the colours are light
against the background, so the figures should be read next to the results table in
evaluation/results/ - that table is what makes them safe to use.

The benchmark command writes the figures itself. To rebuild them from saved results
without running anything, from the totem_lib/ directory:

    from evaluation.plots import plot_all, rows_from_csv
    plot_all(rows_from_csv("evaluation/results/benchmark_results.csv"))
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Mapping, Sequence

import matplotlib

# Pick a backend that needs no display, so this works over SSH and in CI.
matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402  (must come after use())
from matplotlib import ticker  # noqa: E402

from evaluation.datasets import SIZE_METRICS, LogStatistics  # noqa: E402

FIGURES_DIR = Path(__file__).resolve().parent.parent / "figures"
FILE_PREFIX = "runtime_vs_"

# The algorithm drawn as a baseline instead of a coloured series.
BASELINE_ALGORITHM = "import_ocel"

# Validated categorical palette. Never reorder or cycle this: each algorithm takes the
# next free slot, so it keeps its colour across runs.
SERIES_COLORS = (
    "#2a78d6",  # blue
    "#eb6834",  # orange
    "#1baf7a",  # aqua
    "#eda100",  # yellow
    "#e87ba4",  # magenta
    "#008300",  # green
    "#4a3aa7",  # violet
    "#e34948",  # red
)
MARKERS = ("o", "s", "^", "D", "v", "P", "X", "*")

SURFACE = "#fcfcfb"
TEXT = "#0b0b0b"
BASELINE_COLOR = "#52514e"
GRID = "#c3c2b7"
TICKS = "#898781"


# ---------------------------------------------------------------------------
# Reading saved results
# ---------------------------------------------------------------------------

def _number(text, cast):
    """Turn a CSV cell into a number, or None if the cell is empty."""
    return cast(text) if text not in ("", None) else None


def rows_from_csv(path: Path | str) -> list:
    """
    Load rows back from a results CSV.

    Lets the figures be rebuilt from saved results without running any algorithm
    again. CSV gives back only strings, so the numbers are converted here.
    """
    from evaluation.harness import BenchmarkResult
    from evaluation.run_benchmarks import BenchmarkRow

    rows = []
    with open(path, newline="", encoding="utf-8") as handle:
        for record in csv.DictReader(handle):
            statistics = None
            if record.get("num_events"):
                statistics = LogStatistics(
                    num_events=int(record["num_events"]),
                    num_objects=int(record["num_objects"]),
                    num_unique_activities=int(record["num_unique_activities"]),
                    num_object_types=int(record["num_object_types"]),
                    num_e2o_relations=int(record["num_e2o_relations"]),
                    num_o2o_relations=int(record["num_o2o_relations"]),
                    earliest_timestamp=int(record["earliest_timestamp"]),
                    newest_timestamp=int(record["newest_timestamp"]),
                )
            result = BenchmarkResult(
                name=record["algorithm"],
                repeats=int(record["repeats"]) if record["repeats"] else 0,
                elapsed_s=_number(record["elapsed_s"], float),
                peak_mb=_number(record["peak_mb"], float),
                error=record["error"] or None,
            )
            rows.append(
                BenchmarkRow(
                    log=record["log"],
                    algorithm=record["algorithm"],
                    result=result,
                    statistics=statistics,
                )
            )
    return rows


# ---------------------------------------------------------------------------
# Shaping the data
# ---------------------------------------------------------------------------

def series_for(rows: Sequence, metric: str) -> dict[str, list[tuple[int, float]]]:
    """
    Group the rows into one (x, y) list per algorithm, sorted by x.

    Rows without a time or without statistics are dropped: a failed algorithm has no
    runtime to plot, and drawing it as zero would be a lie. Sorting matters because the
    logs are not in the same order for every metric.
    """
    series: dict[str, list[tuple[int, float]]] = {}
    for row in rows:
        if row.statistics is None or row.result.elapsed_s is None:
            continue
        point = (getattr(row.statistics, metric), row.result.elapsed_s)
        series.setdefault(row.algorithm, []).append(point)
    return {name: sorted(points) for name, points in series.items()}


def _style_for(index: int) -> tuple[str, str]:
    """Colour and marker for the n-th coloured algorithm."""
    return SERIES_COLORS[index % len(SERIES_COLORS)], MARKERS[index % len(MARKERS)]


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------

def plot_metric(rows: Sequence, metric: str, path: Path) -> Path:
    """Draw one figure: runtime against a single size metric."""
    if metric not in SIZE_METRICS:
        known = ", ".join(SIZE_METRICS)
        raise ValueError(f"unknown metric {metric!r}; available: {known}")

    series = series_for(rows, metric)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    figure, axes = plt.subplots(figsize=(9, 5.5), dpi=200)
    figure.patch.set_facecolor(SURFACE)
    axes.set_facecolor(SURFACE)

    # The baseline is drawn first so the coloured lines sit on top of it.
    baseline = series.pop(BASELINE_ALGORITHM, None)
    if baseline:
        axes.plot(
            [x for x, _ in baseline],
            [y for _, y in baseline],
            color=BASELINE_COLOR,
            linewidth=2,
            linestyle="--",
            marker="o",
            markersize=6,
            label=BASELINE_ALGORITHM + " (loading step)",
            zorder=2,
        )

    for index, name in enumerate(sorted(series)):
        color, marker = _style_for(index)
        points = series[name]
        axes.plot(
            [x for x, _ in points],
            [y for _, y in points],
            color=color,
            linewidth=2,
            marker=marker,
            markersize=7,
            label=name,
            zorder=3,
        )

    axes.set_yscale("log")
    axes.set_xlabel(SIZE_METRICS[metric], color=TEXT, fontsize=11)
    axes.set_ylabel("Runtime (seconds, log scale)", color=TEXT, fontsize=11)
    axes.set_title(
        "Algorithm runtime against " + SIZE_METRICS[metric].lower(),
        color=TEXT,
        fontsize=13,
        pad=14,
    )

    axes.grid(axis="y", color=GRID, linewidth=0.8, alpha=0.7)
    axes.set_axisbelow(True)
    for side in ("top", "right"):
        axes.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        axes.spines[side].set_color(GRID)
    axes.tick_params(colors=TICKS, labelsize=10)
    # Every metric is a count, so only whole numbers make sense as ticks. Without this,
    # a metric with a small range (object types are 6 or 7) repeats the same label.
    axes.xaxis.set_major_locator(ticker.MaxNLocator(integer=True))
    # Thousands separators, to match the results table.
    axes.xaxis.set_major_formatter(ticker.StrMethodFormatter("{x:,.0f}"))

    # Legend outside the plot: nine entries would cover the lines. Skipped when a run
    # produced nothing to draw, since an empty legend only warns.
    if axes.get_lines():
        axes.legend(
            loc="center left",
            bbox_to_anchor=(1.02, 0.5),
            frameon=False,
            fontsize=9,
            labelcolor=TEXT,
        )

    figure.savefig(path, bbox_inches="tight", facecolor=SURFACE)
    plt.close(figure)
    return path


def plot_all(
    rows: Sequence,
    out_dir: Path | str = FIGURES_DIR,
    metrics: Mapping[str, str] = SIZE_METRICS,
) -> list[Path]:
    """Draw one figure per metric and return the files written."""
    out_dir = Path(out_dir)
    return [
        plot_metric(rows, metric, out_dir / (FILE_PREFIX + metric + ".png"))
        for metric in metrics
    ]
