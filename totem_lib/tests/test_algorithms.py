"""
Contract for the algorithm registry (evaluation/algorithms.py).

Real algorithm runs are far too slow for a test suite, so these check the wiring: that
every algorithm is registered once, that a log's inputs are built lazily and reused, and
that a log missing something needed says so clearly.
"""

from pathlib import Path

import pytest

from evaluation.algorithms import (
    ALGORITHM_NAMES,
    ALGORITHMS,
    Algorithm,
    LogContext,
    MissingInput,
    get_algorithm,
)
from evaluation.datasets import LOGS, EvaluationLog


def _log(**overrides) -> EvaluationLog:
    fields = {
        "name": "fake-log",
        "source_url": "https://example.org",
        "path": Path("fake.json"),
    }
    fields.update(overrides)
    return EvaluationLog(**fields)


# ---------------------------------------------------------------------------
# The registry
# ---------------------------------------------------------------------------

def test_every_algorithm_named_by_the_issue_is_registered():
    expected = {
        "import_ocel",
        "totemDiscovery",
        "totemDiscovery_db",
        "mlpaDiscovery",
        "discover_oc_petri_net_polars",
        "discover_occn",
        "OCDFG.from_ocel",
        "CCDFG.from_ocel",
        "find_variants",
    }
    assert set(ALGORITHM_NAMES) == expected


def test_algorithm_names_are_unique_and_non_empty():
    assert all(ALGORITHM_NAMES)
    assert len(ALGORITHM_NAMES) == len(set(ALGORITHM_NAMES))


def test_get_algorithm_finds_a_known_algorithm():
    assert get_algorithm("OCDFG.from_ocel").name == "OCDFG.from_ocel"


def test_get_algorithm_rejects_an_unknown_name_and_lists_the_valid_ones():
    with pytest.raises(ValueError) as exc:
        get_algorithm("nope")
    assert "nope" in str(exc.value)
    assert "OCDFG.from_ocel" in str(exc.value)  # the message should be actionable


# ---------------------------------------------------------------------------
# LogContext
# ---------------------------------------------------------------------------

def test_building_a_context_does_not_load_anything(monkeypatch):
    """Benchmarking one cheap algorithm should not pay to import the log."""
    calls = []
    monkeypatch.setattr("evaluation.algorithms.import_ocel",
                        lambda *a, **k: calls.append(1))
    LogContext(_log())
    assert calls == []


def test_the_log_is_imported_once_and_reused(monkeypatch):
    calls = []

    def fake_import(*args, **kwargs):
        calls.append(1)
        return "an-ocel"

    monkeypatch.setattr("evaluation.algorithms.import_ocel", fake_import)
    context = LogContext(_log())
    assert context.ocel == "an-ocel"
    assert context.ocel == "an-ocel"
    assert len(calls) == 1  # the second access must not re-import


def test_the_totem_is_discovered_once_and_reused(monkeypatch):
    calls = []
    monkeypatch.setattr("evaluation.algorithms.import_ocel", lambda *a, **k: "an-ocel")
    monkeypatch.setattr("evaluation.algorithms.totemDiscovery",
                        lambda ocel: calls.append(ocel) or "a-totem")
    context = LogContext(_log())
    assert context.totem == "a-totem"
    assert context.totem == "a-totem"
    assert calls == ["an-ocel"]  # discovered once, from the imported log


def test_the_duckdb_copy_is_built_from_the_log_file(monkeypatch):
    """
    Both families must read the same file. The bundled .duckdb copies were built from a
    normalised log, with spaces stripped from labels, so loading those would benchmark
    different data - and did hide a real bug before this was fixed.
    """
    seen = []
    monkeypatch.setattr("evaluation.algorithms.import_ocel_db",
                        lambda path, db_path: seen.append((path, db_path)) or "a-db")
    log = _log()
    context = LogContext(log)
    assert context.ocel_db == "a-db"
    assert seen[0][0] == str(log.path)          # built from the log's own file
    assert seen[0][1].endswith(".duckdb")


def test_the_duckdb_copy_is_built_once(monkeypatch):
    calls = []
    monkeypatch.setattr("evaluation.algorithms.import_ocel_db",
                        lambda path, db_path: calls.append(path) or "a-db")
    context = LogContext(_log())
    _ = context.ocel_db
    _ = context.ocel_db
    assert len(calls) == 1


def test_closing_removes_the_temporary_database(monkeypatch):
    monkeypatch.setattr("evaluation.algorithms.import_ocel_db",
                        lambda path, db_path: _FakeDb())
    context = LogContext(_log())
    _ = context.ocel_db
    scratch = Path(context._db_dir)
    assert scratch.exists()
    context.close()
    assert not scratch.exists()


class _FakeDb:
    def close(self):
        pass


def test_a_log_without_a_leading_object_type_says_so():
    context = LogContext(_log(leading_object_type=None))
    with pytest.raises(MissingInput, match="leading_object_type"):
        _ = context.leading_object_type


def test_the_leading_object_type_comes_from_the_manifest():
    context = LogContext(_log(leading_object_type="orders"))
    assert context.leading_object_type == "orders"


def test_closing_a_context_without_a_database_is_harmless():
    LogContext(_log()).close()


# ---------------------------------------------------------------------------
# The manifest supports what the algorithms need
# ---------------------------------------------------------------------------

def test_every_log_can_supply_what_the_db_algorithms_need():
    """CCDFG and find_variants are unusable without a leading object type."""
    for log in LOGS:
        assert log.leading_object_type, log.name


def test_making_a_call_never_needs_arguments():
    """benchmark() calls the result with no arguments, so it must be fully bound."""
    algorithm = Algorithm("fake", lambda context: lambda: "done")
    assert algorithm.make_call(LogContext(_log()))() == "done"
