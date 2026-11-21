"""
The evaluation figures and tables of each dissertation chapter, drawn from a run.

Every chapter with an evaluation gets a folder of its own. Each figure exists as PDF
(for LaTeX) and PNG (for a quick look), and every table as CSV, Markdown and LaTeX:

    figures/
        totem-discovery/     runtime over events and objects (tau = 0.9), runtime and
                             model size over tau, table with mean and 95% CI per log
        totem-conformance/   conformance time over events, objects and TOTeM arcs, the
                             six fitness/precision values over tau, table
        occn-discovery/      runtime over events and objects with a linear fit (as in
                             the OCCN paper) and on log axes, model sizes, table
        occn-conformance/    time per process execution over its events and objects,
                             fitness and conclusive share over the marker-group filter,
                             time of the whole check, table with the main object types
        process-area/        pipeline runtime over events and objects with a linear
                             fit, levels and areas per log (the paper's Table 2)
        totem-tool/          every algorithm side by side over events and objects,
                             peak memory, Polars against DuckDB, table

Every log keeps its colour and marker in all of them (evaluation/style.py). The style
is the TOTeM conformance paper's: outlined markers, light grid, log axes for runtime,
one legend right of the panels.

Which measurements belong to which chapter is set in evaluation/algorithms.py; the
parameters a measurement ran with and what it produced (fitness, arcs, ...) come from
its properties, and per-execution data from its artifact. Nothing is computed again.

Rebuild the figures of a run without measuring anything:

    python evaluation/figures.py evaluation/results/runs/<run folder>

Combine several runs, e.g. a cluster batch with one run per log, into one set of
tables and figures (written to <folder>/combined unless --out says otherwise):

    python evaluation/figures.py $HPCWORK/totem-eval/runs/<batch>
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from statistics import mean
from typing import Any, Callable, Sequence

_TOTEM_LIB = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_TOTEM_LIB / "src"))
sys.path.insert(0, str(_TOTEM_LIB))

from evaluation import style  # noqa: E402  (sets the Agg backend first)
from evaluation.algorithms import ALGORITHMS, CHAPTERS, DEFAULT_TAU  # noqa: E402

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

# A power law needs this many logs, spread over at least this factor, to be fitted.
MIN_POINTS_FOR_FIT = 3
MIN_RANGE_FACTOR = 2.0
# The OCCN conformance paper's filter: marker groups used by under 10% are dropped.
PAPER_OCCN_THRESHOLD = 0.1
FIGURE_FORMATS = ("pdf", "png")

_REGISTRY = {algorithm.name: algorithm for algorithm in ALGORITHMS}


# ---------------------------------------------------------------------------
# Points: one measurement, flattened for plotting
# ---------------------------------------------------------------------------

@dataclass
class Point:
    log: str
    algorithm: str
    family: str
    params: dict
    seconds: float | None
    ci95: float | None
    peak_mb: float | None
    events: int | None
    objects: int | None
    object_types: int | None
    e2o: int | None
    properties: dict = field(default_factory=dict)
    artifact: str | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.error is None and self.seconds is not None

    def get(self, key: str):
        """A parameter, a property or a log statistic, by name."""
        if key in self.params:
            return self.params[key]
        if key in self.properties:
            return self.properties[key]
        return getattr(self, key, None)

    def load_artifact(self) -> dict | None:
        if not self.artifact or not Path(self.artifact).exists():
            return None
        return json.loads(Path(self.artifact).read_text(encoding="utf-8"))


def to_points(rows: Sequence) -> list[Point]:
    """Rows from a run (runs.BenchmarkRow) as Points, with their parameters resolved."""
    points = []
    for row in rows:
        result = row.result
        properties = dict(result.properties or {})
        registered = _REGISTRY.get(row.algorithm)
        params = properties.pop("params", None)
        if params is None:  # failed before the worker could record them, e.g. a timeout
            params = dict(registered.params) if registered else {}
        family = properties.pop("family", None) or (registered.family if registered
                                                     else row.algorithm)
        stats = row.statistics
        points.append(Point(
            log=row.log, algorithm=row.algorithm, family=family, params=params,
            seconds=result.elapsed_s, ci95=result.ci95_s, peak_mb=result.peak_rss_mb,
            events=stats.num_events if stats else None,
            objects=stats.num_objects if stats else None,
            object_types=stats.num_object_types if stats else None,
            e2o=stats.num_e2o_relations if stats else None,
            properties=properties, artifact=result.artifact, error=result.error,
        ))
    return points


def _select(points, family: str, **params) -> list[Point]:
    return [p for p in points if p.family == family
            and all(_same(p.params.get(k), v) for k, v in params.items())]


def _same(a, b) -> bool:
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return math.isclose(a, b, abs_tol=1e-9)
    return a == b


def _by_log(points) -> dict[str, list[Point]]:
    grouped: dict[str, list[Point]] = defaultdict(list)
    for point in points:
        grouped[point.log].append(point)
    return {log: grouped[log] for log in style.legend_order(grouped)}


# ---------------------------------------------------------------------------
# Fitting
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PowerLawFit:
    """y = 10**intercept * x**slope, fitted in log-log space."""

    slope: float
    intercept: float
    r2: float
    n: int

    def predict(self, xs) -> np.ndarray:
        return 10 ** self.intercept * np.asarray(xs, dtype=float) ** self.slope


def fit_power_law(xs: Sequence[float], ys: Sequence[float]) -> PowerLawFit | None:
    """Least squares on log10 values; None for too few points or too little spread."""
    pairs = [(x, y) for x, y in zip(xs, ys)
             if x is not None and y is not None and x > 0 and y > 0]
    if len(pairs) < MIN_POINTS_FOR_FIT:
        return None
    x = np.log10([p[0] for p in pairs])
    y = np.log10([p[1] for p in pairs])
    if 10 ** (x.max() - x.min()) < MIN_RANGE_FACTOR:
        return None
    slope, intercept = np.polyfit(x, y, 1)
    residual = ((y - (slope * x + intercept)) ** 2).sum()
    total = ((y - y.mean()) ** 2).sum()
    r2 = 1 - residual / total if total > 0 else 1.0
    return PowerLawFit(float(slope), float(intercept), float(r2), len(pairs))


@dataclass(frozen=True)
class LinearFit:
    """y = slope * x + intercept, with Pearson's r, as in the OCCN and area papers."""

    slope: float
    intercept: float
    r: float
    n: int


