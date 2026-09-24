"""
Contract for the runtime plots (evaluation/plots.py).

Rows are built by hand, so nothing here runs an algorithm. The assertions are about
the data that goes into a figure and the files that come out, not about pixels: what
matters is that a failed measurement is left out rather than drawn as zero, and that
the points are ordered by the metric being plotted.
"""

import csv

import matplotlib
import pytest

# No display in CI. Must be set before pyplot is imported anywhere.
matplotlib.use("Agg")

import matplotlib.pyplot as plt

from evaluation.algorithms import ALGORITHM_NAMES
from evaluation.datasets import LOGS, SIZE_METRICS, LogStatistics
from evaluation.export import write_csv
from evaluation.harness import BenchmarkResult
from evaluation.plots import (
    BASELINE_ALGORITHMS,
    FILE_PREFIX,
    colors_for_algorithms,
    markers_for_logs,
    plot_all,
    plot_metric,
    rows_from_csv,
    series_for,
)
from evaluation.run_benchmarks import BenchmarkRow

PNG_MAGIC = b"\x89PNG"

# Every algorithm drawn in colour: all of them except the grey loading steps.
COLORED = [name for name in ALGORITHM_NAMES if name not in BASELINE_ALGORITHMS]


def _stats(**overrides) -> LogStatistics:
    fields = {
        "num_events": 100,
        "num_objects": 50,
        "num_unique_activities": 5,
        "num_object_types": 3,
        "num_e2o_relations": 200,
        "num_o2o_relations": 80,
        "earliest_timestamp": 1_600_000_000,
        "newest_timestamp": 1_600_086_400,
    }
    fields.update(overrides)
    return LogStatistics(**fields)


def _row(log="log-a", algorithm="works", elapsed_s=1.5, statistics=None) -> BenchmarkRow:
    result = BenchmarkResult(name=algorithm, repeats=1, elapsed_s=elapsed_s, peak_mb=2.0)
    return BenchmarkRow(
        log=log,
        algorithm=algorithm,
        result=result,
        statistics=_stats() if statistics is None else statistics,
    )


def _failed_row(log="log-a", algorithm="broken") -> BenchmarkRow:
    result = BenchmarkResult(name=algorithm, repeats=1, error="ValueError: boom")
    return BenchmarkRow(log=log, algorithm=algorithm, result=result, statistics=_stats())


def _line_colors(figure) -> dict[str, str]:
    """The colour of each line, by label. Lines without a label are the log markers."""
    return {
        line.get_label(): line.get_color()
        for line in figure.axes[0].get_lines()
        if not line.get_label().startswith("_")
    }


# ---------------------------------------------------------------------------
# series_for
# ---------------------------------------------------------------------------

def test_series_groups_points_by_algorithm():
    rows = [
        _row(log="a", algorithm="one", statistics=_stats(num_events=10)),
        _row(log="b", algorithm="one", statistics=_stats(num_events=20)),
        _row(log="a", algorithm="two", statistics=_stats(num_events=10)),
    ]
    series = series_for(rows, "num_events")
    assert set(series) == {"one", "two"}
    assert len(series["one"]) == 2


def test_series_sorts_by_the_plotted_metric_not_by_row_order():
    """
    Logs are listed in event-count order, so any other metric can put them out of
    order. Unsorted points would draw a zigzag.
    """
    rows = [
        _row(log="big-log", statistics=_stats(num_events=100, num_e2o_relations=500)),
        _row(log="small-log", statistics=_stats(num_events=200, num_e2o_relations=50)),
    ]
    xs = [x for x, _, _ in series_for(rows, "num_e2o_relations")["works"]]
    assert xs == [50, 500]


def test_series_keeps_the_log_name_with_each_point():
    """The marker shape says which log a point came from, so the name must travel."""
    rows = [_row(log="log-a"), _row(log="log-b", statistics=_stats(num_events=200))]
    points = series_for(rows, "num_events")["works"]
    assert [log for _, _, log in points] == ["log-a", "log-b"]


