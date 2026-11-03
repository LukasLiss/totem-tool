"""Object-centric alignments (Liss, *Object-Centric Alignments*)."""

import os
import tempfile
from pathlib import Path

import pytest

from totem_lib.ocel import OcelDuckDB, import_ocel_db, write_event_columns_to_file
from totem_lib.ocpn import discover_ocpn_db
from totem_lib.oc_alignments import (
    LOG_MOVE,
    MODEL_MOVE,
    NO_ALIGNMENT,
    OPTIMAL,
    STATE_LIMIT,
    SYNC_MOVE,
    AlignmentCancelled,
    AlignmentModelError,
    ExecutionNotFoundError,
    ProcessExecution,
    alignment_edges,
    compute_oc_alignment,
    list_area_executions,
    list_stored_executions,
    load_area_execution,
    load_area_executions,
    load_stored_execution,
    load_stored_executions,
    make_event,
    net_from_ocpn_dict,
    project_execution,
)
from totem_lib.variants import extract_process_executions, partition_events

TEST_DATA = Path(__file__).parent.parent.parent / "test_data" / "small"
CLEAN_LOG = TEST_DATA / "resource_aware_orders.json"
DEVIATING_LOG = TEST_DATA / "resource_aware_orders_deviating.json"
BUSINESS_TYPES = ["order", "item", "package"]
BUSINESS_ACTIVITIES = ["place order", "pick item", "pack items", "ship package", "close order"]


# ---------------------------------------------------------------------------
# The running example of the thesis (Fig. 3.3 / 3.2 / 4.3)
# ---------------------------------------------------------------------------


def _place(pid, object_type, initial=False, final=False):
    place = {"id": pid, "objectType": object_type}
    if initial:
        place["initial"] = True
    if final:
        place["final"] = True
    return place


def running_example_net():
    places = [
        _place("pk_start", "package", initial=True),
        _place("pk_env", "package"),
        _place("pk_env_done", "package"),
        _place("pk_box", "package"),
        _place("pk_box_done", "package"),
        _place("pk_end", "package", final=True),
        _place("it_start", "item", initial=True),
        _place("it_sample", "item"),
        _place("it_sample_done", "item"),
        _place("it_product", "item"),
        _place("it_product_done", "item"),
        _place("it_end", "item", final=True),
    ]
    transitions = [
        {"id": "t1", "label": "receive sample order"},
        {"id": "t2", "label": "receive product order"},
        {"id": "t3", "label": "setup envelope"},
        {"id": "t4", "label": "setup box"},
        {"id": "t5", "label": "prepare sample"},
        {"id": "t6", "label": "prepare product"},
        {"id": "t7", "label": "add advertisement"},
        {"id": "t8", "label": "add bill"},
        {"id": "t9", "label": "add sample"},
        {"id": "t10", "label": "add product"},
    ]
    arcs = []

    def arc(source, target, variable=False):
        entry = {"id": f"a{len(arcs) + 1}", "source": source, "target": target}
        if variable:
            entry["variable"] = True
        arcs.append(entry)

    arc("pk_start", "t1"); arc("pk_start", "t2")
    arc("t1", "pk_env"); arc("t2", "pk_box")
    arc("it_start", "t1", True); arc("it_start", "t2", True)
    arc("t1", "it_sample", True); arc("t2", "it_product", True)
    arc("pk_env", "t3"); arc("t3", "pk_env_done"); arc("pk_env_done", "t7"); arc("t7", "pk_end")
    arc("pk_box", "t4"); arc("t4", "pk_box_done"); arc("pk_box_done", "t8"); arc("t8", "pk_end")
    arc("it_sample", "t5"); arc("t5", "it_sample_done"); arc("it_sample_done", "t9"); arc("t9", "it_end")
    arc("it_product", "t6"); arc("t6", "it_product_done"); arc("it_product_done", "t10"); arc("t10", "it_end")
    return {
        "format": "ocpn",
        "version": 1,
        "name": "Packaging",
        "objectTypes": [{"name": "package"}, {"name": "item"}],
        "places": places,
        "transitions": transitions,
        "arcs": arcs,
    }


