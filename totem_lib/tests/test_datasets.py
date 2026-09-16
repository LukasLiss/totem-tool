"""
Contract for the evaluation log manifest (evaluation/datasets.py).

Most of these are invariants over the manifest itself and need no data on disk. The one
test that imports real logs skips whatever has not been downloaded, so the suite stays
green on a machine with only the bundled logs.
"""

from pathlib import Path

import pytest

from evaluation.datasets import (
    LARGE,
    LOGS,
    SIZE_METRICS,
    SMALL,
    STATISTIC_FIELDS,
    SUPPORTED_FORMATS,
    EvaluationLog,
    LogStatistics,
    available_logs,
    downloadable_logs,
    get_log,
    import_args,
)


def _statistics(**overrides) -> LogStatistics:
    """A LogStatistics with plausible values, for tests that need one."""
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


# ---------------------------------------------------------------------------
# Manifest shape
# ---------------------------------------------------------------------------

def test_manifest_is_not_empty():
    assert len(LOGS) >= 3  # the acceptance criterion asks for at least 3 real logs


def test_log_names_are_unique_and_non_empty():
    names = [log.name for log in LOGS]
    assert all(names)
    assert len(names) == len(set(names))


def test_every_log_records_a_source_link():
    """'Written down (name + source link)' is an acceptance criterion, so enforce it."""
    for log in LOGS:
        assert log.source_url.startswith("https://"), log.name


def test_every_log_path_is_absolute_and_in_a_known_location():
    for log in LOGS:
        assert log.path.is_absolute(), log.name
        expected = SMALL if log.bundled else LARGE
        assert log.path.parent == expected, log.name


def test_recorded_statistics_are_positive():
    for log in LOGS:
        if log.statistics is None:
            continue
        for field in STATISTIC_FIELDS:
            assert getattr(log.statistics, field) > 0, f"{log.name}.{field}"


def test_logs_are_sorted_by_event_count_with_unmeasured_last():
    keys = [(log.event_count is None, log.event_count or 0) for log in LOGS]
    assert keys == sorted(keys)


# ---------------------------------------------------------------------------
# LogStatistics
# ---------------------------------------------------------------------------

def test_event_count_is_a_shortcut_for_the_statistic():
    log = EvaluationLog(name="x", source_url="https://e.org", path=Path("x.json"),
                        statistics=_statistics(num_events=42))
    assert log.event_count == 42


def test_event_count_is_none_when_nothing_is_recorded():
    log = EvaluationLog(name="x", source_url="https://e.org", path=Path("x.json"))
    assert log.event_count is None


def test_duration_is_the_span_between_first_and_last_event():
    stats = _statistics(earliest_timestamp=1_000, newest_timestamp=87_400)
    assert stats.duration_seconds == 86_400


def test_as_dict_exposes_every_field_plus_the_duration():
    values = _statistics().as_dict()
    assert set(values) == set(STATISTIC_FIELDS) | {"duration_seconds"}


def test_statistic_fields_match_the_dataclass():
    """STATISTIC_FIELDS is written by hand, so keep it honest."""
    assert STATISTIC_FIELDS == tuple(LogStatistics.__dataclass_fields__)


def test_every_plottable_metric_is_a_real_statistic():
    for metric, label in SIZE_METRICS.items():
        assert metric in STATISTIC_FIELDS, metric
        assert label, metric


def test_timestamps_are_not_offered_as_plot_axes():
    """They say when a log happened, not how big it is."""
    assert not any(metric.endswith("_timestamp") for metric in SIZE_METRICS)


# ---------------------------------------------------------------------------
# Loading contract
# ---------------------------------------------------------------------------

def test_inferrable_extension_or_explicit_format():
    """
    import_ocel infers the format from the extension and raises on anything else, so a
    log whose suffix it cannot read must declare file_format explicitly. OCEL 1.0-era
    suffixes such as .jsonocel are the case this guards.
    """
    for log in LOGS:
        if log.file_format is None:
            suffix = log.path.suffix.lower().lstrip(".")
            assert suffix in SUPPORTED_FORMATS, f"{log.name} needs an explicit file_format"
        else:
            assert log.file_format in SUPPORTED_FORMATS, log.name


def test_import_args_passes_the_path_and_no_format_by_default():
    path = Path("data") / "x.json"
    log = EvaluationLog(name="x", source_url="https://e.org", path=path)
    assert import_args(log) == (str(path), None)


def test_import_args_carries_an_explicit_format_through():
    path = Path("data") / "x.jsonocel"
    log = EvaluationLog(
        name="x",
        source_url="https://e.org",
        path=path,
        file_format="json",
    )
    assert import_args(log) == (str(path), "json")


# ---------------------------------------------------------------------------
# Download metadata
# ---------------------------------------------------------------------------

def test_downloadable_logs_carry_verification_metadata():
    for log in downloadable_logs():
        assert log.download_url.startswith("https://"), log.name
        assert len(log.md5) == 32 and int(log.md5, 16) >= 0, log.name
        assert log.size_bytes > 0, log.name


def test_bundled_logs_have_no_download_metadata():
    for log in LOGS:
        if log.bundled:
            assert log.md5 is None and log.size_bytes is None, log.name


# ---------------------------------------------------------------------------
# Lookup
# ---------------------------------------------------------------------------

def test_get_log_finds_a_known_log():
    assert get_log("ocel2-p2p").name == "ocel2-p2p"


def test_get_log_rejects_an_unknown_name_and_lists_the_valid_ones():
    with pytest.raises(ValueError) as exc:
        get_log("no-such-log")
    assert "no-such-log" in str(exc.value)
    assert "ocel2-p2p" in str(exc.value)  # the message should be actionable


def test_available_logs_only_reports_files_that_exist():
    for log in available_logs():
        assert log.path.exists(), log.name


# ---------------------------------------------------------------------------
# Real imports (skips whatever is not on disk)
# ---------------------------------------------------------------------------

def test_every_available_log_imports_and_matches_its_recorded_statistics():
    """Turns 'each log loads with import_ocel without errors' into an executed check."""
    from evaluation.log_stats import measure

    logs = available_logs()
    if not logs:
        pytest.skip("no evaluation logs present on disk")

    for log in logs:
        measured = measure(log)
        assert measured.num_events > 0, f"{log.name} imported as empty"
        if log.statistics is not None:
            assert measured == log.statistics, (
                f"{log.name}: recorded statistics differ from a fresh import "
                "- re-run: python evaluation/log_stats.py"
            )