def fit_linear(xs: Sequence[float], ys: Sequence[float]) -> LinearFit | None:
    pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
    if len(pairs) < MIN_POINTS_FOR_FIT:
        return None
    x = np.array([p[0] for p in pairs], dtype=float)
    y = np.array([p[1] for p in pairs], dtype=float)
    if x.std() == 0 or y.std() == 0:
        return None
    slope, intercept = np.polyfit(x, y, 1)
    return LinearFit(float(slope), float(intercept), float(np.corrcoef(x, y)[0, 1]), len(pairs))


# ---------------------------------------------------------------------------
# Drawing helpers
# ---------------------------------------------------------------------------

def _save(fig, folder: Path, name: str) -> list[Path]:
    folder.mkdir(parents=True, exist_ok=True)
    written = []
    for fmt in FIGURE_FORMATS:
        path = folder / f"{name}.{fmt}"
        fig.savefig(path, dpi=200 if fmt == "png" else None, bbox_inches="tight")
        written.append(path)
    plt.close(fig)
    return written


def _panels(n: int, sharey: bool = True):
    width, height = style.PANEL_SIZE
    fig, axes = plt.subplots(1, n, figsize=(width * n, height), sharey=sharey, squeeze=False)
    return fig, list(axes[0])


def _no_data(ax, text: str = "no measurements") -> None:
    ax.text(0.5, 0.5, text, transform=ax.transAxes, ha="center", va="center",
            color="#7f7f7f")