def running_example_execution(extra_objects=None):
    def objs(**kwargs):
        out = {}
        if "p" in kwargs:
            out["package"] = kwargs["p"]
        if "i" in kwargs:
            out["item"] = kwargs["i"]
        return out

    first = objs(p=["p1"], i=["i1", "i2"])
    if extra_objects:
        first.update(extra_objects)
    return ProcessExecution(
        "p1",
        (
            make_event("1", "receive sample order", 1, first),
            make_event("2", "setup box", 2, objs(p=["p1"])),
            make_event("3", "prepare sample", 3, objs(i=["i1"])),
            make_event("4", "add bill", 4, objs(p=["p1"])),
            make_event("5", "prepare sample", 5, objs(i=["i2"])),
            make_event("6", "add sample", 6, objs(i=["i2"])),
            make_event("7", "add sample", 7, objs(i=["i2"])),
        ),
    )


def test_running_example_has_the_optimal_cost_of_the_thesis():
    result = compute_oc_alignment(running_example_net(), running_example_execution())

    assert result.status == OPTIMAL
    assert result.cost == 6
    counts = result.move_counts()
    assert counts == {SYNC_MOVE: 4, LOG_MOVE: 3, MODEL_MOVE: 3, "silent": 0}

    # The inter-object dependency is respected: the receive event is aligned
    # with "receive sample order" on all three objects, so p1 must follow the
    # envelope branch and both "setup box" and "add bill" are log moves.
    first = result.moves[0]
    assert first.kind == SYNC_MOVE and first.model_activity == "receive sample order"
    assert {obj for _, obj in first.objects} == {"p1", "i1", "i2"}
    log_moves = sorted(m.log_activity for m in result.moves if m.kind == LOG_MOVE)
    assert log_moves == ["add bill", "add sample", "setup box"]
    model_moves = sorted(
        (m.model_activity, tuple(o for _, o in m.objects))
        for m in result.moves
        if m.kind == MODEL_MOVE
    )
    assert model_moves == [
        ("add advertisement", ("p1",)),
        ("add sample", ("i1",)),
        ("setup envelope", ("p1",)),
    ]


def test_alignment_graph_connects_moves_of_the_same_object():
    result = compute_oc_alignment(running_example_net(), running_example_execution())
    edges = set(map(tuple, result.edges))
    assert edges == set(alignment_edges(result.moves))
    # Every move after the first is reachable from the receive move.
    reached, frontier = {0}, [0]
    while frontier:
        node = frontier.pop()
        for a, b in edges:
            if a == node and b not in reached:
                reached.add(b)
                frontier.append(b)
    assert reached == set(range(len(result.moves)))
    serialized = result.to_dict()
    assert serialized["cost"] == 6
    assert len(serialized["moves"]) == len(result.moves)
    assert serialized["execution"]["event_count"] == 7


def test_fitting_execution_has_cost_zero():
    execution = ProcessExecution(
        "p2",
        (
            make_event("8", "receive product order", 1, {"package": ["p2"], "item": ["i3"]}),
            make_event("9", "setup box", 2, {"package": ["p2"]}),
            make_event("10", "prepare product", 3, {"item": ["i3"]}),
            make_event("11", "add bill", 4, {"package": ["p2"]}),
            make_event("12", "add product", 5, {"item": ["i3"]}),
        ),
    )
    result = compute_oc_alignment(running_example_net(), execution)
    assert result.status == OPTIMAL
    assert result.cost == 0
    assert all(m.kind == SYNC_MOVE for m in result.moves)


def test_object_types_missing_from_the_model_are_ignored_and_reported():
    execution = running_example_execution(extra_objects={"worker": ["w1"]})
    result = compute_oc_alignment(running_example_net(), execution)

    assert result.status == OPTIMAL
    assert result.cost == 6
    assert result.projection.ignored_object_types == ("worker",)
    assert result.projection.ignored_object_counts == {"worker": 1}
    assert result.to_dict()["projection"]["ignored_object_count"] == 1

    strict = compute_oc_alignment(
        running_example_net(), execution, ignore_unknown_object_types=False
    )
    assert strict.status == NO_ALIGNMENT
    assert "worker" in strict.message


def test_events_left_without_objects_are_dropped():
    execution = ProcessExecution(
        "x",
        running_example_execution().events
        + (make_event("w", "start shift", 0, {"worker": ["w1"]}),),
    )
    projected, report = project_execution(execution, ["package", "item"])
    assert report.dropped_event_ids == ("w",)
    assert len(projected.events) == 7


