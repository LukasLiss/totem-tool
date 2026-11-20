"""
Every figure of the runtime evaluation, drawn from one list of benchmark rows.

plots.py draws the overview: all algorithms in one figure per size metric. This module
adds the figures that answer more specific questions, and `draw_all()` produces the
whole set:

    figures/
        runtime_vs_<metric>.png        overview, one line per algorithm (plots.py)
        memory/memory_vs_<metric>.png  the same for peak memory
        grid/runtime_grid_<metric>.png one panel per algorithm, log-log, with error
                                       bars and a fitted power law y = a * x^b
        scaling_exponents.png          the fitted exponent b for every algorithm and
                                       metric at a glance
        polars_vs_duckdb.png           speed-up of each DuckDB algorithm over its
                                       Polars twin, alone and including the import
        pipeline_cost.png              end-to-end cost per log: prerequisite steps
                                       (import, TOTeM for MLPA) plus the algorithm
    scaling_exponents.csv / .md        the fitted exponents as a table

How to read the exponent: on log-log axes a power law is a straight line, and its
slope b says how runtime grows with the metric - b = 1 is linear, b = 2 quadratic. The
logs differ in many ways at once, so b is an empirical summary across logs, not a
controlled complexity measurement: a high R^2 says the metric explains runtime well
across these logs, a low one says something else drives it. Comparing R^2 across
metrics shows which size measure an algorithm actually scales with.

Rebuild every figure of a run without measuring anything again:

    python evaluation/figures.py evaluation/results/runs/<run folder>
"""

from __future__ import annotations

import argparse
import csv
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence

_TOTEM_LIB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_TOTEM_LIB / "src"))
sys.path.insert(0, str(_TOTEM_LIB))

import matplotlib  # noqa: E402

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib import ticker  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402
from matplotlib.lines import Line2D  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402

from evaluation.algorithms import ALGORITHM_NAMES, ALGORITHMS  # noqa: E402
from evaluation.datasets import SIZE_METRICS  # noqa: E402
from evaluation.plots import (  # noqa: E402
    BASELINE_ALGORITHMS,
    BASELINE_COLOR,
    GRID,
    SURFACE,
    TEXT,
    TICKS,
    VALUES,
    _compact,
    colors_for_algorithms,
    markers_for_logs,
    plot_all,
    plot_metric,
    series_for,
)

# Muted ink for secondary text, and a lighter grey for prerequisite steps that are
# algorithms themselves (TOTeM discovery before MLPA).
MUTED = "#6f6e69"
PREREQUISITE_COLOR = "#b5b4ad"

# The validated sequential ramp (blue 100 -> 650), for the exponent heatmap.
SEQUENTIAL = ("#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#104281")

# Below this R^2 a fitted exponent is shown but greyed out: the metric does not explain
# runtime across the logs, so the slope means little.
POOR_FIT_R2 = 0.5

# A power law needs at least this many logs to be worth fitting.
MIN_POINTS_FOR_FIT = 3

# ...and the metric has to vary by at least this factor across them. Object types
# (6 or 7 in the small logs) cannot explain a runtime, and a slope fitted over such a
# narrow range comes out as a meaningless -13.
MIN_RANGE_FACTOR = 2.0

_REQUIRES = {algorithm.name: algorithm.requires for algorithm in ALGORITHMS}


# ---------------------------------------------------------------------------
# Fitting
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PowerLawFit:
    """y = a * x^b, fitted by least squares on log10(x), log10(y)."""

    slope: float      # b, the exponent
    intercept: float  # log10(a)
    r2: float
    n: int

    def predict(self, x):
        return 10 ** self.intercept * np.asarray(x, dtype=float) ** self.slope


