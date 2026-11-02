"""Tests for the flattened token-based replay on OCPNs (OCPN flattened replay)."""

from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from totem_lib.ocel.importer_db import import_ocel_db
from totem_lib.ocel.ocel_duckdb import OcelDuckDB, create_ocel_schema
from totem_lib.ocpn import (
    DuplicateTransitionLabelError,
    InvalidOCPNError,
    discover_ocpn_db,
    flattened_token_based_replay,
    flattened_token_based_replay_db,
)

TOTEM_LIB_DIR = Path(__file__).resolve().parents[2]
CONTAINER_LOGISTICS = TOTEM_LIB_DIR / "example_data" / "ContainerLogistics.json"


def _net(places, transitions, arcs, object_types=None):
    """Build a model dict; places: (id, type[, flags]); transitions: (id, label|None)."""
    types = object_types or sorted({p[1] for p in places})
    return {
        "format": "ocpn",
        "version": 1,
        "name": "test",
        "objectTypes": [{"name": t} for t in types],
        "places": [
            {"id": p[0], "objectType": p[1], **(p[2] if len(p) > 2 else {})}
            for p in places
        ],
        "transitions": [
            {"id": t, "label": label} if label is not None else {"id": t, "silent": True}
            for t, label in transitions
        ],
        "arcs": [
            {"id": f"a{i}", "source": s, "target": t} for i, (s, t) in enumerate(arcs)
        ],
    }


def _sequence_net():
    """order: start -> a -> p1 -> b -> p2 -> c -> end."""
    return _net(
        places=[
            ("start", "order", {"initial": True}),
            ("p1", "order"),
            ("p2", "order"),
            ("end", "order", {"final": True}),
        ],
        transitions=[("ta", "a"), ("tb", "b"), ("tc", "c")],
        arcs=[
            ("start", "ta"), ("ta", "p1"),
            ("p1", "tb"), ("tb", "p2"),
            ("p2", "tc"), ("tc", "end"),
        ],
    )


def _places(result):
    return {p.place_id: p for p in result.places.values()}


def test_fitting_trace_has_fitness_one():
    result = flattened_token_based_replay(
        _sequence_net(), {"order": {("a", "b", "c"): 3}}
    )
    (order,) = result.object_types
    assert order.num_objects == 3
    assert order.fitting_objects == 3
    assert order.fitness == pytest.approx(1.0)
    # Per object: p = 1 initial + 3 transitions, c = 3 transitions + 1 final.
    assert (order.produced, order.consumed, order.missing, order.remaining) == (12, 12, 0, 0)
    assert result.average_fitness == pytest.approx(1.0)
    assert _places(result)["p1"].produced == 3
    assert _places(result)["end"].consumed == 3


def test_skipped_activity_creates_missing_and_remaining_tokens():
    result = flattened_token_based_replay(_sequence_net(), {"order": {("a", "c"): 1}})
    (order,) = result.object_types
    # p = 1 (start) + 1 (a) + 1 (c) = 3; c = 1 (a) + 1 (c) + 1 (final) = 3
    assert (order.produced, order.consumed, order.missing, order.remaining) == (3, 3, 1, 1)
    assert order.fitness == pytest.approx(0.5 * (1 - 1 / 3) + 0.5 * (1 - 1 / 3))
    assert order.fitting_objects == 0
    places = _places(result)
    assert places["p2"].missing == 1
    assert places["p1"].remaining == 1
    assert places["start"].missing == 0 and places["start"].remaining == 0
    assert places["p1"].deviation == pytest.approx(1.0)


def test_book_example_trace_with_missing_and_remaining():
    """Token counts follow the book's worked example style: extra activity."""
    result = flattened_token_based_replay(_sequence_net(), {"order": {("a", "b", "b", "c"): 1}})
    (order,) = result.object_types
    # Second b misses a token in p1 and leaves an extra token in p2.
    assert order.missing == 1
    assert order.remaining == 1
    assert _places(result)["p1"].missing == 1
    assert _places(result)["p2"].remaining == 1


def test_silent_transition_skip_is_found_by_search():
    # a -> p1 -> (b | tau) -> p2 -> c
    model = _net(
        places=[
            ("start", "order", {"initial": True}),
            ("p1", "order"),
            ("p2", "order"),
            ("end", "order", {"final": True}),
        ],
        transitions=[("ta", "a"), ("tb", "b"), ("tau", None), ("tc", "c")],
        arcs=[
            ("start", "ta"), ("ta", "p1"),
            ("p1", "tb"), ("tb", "p2"),
            ("p1", "tau"), ("tau", "p2"),
            ("p2", "tc"), ("tc", "end"),
        ],
    )
    result = flattened_token_based_replay(model, {"order": {("a", "c"): 2, ("a", "b", "c"): 1}})
    (order,) = result.object_types
    assert order.fitness == pytest.approx(1.0)
    assert order.fitting_objects == 3
    # Silent firings count as produced/consumed tokens.
    assert _places(result)["p2"].produced == 3


