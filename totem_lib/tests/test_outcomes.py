"""
Contract for what a measurement keeps besides its time (evaluation/outcomes.py), and
for the worker saving it.

These run the real algorithms on the tiny running-example log, so the described
properties are checked against real models, not hand-made ones.
"""

import json
import pickle
from pathlib import Path

import pytest

from evaluation import outcomes
from evaluation.algorithms import (
    LogContext,
    check_totem_conformance,
    discover_process_areas,
    replay_each,
)
from evaluation.datasets import EvaluationLog
from evaluation.harness import benchmark
from evaluation.worker import measure_in_this_process
from totem_lib import discover_occn, extract_occn_replay_units, import_ocel, occn_from_dict
from totem_lib.ocel.importer_db import import_ocel_db
from totem_lib.totem import totemDiscovery_db

RUNNING_EXAMPLE = Path(__file__).resolve().parent.parent / "test_data" / "small" / "runningexample.json"


@pytest.fixture(scope="module")
def ocel_db(tmp_path_factory):
    db = import_ocel_db(str(RUNNING_EXAMPLE),
                        db_path=str(tmp_path_factory.mktemp("db") / "re.duckdb"))
    yield db
    db.close()


@pytest.fixture(scope="module")
def occn():
    return discover_occn(import_ocel(str(RUNNING_EXAMPLE)), 0)


def test_a_totem_is_counted_by_its_d_i_and_p_arcs(ocel_db):
    totem = totemDiscovery_db(ocel_db)
    outcome = outcomes.describe_totem(totem)
    props = outcome.properties
    assert props["totem_arcs"] == (props["totem_arcs_dependent"] + props["totem_arcs_initiating"]
                                   + props["totem_arcs_parallel"])
    assert props["totem_nodes"] == 4
    assert outcome.artifact["totem"]["schema"] == "totem"


def test_conformance_keeps_all_six_values_and_the_model(ocel_db):
    output = check_totem_conformance(totemDiscovery_db(ocel_db, tau=1.0), ocel_db)
    outcome = outcomes.describe_totem_conformance(output)
    for dimension in ("temporal", "log_cardinality", "event_cardinality"):
        assert outcome.properties[f"{dimension}_fitness"] == pytest.approx(1.0)
        assert 0 <= outcome.properties[f"{dimension}_precision"] <= 1
    assert {"totem", "overall", "type_pairs"} <= set(outcome.artifact)
    json.dumps(outcome.artifact)  # must be saveable as it is


def test_an_occn_is_saved_in_the_canonical_form_and_kept_exactly_for_reuse(occn):
    outcome = outcomes.describe_occn(occn)
    assert outcome.properties["occn_activities"] == len(occn.activities)
    assert outcome.properties["occn_markers"] > 0
    saved = json.loads(json.dumps(outcome.artifact))["occn"]
    assert saved["schema"] == "occn"
    assert occn_from_dict(saved) == occn
    reused = pickle.loads(pickle.dumps(outcome.reuse))
    for threshold in (0, 0.1, 0.5):  # the conformance experiments filter the reused net
        assert str(reused.apply_relative_occurrence_threshold(threshold)) == \
            str(occn.apply_relative_occurrence_threshold(threshold))


def test_each_execution_is_replayed_and_timed_on_its_own(occn, ocel_db):
    units = extract_occn_replay_units(ocel_db)
    _, replayed = replay_each(occn, units)
    assert len(replayed) == len(units)
    assert all(u.seconds >= 0 and u.events >= 1 and u.objects >= 1 for u in replayed)
    outcome = outcomes.describe_occn_fitness((occn, replayed))
    props = outcome.properties
    assert props["executions"] == len(units)
    assert props["fitting_executions"] + props["non_fitting_executions"] \
        + props["inconclusive_executions"] == len(units)
    assert len(outcome.artifact["executions"]) == len(units)


