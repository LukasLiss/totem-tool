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
    SMALL,
    SUPPORTED_FORMATS,
    EvaluationLog,
    available_logs,
    downloadable_logs,
    get_log,
    import_args,
)


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


def test_event_counts_are_positive_when_recorded():
    for log in LOGS:
        if log.event_count is not None:
            assert log.event_count > 0, log.name


def test_logs_are_sorted_by_event_count_with_unmeasured_last():
    keys = [(log.event_count is None, log.event_count or 0) for log in LOGS]
    assert keys == sorted(keys)


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

def test_every_available_log_imports_and_matches_its_recorded_event_count():
    """Turns 'each log loads with import_ocel without errors' into an executed check."""
    from totem_lib.ocel.importer import import_ocel

    logs = available_logs()
    if not logs:
        pytest.skip("no evaluation logs present on disk")

    for log in logs:
        ocel = import_ocel(*import_args(log))
        events = ocel.events.height
        assert events > 0, f"{log.name} imported as empty"
        if log.event_count is not None:
            assert events == log.event_count, (
                f"{log.name}: recorded {log.event_count}, imported {events} "
                "- re-run: python evaluation/log_sizes.py"
            )