def test_silent_chain_and_silent_path_to_end():
    # a -> p1 -> tau1 -> p2 -> tau2 -> end, and p2 -> b -> end (b optional)
    model = _net(
        places=[
            ("start", "order", {"initial": True}),
            ("p1", "order"),
            ("p2", "order"),
            ("p3", "order"),
            ("end", "order", {"final": True}),
        ],
        transitions=[("ta", "a"), ("t1", None), ("tb", "b"), ("t2", None)],
        arcs=[
            ("start", "ta"), ("ta", "p1"),
            ("p1", "t1"), ("t1", "p2"),
            ("p2", "tb"), ("tb", "p3"),
            ("p2", "t2"), ("t2", "p3"),
            ("p3", "t3"),
        ]
        + [],
    )
    # p3 is the end place (no outgoing arcs once we drop the dangling arc).
    model["arcs"] = [a for a in model["arcs"] if a["target"] != "t3"]
    model["places"] = [p for p in model["places"] if p["id"] != "end"]
    result = flattened_token_based_replay(model, {"order": {("a",): 1, ("a", "b"): 1}})
    (order,) = result.object_types
    assert order.fitness == pytest.approx(1.0)
    assert order.missing == 0 and order.remaining == 0


def test_parallel_split_with_silent_transitions():
    # tau_split -> (a || b) -> tau_join
    model = _net(
        places=[
            ("s", "x", {"initial": True}),
            ("pa", "x"), ("pb", "x"), ("qa", "x"), ("qb", "x"),
            ("e", "x", {"final": True}),
        ],
        transitions=[("split", None), ("ta", "a"), ("tb", "b"), ("join", None)],
        arcs=[
            ("s", "split"), ("split", "pa"), ("split", "pb"),
            ("pa", "ta"), ("ta", "qa"), ("pb", "tb"), ("tb", "qb"),
            ("qa", "join"), ("qb", "join"), ("join", "e"),
        ],
    )
    result = flattened_token_based_replay(
        model, {"x": {("a", "b"): 1, ("b", "a"): 1, ("a",): 1}}
    )
    (x,) = result.object_types
    assert x.num_objects == 3
    assert x.fitting_objects == 2
    # For <a> the join cannot fire (qb never gets a token): the end place
    # misses a token and the tokens in pb and qa remain.
    places = _places(result)
    assert places["e"].missing == 1
    assert places["pb"].remaining == 1
    assert places["qa"].remaining == 1
    assert places["qb"].missing == 0


def test_duplicate_visible_labels_raise():
    model = _net(
        places=[("s", "x", {"initial": True}), ("e", "x", {"final": True})],
        transitions=[("t1", "a"), ("t2", "a"), ("t3", None), ("t4", None)],
        arcs=[("s", "t1"), ("t1", "e"), ("s", "t2"), ("t2", "e")],
    )
    with pytest.raises(DuplicateTransitionLabelError) as info:
        flattened_token_based_replay(model, {"x": {("a",): 1}})
    assert info.value.labels == ["a"]
    assert "unique" in str(info.value)


def test_invalid_model_raises():
    with pytest.raises(InvalidOCPNError):
        flattened_token_based_replay({"places": []}, {})


def test_object_types_are_replayed_on_their_projection_only():
    # Shared transition "create" touches order and item; "pick" only item.
    model = _net(
        places=[
            ("o_s", "order", {"initial": True}), ("o_1", "order"),
            ("o_e", "order", {"final": True}),
            ("i_s", "item", {"initial": True}), ("i_1", "item"), ("i_2", "item"),
            ("i_e", "item", {"final": True}),
        ],
        transitions=[("create", "create"), ("pick", "pick"), ("ship", "ship")],
        arcs=[
            ("o_s", "create"), ("create", "o_1"), ("o_1", "ship"), ("ship", "o_e"),
            ("i_s", "create"), ("create", "i_1"), ("i_1", "pick"), ("pick", "i_2"),
            ("i_2", "ship"), ("ship", "i_e"),
        ],
        object_types=["order", "item"],
    )
    variants = {
        # "pick" is not part of the order net: it is ignored and reported.
        "order": {("create", "pick", "ship"): 2},
        # One item skips pick.
        "item": {("create", "pick", "ship"): 3, ("create", "ship"): 1},
    }
    result = flattened_token_based_replay(model, variants, log_object_types=["order", "item", "worker"])
    by_type = {r.object_type: r for r in result.object_types}
    assert by_type["order"].missing == 0 and by_type["order"].remaining == 0
    assert by_type["order"].fitness == pytest.approx(1.0)
    assert by_type["order"].unmapped_activities == {"pick": 2}
    assert by_type["order"].fitting_objects == 0  # unmapped events are deviations
    item = by_type["item"]
    assert item.num_objects == 4
    assert item.missing == 1 and item.remaining == 1
    expected_item = 0.5 * (1 - 1 / 15) + 0.5 * (1 - 1 / 15)
    assert item.fitness == pytest.approx(expected_item)
    assert result.average_fitness == pytest.approx((1.0 + expected_item) / 2)
    assert result.log_object_types_not_in_model == ["worker"]
    places = _places(result)
    assert places["i_2"].missing == 1
    assert places["i_1"].remaining == 1
    assert places["o_1"].missing == 0


