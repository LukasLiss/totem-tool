"""
Contract for the chapter figures (evaluation/figures.py) and their style (style.py).

Rows are built by hand, with the properties and artifacts a real run would save. The
fits are checked exactly; the drawing is checked for writing every chapter's files and
for coping with gaps (failed measurements, chapters not measured), since a long run
always has some.
"""

import csv
import json
from dataclasses import replace

import pytest

from evaluation.algorithms import CHAPTERS, DEFAULT_TAU, OCCN_THRESHOLD_SWEEP, TAU_SWEEP
from evaluation.datasets import LogStatistics
from evaluation.figures import (
    MIN_RANGE_FACTOR,
    draw_all,
    duckdb_pairs,
    fit_linear,
    fit_power_law,
    output_folder,
    to_points,
    write_table,
)
from evaluation.harness import BenchmarkResult, Measurement
from evaluation.runs import BenchmarkRow
from evaluation.style import LOG_STYLES, legend_order, log_style

SIZES = {"ocel2-p2p": 1_000, "order-management": 10_000, "container_logistics": 100_000,
         "age-of-empires": 1_000_000}


def _stats(events: int) -> LogStatistics:
    return LogStatistics(
        num_events=events, num_objects=events // 2, num_unique_activities=10,
        num_object_types=max(events // 10_000, 2), num_e2o_relations=events * 3,
        num_o2o_relations=events, earliest_timestamp=0, newest_timestamp=86_400,
    )


def _row(log, algorithm, seconds, *, family=None, params=None, properties=None,
         artifact=None, error=None) -> BenchmarkRow:
    if error:
        result = BenchmarkResult.failed(algorithm, 2, error)
    else:
        result = BenchmarkResult.from_measurements(
            algorithm, [Measurement(seconds * 0.95), Measurement(seconds * 1.05)],
            input_rss_mb=50.0, peak_rss_mb=100.0)
    props = {"params": params or {}, "family": family or algorithm, **(properties or {})}
    result = replace(result, properties=props, artifact=artifact)
    return BenchmarkRow(log, algorithm, result, _stats(SIZES[log]))


def _run(tmp_path, *, fail=()) -> list[BenchmarkRow]:
    """A run of every chapter on every log, with artifacts for the OCCN replay."""
    rows = []
    for log, events in SIZES.items():
        def add(algorithm, seconds, **kwargs):
            error = "Timeout" if (log, algorithm) in fail else None
            rows.append(_row(log, algorithm, seconds, error=error, **kwargs))

        for name in ("import_ocel", "import_ocel_db", "totemDiscovery", "discover_occn",
                     "OCDFG.from_ocel", "OCDFG.from_ocel_db", "mlpaDiscovery"):
            add(name, 1e-4 * events)
        for tau in TAU_SWEEP:
            name = "totemDiscovery_db" if tau == DEFAULT_TAU else f"totemDiscovery_db@tau={tau:g}"
            add(name, 1e-5 * events, family="totemDiscovery_db", params={"tau": tau},
                properties={"totem_nodes": 5, "totem_arcs": 7})
            add(f"totem_conformance@tau={tau:g}", 2e-5 * events, family="totem_conformance",
                params={"tau": tau},
                properties={"totem_arcs": 7, "temporal_fitness": tau,
                            "temporal_precision": 1 - tau, "log_cardinality_fitness": tau,
                            "log_cardinality_precision": 1, "event_cardinality_fitness": tau,
                            "event_cardinality_precision": 1})
        add("discover_occn_db", 1e-3 * events,
            properties={"occn_activities": 10, "occn_arcs": 20, "occn_markers": 50})
        add("discover_occn_main", 1e-4 * events,
            properties={"occn_activities": 5, "occn_markers": 20,
                        "occn_object_type_names": ["Container", "Handling Unit"]})
        for threshold in OCCN_THRESHOLD_SWEEP:
            artifact = tmp_path / "artifacts" / log / f"occn_fitness@threshold={threshold:g}.json"
            artifact.parent.mkdir(parents=True, exist_ok=True)
            artifact.write_text(json.dumps({"executions": [
                {"unit_id": f"u{i}", "events": 5 + i, "objects": 2 + i, "object_types": 2,
                 "seconds": 0.001 * (i + 1), "status": "fitting", "explored_states": 10}
                for i in range(5)]}))
            add(f"occn_fitness@threshold={threshold:g}", 1e-4 * events, family="occn_fitness",
                params={"threshold": threshold}, artifact=str(artifact),
                properties={"executions": 5, "fitting_executions": 4,
                            "non_fitting_executions": 1, "fitness": 0.8})
        add("process_areas", 1e-5 * events, params={"tau": DEFAULT_TAU},
            properties={"levels": 3, "areas": 4, "avg_types_per_area": 1.5,
                        "avg_activities_per_area": 2.75, "totem_share": 0.99})
    return rows


# ---------------------------------------------------------------------------
# Style
# ---------------------------------------------------------------------------

def test_the_conformance_papers_logs_keep_their_exact_look():
    p2p = log_style("ocel2-p2p")
    assert (p2p.label, p2p.color, p2p.marker) == ("P2P", "#e377c2", "*")
    assert log_style("enron").color == "#d62728"
    assert log_style("age-of-empires").marker == "o"


def test_no_two_logs_look_alike():
    styles = list(LOG_STYLES.values())
    assert len({s.color for s in styles}) == len(styles)
    assert len({s.marker for s in styles}) == len(styles)
    assert len({s.label for s in styles}) == len(styles)


def test_every_log_in_the_manifest_has_a_style():
    from evaluation.datasets import LOGS
    assert {log.name for log in LOGS} <= set(LOG_STYLES)


def test_an_unknown_log_is_drawn_under_its_own_name():
    assert log_style("brand-new").label == "brand-new"


def test_legends_list_logs_by_their_short_name():
    assert legend_order(["ocel2-p2p", "age-of-empires", "bundestag"]) == \
        ["age-of-empires", "bundestag", "ocel2-p2p"]


# ---------------------------------------------------------------------------
# Fitting
# ---------------------------------------------------------------------------

def test_a_power_law_is_recovered_exactly():
    xs = [10, 100, 1000, 10000]
    fit = fit_power_law(xs, [2 * x ** 1.5 for x in xs])
    assert fit.slope == pytest.approx(1.5)
    assert 10 ** fit.intercept == pytest.approx(2)
    assert fit.r2 == pytest.approx(1.0)
    assert fit.predict([100])[0] == pytest.approx(2000)


def test_too_few_or_too_close_points_give_no_fit():
    assert fit_power_law([10, 100], [1, 2]) is None
    assert fit_power_law([6, 7, 7], [1.0, 5.0, 2.0]) is None
    assert fit_power_law([1, 1.5, MIN_RANGE_FACTOR], [1, 2, 3]) is not None


def test_a_linear_fit_reports_pearsons_r():
    fit = fit_linear([1, 2, 3, 4], [3, 5, 7, 9])
    assert (fit.slope, fit.intercept) == pytest.approx((2, 1))
    assert fit.r == pytest.approx(1.0)
    assert fit_linear([1, 1, 1], [1, 2, 3]) is None


# ---------------------------------------------------------------------------
# Points
# ---------------------------------------------------------------------------

def test_points_carry_parameters_properties_and_log_size(tmp_path):
    points = to_points(_run(tmp_path))
    point = next(p for p in points if p.algorithm == "totem_conformance@tau=0.3")
    assert point.params == {"tau": 0.3}
    assert point.family == "totem_conformance"
    assert point.get("tau") == 0.3
    assert point.get("temporal_fitness") == 0.3
    assert point.get("events") == SIZES[point.log]


def test_a_failed_measurement_gets_its_parameters_from_the_registry():
    row = BenchmarkRow("ocel2-p2p", "totem_conformance@tau=0.3",
                       BenchmarkResult.failed("totem_conformance@tau=0.3", 2, "Timeout"),
                       _stats(1000))
    [point] = to_points([row])
    assert point.params == {"tau": 0.3} and point.family == "totem_conformance"
    assert not point.ok


def test_duckdb_pairs_match_x_with_x_db_but_not_the_loaders():
    names = {"import_ocel", "import_ocel_db", "totemDiscovery", "totemDiscovery_db",
             "discover_occn", "discover_occn_db", "OCDFG.from_ocel", "OCDFG.from_ocel_db",
             "discover_ocpn_db"}
    assert duckdb_pairs(names) == [("OCDFG.from_ocel", "OCDFG.from_ocel_db"),
                                   ("discover_occn", "discover_occn_db"),
                                   ("totemDiscovery", "totemDiscovery_db")]


# ---------------------------------------------------------------------------
# Drawing
# ---------------------------------------------------------------------------

def test_every_chapter_gets_its_folder_figures_and_tables(tmp_path):
    written = draw_all(_run(tmp_path), tmp_path / "figures")
    names = {p.relative_to(tmp_path / "figures").as_posix() for p in written}
    assert {name.split("/")[0] for name in names} == set(CHAPTERS)
    expected = {
        "totem-discovery/runtime.pdf", "totem-discovery/over_tau.pdf",
        "totem-discovery/discovery.tex",
        "totem-conformance/conformance_time.pdf", "totem-conformance/metrics_over_tau.pdf",
        "occn-discovery/runtime.pdf", "occn-discovery/runtime_log.png",
        "occn-conformance/execution_time.pdf", "occn-conformance/fitness_over_threshold.pdf",
        "occn-conformance/conformance.csv", "occn-conformance/main_object_types.md",
        "process-area/runtime.pdf", "process-area/areas.md",
        "totem-tool/runtime_by_algorithm_events.pdf", "totem-tool/polars_vs_duckdb.pdf",
        "totem-tool/memory_by_algorithm.png", "totem-tool/all_algorithms.csv",
    }
    assert expected <= names
    assert all(p.exists() and p.stat().st_size > 0 for p in written)


def test_the_process_area_table_has_the_papers_columns(tmp_path):
    draw_all(_run(tmp_path), tmp_path / "figures")
    rows = list(csv.DictReader(open(tmp_path / "figures/process-area/areas.csv")))
    assert {"levels", "areas", "avg_types_per_area", "avg_activities_per_area"} <= set(rows[0])
    assert [r["log"] for r in rows] == ["P2P", "OrderMgmt", "ContLog", "AoE"]  # by events


def test_the_main_object_types_of_each_log_are_listed(tmp_path):
    draw_all(_run(tmp_path), tmp_path / "figures")
    rows = list(csv.DictReader(open(tmp_path / "figures/occn-conformance/main_object_types.csv")))
    assert rows[0]["main_types"] == "Container, Handling Unit"


def test_failures_leave_gaps_not_errors(tmp_path):
    rows = _run(tmp_path, fail={("age-of-empires", "discover_occn_db"),
                                ("ocel2-p2p", "occn_fitness@threshold=0.1")})
    written = draw_all(rows, tmp_path / "figures")
    assert "Timeout" in (tmp_path / "figures/occn-discovery/discovery.md").read_text()
    assert any(p.name == "execution_time.pdf" for p in written)


def test_a_chapter_without_measurements_is_left_out(tmp_path):
    rows = [r for r in _run(tmp_path) if r.algorithm == "process_areas"]
    written = draw_all(rows, tmp_path / "figures")
    assert {p.parent.name for p in written} == {"process-area"}


def test_tables_are_written_for_latex_too(tmp_path):
    written = write_table([{"log": "P2P", "seconds": 0.5, "n": 12_345}], tmp_path, "t",
                          [("log", "Log"), ("seconds", "Time (s)"), ("n", "Events_total")])
    tex = (tmp_path / "t.tex").read_text()
    assert "\\toprule" in tex and "12{,}345" in tex and "Events\\_total" in tex
    assert {p.suffix for p in written} == {".csv", ".md", ".tex"}


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