# The x-axes every runtime figure has, with the paper's labels.
EVENTS = ("events", "Number of Events")
OBJECTS = ("objects", "Number of Objects")


def runtime_panels(points: Sequence[Point], folder: Path, name: str, *,
                   axes_spec=(EVENTS, OBJECTS), y: Callable[[Point], Any] | None = None,
                   ylabel: str = "Runtime (s)", log_x=True, log_y=True,
                   fit: str | None = None) -> list[Path]:
    """
    The paper's runtime figure: one panel per x-axis, a shared y-axis, one marker per
    measurement in its log's style, one legend on the right.

    `axes_spec` is a list of (point attribute, label) or (attribute, label, log_x).
    `fit="linear"` adds the least-squares line of the OCCN and process-area papers.
    """
    y = y or (lambda p: p.seconds)
    usable = [p for p in points if p.ok and y(p) is not None]
    fig, axes = _panels(len(axes_spec))
    for ax, spec in zip(axes, axes_spec):
        key, label = spec[0], spec[1]
        panel_log_x = spec[2] if len(spec) > 2 else log_x
        for log, pts in _by_log(usable).items():
            pairs = [(p.get(key), y(p)) for p in pts if p.get(key) is not None]
            if pairs:
                style.scatter_log(ax, log, *zip(*pairs))
        if fit == "linear" and usable:
            line = fit_linear([p.get(key) for p in usable], [y(p) for p in usable])
            if line is not None:
                xs = np.linspace(0, max(p.get(key) or 0 for p in usable), 50)
                ax.plot(xs, line.slope * xs + line.intercept, color="#d62728",
                        linewidth=1.2, label=f"Linear fit (r = {line.r:.2f})", zorder=0)
        style.finish_axes(ax, label, log_x=panel_log_x, log_y=log_y)
    style.finish_axes(axes[0], ylabel=ylabel)
    if not usable:
        _no_data(axes[0])
    fig.tight_layout()
    style.legend_right(fig, axes)
    return _save(fig, folder, name)


def over_parameter(points: Sequence[Point], folder: Path, name: str, param: str,
                   xlabel: str, panels: Sequence[tuple[Callable[[Point], Any], str]],
                   *, log_y: bool = False, unit_range: bool = False,
                   ncols: int | None = None) -> list[Path]:
    """
    Values over a swept parameter, one line per log: the paper's metrics-over-tau
    figure. `panels` are (value of a point, title); `unit_range` fixes y to [0, 1].
    """
    usable = [p for p in points if p.ok and param in p.params]
    n = len(panels)
    ncols = ncols or min(n, 3)
    nrows = math.ceil(n / ncols)
    fig, grid = plt.subplots(nrows, ncols, figsize=(6 * ncols, 5 * nrows), squeeze=False)
    axes = [ax for row in grid for ax in row]
    for ax, (value, title) in zip(axes, panels):
        for log, pts in _by_log(usable).items():
            pts = sorted((p for p in pts if value(p) is not None), key=lambda p: p.params[param])
            if pts:
                style.plot_log(ax, log, [p.params[param] for p in pts], [value(p) for p in pts])
        ax.set_title(title, fontsize=16)
        style.finish_axes(ax, xlabel, title, log_y=log_y)
        if unit_range:
            ax.set_ylim(-0.05, 1.05)
        if not usable:
            _no_data(ax)
    for ax in axes[n:]:
        ax.set_visible(False)
    fig.tight_layout()
    if nrows > 1:
        style.legend_below(fig, axes[:n])
    else:
        style.legend_right(fig, axes[:n])
    return _save(fig, folder, name)


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------

