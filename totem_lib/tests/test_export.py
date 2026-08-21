"""
Contract for the results export (evaluation/export.py).

Rows are built by hand so the tests stay fast and do not run any algorithm. Most of
these guard a specific way the output could be quietly wrong: a missing column, a
broken table, or mangled characters.
"""

import csv
import json

from evaluation.datasets import LogStatistics
from evaluation.export import (
    CSV_FIELDS,
    FORMATS,
    export,
    write_csv,
    write_json,
    write_markdown,
)
from evaluation.harness import BenchmarkResult
from evaluation.run_benchmarks import BenchmarkRow

import pytest

STATS = LogStatistics(
    num_events=100,
    num_objects=50,
    num_unique_activities=5,
    num_object_types=3,
    num_e2o_relations=200,
    num_o2o_relations=80,
    earliest_timestamp=1_600_000_000,
    newest_timestamp=1_600_086_400,
)


def _ok_row(log="fake-log", algorithm="works", statistics=STATS) -> BenchmarkRow:
    result = BenchmarkResult(name=algorithm, repeats=1, elapsed_s=1.5, peak_mb=2.5)
    return BenchmarkRow(log=log, algorithm=algorithm, result=result, statistics=statistics)


def _failed_row(error="ValueError: boom", log="fake-log") -> BenchmarkRow:
    result = BenchmarkResult(name="broken", repeats=1, error=error)
    return BenchmarkRow(log=log, algorithm="broken", result=result, statistics=STATS)


def _read_csv(path):
    with open(path, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------

def test_csv_has_one_line_per_row(tmp_path):
    path = write_csv([_ok_row(), _ok_row()], tmp_path / "r.csv")
    assert len(_read_csv(path)) == 2


def test_csv_columns_are_the_fixed_field_list(tmp_path):
    path = write_csv([_ok_row()], tmp_path / "r.csv")
    with open(path, newline="", encoding="utf-8") as handle:
        assert next(csv.reader(handle)) == list(CSV_FIELDS)


def test_csv_keeps_every_column_when_some_rows_have_no_statistics(tmp_path):
    """
    A row without statistics exports 9 fewer keys. Columns must come from the fixed
    list, or those rows would shift or drop values.
    """
    path = write_csv([_ok_row(), _ok_row(statistics=None)], tmp_path / "r.csv")
    rows = _read_csv(path)
    assert rows[0]["num_events"] == "100"
    assert rows[1]["num_events"] == ""
    assert set(rows[1]) == set(CSV_FIELDS)


def test_csv_writes_a_failed_row_with_its_error_and_no_timings(tmp_path):
    path = write_csv([_failed_row()], tmp_path / "r.csv")
    row = _read_csv(path)[0]
    assert row["error"] == "ValueError: boom"
    assert row["elapsed_s"] == ""
    assert row["peak_mb"] == ""


# ---------------------------------------------------------------------------
# JSON
# ---------------------------------------------------------------------------

def test_json_round_trips(tmp_path):
    path = write_json([_ok_row(), _failed_row()], tmp_path / "r.json", repeats=3)
    document = json.loads(path.read_text(encoding="utf-8"))
    assert len(document["results"]) == 2
    assert document["repeats"] == 3
    assert document["generated_at"]


def test_json_lists_each_log_once(tmp_path):
    rows = [_ok_row(log="a"), _ok_row(log="a"), _ok_row(log="b")]
    path = write_json(rows, tmp_path / "r.json")
    document = json.loads(path.read_text(encoding="utf-8"))
    assert [entry["name"] for entry in document["logs"]] == ["a", "b"]


# ---------------------------------------------------------------------------
# Markdown
# ---------------------------------------------------------------------------

def test_markdown_has_both_tables(tmp_path):
    text = write_markdown([_ok_row()], tmp_path / "r.md").read_text(encoding="utf-8")
    assert "## Logs" in text
    assert "## Results" in text


def test_markdown_has_a_line_per_result(tmp_path):
    rows = [_ok_row(algorithm="one"), _ok_row(algorithm="two")]
    text = write_markdown(rows, tmp_path / "r.md").read_text(encoding="utf-8")
    assert "| one |" in text
    assert "| two |" in text


def test_markdown_lists_a_log_once_even_with_many_results(tmp_path):
    rows = [_ok_row(algorithm="one"), _ok_row(algorithm="two")]
    text = write_markdown(rows, tmp_path / "r.md").read_text(encoding="utf-8")
    # One row in the Logs table, plus two in the Results table.
    assert text.count("| fake-log |") == 3


def test_an_error_containing_a_pipe_does_not_break_the_table(tmp_path):
    """Error text is free-form, so a pipe in it must not add table columns."""
    rows = [_failed_row(error="IOError: cannot open a|b")]
    text = write_markdown(rows, tmp_path / "r.md").read_text(encoding="utf-8")
    result_lines = [
        line for line in text.splitlines()
        if line.startswith("| fake-log |") and "broken" in line
    ]
    assert len(result_lines) == 1
    assert result_lines[0].count("|") == 6  # 5 columns -> 6 pipes


def test_markdown_reports_failures_separately(tmp_path):
    text = write_markdown([_failed_row()], tmp_path / "r.md").read_text(encoding="utf-8")
    assert "## Failures" in text
    assert "ValueError: boom" in text


def test_markdown_has_no_failures_section_when_everything_worked(tmp_path):
    text = write_markdown([_ok_row()], tmp_path / "r.md").read_text(encoding="utf-8")
    assert "## Failures" not in text


def test_non_ascii_survives_the_round_trip(tmp_path):
    """The default Windows codepage would mangle this."""
    rows = [_failed_row(error="ValueError: bad value \u2014 f\u00fcr Gr\u00f6\u00dfe")]
    text = write_markdown(rows, tmp_path / "r.md").read_text(encoding="utf-8")
    assert "f\u00fcr Gr\u00f6\u00dfe" in text


# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------

def test_export_writes_every_format_and_creates_the_directory(tmp_path):
    out_dir = tmp_path / "nested" / "results"
    written = export([_ok_row()], out_dir)
    assert len(written) == len(FORMATS)
    assert all(path.exists() for path in written)


def test_export_can_write_a_subset(tmp_path):
    written = export([_ok_row()], tmp_path, formats=("csv",))
    assert [path.suffix for path in written] == [".csv"]


def test_export_rejects_an_unknown_format(tmp_path):
    with pytest.raises(ValueError, match="unknown format"):
        export([_ok_row()], tmp_path, formats=("xlsx",))


def test_export_overwrites_rather_than_appending(tmp_path):
    first = export([_ok_row()], tmp_path)[0].read_text(encoding="utf-8")
    second = export([_ok_row()], tmp_path)[0].read_text(encoding="utf-8")
    assert first.count("\n") == second.count("\n")


def test_export_handles_an_empty_run(tmp_path):
    """A fully filtered run writes headers and no rows, rather than crashing."""
    written = export([], tmp_path)
    assert all(path.exists() for path in written)