def test_conformance_uses_the_main_types_for_the_net_and_the_executions(tmp_path):
    context = LogContext(_example_log(), tmp_path)
    try:
        types = context.main_object_types
        assert types and set(types) <= {"item", "package", "employee", "machine"}
        assert set(context.main_occn.object_types) == set(types)
        seen = {object_type for unit in context.replay_units for event in unit.events
                for object_type, _ in event.objects_by_type}
        assert seen <= set(types)
    finally:
        context.close()


def test_a_stricter_filter_never_fits_more_executions(occn, ocel_db):
    units = extract_occn_replay_units(ocel_db)
    loose = outcomes.describe_occn_fitness(replay_each(occn, units)).properties
    strict = outcomes.describe_occn_fitness(
        replay_each(occn.apply_relative_occurrence_threshold(0.9), units)).properties
    assert strict["occn_markers"] <= loose["occn_markers"]


def test_process_areas_report_the_papers_table_columns(ocel_db):
    outcome = outcomes.describe_process_areas(discover_process_areas(ocel_db, 0.9))
    props = outcome.properties
    assert props["levels"] >= 1 and props["areas"] >= props["levels"]
    assert 0 <= props["totem_share"] <= 1
    assert sum(len(level["areas"]) for level in outcome.artifact["levels"]) == props["areas"]


# ---------------------------------------------------------------------------
# Harness and worker
# ---------------------------------------------------------------------------

def test_the_harness_hands_over_only_the_last_output():
    calls = iter(range(10))
    kept = []
    result = benchmark("count", lambda: next(calls), repeats=3, warmup=1,
                       keep_output=kept.append)
    assert result.ok and kept == [3]  # warm-up 0, timed 1..3


def test_nothing_is_kept_from_a_failed_run():
    kept = []

    def boom():
        raise RuntimeError("no")

    assert not benchmark("boom", boom, repeats=2, keep_output=kept.append).ok
    assert kept == []


def _example_log() -> EvaluationLog:
    return EvaluationLog(name="running-example", source_url="https://example.org",
                         path=RUNNING_EXAMPLE)


def test_the_worker_saves_the_model_and_records_where(tmp_path, monkeypatch):
    log = _example_log()
    monkeypatch.setattr("evaluation.worker.get_log", lambda name: log)
    artifacts = tmp_path / "artifacts"
    result = measure_in_this_process(log.name, "discover_occn_db", 1, 0, artifacts)
    assert result.ok
    assert result.properties["params"] == {}
    assert result.properties["occn_markers"] > 0
    assert result.artifact == "artifacts/running-example/discover_occn_db.json"
    saved = artifacts / "running-example" / "discover_occn_db.json"
    assert json.loads(saved.read_text())["occn"]["schema"] == "occn"
    with open(saved.with_suffix(".pickle"), "rb") as handle:
        assert pickle.load(handle).activities


def test_conformance_reuses_the_occn_discovery_saved(tmp_path, monkeypatch, occn):
    artifacts = tmp_path / "artifacts"
    target = artifacts / "running-example" / "discover_occn_db.pickle"
    target.parent.mkdir(parents=True)
    target.write_bytes(pickle.dumps(outcomes.describe_occn(occn).reuse))
    monkeypatch.setattr("evaluation.algorithms.discover_occn",
                        lambda *a, **k: pytest.fail("mined again"))
    context = LogContext(_example_log(), artifacts)
    try:
        assert context.occn == occn
    finally:
        context.close()


def test_a_failing_description_keeps_the_measurement(tmp_path, monkeypatch):
    log = _example_log()
    monkeypatch.setattr("evaluation.worker.get_log", lambda name: log)
    monkeypatch.setattr("evaluation.outcomes.totem_properties",
                        lambda totem: (_ for _ in ()).throw(ValueError("odd model")))
    result = measure_in_this_process(log.name, "totemDiscovery_db", 1, 0, tmp_path)
    assert result.ok
    assert result.properties["describe_error"] == "ValueError: odd model"
    assert result.properties["params"] == {"tau": 0.9}