def write_table(rows: Sequence[dict], folder: Path, name: str,
                columns: Sequence[tuple[str, str]]) -> list[Path]:
    """
    One table as CSV (every digit), Markdown and LaTeX (rounded for reading).

    `columns` are (key, heading). The LaTeX version is a bare booktabs tabular, ready
    for \\input.
    """
    folder.mkdir(parents=True, exist_ok=True)
    keys = [key for key, _ in columns]
    headings = [heading for _, heading in columns]

    csv_path = folder / f"{name}.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(keys)
        for row in rows:
            writer.writerow(["" if row.get(k) is None else row.get(k) for k in keys])

    cells = [[_fmt(row.get(k)) for k in keys] for row in rows]
    md_path = folder / f"{name}.md"
    md = ["| " + " | ".join(headings) + " |", "|" + "---|" * len(headings)]
    md += ["| " + " | ".join(c.replace("|", "\\|") for c in row) + " |" for row in cells]
    md_path.write_text("\n".join(md) + "\n", encoding="utf-8")

    tex_path = folder / f"{name}.tex"
    spec = "l" + "r" * (len(keys) - 1)
    tex = [f"\\begin{{tabular}}{{{spec}}}", "\\toprule",
           " & ".join(_tex(h) for h in headings) + " \\\\", "\\midrule"]
    tex += [" & ".join(_tex(c) for c in row) + " \\\\" for row in cells]
    tex += ["\\bottomrule", "\\end{tabular}"]
    tex_path.write_text("\n".join(tex) + "\n", encoding="utf-8")
    return [csv_path, md_path, tex_path]


def _fmt(value) -> str:
    if value is None:
        return "-"
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, int):
        return f"{value:,}"
    if isinstance(value, float):
        if value == 0:
            return "0"
        if abs(value) >= 100:
            return f"{value:,.0f}"
        if abs(value) >= 1:
            return f"{value:.2f}"
        return f"{value:.3g}"
    return str(value)


def _tex(text: str) -> str:
    for char, escaped in (("\\", "\\textbackslash{}"), ("&", "\\&"), ("%", "\\%"),
                          ("_", "\\_"), ("#", "\\#"), ("$", "\\$"), ("±", "$\\pm$")):
        text = text.replace(char, escaped)
    return text.replace(",", "{,}")


def _log_columns(point: Point) -> dict:
    return {"log": style.log_style(point.log).label, "events": point.events,
            "objects": point.objects, "object_types": point.object_types}


def _sorted_by_events(points: Sequence[Point]) -> list[Point]:
    return sorted(points, key=lambda p: (p.events is None, p.events or 0, p.log))


def _timing_columns(point: Point) -> dict:
    return {"seconds": point.seconds if point.ok else None,
            "ci95": point.ci95 if point.ok else None,
            "peak_mb": point.peak_mb if point.ok else None,
            "error": point.error}


LOG_HEADINGS = [("log", "Log"), ("events", "Events"), ("objects", "Objects"),
                ("object_types", "Types")]
TIME_HEADINGS = [("seconds", "Time (s)"), ("ci95", "± 95% CI"),
                 ("peak_mb", "Peak RSS (MB)")]


# ---------------------------------------------------------------------------
# The chapters
# ---------------------------------------------------------------------------

def totem_discovery(points, folder: Path) -> list[Path]:
    sweep = _select(points, "totemDiscovery_db")
    main = _select(points, "totemDiscovery_db", tau=DEFAULT_TAU)
    written = runtime_panels(main, folder, "runtime", ylabel="Discovery Time (s)")
    written += runtime_panels(
        main, folder, "runtime_types",
        axes_spec=(EVENTS, OBJECTS, ("object_types", "Number of Object Types", False)),
        ylabel="Discovery Time (s)")
    written += over_parameter(sweep, folder, "over_tau", "tau", "Tau", [
        (lambda p: p.seconds, "Discovery Time (s)"),
        (lambda p: p.get("totem_arcs"), "Number of TOTeM Arcs"),
    ])
    rows = [{**_log_columns(p), **_timing_columns(p),
             **{k: p.get(k) for k in ("totem_nodes", "totem_arcs", "totem_arcs_dependent",
                                      "totem_arcs_initiating", "totem_arcs_parallel")}}
            for p in _sorted_by_events(main)]
    written += write_table(rows, folder, "discovery", LOG_HEADINGS + TIME_HEADINGS + [
        ("totem_nodes", "Nodes"), ("totem_arcs", "Arcs"), ("totem_arcs_dependent", "D"),
        ("totem_arcs_initiating", "I"), ("totem_arcs_parallel", "P"), ("error", "Error")])
    return written