def fit_power_law(xs: Sequence[float], ys: Sequence[float]) -> PowerLawFit | None:
    """
    Fit y = a * x^b, or return None when there is too little to fit.

    Needs MIN_POINTS_FOR_FIT points with positive values, spanning at least a factor
    of MIN_RANGE_FACTOR in x - a metric that barely varies across the logs cannot
    explain anything.
    """
    pairs = [(x, y) for x, y in zip(xs, ys) if x and y and x > 0 and y > 0]
    if len(pairs) < MIN_POINTS_FOR_FIT:
        return None
    x_values = [x for x, _ in pairs]
    if max(x_values) / min(x_values) < MIN_RANGE_FACTOR:
        return None
    lx = np.log10([x for x, _ in pairs])
    ly = np.log10([y for _, y in pairs])
    slope, intercept = np.polyfit(lx, ly, 1)
    predicted = slope * lx + intercept
    total = float(np.sum((ly - ly.mean()) ** 2))
    r2 = 1.0 - float(np.sum((ly - predicted) ** 2)) / total if total > 0 else 0.0
    return PowerLawFit(float(slope), float(intercept), r2, len(pairs))


def scaling_table(rows: Sequence, metrics: Mapping[str, str] = SIZE_METRICS) -> list[dict]:
    """One fitted exponent per (algorithm, metric) that has enough logs, in a fixed order."""
    table = []
    for metric in metrics:
        series = series_for(rows, metric)
        for algorithm in _ordered(series):
            points = series[algorithm]
            fit = fit_power_law([x for x, _, _ in points], [y for _, y, _ in points])
            if fit is not None:
                table.append({
                    "algorithm": algorithm,
                    "metric": metric,
                    "exponent": fit.slope,
                    "r2": fit.r2,
                    "logs": fit.n,
                })
    return table