def test_object_combination_not_allowed_by_the_model_has_no_alignment():
    # Without a package the receive transitions can never fire, so the items
    # can never reach their final place.
    execution = ProcessExecution(
        "i9",
        (
            make_event("1", "prepare sample", 1, {"item": ["i9"]}),
            make_event("2", "add sample", 2, {"item": ["i9"]}),
        ),
    )
    result = compute_oc_alignment(running_example_net(), execution)
    assert result.status == NO_ALIGNMENT
    assert result.moves == []


def test_unknown_activities_become_log_moves_and_are_reported():
    events = running_example_execution().events + (
        make_event("8", "ring bell", 8, {"package": ["p1"]}),
    )
    result = compute_oc_alignment(running_example_net(), ProcessExecution("p1", events))
    assert result.status == OPTIMAL
    assert result.cost == 7
    assert result.unknown_activities == ("ring bell",)


def test_silent_transitions_cost_epsilon_only():
    model = {
        "format": "ocpn",
        "version": 1,
        "places": [
            _place("s", "order", initial=True),
            _place("m", "order"),
            _place("n", "order"),
            _place("e", "order", final=True),
        ],
        "transitions": [
            {"id": "a", "label": "create"},
            {"id": "tau", "label": None},
            {"id": "b", "label": "close"},
        ],
        "arcs": [
            {"id": "1", "source": "s", "target": "a"},
            {"id": "2", "source": "a", "target": "m"},
            {"id": "3", "source": "m", "target": "tau"},
            {"id": "4", "source": "tau", "target": "n"},
            {"id": "5", "source": "n", "target": "b"},
            {"id": "6", "source": "b", "target": "e"},
        ],
    }
    execution = ProcessExecution(
        "o1",
        (
            make_event("1", "create", 1, {"order": ["o1"]}),
            make_event("2", "close", 2, {"order": ["o1"]}),
        ),
    )
    result = compute_oc_alignment(model, execution)
    assert result.status == OPTIMAL
    assert result.cost == 0
    assert result.move_counts()["silent"] == 1
    # Edges can bridge over silent moves for display.
    assert alignment_edges(result.moves, include_silent=False) == [(0, 2)]


def test_state_limit_and_cancellation():
    limited = compute_oc_alignment(running_example_net(), running_example_execution(), max_states=3)
    assert limited.status == STATE_LIMIT

    with pytest.raises(AlignmentCancelled):
        big = ProcessExecution(
            "big",
            tuple(
                make_event(str(i), "prepare sample", i, {"item": [f"i{i}"]})
                for i in range(12)
            ),
        )
        compute_oc_alignment(running_example_net(), big, should_cancel=lambda: True)


def test_model_errors():
    with pytest.raises(AlignmentModelError):
        net_from_ocpn_dict({"places": [{"id": "p"}], "transitions": []})
    model = running_example_net()
    model["arcs"].append({"id": "x", "source": "it_start", "target": "t3"})
    model["arcs"].append({"id": "y", "source": "it_sample", "target": "t3", "variable": True})
    with pytest.raises(AlignmentModelError, match="not well-formed"):
        net_from_ocpn_dict(model)


def test_initial_and_final_places_fall_back_to_structure():
    model = running_example_net()
    for place in model["places"]:
        place.pop("initial", None)
        place.pop("final", None)
    net = net_from_ocpn_dict(model)
    assert [net.place_ids[i] for i in net.initial_places["package"]] == ["pk_start"]
    assert [net.place_ids[i] for i in net.final_places["item"]] == ["it_end"]
    result = compute_oc_alignment(net, running_example_execution())
    assert result.cost == 6


# ---------------------------------------------------------------------------
# DuckDB: stored and process-area executions
# ---------------------------------------------------------------------------


def _store_executions(source, path):
    db = import_ocel_db(str(source), db_path=path)
    executions = extract_process_executions(
        db,
        extraction="resource_aware",
        business_object_types=BUSINESS_TYPES,
        business_activities=BUSINESS_ACTIVITIES,
    )
    partition = partition_events(executions.case_events)
    db.close()
    write_event_columns_to_file(path, {"execution": partition.assignment})


@pytest.fixture(scope="module")
def logs():
    with tempfile.TemporaryDirectory() as tmp:
        clean_path = os.path.join(tmp, "clean.duckdb")
        deviating_path = os.path.join(tmp, "deviating.duckdb")
        _store_executions(CLEAN_LOG, clean_path)
        _store_executions(DEVIATING_LOG, deviating_path)
        clean = OcelDuckDB.load(clean_path, read_only=True)
        deviating = OcelDuckDB.load(deviating_path, read_only=True)
        model = discover_ocpn_db(clean, object_types=BUSINESS_TYPES)
        try:
            yield clean, deviating, model
        finally:
            clean.close()
            deviating.close()