CONFORMANCE_METRICS = [
    ("temporal_fitness", "Temporal Fitness"),
    ("log_cardinality_fitness", "Log Card. Fitness"),
    ("event_cardinality_fitness", "Event Card. Fitness"),
    ("temporal_precision", "Temporal Precision"),
    ("log_cardinality_precision", "Log Card. Precision"),
    ("event_cardinality_precision", "Event Card. Precision"),
]


def totem_conformance(points, folder: Path) -> list[Path]:
    sweep = _select(points, "totem_conformance")
    written = runtime_panels(
        sweep, folder, "conformance_time",
        axes_spec=(EVENTS, OBJECTS, ("totem_arcs", "Number of TOTeM Arcs", False)),
        ylabel="Conformance Time (s)")
    written += over_parameter(
        sweep, folder, "metrics_over_tau", "tau", "Tau",
        [(lambda p, k=k: p.get(k), title) for k, title in CONFORMANCE_METRICS],
        unit_range=True)
    rows = []
    for log, pts in _by_log(sweep).items():
        ok = [p for p in pts if p.ok]
        at_default = next((p for p in ok if _same(p.params.get("tau"), DEFAULT_TAU)), None)
        rows.append({**_log_columns(pts[0]),
                     "totem_arcs": at_default.get("totem_arcs") if at_default else None,
                     "models": len(ok),
                     "mean_seconds": mean(p.seconds for p in ok) if ok else None,
                     "max_seconds": max((p.seconds for p in ok), default=None),
                     **{k: at_default.get(k) if at_default else None
                        for k, _ in CONFORMANCE_METRICS}})
    rows.sort(key=lambda r: r["events"] or 0)
    written += write_table(rows, folder, "conformance", LOG_HEADINGS + [
        ("totem_arcs", "Arcs (tau=0.9)"), ("models", "Models"),
        ("mean_seconds", "Mean time (s)"), ("max_seconds", "Max time (s)")]
        + [(k, f"{title} (tau=0.9)") for k, title in CONFORMANCE_METRICS])
    return written


OCCN_SIZE = [("occn_activities", "Activities"), ("occn_arcs", "Arcs"),
             ("occn_input_marker_groups", "Input groups"),
             ("occn_output_marker_groups", "Output groups"), ("occn_markers", "Markers")]


def occn_discovery(points, folder: Path) -> list[Path]:
    main = _select(points, "discover_occn_db")
    written = runtime_panels(main, folder, "runtime", ylabel="Overall Time (s)",
                             log_x=False, log_y=False, fit="linear")
    written += runtime_panels(main, folder, "runtime_log", ylabel="Overall Time (s)")
    rows = [{**_log_columns(p), **_timing_columns(p), **{k: p.get(k) for k, _ in OCCN_SIZE}}
            for p in _sorted_by_events(main)]
    written += write_table(rows, folder, "discovery",
                           LOG_HEADINGS + TIME_HEADINGS + OCCN_SIZE + [("error", "Error")])
    return written


def _executions(points: Sequence[Point]) -> list[Point]:
    """One Point per replayed process execution, read from the fitness artifacts."""
    executions = []
    for point in points:
        artifact = point.load_artifact() if point.ok else None
        for unit in (artifact or {}).get("executions", []):
            executions.append(Point(
                log=point.log, algorithm=point.algorithm, family="execution",
                params=point.params, seconds=unit["seconds"], ci95=None, peak_mb=None,
                events=unit["events"], objects=unit["objects"],
                object_types=unit["object_types"], e2o=None,
                properties={"status": unit["status"]}))
    return executions