# ---------------------------------------------------------------------------
# markers_for_logs
# ---------------------------------------------------------------------------

def test_each_log_gets_its_own_marker():
    markers = markers_for_logs([_row(log="a"), _row(log="b"), _row(log="c")])
    shapes = [markers["a"], markers["b"], markers["c"]]
    assert len(set(shapes)) == 3


def test_a_manifest_log_keeps_its_marker_when_others_are_missing():
    """
    Same rule as the colours: a log's shape must not change just because a run
    covered fewer logs, or two figures would disagree.
    """
    first, second = LOGS[0].name, LOGS[1].name
    full = markers_for_logs([_row(log=first), _row(log=second)])
    partial = markers_for_logs([_row(log=second)])
    assert partial[second] == full[second]


def test_series_drops_a_failed_measurement():
    """A failed algorithm has no runtime; plotting it as zero would be a lie."""
    series = series_for([_row(), _failed_row()], "num_events")
    assert "broken" not in series
    assert "works" in series


def test_series_drops_rows_without_statistics():
    row = BenchmarkRow(
        log="a",
        algorithm="works",
        result=BenchmarkResult(name="works", repeats=1, elapsed_s=1.0, peak_mb=1.0),
        statistics=None,
    )
    assert series_for([row], "num_events") == {}


# ---------------------------------------------------------------------------
# colors_for_algorithms
# ---------------------------------------------------------------------------

def test_an_algorithm_keeps_its_colour_when_others_are_missing():
    """
    The colour belongs to the algorithm, not to its rank in the run. Leaving any one
    algorithm out must not repaint the others.
    """
    full = colors_for_algorithms(COLORED)
    for missing in COLORED:
        partial = colors_for_algorithms(name for name in COLORED if name != missing)
        for name, color in partial.items():
            assert color == full[name], f"{name} changed colour without {missing}"


def test_every_algorithm_gets_its_own_colour():
    """
    Two lines in one colour cannot be told apart. The palette has one colour per
    algorithm, so this fails when an algorithm is added without a colour of its own.
    """
    colors = colors_for_algorithms(COLORED)
    assert len(set(colors.values())) == len(COLORED)


def test_colours_come_in_the_order_of_the_algorithms():
    """The legend lists the algorithms in the same order as the results table."""
    assert list(colors_for_algorithms(reversed(COLORED))) == COLORED


def test_an_unknown_algorithm_does_not_move_the_known_ones():
    """A name from an old results file goes last, and the others keep their colour."""
    full = colors_for_algorithms(COLORED)
    colors = colors_for_algorithms([*COLORED, "old-name"])
    assert list(colors)[-1] == "old-name"
    assert all(colors[name] == full[name] for name in COLORED)


def test_an_unknown_algorithm_takes_a_colour_no_other_line_uses():
    """Sharing a colour with a known algorithm would make the two look like one."""
    present = COLORED[1:]
    colors = colors_for_algorithms([*present, "old-name"])
    assert colors["old-name"] not in [colors[name] for name in present]


# ---------------------------------------------------------------------------
# plot_metric
# ---------------------------------------------------------------------------

def test_plot_metric_writes_a_png(tmp_path):
    path = plot_metric([_row()], "num_events", tmp_path / "f.png")
    assert path.exists()
    assert path.read_bytes()[:4] == PNG_MAGIC


def test_plot_metric_rejects_an_unknown_metric(tmp_path):
    with pytest.raises(ValueError, match="unknown metric"):
        plot_metric([_row()], "num_bananas", tmp_path / "f.png")


def test_plot_metric_still_writes_when_everything_failed(tmp_path):
    """An empty chart is better than a crash part way through a long run."""
    path = plot_metric([_failed_row()], "num_events", tmp_path / "f.png")
    assert path.read_bytes()[:4] == PNG_MAGIC