def test_area_executions_are_listed_and_aligned(logs):
    clean, deviating, model = logs
    summaries = list_area_executions(deviating.conn, BUSINESS_TYPES, BUSINESS_ACTIVITIES)
    assert len(summaries) == 3
    assert all(s["object_type_counts"] for s in summaries)
    assert [s["event_count"] for s in summaries] == [6, 5, 8]

    costs = {}
    for summary in summaries:
        execution = load_area_execution(
            deviating.conn, BUSINESS_TYPES, BUSINESS_ACTIVITIES, summary["id"]
        )
        assert execution.summary()["event_count"] == summary["event_count"]
        result = compute_oc_alignment(model, execution)
        assert result.status == OPTIMAL
        assert not result.projection.changed  # the worker is not a business type
        costs[summary["id"]] = result.cost
    # Order o2 (execution i3) misses the pick of item i4; the others fit.
    assert costs == {"i1": 0, "i3": 1, "i5": 0}
    execution = load_area_execution(deviating.conn, BUSINESS_TYPES, BUSINESS_ACTIVITIES, "i3")
    deviations = [m for m in compute_oc_alignment(model, execution).moves if m.kind != SYNC_MOVE]
    assert [(m.kind, m.model_activity, m.objects) for m in deviations] == [
        (MODEL_MOVE, "pick item", (("item", "i4"),))
    ]
    # Any object of the component identifies the execution as well.
    assert load_area_execution(deviating.conn, BUSINESS_TYPES, BUSINESS_ACTIVITIES, "i4").execution_id == "i3"

    for summary in list_area_executions(clean.conn, BUSINESS_TYPES, BUSINESS_ACTIVITIES):
        execution = load_area_execution(clean.conn, BUSINESS_TYPES, BUSINESS_ACTIVITIES, summary["id"])
        assert compute_oc_alignment(model, execution).cost == 0


def test_stored_executions_report_the_ignored_worker(logs):
    _clean, deviating, model = logs
    summaries = list_stored_executions(deviating.conn, "execution")
    assert len(summaries) == 3
    assert any("worker" in s["object_type_counts"] for s in summaries)

    execution = load_stored_execution(deviating.conn, "execution", summaries[0]["id"])
    result = compute_oc_alignment(model, execution)
    assert result.status == OPTIMAL
    assert result.projection.ignored_object_types == ("worker",)

    with pytest.raises(ExecutionNotFoundError):
        load_stored_execution(deviating.conn, "execution", "nope")
    with pytest.raises(ValueError, match="does not exist"):
        list_stored_executions(deviating.conn, "missing")
    with pytest.raises(ExecutionNotFoundError):
        load_area_execution(deviating.conn, BUSINESS_TYPES, BUSINESS_ACTIVITIES, "nope")


def test_flattened_lower_bound_is_admissible():
    # Per object: p1 can at best take the box branch (2), i1 misses one
    # "add sample" (1), i2 has one too many (1).
    result = compute_oc_alignment(running_example_net(), running_example_execution())
    assert result.lower_bound == 4
    assert result.lower_bound <= result.cost


def test_approximate_fallback_when_the_optimal_search_hits_its_limit(monkeypatch):
    from totem_lib.oc_alignments import APPROXIMATE
    from totem_lib.oc_alignments.alignment import _Search

    original = _Search.run

    def run(self, **kwargs):
        if not kwargs.get("greedy"):
            self.lower_bound = 4
            return None, None, 0, 0, STATE_LIMIT
        return original(self, **kwargs)

    monkeypatch.setattr(_Search, "run", run)
    result = compute_oc_alignment(running_example_net(), running_example_execution())
    assert result.status == APPROXIMATE
    assert not result.exact
    assert result.cost == 6
    assert "upper bound" in result.message
    assert result.to_dict()["exact"] is False

    disabled = compute_oc_alignment(
        running_example_net(), running_example_execution(), approximate_fallback=False
    )
    assert disabled.status == STATE_LIMIT