def occn_conformance(points, folder: Path) -> list[Path]:
    fitness = _select(points, "occn_fitness")
    paper = _select(points, "occn_fitness", threshold=PAPER_OCCN_THRESHOLD)
    for p in fitness:
        total = p.get("executions")
        conclusive = (p.get("fitting_executions") or 0) + (p.get("non_fitting_executions") or 0)
        p.properties["conclusive_share"] = conclusive / total if total else None

    written = runtime_panels(
        _executions(paper), folder, "execution_time",
        axes_spec=(("events", "Number of Events", False), ("objects", "Number of Objects", False)),
        ylabel="Time per Execution (s)")
    written += runtime_panels(paper, folder, "check_time", ylabel="Conformance Time (s)")
    written += over_parameter(fitness, folder, "fitness_over_threshold", "threshold",
                              "Marker-Group Filter",
                              [(lambda p: p.get("fitness"), "Fitness"),
                               (lambda p: p.get("conclusive_share"), "Conclusive Executions")],
                              unit_range=True)
    rows = []
    for p in sorted(fitness, key=lambda p: (p.events or 0, p.log, p.params.get("threshold"))):
        rows.append({"log": style.log_style(p.log).label, "threshold": p.params.get("threshold"),
                     **{k: p.get(k) for k in ("executions", "fitting_executions",
                                              "non_fitting_executions", "inconclusive_executions",
                                              "fitness", "mean_execution_s", "occn_markers")},
                     "seconds": p.seconds if p.ok else None, "error": p.error})
    written += write_table(rows, folder, "conformance", [
        ("log", "Log"), ("threshold", "Filter"), ("executions", "Executions"),
        ("fitting_executions", "Fitting"), ("non_fitting_executions", "Not fitting"),
        ("inconclusive_executions", "Inconclusive"), ("fitness", "Fitness"),
        ("mean_execution_s", "Mean per execution (s)"), ("seconds", "Total (s)"),
        ("occn_markers", "Markers"), ("error", "Error")])

    # Which object types each log was checked on, and what their OCCN cost to mine.
    models = _select(points, "discover_occn_main")
    model_rows = [{**_log_columns(p), **_timing_columns(p),
                   "main_types": ", ".join(p.get("occn_object_type_names") or []),
                   **{k: p.get(k) for k, _ in OCCN_SIZE}}
                  for p in _sorted_by_events(models)]
    written += write_table(model_rows, folder, "main_object_types",
                           LOG_HEADINGS + [("main_types", "Main object types")]
                           + TIME_HEADINGS + OCCN_SIZE + [("error", "Error")])
    return written


def process_area(points, folder: Path) -> list[Path]:
    main = _select(points, "process_areas")
    written = runtime_panels(main, folder, "runtime", ylabel="Runtime (s)",
                             log_x=False, log_y=False, fit="linear")
    written += runtime_panels(main, folder, "runtime_log", ylabel="Runtime (s)")
    rows = [{**_log_columns(p), **_timing_columns(p),
             **{k: p.get(k) for k in ("levels", "areas", "avg_types_per_area",
                                      "avg_activities_per_area", "totem_share")}}
            for p in _sorted_by_events(main)]
    written += write_table(rows, folder, "areas", LOG_HEADINGS + TIME_HEADINGS + [
        ("levels", "Levels"), ("areas", "Areas"), ("avg_types_per_area", "Avg. types"),
        ("avg_activities_per_area", "Avg. activities"), ("totem_share", "TOTeM share"),
        ("error", "Error")])
    return written


def duckdb_pairs(names) -> list[tuple[str, str]]:
    """(x, x_db) for every x that has a DuckDB twin; the two loaders are not a pair."""
    names = set(names)
    return sorted((name, f"{name}_db") for name in names
                  if f"{name}_db" in names and name != "import_ocel")