def write_scaling(table: Sequence[dict], out_dir: Path) -> list[Path]:
    """The exponent table as CSV (for tools) and Markdown (for reading)."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / "scaling_exponents.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["algorithm", "metric", "exponent", "r2", "logs"])
        writer.writeheader()
        writer.writerows(table)

    metrics = list(dict.fromkeys(entry["metric"] for entry in table))
    algorithms = list(dict.fromkeys(entry["algorithm"] for entry in table))
    cell = {(e["algorithm"], e["metric"]): e for e in table}
    lines = [
        "# Scaling exponents",
        "",
        "Each cell is the exponent b of a power law runtime = a * metric^b fitted across "
        "the logs, with its R^2 in brackets. b = 1 is linear growth. The logs differ in "
        "many ways at once, so b summarises them empirically; a low R^2 means that "
        "metric does not explain the runtime.",
        "",
        "| Algorithm | " + " | ".join(SIZE_METRICS.get(m, m) for m in metrics) + " |",
        "|---" * (len(metrics) + 1) + "|",
    ]
    for algorithm in algorithms:
        cells = []
        for metric in metrics:
            entry = cell.get((algorithm, metric))
            cells.append("-" if entry is None else f"{entry['exponent']:.2f} ({entry['r2']:.2f})")
        lines.append(f"| {algorithm} | " + " | ".join(cells) + " |")
    md_path = out_dir / "scaling_exponents.md"
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return [csv_path, md_path]


# ---------------------------------------------------------------------------
# Shared drawing helpers
# ---------------------------------------------------------------------------

def _ordered(names) -> list[str]:
    """Algorithms in registry order, loaders first; unknown names last."""
    names = set(names)
    known = [n for n in ALGORITHM_NAMES if n in names]
    return known + sorted(names - set(known))


def _color(name: str, colors: Mapping[str, str]) -> str:
    return BASELINE_COLOR if name in BASELINE_ALGORITHMS else colors.get(name, BASELINE_COLOR)


def _style(axes) -> None:
    axes.set_facecolor(SURFACE)
    axes.grid(color=GRID, linewidth=0.6, alpha=0.6, which="major")
    axes.set_axisbelow(True)
    for side in ("top", "right"):
        axes.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        axes.spines[side].set_color(GRID)
    axes.tick_params(colors=TICKS, labelsize=8)


def _suptitle(figure, text: str, fontsize: int):
    """
    A left-aligned figure title, with the panels laid out below it.

    A plain tight_layout() lets the panel titles run into the figure title once a
    figure is a few panels tall, so leave a fixed strip at the top for it instead.
    """
    strip = 0.5 / figure.get_figheight()  # half an inch, as a share of the height
    figure.tight_layout(rect=(0, 0, 1, 1 - strip))
    return figure.text(0.01, 1 - strip / 3, text, color=TEXT, fontsize=fontsize,
                       ha="left", va="center")


def _save(figure, path: Path, extra=()) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(path, bbox_inches="tight", bbox_extra_artists=list(extra), facecolor=SURFACE)
    plt.close(figure)
    return path


def _by_pair(rows: Sequence) -> dict[tuple[str, str], object]:
    return {(row.log, row.algorithm): row for row in rows if row.ok}


def _logs_by_size(rows: Sequence) -> list[str]:
    """Logs in order of event count, the order every per-log figure uses."""
    sizes = {row.log: (row.statistics.num_events if row.statistics else math.inf) for row in rows}
    return sorted(sizes, key=lambda log: (sizes[log], log))


def _plain(value: float, _position=None) -> str:
    """0.04 rather than 4 x 10^-2: tick labels people read without decoding."""
    return f"{value:g}"


def _log_log(axes) -> None:
    """
    Log scales on both axes, so a power law is a straight line. Tick labels stay
    plain numbers, and minor ticks are labelled only when a panel spans less than a
    decade (otherwise it would have no labels at all).
    """
    axes.set_xscale("log")
    axes.set_yscale("log")
    for axis, compact in ((axes.xaxis, _compact), (axes.yaxis, _plain)):
        axis.set_major_formatter(ticker.FuncFormatter(compact))
        axis.set_minor_formatter(ticker.FuncFormatter(
            # Defaults bind the current axis; a plain closure would see the last one.
            lambda value, position, f=compact, ax=axis: (
                f(value) if _few_majors(ax) and _leading_digit(value) in (2, 5) else ""
            )
        ))
    axes.tick_params(axis="both", which="minor", labelsize=7, colors=TICKS)


def _leading_digit(value: float) -> int:
    """2 for 0.02, 20 and 200: which minor ticks of a decade get a label."""
    if value <= 0:
        return 0
    return int(round(value / 10 ** math.floor(math.log10(value) + 1e-9)))


def _few_majors(axis) -> bool:
    low, high = sorted(axis.get_view_interval())
    return high / low < 10 if low > 0 else False


def _empty(path: Path, message: str) -> Path:
    figure, axes = plt.subplots(figsize=(6, 2), dpi=150)
    figure.patch.set_facecolor(SURFACE)
    axes.axis("off")
    axes.text(0.5, 0.5, message, ha="center", va="center", color=MUTED, fontsize=10)
    return _save(figure, path)


# ---------------------------------------------------------------------------
# Small multiples with fitted power laws
# ---------------------------------------------------------------------------

def plot_grid(rows: Sequence, metric: str, path: Path, value: str = "elapsed_s") -> Path:
    """
    One panel per algorithm: value against a metric on log-log axes.

    Each point is one log (marker shape says which). Error bars span one standard
    deviation of the timed repeats. The dashed line is the fitted power law, and its
    exponent and R^2 are printed in the panel.
    """
    if metric not in SIZE_METRICS:
        raise ValueError(f"unknown metric {metric!r}; available: {', '.join(SIZE_METRICS)}")
    series = series_for(rows, metric, value)
    if not series:
        return _empty(path, "No successful measurements to plot.")

    names = _ordered(series)
    colors = colors_for_algorithms(n for n in names if n not in BASELINE_ALGORITHMS)
    markers = markers_for_logs(rows)
    spread = {(row.log, row.algorithm): row.result.std_s for row in rows if row.ok}

    columns = 3
    grid_rows = math.ceil(len(names) / columns)
    figure, axes_grid = plt.subplots(
        grid_rows, columns, figsize=(4.2 * columns, 3.2 * grid_rows), dpi=170, squeeze=False,
    )
    figure.patch.set_facecolor(SURFACE)

    for index, axes in enumerate(axes_grid.flat):
        if index >= len(names):
            axes.axis("off")
            continue
        name = names[index]
        # A log scale has no zero: logs without object-to-object relations, say,
        # cannot be placed on that axis and are noted in the panel instead.
        points = [p for p in series[name] if p[0] > 0 and p[1] > 0]
        left_out = len(series[name]) - len(points)
        color = _color(name, colors)
        _style(axes)

        for x, y, log in points:
            std = spread.get((log, name)) if value == "elapsed_s" else None
            if std:
                # Never let a bar cross zero on a log axis.
                lower = min(std, y * 0.95)
                axes.errorbar(x, y, yerr=[[lower], [std]], color=color, linewidth=1,
                              capsize=2, zorder=2)
            axes.plot(x, y, marker=markers.get(log, "o"), color=color, markersize=7,
                      markeredgecolor=SURFACE, markeredgewidth=1.2, linestyle="none", zorder=3)

        fit = fit_power_law([x for x, _, _ in points], [y for _, y, _ in points])
        if fit is not None and points:
            xs = np.geomspace(min(x for x, _, _ in points), max(x for x, _, _ in points), 50)
            axes.plot(xs, fit.predict(xs), color=color, linewidth=1.5, linestyle="--",
                      alpha=0.8, zorder=1)
            label = f"exponent {fit.slope:.2f}   R² {fit.r2:.2f}"
        else:
            label = "no fit: too few logs or too narrow a range"
        if left_out:
            label += f"\n{left_out} log(s) at zero not shown"
        axes.text(0.03, 0.95, label, transform=axes.transAxes, va="top", ha="left",
                  fontsize=8, color=TEXT if fit and fit.r2 >= POOR_FIT_R2 else MUTED)

        axes.set_title(name, fontsize=10, color=TEXT, loc="left")
        _log_log(axes)
        if index % columns == 0:
            axes.set_ylabel(VALUES[value].replace(", log scale", ""), fontsize=8, color=TEXT)
        if index >= len(names) - columns:
            axes.set_xlabel(SIZE_METRICS[metric], fontsize=8, color=TEXT)

    drawn = {log for points in series.values() for _, _, log in points}
    handles = [
        Line2D([], [], color=TICKS, marker=markers[log], linestyle="none", markersize=7, label=log)
        for log in markers if log in drawn
    ]
    what = "Runtime" if value == "elapsed_s" else "Peak memory"
    title = _suptitle(figure, f"{what} per algorithm against {SIZE_METRICS[metric].lower()}", 13)
    legend = figure.legend(handles=handles, title="Log (marker)", loc="lower center",
                           ncol=min(len(handles), 4), frameon=False, fontsize=8,
                           bbox_to_anchor=(0.5, -0.02 - 0.03 * math.ceil(len(handles) / 4)))
    return _save(figure, path, [legend, title])


# ---------------------------------------------------------------------------
# Exponent heatmap
# ---------------------------------------------------------------------------

def plot_scaling_heatmap(table: Sequence[dict], path: Path) -> Path:
    """
    Algorithms down, metrics across, the fitted exponent in each cell.

    Colour is the exponent on the sequential blue ramp. Cells with a poor fit
    (R^2 below POOR_FIT_R2) are left uncoloured, with their value in muted ink, so
    only exponents that mean something stand out.
    """
    if not table:
        return _empty(path, "Not enough logs to fit any exponent.")
    metrics = [m for m in SIZE_METRICS if any(e["metric"] == m for e in table)]
    algorithms = _ordered(e["algorithm"] for e in table)
    cell = {(e["algorithm"], e["metric"]): e for e in table}

    good = [e["exponent"] for e in table if e["r2"] >= POOR_FIT_R2 and e["exponent"] >= 0]
    top = max([2.0, *good])
    cmap = LinearSegmentedColormap.from_list("sequential", SEQUENTIAL)

    figure, axes = plt.subplots(
        figsize=(1.45 * len(metrics) + 2.5, 0.48 * len(algorithms) + 1.8), dpi=170,
    )
    figure.patch.set_facecolor(SURFACE)
    axes.set_facecolor(SURFACE)
    for i, algorithm in enumerate(algorithms):
        for j, metric in enumerate(metrics):
            entry = cell.get((algorithm, metric))
            if entry is None:
                axes.text(j, i, "-", ha="center", va="center", color=MUTED, fontsize=8)
                continue
            exponent, r2 = entry["exponent"], entry["r2"]
            if r2 >= POOR_FIT_R2 and exponent >= 0:
                share = min(max(exponent, 0.0) / top, 1.0)
                fill = cmap(share)
                ink = SURFACE if share > 0.55 else TEXT
            else:
                fill, ink = SURFACE, MUTED
            # A 2px-like gap between cells: slightly smaller rectangles on the surface.
            axes.add_patch(plt.Rectangle((j - 0.47, i - 0.45), 0.94, 0.9, color=fill, linewidth=0))
            axes.text(j, i - 0.08, f"{exponent:.2f}", ha="center", va="center", color=ink, fontsize=9)
            axes.text(j, i + 0.24, f"R² {r2:.2f}", ha="center", va="center", color=ink, fontsize=6)

    axes.set_xlim(-0.5, len(metrics) - 0.5)
    axes.set_ylim(len(algorithms) - 0.5, -0.5)
    axes.set_xticks(range(len(metrics)))
    axes.set_xticklabels([SIZE_METRICS[m].replace("Number of ", "").replace(" ", "\n", 1)
                          for m in metrics], fontsize=8, color=TEXT)
    axes.set_yticks(range(len(algorithms)))
    axes.set_yticklabels(algorithms, fontsize=8, color=TEXT)
    axes.tick_params(length=0)
    for side in axes.spines.values():
        side.set_visible(False)
    axes.xaxis.tick_top()
    axes.set_title(
        "Fitted scaling exponent (runtime ~ metric^b)\n"
        f"darker = steeper growth; uncoloured = poor fit (R² < {POOR_FIT_R2}) or falling; "
        f"- = metric varies < {MIN_RANGE_FACTOR:g}x across logs",
        fontsize=10, color=TEXT, loc="left", pad=34,
    )
    return _save(figure, path)


# ---------------------------------------------------------------------------
# Polars vs DuckDB
# ---------------------------------------------------------------------------

def duckdb_pairs(names) -> list[tuple[str, str]]:
    """
    (polars, duckdb) algorithm pairs: every `x` that also has an `x_db`.

    The two loaders are left out: "including the import" means nothing for an import,
    and their comparison is already the grey baselines of the overview figures.
    """
    names = set(names) - set(BASELINE_ALGORITHMS)
    return [(n, n + "_db") for n in _ordered(names) if n + "_db" in names]


def _end_to_end(by_pair, log: str, algorithm: str) -> float | None:
    """The algorithm plus every prerequisite step, or None if one is missing."""
    steps = [*_REQUIRES.get(algorithm, ()), algorithm]
    times = [by_pair.get((log, step)) for step in steps]
    if any(row is None for row in times):
        return None
    return sum(row.result.elapsed_s for row in times)


def plot_polars_vs_duckdb(rows: Sequence, path: Path) -> Path:
    """
    How much faster each DuckDB algorithm is than its Polars twin, per log.

    Two bars per log: the algorithm alone, and including the import each one needs.
    Above 1 DuckDB is faster. Loading into DuckDB is usually the slower step, so the
    second bar is the fairer one when one load feeds one algorithm.
    """
    by_pair = _by_pair(rows)
    pairs = duckdb_pairs({row.algorithm for row in rows if row.ok})
    logs = _logs_by_size(rows)
    if not pairs:
        return _empty(path, "No algorithm was measured in both a Polars and a DuckDB version.")

    figure, axes_list = plt.subplots(len(pairs), 1, figsize=(max(7, 1.1 * len(logs) + 2), 3.8 * len(pairs)),
                                     dpi=170, squeeze=False)
    figure.patch.set_facecolor(SURFACE)
    alone_color, job_color = "#2a78d6", "#eb6834"  # categorical slots 1 and 2

    for (polars, duckdb), axes in zip(pairs, axes_list.flat):
        _style(axes)
        shown, alone, job = [], [], []
        for log in logs:
            p, d = by_pair.get((log, polars)), by_pair.get((log, duckdb))
            if p is None or d is None:
                continue
            p_job, d_job = _end_to_end(by_pair, log, polars), _end_to_end(by_pair, log, duckdb)
            shown.append(log)
            alone.append(p.result.elapsed_s / d.result.elapsed_s)
            job.append(p_job / d_job if p_job and d_job else math.nan)
        positions = np.arange(len(shown))
        width = 0.38
        for offset, values, color, label in (
            (-width / 2 - 0.01, alone, alone_color, "Algorithm alone"),
            (width / 2 + 0.01, job, job_color, "Including the import"),
        ):
            bars = axes.bar(positions + offset, values, width, color=color, label=label, zorder=2)
            for bar, v in zip(bars, values):
                if not math.isnan(v):
                    axes.text(bar.get_x() + bar.get_width() / 2, v * 1.05, f"{v:.1f}×",
                              ha="center", va="bottom", fontsize=7, color=TEXT)
        axes.axhline(1, color=TEXT, linewidth=1, zorder=3)
        axes.set_yscale("log")
        finite = [v for v in alone + job if not math.isnan(v)]
        if finite:
            axes.set_ylim(min(0.8, min(finite) * 0.8), max(1.25, max(finite)) * 1.6)
        axes.yaxis.set_major_formatter(ticker.FuncFormatter(
            # The 1x line is labelled on the axis: any spot inside the plot meets a bar.
            lambda v, _: "same speed  1×" if v == 1 else f"{v:g}×"))
        axes.yaxis.set_minor_formatter(ticker.NullFormatter())
        axes.set_xticks(positions)
        axes.set_xticklabels(shown, fontsize=8, color=TEXT, rotation=20, ha="right")
        axes.set_ylabel("Speed-up of DuckDB\n(Polars time / DuckDB time)", fontsize=8, color=TEXT)
        axes.set_title(f"{duckdb} vs {polars}", fontsize=10, color=TEXT, loc="left")
    figure.tight_layout()
    legend = figure.legend(
        handles=[Patch(color=alone_color, label="Algorithm alone"),
                 Patch(color=job_color, label="Including the import each one needs")],
        loc="lower center", ncol=2, frameon=False, fontsize=8, bbox_to_anchor=(0.5, -0.06),
    )
    return _save(figure, path, [legend])


# ---------------------------------------------------------------------------
# End-to-end pipeline cost
# ---------------------------------------------------------------------------

def plot_pipeline(rows: Sequence, path: Path) -> Path:
    """
    Where the time goes on the way from the file on disk to each algorithm's result.

    One panel per log, one bar per algorithm, stacked to 100%: the import (dark grey),
    other prerequisite steps such as TOTeM discovery before MLPA (light grey), then the
    algorithm itself in its own colour. The total end-to-end time is printed next to
    each bar. Shares rather than seconds, because one slow algorithm would otherwise
    flatten every other bar in its panel.
    """
    by_pair = _by_pair(rows)
    logs = _logs_by_size(rows)
    algorithms = _ordered(
        {row.algorithm for row in rows if row.ok and row.algorithm not in BASELINE_ALGORITHMS}
    )
    if not algorithms or not logs:
        return _empty(path, "No algorithm results to stack.")
    colors = colors_for_algorithms(algorithms)

    columns = 2 if len(logs) > 1 else 1
    grid_rows = math.ceil(len(logs) / columns)
    figure, axes_grid = plt.subplots(
        grid_rows, columns, figsize=(6.2 * columns, 0.32 * len(algorithms) * grid_rows + 1.2 * grid_rows),
        dpi=170, squeeze=False,
    )
    figure.patch.set_facecolor(SURFACE)

    for index, axes in enumerate(axes_grid.flat):
        if index >= len(logs):
            axes.axis("off")
            continue
        log = logs[index]
        _style(axes)
        axes.grid(axis="y", visible=False)
        labels = []
        for position, algorithm in enumerate(algorithms):
            labels.append(algorithm)
            own = by_pair.get((log, algorithm))
            steps = _REQUIRES.get(algorithm, ())
            prereqs = [by_pair.get((log, step)) for step in steps]
            if own is None or any(p is None for p in prereqs):
                axes.text(0, position, "  not measured", va="center", fontsize=7, color=MUTED)
                continue
            total = sum(p.result.elapsed_s for p in prereqs) + own.result.elapsed_s
            left = 0.0
            for step, prereq in zip(steps, prereqs):
                fill = BASELINE_COLOR if step in BASELINE_ALGORITHMS else PREREQUISITE_COLOR
                share = 100 * prereq.result.elapsed_s / total
                axes.barh(position, share, left=left, color=fill,
                          edgecolor=SURFACE, linewidth=1, height=0.7)
                left += share
            axes.barh(position, 100 - left, left=left, color=colors[algorithm],
                      edgecolor=SURFACE, linewidth=1, height=0.7)
            axes.text(101, position, f"{total:.3g} s", va="center", fontsize=7, color=TEXT)
        axes.set_yticks(range(len(labels)))
        axes.set_yticklabels(labels, fontsize=7, color=TEXT)
        axes.invert_yaxis()
        # Room right of 100% for the total, inside the panel so it is never clipped.
        axes.set_xlim(0, 118)
        axes.set_xticks([0, 25, 50, 75, 100])
        axes.spines["bottom"].set_bounds(0, 100)
        events = next((r.statistics.num_events for r in rows if r.log == log and r.statistics), None)
        axes.set_title(f"{log}" + (f"  ({events:,} events)" if events else ""),
                       fontsize=9, color=TEXT, loc="left")
        axes.set_xlabel("share of end-to-end time (%); total on the right", fontsize=7, color=TEXT)

    legend = figure.legend(
        handles=[
            Patch(color=BASELINE_COLOR, label="Import (prerequisite)"),
            Patch(color=PREREQUISITE_COLOR, label="Other prerequisite step"),
            Patch(color="#2a78d6", label="The algorithm (its own colour)"),
        ],
        loc="lower center", ncol=3, frameon=False, fontsize=8, bbox_to_anchor=(0.5, -0.03),
    )
    title = _suptitle(figure, "Where the time goes: from the file on disk to each result", 12)
    return _save(figure, path, [legend, title])


# ---------------------------------------------------------------------------
# Everything
# ---------------------------------------------------------------------------

def draw_all(rows: Sequence, figures_dir: Path, tables_dir: Path | None = None) -> list[Path]:
    """
    Draw every figure into figures_dir and return the files written.

    With tables_dir, the scaling exponents are also written there as CSV and Markdown.
    """
    figures_dir = Path(figures_dir)
    written = plot_all(rows, figures_dir)

    if any(row.ok and row.result.peak_rss_mb is not None for row in rows):
        for metric in SIZE_METRICS:
            written.append(plot_metric(rows, metric, figures_dir / "memory" / f"memory_vs_{metric}.png",
                                       value="peak_rss_mb"))

    for metric in SIZE_METRICS:
        written.append(plot_grid(rows, metric, figures_dir / "grid" / f"runtime_grid_{metric}.png"))

    table = scaling_table(rows)
    written.append(plot_scaling_heatmap(table, figures_dir / "scaling_exponents.png"))
    if tables_dir is not None:
        written += write_scaling(table, tables_dir)

    written.append(plot_polars_vs_duckdb(rows, figures_dir / "polars_vs_duckdb.png"))
    written.append(plot_pipeline(rows, figures_dir / "pipeline_cost.png"))
    return written


def main() -> None:
    from evaluation.runs import RunDirectory

    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("run_dir", type=Path, help="a run folder from run_benchmarks.py")
    args = parser.parse_args()
    try:
        run_dir = RunDirectory.open(args.run_dir)
    except FileNotFoundError as exc:
        raise SystemExit(str(exc))
    rows = run_dir.rows()
    if not rows:
        raise SystemExit(f"{run_dir.path} has no measurements yet")
    for path in draw_all(rows, run_dir.figures_dir, run_dir.path):
        print(path)


if __name__ == "__main__":
    main()
