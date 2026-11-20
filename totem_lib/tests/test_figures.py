"""
Contract for the evaluation figures (evaluation/figures.py).

Rows are built by hand. The fitting maths is checked exactly; the drawing functions are
checked for writing a file and for coping with gaps (failed or missing measurements),
since a long run always has some.
"""

import csv

import pytest

from evaluation.datasets import SIZE_METRICS, LogStatistics
from evaluation.figures import (
    MIN_RANGE_FACTOR,
    draw_all,
    duckdb_pairs,
    output_folder,
    fit_power_law,
    plot_grid,
    plot_pipeline,
    plot_polars_vs_duckdb,
    plot_scaling_heatmap,
    scaling_table,
    write_scaling,
)
from evaluation.harness import BenchmarkResult, Measurement
from evaluation.runs import BenchmarkRow

# Four logs whose sizes grow by 10x each, with every metric varying.
SIZES = {"tiny": 1_000, "small": 10_000, "medium": 100_000, "large": 1_000_000}


def _stats(events: int) -> LogStatistics:
    return LogStatistics(
        num_events=events, num_objects=events // 2, num_unique_activities=max(events // 1000, 2),
        num_object_types=max(events // 10_000, 2), num_e2o_relations=events * 3,
        num_o2o_relations=events, earliest_timestamp=0, newest_timestamp=86_400,
    )


def _row(log, algorithm, seconds, memory=100.0, error=None) -> BenchmarkRow:
    if error:
        result = BenchmarkResult.failed(algorithm, 2, error)
    else:
        result = BenchmarkResult.from_measurements(
            algorithm, [Measurement(seconds * 0.95), Measurement(seconds * 1.05)],
            input_rss_mb=memory / 2, peak_rss_mb=memory,
        )
    return BenchmarkRow(log, algorithm, result, _stats(SIZES[log]))


def _grid(error_on=()) -> list[BenchmarkRow]:
    """A full grid where each algorithm scales as a known power of the event count."""
    exponents = {
        "import_ocel": 1.0, "import_ocel_db": 1.0,
        "totemDiscovery": 1.0, "totemDiscovery_db": 0.8,
        "mlpaDiscovery": 0.1, "discover_occn": 2.0,
    }
    rows = []
    for log, events in SIZES.items():
        for algorithm, b in exponents.items():
            seconds = 1e-4 * events ** b
            error = "Timeout" if (log, algorithm) in error_on else None
            rows.append(_row(log, algorithm, seconds, memory=events / 100, error=error))
    return rows


# ---------------------------------------------------------------------------
# Fitting
# ---------------------------------------------------------------------------

def test_a_power_law_is_recovered_exactly():
    xs = [10, 100, 1000, 10000]
    fit = fit_power_law(xs, [2 * x ** 1.5 for x in xs])
    assert fit.slope == pytest.approx(1.5)
    assert 10 ** fit.intercept == pytest.approx(2)
    assert fit.r2 == pytest.approx(1.0)
    assert fit.n == 4
    assert fit.predict([100])[0] == pytest.approx(2000)


def test_too_few_logs_give_no_fit():
    assert fit_power_law([10, 100], [1, 2]) is None


def test_a_metric_that_barely_varies_gives_no_fit():
    """Object types are 6 or 7 in the small logs: no basis for a slope."""
    assert fit_power_law([6, 7, 7], [1.0, 5.0, 2.0]) is None
    assert fit_power_law([1, 1.5, MIN_RANGE_FACTOR], [1, 2, 3]) is not None


def test_zero_and_missing_values_are_left_out_of_a_fit():
    assert fit_power_law([0, 10, 100, 1000], [1, 1, 10, 100]).n == 3


def test_scaling_table_has_one_entry_per_algorithm_and_fittable_metric():
    table = scaling_table(_grid())
    by_key = {(e["algorithm"], e["metric"]): e for e in table}
    assert by_key[("discover_occn", "num_events")]["exponent"] == pytest.approx(2.0)
    assert by_key[("totemDiscovery_db", "num_events")]["exponent"] == pytest.approx(0.8)
    assert all(e["logs"] == 4 for e in table)


def test_a_failed_measurement_is_not_fitted():
    table = scaling_table(_grid(error_on={("large", "discover_occn")}))
    entry = next(e for e in table if e["algorithm"] == "discover_occn" and e["metric"] == "num_events")
    assert entry["logs"] == 3


def test_the_scaling_table_is_written_for_tools_and_people(tmp_path):
    written = write_scaling(scaling_table(_grid()), tmp_path)
    assert {p.name for p in written} == {"scaling_exponents.csv", "scaling_exponents.md"}
    rows = list(csv.DictReader(open(tmp_path / "scaling_exponents.csv")))
    assert rows and set(rows[0]) == {"algorithm", "metric", "exponent", "r2", "logs"}
    assert "| discover_occn |" in (tmp_path / "scaling_exponents.md").read_text()


# ---------------------------------------------------------------------------
# Pairs
# ---------------------------------------------------------------------------

def test_duckdb_pairs_match_x_with_x_db_but_not_the_loaders():
    names = {"import_ocel", "import_ocel_db", "totemDiscovery", "totemDiscovery_db",
             "discover_ocpn_db", "OCDFG.from_ocel"}
    assert duckdb_pairs(names) == [("totemDiscovery", "totemDiscovery_db")]


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("metric", list(SIZE_METRICS))
def test_the_grid_draws_for_every_metric(tmp_path, metric):
    path = plot_grid(_grid(), metric, tmp_path / f"{metric}.png")
    assert path.exists() and path.stat().st_size > 0


def test_the_grid_copes_with_nothing_to_draw(tmp_path):
    rows = [_row("tiny", "totemDiscovery", 1.0, error="boom")]
    assert plot_grid(rows, "num_events", tmp_path / "g.png").exists()


def test_the_grid_rejects_an_unknown_metric(tmp_path):
    with pytest.raises(ValueError):
        plot_grid(_grid(), "colour", tmp_path / "g.png")


def test_the_heatmap_draws_with_and_without_data(tmp_path):
    assert plot_scaling_heatmap(scaling_table(_grid()), tmp_path / "h.png").exists()
    assert plot_scaling_heatmap([], tmp_path / "empty.png").exists()


def test_the_speedup_chart_draws_and_survives_a_missing_twin(tmp_path):
    assert plot_polars_vs_duckdb(_grid(), tmp_path / "p.png").exists()
    without_db = [r for r in _grid() if not r.algorithm.endswith("_db")]
    assert plot_polars_vs_duckdb(without_db, tmp_path / "none.png").exists()


def test_the_pipeline_chart_skips_a_bar_whose_prerequisite_failed(tmp_path):
    rows = _grid(error_on={("small", "totemDiscovery")})  # MLPA needs it
    assert plot_pipeline(rows, tmp_path / "pipe.png").exists()


def test_draw_all_writes_every_figure_and_the_tables(tmp_path):
    written = draw_all(_grid(), tmp_path / "figures", tmp_path)
    names = {p.relative_to(tmp_path).as_posix() for p in written}
    metrics = len(SIZE_METRICS)
    assert sum(n.startswith("figures/runtime_vs_") for n in names) == metrics
    assert sum(n.startswith("figures/memory/") for n in names) == metrics
    assert sum(n.startswith("figures/grid/") for n in names) == metrics
    assert {"figures/scaling_exponents.png", "figures/polars_vs_duckdb.png",
            "figures/pipeline_cost.png", "scaling_exponents.csv",
            "scaling_exponents.md"} <= names
    assert all(p.exists() for p in written)


def test_draw_all_leaves_out_memory_when_nothing_measured_it(tmp_path):
    rows = [
        BenchmarkRow(r.log, r.algorithm,
                     BenchmarkResult(name=r.algorithm, repeats=2, elapsed_s=r.result.elapsed_s),
                     r.statistics)
        for r in _grid()
    ]
    written = draw_all(rows, tmp_path)
    assert not any("memory" in p.as_posix() for p in written)


def test_a_log_at_zero_does_not_break_a_log_axis(tmp_path):
    """Enron, Bundestag and the LRM log have no object-to-object relations."""
    from dataclasses import replace

    rows = [
        BenchmarkRow(r.log, r.algorithm, r.result,
                     replace(r.statistics, num_o2o_relations=0) if r.log == "tiny" else r.statistics)
        for r in _grid()
    ]
    assert plot_grid(rows, "num_o2o_relations", tmp_path / "zero.png").exists()
    assert draw_all(rows, tmp_path / "figures")


# ---------------------------------------------------------------------------
# Where the figures go
# ---------------------------------------------------------------------------

def test_figures_go_into_a_run_folder_given_alone_and_combined_otherwise(tmp_path):
    from types import SimpleNamespace

    batch = tmp_path / "batch"
    one = SimpleNamespace(path=batch / "enron")
    two = SimpleNamespace(path=batch / "bundestag")
    (batch / "enron").mkdir(parents=True)
    assert output_folder([batch / "enron"], [one]) == batch / "enron"
    # A batch with one log done so far still goes to combined/, like the full batch will.
    assert output_folder([batch], [one]) == batch / "combined"
    assert output_folder([batch], [one, two]) == batch / "combined"
    assert output_folder([batch], [one], tmp_path / "elsewhere") == tmp_path / "elsewhere"