def _chapters_of(algorithm: str) -> tuple[str, ...]:
    registered = _REGISTRY.get(algorithm)
    return registered.chapters if registered else ()


def totem_tool(points, folder: Path) -> list[Path]:
    tool = [p for p in points if "totem-tool" in _chapters_of(p.algorithm)]
    algorithms = [a.name for a in ALGORITHMS if any(p.algorithm == a.name for p in tool)]
    written = []
    for name, x_key, x_label, value, ylabel in (
        ("runtime_by_algorithm_events", "events", "Number of Events",
         lambda p: p.seconds, "Runtime (s)"),
        ("runtime_by_algorithm_objects", "objects", "Number of Objects",
         lambda p: p.seconds, "Runtime (s)"),
        ("memory_by_algorithm", "events", "Number of Events",
         lambda p: p.peak_mb, "Peak RSS (MB)"),
    ):
        written += _algorithm_grid(tool, algorithms, folder, name, x_key=x_key,
                                   x_label=x_label, value=value, ylabel=ylabel)
    written += _polars_vs_duckdb(tool, folder)
    rows = [{"algorithm": p.algorithm, **_log_columns(p), **_timing_columns(p)}
            for p in sorted(tool, key=lambda p: (algorithms.index(p.algorithm), p.events or 0))]
    written += write_table(rows, folder, "all_algorithms", [("algorithm", "Algorithm")]
                           + LOG_HEADINGS + TIME_HEADINGS + [("error", "Error")])
    return written


def _algorithm_grid(points, algorithms, folder, name, *, x_key, x_label, value, ylabel):
    """Small multiples: one panel per algorithm, logs in their colours, shared axes."""
    n = max(len(algorithms), 1)
    ncols = min(4, n)
    nrows = math.ceil(n / ncols)
    fig, grid = plt.subplots(nrows, ncols, figsize=(4.2 * ncols, 3.6 * nrows),
                             sharex=True, sharey=True, squeeze=False)
    axes = [ax for row in grid for ax in row]
    for ax, algorithm in zip(axes, algorithms):
        pts = [p for p in points if p.algorithm == algorithm and p.ok and value(p)]
        for log, own in _by_log(pts).items():
            style.scatter_log(ax, log, [p.get(x_key) for p in own], [value(p) for p in own])
        ax.set_title(algorithm, fontsize=12)
        style.finish_axes(ax, log_x=True, log_y=True)
    for ax in axes[len(algorithms):]:
        ax.set_visible(False)
    for column in range(ncols):  # x label on the lowest visible panel of each column
        visible = [grid[r][column] for r in range(nrows)
                   if r * ncols + column < len(algorithms)]
        if visible:
            visible[-1].set_xlabel(x_label, fontsize=style.LABEL_SIZE)
            visible[-1].xaxis.set_tick_params(labelbottom=True)
    for row in grid:
        row[0].set_ylabel(ylabel, fontsize=style.LABEL_SIZE)
    fig.tight_layout()
    style.legend_right(fig, axes[:len(algorithms)])
    return _save(fig, folder, name)


def _polars_vs_duckdb(points, folder) -> list[Path]:
    """Each pair as Polars time against DuckDB time per log; below the line DuckDB wins."""
    seconds = {(p.log, p.algorithm): p.seconds for p in points if p.ok}
    pairs = duckdb_pairs({p.algorithm for p in points})
    fig, axes = _panels(max(len(pairs), 1), sharey=False)
    for ax, (polars, duck) in zip(axes, pairs):
        logs = [log for log in style.legend_order({log for log, _ in seconds})
                if (log, polars) in seconds and (log, duck) in seconds]
        for log in logs:
            style.scatter_log(ax, log, [seconds[(log, polars)]], [seconds[(log, duck)]])
        values = [seconds[(log, a)] for log in logs for a in (polars, duck)]
        if values:
            low, high = min(values) / 2, max(values) * 2
            ax.plot([low, high], [low, high], color="#7f7f7f", linestyle="--", linewidth=1,
                    label="Same speed", zorder=0)
            ax.set_xlim(low, high)
            ax.set_ylim(low, high)
        else:
            _no_data(ax)
        ax.set_title(polars, fontsize=12)
        style.finish_axes(ax, "Polars Time (s)", "DuckDB Time (s)", log_x=True, log_y=True)
    if not pairs:
        _no_data(axes[0], "no Polars/DuckDB pairs measured")
    fig.tight_layout()
    style.legend_right(fig, axes)
    return _save(fig, folder, "polars_vs_duckdb")


