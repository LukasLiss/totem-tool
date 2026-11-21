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
    CHAPTERS,
    OCCN_MAIN_DISCOVERY,
    OCCN_THRESHOLD_SWEEP,
    MAIN_OBJECT_TYPES,
    OCCN_MAX_STATES,
    TAU_SWEEP,
    MissingInput,
    main_area_types,
    planned_pairs,
    algorithms_for,
    artifact_path,
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

def test_the_library_algorithms_are_registered_for_the_tool_chapter():
    tool = {a.name for a in ALGORITHMS if "totem-tool" in a.chapters}
    assert tool == {
        "import_ocel", "import_ocel_db",
        "totemDiscovery", "totemDiscovery_db",
        "mlpaDiscovery", "discover_ocpn_db",
        "discover_occn", "discover_occn_db",
        "OCDFG.from_ocel", "OCDFG.from_ocel_db",
        "CCDFG.from_ocel", "find_variants",
    }


def test_every_chapter_has_its_experiments():
    for chapter in CHAPTERS:
        assert algorithms_for([chapter]), chapter
    with pytest.raises(ValueError, match="unknown chapter"):
        algorithms_for(["nope"])


def test_sweeps_cover_every_value_and_record_their_parameter():
    conformance = [a for a in ALGORITHMS if a.family == "totem_conformance"]
    assert sorted(a.params["tau"] for a in conformance) == list(TAU_SWEEP)
    assert get_algorithm("totem_conformance@tau=0.3").params == {"tau": 0.3}
    # TOTeM discovery at 0.9 is the tool's plain totemDiscovery_db, measured once.
    discovery = [a for a in ALGORITHMS if a.family == "totemDiscovery_db"]
    assert sorted(a.params["tau"] for a in discovery) == list(TAU_SWEEP)
    fitness = [a for a in ALGORITHMS if a.family == "occn_fitness"]
    assert sorted(a.params["threshold"] for a in fitness) == list(OCCN_THRESHOLD_SWEEP)


def test_occn_conformance_runs_after_the_discovery_whose_model_it_reuses():
    names = [a.name for a in ALGORITHMS]
    first_check = min(names.index(a.name) for a in ALGORITHMS if a.family == "occn_fitness")
    assert names.index(OCCN_MAIN_DISCOVERY) < first_check


def test_the_main_object_types_are_the_biggest_area_on_the_lowest_level():
    areas = {
        0.0: [({"Handling Unit"}, {"Collect Goods", "Load Truck"}),
              ({"Container", "Vehicle"}, {"Depart"}),
              ({"Truck", "Order"}, {"Book", "Register"})],  # ties on types, more activities
        1.0: [({"Forklift", "Customer", "Plant"}, {"Drive"})],  # bigger, but not lowest
    }
    assert main_area_types(areas) == ("Order", "Truck")


def test_main_object_types_can_be_set_by_hand(monkeypatch):
    monkeypatch.setitem(MAIN_OBJECT_TYPES, "fake-log", ("b", "a"))
    monkeypatch.setattr("evaluation.algorithms.mlpaDiscovery",
                        lambda *a: pytest.fail("chose automatically"))
    assert LogContext(_log()).main_object_types == ("a", "b")


def test_occn_conformance_runs_only_on_the_logs_with_chosen_main_types():
    fitness = get_algorithm("occn_fitness@threshold=0.1")
    assert set(fitness.logs) == set(MAIN_OBJECT_TYPES) == {
        "ocel2-p2p", "container_logistics", "github-pm4py", "recruiting"}
    assert fitness.runs_on("recruiting") and not fitness.runs_on("enron")
    assert get_algorithm("totemDiscovery_db").runs_on("enron")
    pairs = planned_pairs(["enron", "recruiting"], ["totemDiscovery_db", fitness.name])
    assert pairs == [("enron", "totemDiscovery_db"), ("recruiting", "totemDiscovery_db"),
                     ("recruiting", fitness.name)]


def test_the_hand_picked_types_exist_in_their_logs():
    """Names as the DuckDB importer stores them; a typo would silently drop events."""
    from evaluation.datasets import get_log
    for log_name, types in MAIN_OBJECT_TYPES.items():
        log = get_log(log_name)
        if not log.available:
            continue
        context = LogContext(log)
        try:
            stored = {row[0] for row in context.ocel_db.conn.execute(
                "select distinct obj_type from objects").fetchall()}
        finally:
            context.close()
        assert set(types) <= stored, log_name


def test_replay_is_not_capped():
    assert OCCN_MAX_STATES is None
    assert not [a for a in ALGORITHMS if "precision" in a.name]


def test_artifacts_are_saved_per_log_and_algorithm(tmp_path):
    assert artifact_path(tmp_path, "p2p", "occn_fitness@threshold=0.1") == \
        tmp_path / "p2p" / "occn_fitness@threshold=0.1.json"


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