def test_final_places_are_places_without_outgoing_arcs():
    # No flags at all: start = no incoming arcs, end = no outgoing arcs.
    model = _net(
        places=[("s", "x"), ("e", "x")],
        transitions=[("ta", "a")],
        arcs=[("s", "ta"), ("ta", "e")],
    )
    result = flattened_token_based_replay(model, {"x": {("a",): 1}})
    (x,) = result.object_types
    assert x.fitness == pytest.approx(1.0)
    assert x.warnings  # missing initial flag is reported


def test_type_without_objects_has_no_fitness_and_is_excluded_from_average():
    result = flattened_token_based_replay(_sequence_net(), {})
    (order,) = result.object_types
    assert order.fitness is None
    assert result.average_fitness is None


def test_to_dict_shape():
    payload = flattened_token_based_replay(
        _sequence_net(), {"order": {("a", "c"): 1}}
    ).to_dict()
    assert set(payload) == {
        "average_fitness",
        "object_types",
        "places",
        "log_object_types_not_in_model",
    }
    place = next(p for p in payload["places"] if p["place_id"] == "p1")
    assert place == {
        "place_id": "p1",
        "object_type": "order",
        "produced": 1,
        "consumed": 0,
        "missing": 0,
        "remaining": 1,
        "deviation": 1.0,
    }


# ---------------------------------------------------------------------------
# DuckDB integration: nets discovered by the inductive miner replay perfectly.
# ---------------------------------------------------------------------------


@pytest.fixture()
def paper_ocel_db():
    conn = duckdb.connect(":memory:")
    create_ocel_schema(conn, [], [])
    conn.executemany(
        "INSERT INTO events VALUES (?, ?, ?)",
        [
            ("e1", "place order", 1), ("e2", "pick item", 2), ("e3", "pick item", 3),
            ("e4", "complete order", 4), ("e5", "place order", 5),
            ("e6", "pick item", 6), ("e7", "complete order", 7),
        ],
    )
    conn.executemany(
        "INSERT INTO objects VALUES (?, ?)",
        [("o1", "order"), ("o2", "order"), ("i1", "item"), ("i2", "item"), ("i3", "item")],
    )
    conn.executemany(
        "INSERT INTO event_object VALUES (?, ?, NULL)",
        [
            ("e1", "o1"), ("e1", "i1"), ("e1", "i2"), ("e2", "i1"), ("e3", "i2"),
            ("e4", "o1"), ("e4", "i1"), ("e4", "i2"), ("e5", "o2"), ("e5", "i3"),
            ("e6", "i3"), ("e7", "o2"), ("e7", "i3"),
        ],
    )
    db = OcelDuckDB._from_prepared_connection(conn, [], [])
    yield db
    db.close()


def test_db_replay_of_discovered_net_fits(paper_ocel_db):
    model = discover_ocpn_db(paper_ocel_db)
    result = flattened_token_based_replay_db(model, paper_ocel_db)
    by_type = {r.object_type: r for r in result.object_types}
    assert by_type["order"].num_objects == 2
    assert by_type["item"].num_objects == 3
    assert by_type["order"].fitness == pytest.approx(1.0)
    assert by_type["item"].fitness == pytest.approx(1.0)
    assert result.average_fitness == pytest.approx(1.0)


def test_db_replay_detects_deviation(paper_ocel_db):
    model = discover_ocpn_db(paper_ocel_db)
    # Remove "pick item" from the log view: items now skip a mandatory step.
    paper_ocel_db.conn.execute("DELETE FROM event_object WHERE event_id = 'e6'")
    result = flattened_token_based_replay_db(model, paper_ocel_db)
    by_type = {r.object_type: r for r in result.object_types}
    assert by_type["item"].fitness < 1.0
    assert by_type["item"].missing > 0


@pytest.mark.skipif(not CONTAINER_LOGISTICS.exists(), reason="example log not available")
def test_container_logistics_discovered_net_fits():
    db = import_ocel_db(str(CONTAINER_LOGISTICS))
    try:
        model = discover_ocpn_db(db)
        result = flattened_token_based_replay_db(model, db)
        for type_result in result.object_types:
            assert type_result.fitness == pytest.approx(1.0), type_result.to_dict()
            assert type_result.silent_search_limit_hits == 0
    finally:
        db.close()