CHAPTER_FIGURES: dict[str, Callable[[list[Point], Path], list[Path]]] = {
    "totem-discovery": totem_discovery,
    "totem-conformance": totem_conformance,
    "occn-discovery": occn_discovery,
    "occn-conformance": occn_conformance,
    "process-area": process_area,
    "totem-tool": totem_tool,
}
assert set(CHAPTER_FIGURES) == set(CHAPTERS)


def draw_all(rows: Sequence, figures_dir: Path, tables_dir: Path | None = None) -> list[Path]:
    """
    Every chapter's figures and tables, each chapter in figures/<chapter>/.

    A chapter with no measurements in the rows is left out. One chapter failing to draw
    is reported and does not stop the others. `tables_dir` is accepted for callers of
    the earlier version; tables now sit next to their chapter's figures.
    """
    points = to_points(rows)
    measured = {chapter for p in points for chapter in _chapters_of(p.algorithm)}
    written: list[Path] = []
    for chapter, draw in CHAPTER_FIGURES.items():
        if chapter not in measured:
            continue
        try:
            written += draw(points, Path(figures_dir) / chapter)
        except Exception as exc:  # one broken chapter must not hide the others
            print(f"Drawing {chapter} failed: {type(exc).__name__}: {exc}")
    return written


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

def output_folder(paths: list[Path], runs: list, out: Path | None = None) -> Path:
    """Where the figures go: a run folder given on its own is drawn into itself; a batch
    folder or several runs go to ``<first path>/combined``, even if only one run is in it
    so far, so a batch always ends up in the same place."""
    if out is not None:
        return out
    if len(paths) == 1 and len(runs) == 1 and runs[0].path.resolve() == paths[0].resolve():
        return runs[0].path
    return paths[0] / "combined"


def main() -> None:
    from evaluation.export import FORMATS, export
    from evaluation.runs import combined_rows, find_runs

    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="+", type=Path,
                        help="a run folder, several, or a folder holding runs (a cluster "
                             "batch writes one run per log); their results are combined")
    parser.add_argument("--out", type=Path, default=None,
                        help="where to write: default is the run folder itself, or "
                             "<folder>/combined when several runs are combined")
    args = parser.parse_args()

    runs = find_runs(args.paths)
    if not runs:
        raise SystemExit(f"no benchmark runs in {', '.join(map(str, args.paths))}")
    rows = combined_rows(runs)
    if not rows:
        raise SystemExit("those runs have no measurements yet")

    out = output_folder(args.paths, runs, args.out)
    if out != runs[0].path:
        settings = {run.path.name: run.settings for run in runs}
        if len({tuple(sorted(s.items())) for s in settings.values()}) > 1:
            print("Warning: these runs used different settings, so their numbers are not "
                  "strictly comparable:")
            for name, values in settings.items():
                print(f"  {name}: {values}")
        print(f"Combining {len(runs)} runs ({len(rows)} measurements) into {out}")
        # The tables too, so the combined folder reads like one run.
        first = runs[0]
        for path in export(rows, out, FORMATS, repeats=first.settings.get("repeats"),
                           settings=first.settings, environment=first.environment):
            print(path)
    for path in draw_all(rows, out / "figures", out):
        print(path)


if __name__ == "__main__":
    main()