def test_many_objects_behind_a_variable_arc_stay_tractable():
    # 2^14 item subsets for "receive sample order" exceed the enumeration
    # cap; the restricted binding family still finds the optimum here.
    items = [f"i{n:02d}" for n in range(14)]
    events = [make_event("r", "receive sample order", 0, {"package": ["p1"], "item": items})]
    t = 1
    for item in items:
        events.append(make_event(f"p{item}", "prepare sample", t, {"item": [item]}))
        if item != "i07":  # i07 misses "add sample"
            events.append(make_event(f"a{item}", "add sample", t + 0.5, {"item": [item]}))
        t += 1
    events.append(make_event("e", "setup envelope", t, {"package": ["p1"]}))
    events.append(make_event("v", "add advertisement", t + 1, {"package": ["p1"]}))
    result = compute_oc_alignment(running_example_net(), ProcessExecution("big", tuple(events)), timeout_s=30)
    assert result.status == OPTIMAL
    assert result.exact
    assert result.cost == 1
    assert [(m.kind, m.model_activity, m.objects) for m in result.moves if m.kind != SYNC_MOVE] == [
        (MODEL_MOVE, "add sample", (("item", "i07"),))
    ]


# ---------------------------------------------------------------------------
# Diagnostics, bulk loading and batches
# ---------------------------------------------------------------------------


def test_no_alignment_names_an_unreachable_final_place():
    from totem_lib.oc_alignments import diagnose_no_alignment

    model = running_example_net()
    for place in model["places"]:
        if place["id"] == "it_sample_done":
            place["final"] = True  # an item would have to end in two places
    result = compute_oc_alignment(model, running_example_execution())
    assert result.status == NO_ALIGNMENT
    assert any('"item" object can never get' in d and "it_sample_done" in d for d in result.diagnostics)
    assert result.to_dict()["diagnostics"] == list(result.diagnostics)
    assert diagnose_no_alignment(net_from_ocpn_dict(model), running_example_execution())


def test_no_alignment_names_transitions_that_need_missing_object_types():
    execution = ProcessExecution(
        "i9",
        (
            make_event("1", "prepare sample", 1, {"item": ["i9"]}),
            make_event("2", "add sample", 2, {"item": ["i9"]}),
        ),
    )
    result = compute_oc_alignment(running_example_net(), execution)
    assert result.status == NO_ALIGNMENT
    assert any("receive sample order" in d and "'package'" in d for d in result.diagnostics)
    assert any("without objects in this execution: package" in d for d in result.diagnostics)


def test_bulk_loaders_match_single_loads(logs):
    _clean, deviating, _model = logs
    area = load_area_executions(deviating.conn, BUSINESS_TYPES, BUSINESS_ACTIVITIES)
    assert [e.execution_id for e in area] == ["i1", "i3", "i5"]
    for execution in area:
        single = load_area_execution(deviating.conn, BUSINESS_TYPES, BUSINESS_ACTIVITIES, execution.execution_id)
        assert single.events == execution.events
    stored = load_stored_executions(deviating.conn, "execution")
    assert {e.execution_id for e in stored} == {"i1", "i3", "i5"}
    for execution in stored:
        assert load_stored_execution(deviating.conn, "execution", execution.execution_id).events == execution.events


def test_batch_aligns_every_execution_and_aggregates(logs):
    from totem_lib.oc_alignments import SKIPPED, align_executions

    _clean, deviating, model = logs
    executions = load_stored_executions(deviating.conn, "execution")
    result = align_executions(model, executions).to_dict()
    assert result["total"] == 3
    assert result["aligned"] == 3 and result["fitting"] == 2
    assert result["status_counts"] == {OPTIMAL: 3}
    assert result["average_cost"] == pytest.approx(1 / 3)
    assert result["ignored_object_types"] == {"worker": 3}
    pick = next(r for r in result["deviations_by_activity"] if r["activity"] == "pick item")
    assert (pick["model"], pick["executions"]) == (1, 1)
    costs = {row["id"]: row["cost"] for row in result["rows"]}
    assert costs["i3"] == 1
    assert all("_per_activity" not in row for row in result["rows"])

    # A spent total budget skips the remaining executions instead of failing.
    stopped = align_executions(model, executions, total_timeout_s=1e-9).to_dict()
    assert stopped["stopped_early"]
    assert stopped["status_counts"][SKIPPED] >= 2

    with pytest.raises(AlignmentCancelled):
        align_executions(model, executions, should_cancel=lambda: True)