def test_plot_metric_creates_a_missing_directory(tmp_path):
    path = plot_metric([_row()], "num_events", tmp_path / "deep" / "dir" / "f.png")
    assert path.exists()


def test_a_missing_algorithm_does_not_repaint_the_figure(monkeypatch, tmp_path):
    """
    The committed example run leaves out find_variants. Its figures must still draw
    every other algorithm in the colour a full run gives it.
    """
    figures = []
    real_close = plt.close

    def keep_and_close(figure):
        figures.append(figure)
        real_close(figure)

    monkeypatch.setattr(plt, "close", keep_and_close)

    full_run = [_row(algorithm=name) for name in ALGORITHM_NAMES]
    committed_run = [row for row in full_run if row.algorithm != "find_variants"]
    plot_metric(full_run, "num_events", tmp_path / "full.png")
    plot_metric(committed_run, "num_events", tmp_path / "committed.png")

    full, committed = (_line_colors(figure) for figure in figures)
    assert "find_variants" in full and "find_variants" not in committed
    assert committed == {name: full[name] for name in committed}


# ---------------------------------------------------------------------------
# plot_all
# ---------------------------------------------------------------------------

def test_plot_all_writes_one_figure_per_metric(tmp_path):
    written = plot_all([_row()], tmp_path)
    assert len(written) == len(SIZE_METRICS)
    assert all(path.read_bytes()[:4] == PNG_MAGIC for path in written)


def test_plot_all_names_files_after_the_metric(tmp_path):
    names = {path.name for path in plot_all([_row()], tmp_path)}
    assert f"{FILE_PREFIX}num_events.png" in names
    assert f"{FILE_PREFIX}num_e2o_relations.png" in names


def test_plot_all_can_draw_a_subset(tmp_path):
    written = plot_all([_row()], tmp_path, metrics={"num_events": "Number of events"})
    assert [path.name for path in written] == [f"{FILE_PREFIX}num_events.png"]


def test_plot_all_overwrites_rather_than_accumulating(tmp_path):
    plot_all([_row()], tmp_path)
    plot_all([_row()], tmp_path)
    assert len(list(tmp_path.glob("*.png"))) == len(SIZE_METRICS)


# ---------------------------------------------------------------------------
# rows_from_csv
# ---------------------------------------------------------------------------

def test_rows_from_csv_round_trips_a_written_file(tmp_path):
    path = write_csv([_row(), _failed_row()], tmp_path / "r.csv")
    rows = rows_from_csv(path)
    assert len(rows) == 2
    by_algorithm = {row.algorithm: row for row in rows}
    assert by_algorithm["works"].result.elapsed_s == 1.5
    assert by_algorithm["works"].statistics.num_events == 100


def test_rows_from_csv_gives_back_none_for_a_failed_row(tmp_path):
    """An empty CSV cell must come back as None, not as an empty string or zero."""
    path = write_csv([_failed_row()], tmp_path / "r.csv")
    row = rows_from_csv(path)[0]
    assert row.result.elapsed_s is None
    assert row.result.error == "ValueError: boom"
    assert not row.ok


def test_rows_from_csv_handles_a_row_without_statistics(tmp_path):
    row = BenchmarkRow(
        log="a",
        algorithm="works",
        result=BenchmarkResult(name="works", repeats=1, elapsed_s=1.0, peak_mb=1.0),
        statistics=None,
    )
    loaded = rows_from_csv(write_csv([row], tmp_path / "r.csv"))[0]
    assert loaded.statistics is None


def test_rows_from_csv_reads_numbers_not_strings(tmp_path):
    path = write_csv([_row()], tmp_path / "r.csv")
    with open(path, newline="", encoding="utf-8") as handle:
        raw = next(csv.DictReader(handle))
    assert isinstance(raw["elapsed_s"], str)          # what the file holds
    assert isinstance(rows_from_csv(path)[0].result.elapsed_s, float)  # what we return
