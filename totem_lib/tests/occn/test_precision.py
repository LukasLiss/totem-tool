import json

import polars as pl
import pytest

from totem_lib import ObjectCentricEventLog, OCCausalNet, occn_precision
from totem_lib.ocel.ocel import EVENTS_SCHEMA, OBJECTS_SCHEMA


# --- Helpers -----------------------------------------------------------------


def make_ocel(events, objects):
    """
    Builds an ObjectCentricEventLog from short-hand data.

    events: list of (event_id, activity, timestamp, [object_ids])
    objects: list of (object_id, object_type)
    """
    events_df = pl.DataFrame(
        {
            "_eventId": [e[0] for e in events],
            "_activity": [e[1] for e in events],
            "_timestampUnix": [e[2] for e in events],
            "_objects": [e[3] for e in events],
            "_qualifiers": [[""] * len(e[3]) for e in events],
            "_attributes": ["{}" for _ in events],
        },
        schema=EVENTS_SCHEMA,
    )
    objects_df = pl.DataFrame(
        {
            "_objId": [o[0] for o in objects],
            "_objType": [o[1] for o in objects],
            "_targetObjects": [[] for _ in objects],
            "_qualifiers": [[] for _ in objects],
        },
        schema=OBJECTS_SCHEMA,
    )
    return ObjectCentricEventLog(events=events_df, objects=objects_df)


def sequential_net():
    """START_order -> a -> b -> END_order."""
    return {
        "START_order": {"omg": [[("a", "order", (1, 1), 0)]]},
        "a": {
            "img": [[("START_order", "order", (1, 1), 0)]],
            "omg": [[("b", "order", (1, 1), 0)]],
        },
        "b": {
            "img": [[("a", "order", (1, 1), 0)]],
            "omg": [[("END_order", "order", (1, 1), 0)]],
        },
        "END_order": {"img": [[("b", "order", (1, 1), 0)]]},
    }


def xor_net():
    """START_order -> (a XOR b) -> END_order."""
    return {
        "START_order": {
            "omg": [
                [("a", "order", (1, 1), 0)],
                [("b", "order", (1, 1), 0)],
            ]
        },
        "a": {
            "img": [[("START_order", "order", (1, 1), 0)]],
            "omg": [[("END_order", "order", (1, 1), 0)]],
        },
        "b": {
            "img": [[("START_order", "order", (1, 1), 0)]],
            "omg": [[("END_order", "order", (1, 1), 0)]],
        },
        "END_order": {
            "img": [
                [("a", "order", (1, 1), 0)],
                [("b", "order", (1, 1), 0)],
            ]
        },
    }


def flower_net():
    """
    Flower-like OCCN: after START, each of a, b, c can follow any of
    a, b, c (and START) arbitrarily often before END.
    """
    activities = ["a", "b", "c"]
    net = {
        "START_order": {
            "omg": [[(act, "order", (1, 1), 0)] for act in activities]
        },
        "END_order": {
            "img": [[(act, "order", (1, 1), 0)] for act in activities]
        },
    }
    for act in activities:
        net[act] = {
            "img": [[("START_order", "order", (1, 1), 0)]]
            + [[(other, "order", (1, 1), 0)] for other in activities],
            "omg": [[("END_order", "order", (1, 1), 0)]]
            + [[(other, "order", (1, 1), 0)] for other in activities],
        }
    return net


def airline_net():
    """
    Multi-type net inspired by the running example of Adams & van der
    Aalst (ICPM 2021): a plane is loaded with 1..2 baggage, lifts off and
    is unloaded; each baggage is picked up. Like the object-centric Petri
    net of the paper, the model allows baggage to be picked up directly
    after loading (skipping unload): the output marker group of `load`
    routes each baggage exclusively (shared key 5) to unload or pickup.
    """
    return {
        "START_plane": {"omg": [[("load", "plane", (1, 1), 0)]]},
        "START_baggage": {"omg": [[("load", "baggage", (1, 1), 0)]]},
        "load": {
            "img": [
                [
                    ("START_plane", "plane", (1, 1), 0),
                    ("START_baggage", "baggage", (1, 2), 0),
                ]
            ],
            "omg": [
                [
                    ("liftoff", "plane", (1, 1), 0),
                    ("unload", "baggage", (0, 2), 5),
                    ("pickup", "baggage", (0, 2), 5),
                ]
            ],
        },
        "liftoff": {
            "img": [[("load", "plane", (1, 1), 0)]],
            "omg": [[("unload", "plane", (1, 1), 0)]],
        },
        "unload": {
            "img": [
                [
                    ("liftoff", "plane", (1, 1), 0),
                    ("load", "baggage", (1, 2), 0),
                ]
            ],
            "omg": [
                [
                    ("END_plane", "plane", (1, 1), 0),
                    ("pickup", "baggage", (1, 2), 0),
                ]
            ],
        },
        "pickup": {
            "img": [
                [("load", "baggage", (1, 1), 0)],
                [("unload", "baggage", (1, 1), 0)],
            ],
            "omg": [[("END_baggage", "baggage", (1, 1), 0)]],
        },
        "END_plane": {"img": [[("unload", "plane", (1, 1), 0)]]},
        "END_baggage": {"img": [[("pickup", "baggage", (1, 1), 0)]]},
    }


def feedback_net(with_key: bool):
    """
    Net inspired by the running example of the OCCN conformance-checking
    paper: two orders receive feedback (r) together; afterwards each order
    is investigated (i) or not investigated (n), and finally the orders
    are archived together (one investigated, at least one not).

    With `with_key=True`, the output marker group of r forces every order
    exclusively to i or to n, with exactly one order being investigated
    (shared key). Without the key, each order can independently go to i,
    to n, or to both.
    """
    if with_key:
        r_omg = [
            [
                ("i", "order", (1, 1), 7),
                ("n", "order", (0, -1), 7),
            ]
        ]
    else:
        r_omg = [
            [
                ("i", "order", (0, -1), 0),
                ("n", "order", (0, -1), 0),
            ]
        ]
    return {
        "START_order": {"omg": [[("r", "order", (1, 1), 0)]]},
        "r": {
            "img": [[("START_order", "order", (2, 2), 0)]],
            "omg": r_omg,
        },
        "i": {
            "img": [[("r", "order", (1, -1), 0)]],
            "omg": [[("archive", "order", (1, -1), 0)]],
        },
        "n": {
            "img": [[("r", "order", (1, -1), 0)]],
            "omg": [[("archive", "order", (1, -1), 0)]],
        },
        "archive": {
            "img": [
                [
                    ("i", "order", (1, 1), 0),
                    ("n", "order", (1, -1), 0),
                ]
            ],
            "omg": [[("END_order", "order", (2, -1), 0)]],
        },
        "END_order": {
            "img": [[("archive", "order", (1, -1), 0)]],
        },
    }


# --- Basic behavior ----------------------------------------------------------


def test_perfectly_precise_sequential_model():
    ocel = make_ocel(
        events=[
            ("e1", "a", 1, ["o1"]),
            ("e2", "b", 2, ["o1"]),
            ("e3", "a", 3, ["o2"]),
            ("e4", "b", 4, ["o2"]),
        ],
        objects=[("o1", "order"), ("o2", "order")],
    )
    result = occn_precision(ocel, sequential_net())
    assert result.precision == pytest.approx(1.0)
    assert result.num_events == 4
    assert result.num_replayable_events == 4
    assert result.num_skipped_events == 0
    # both orders share the two contexts (empty prefix, prefix <a>)
    assert result.num_contexts == 2


def test_xor_model_unused_branch_is_escaping():
    # The model allows a XOR b, the log only ever does a.
    ocel = make_ocel(
        events=[("e1", "a", 1, ["o1"]), ("e2", "a", 2, ["o2"])],
        objects=[("o1", "order"), ("o2", "order")],
    )
    result = occn_precision(ocel, xor_net())
    assert result.precision == pytest.approx(0.5)
    detail = result.context_details[0]
    assert result.num_contexts == 1
    assert detail.enabled_log == frozenset({"a"})
    assert detail.enabled_model == frozenset({"a", "b"})
    assert detail.escaping == frozenset({"b"})
    assert detail.event_ids == ("e1", "e2")
    assert detail.replayable
    assert detail.contribution == pytest.approx(0.5)


def test_xor_model_with_both_branches_used_is_precise():
    ocel = make_ocel(
        events=[("e1", "a", 1, ["o1"]), ("e2", "b", 2, ["o2"])],
        objects=[("o1", "order"), ("o2", "order")],
    )
    result = occn_precision(ocel, xor_net())
    # both events share the empty-prefix context: en_log = en_model = {a, b}
    assert result.precision == pytest.approx(1.0)
    assert result.num_contexts == 1


def test_flower_model_has_low_precision():
    ocel = make_ocel(
        events=[
            ("e1", "a", 1, ["o1"]),
            ("e2", "b", 2, ["o1"]),
            ("e3", "c", 3, ["o1"]),
        ],
        objects=[("o1", "order")],
    )
    flower_result = occn_precision(ocel, flower_net())
    # in every context all three activities are enabled, one is observed
    assert flower_result.precision == pytest.approx(1 / 3)

    # a fitting sequential model of the same log is perfectly precise
    seq_abc = {
        "START_order": {"omg": [[("a", "order", (1, 1), 0)]]},
        "a": {
            "img": [[("START_order", "order", (1, 1), 0)]],
            "omg": [[("b", "order", (1, 1), 0)]],
        },
        "b": {
            "img": [[("a", "order", (1, 1), 0)]],
            "omg": [[("c", "order", (1, 1), 0)]],
        },
        "c": {
            "img": [[("b", "order", (1, 1), 0)]],
            "omg": [[("END_order", "order", (1, 1), 0)]],
        },
        "END_order": {"img": [[("c", "order", (1, 1), 0)]]},
    }
    seq_result = occn_precision(ocel, seq_abc)
    assert seq_result.precision == pytest.approx(1.0)
    assert flower_result.precision < seq_result.precision


# --- Multiple object types and object interaction ----------------------------


def test_airline_example_pickup_escapes_before_unload():
    # load(p1, b1, b2), liftoff(p1), unload(p1, b1, b2), pickup, pickup;
    # in the log baggage is only picked up after unloading, but the model
    # also allows picking it up directly after loading
    ocel = make_ocel(
        events=[
            ("e1", "load", 1, ["p1", "b1", "b2"]),
            ("e2", "liftoff", 2, ["p1"]),
            ("e3", "unload", 3, ["p1", "b1", "b2"]),
            ("e4", "pickup", 4, ["b1"]),
            ("e5", "pickup", 5, ["b2"]),
        ],
        objects=[("p1", "plane"), ("b1", "baggage"), ("b2", "baggage")],
    )
    result = occn_precision(ocel, airline_net())
    # e1: en_log = en_model = {load}                             -> 1
    # e2: en_log = {liftoff}, en_model = {liftoff, pickup}       -> 1/2
    # e3: en_log = {unload},  en_model = {unload, pickup}        -> 1/2
    # e4: en_log = en_model = {pickup}                           -> 1
    # e5: en_log = en_model = {pickup}                           -> 1
    assert result.precision == pytest.approx((1 + 0.5 + 0.5 + 1 + 1) / 5)
    liftoff_context = next(
        d for d in result.context_details if d.event_ids == ("e2",)
    )
    assert liftoff_context.enabled_model == frozenset({"liftoff", "pickup"})
    assert liftoff_context.escaping == frozenset({"pickup"})


def test_multiset_context_distinguishes_object_counts():
    # one plane loaded with one baggage vs. loaded with two baggage
    ocel = make_ocel(
        events=[
            ("e1", "load", 1, ["p1", "b1"]),
            ("e2", "liftoff", 2, ["p1"]),
            ("e3", "load", 3, ["p2", "b2", "b3"]),
            ("e4", "liftoff", 4, ["p2"]),
        ],
        objects=[
            ("p1", "plane"),
            ("p2", "plane"),
            ("b1", "baggage"),
            ("b2", "baggage"),
            ("b3", "baggage"),
        ],
    )
    result = occn_precision(ocel, airline_net())
    # the two liftoff events must not share a context: one depends on one
    # baggage, the other on two
    liftoff_contexts = [
        d for d in result.context_details if "liftoff" in d.enabled_log
    ]
    assert len(liftoff_contexts) == 2


# --- Keys and cardinalities (OCCN-specific characteristics) ------------------


def test_key_constraint_restricts_reachable_states():
    # r(o1, o2), i(o1), n(o2), archive(o1, o2)
    ocel = make_ocel(
        events=[
            ("e1", "r", 1, ["o1", "o2"]),
            ("e2", "i", 2, ["o1"]),
            ("e3", "n", 3, ["o2"]),
            ("e4", "archive", 4, ["o1", "o2"]),
        ],
        objects=[("o1", "order"), ("o2", "order")],
    )
    # i(o1) and n(o2) do not depend on each other, so they share a context
    # with en_log = en_model = {i, n}. With the key, after i and n no
    # obligation toward i or n remains, so the model is perfectly precise.
    keyed = occn_precision(ocel, feedback_net(with_key=True))
    assert keyed.precision == pytest.approx(1.0)

    # without the key, an order may go to i and to n at once, so in the
    # context of the archive event, i and n can still be enabled:
    # e4 -> |{archive}| / |{archive, i, n}| = 1/3
    unkeyed = occn_precision(ocel, feedback_net(with_key=False))
    assert unkeyed.precision == pytest.approx((1 + 1 + 1 + 1 / 3) / 4)
    assert unkeyed.precision < keyed.precision
    archive_context = next(
        d
        for d in unkeyed.context_details
        if d.event_ids == ("e4",)
    )
    assert archive_context.escaping == frozenset({"i", "n"})


def test_profile_granularity_penalizes_loose_cardinalities():
    # 'send' allows 1..3 orders per binding, the log always sends exactly 2
    card_net = {
        "START_order": {"omg": [[("send", "order", (1, 1), 0)]]},
        "send": {
            "img": [[("START_order", "order", (1, 3), 0)]],
            "omg": [[("END_order", "order", (1, 3), 0)]],
        },
        "END_order": {"img": [[("send", "order", (1, 1), 0)]]},
    }
    ocel = make_ocel(
        events=[("e1", "send", 1, ["o1", "o2"])],
        objects=[("o1", "order"), ("o2", "order")],
    )
    activity_result = occn_precision(ocel, card_net, granularity="activity")
    profile_result = occn_precision(ocel, card_net, granularity="profile")
    # at activity granularity the loose cardinality is invisible
    assert activity_result.precision == pytest.approx(1.0)
    # at profile granularity, send with 1 order escapes:
    # en_model = {(send, 1 order), (send, 2 orders)}, en_log = {(send, 2)}
    assert profile_result.precision == pytest.approx(0.5)
    detail = profile_result.context_details[0]
    assert detail.enabled_model == frozenset(
        {("send", (("order", 1),)), ("send", (("order", 2),))}
    )
    assert detail.escaping == frozenset({("send", (("order", 1),))})


def test_profile_granularity_key_group_exact_values():
    # r(o1, o2), i(o1), n(o2), archive(o1, o2) at profile granularity
    ocel = make_ocel(
        events=[
            ("e1", "r", 1, ["o1", "o2"]),
            ("e2", "i", 2, ["o1"]),
            ("e3", "n", 3, ["o2"]),
            ("e4", "archive", 4, ["o1", "o2"]),
        ],
        objects=[("o1", "order"), ("o2", "order")],
    )
    # keyed: at most one obligation toward i and toward n can exist, so
    # only batches of size 1 are enabled for i and n; every context is
    # perfectly precise
    keyed = occn_precision(
        ocel, feedback_net(with_key=True), granularity="profile"
    )
    assert keyed.precision == pytest.approx(1.0)

    # unkeyed: both orders may go to i and/or to n, so i/n batches of size
    # 2 are enabled as well:
    # e2, e3: en_model = {(i,1),(i,2),(n,1),(n,2)},
    #         en_log = {(i,1),(n,1)}                             -> 1/2
    # e4:     en_model = {(archive,2),(i,1),(n,1)},
    #         en_log = {(archive,2)}                             -> 1/3
    unkeyed = occn_precision(
        ocel, feedback_net(with_key=False), granularity="profile"
    )
    assert unkeyed.precision == pytest.approx((1 + 0.5 + 0.5 + 1 / 3) / 4)
    assert unkeyed.precision < keyed.precision


# --- Skipped events and unfitting logs ---------------------------------------


def test_unfitting_activity_gives_zero_contribution_but_is_not_skipped():
    # 'x' is not an activity of the model, but the context of e1 (a fresh
    # order) is replayable, so e1 counts with contribution 0
    ocel = make_ocel(
        events=[("e1", "x", 1, ["o1"])],
        objects=[("o1", "order")],
    )
    result = occn_precision(ocel, sequential_net())
    assert result.precision == pytest.approx(0.0)
    assert result.num_replayable_events == 1
    assert result.num_skipped_events == 0


def test_events_with_non_replayable_context_are_skipped():
    # e2 depends on e1 whose activity does not exist in the model, so the
    # context of e2 cannot be replayed and e2 is skipped
    ocel = make_ocel(
        events=[("e1", "x", 1, ["o1"]), ("e2", "a", 2, ["o1"])],
        objects=[("o1", "order")],
    )
    result = occn_precision(ocel, sequential_net())
    assert result.num_replayable_events == 1  # only e1
    assert result.num_skipped_events == 1
    skipped = next(d for d in result.context_details if not d.replayable)
    assert skipped.event_ids == ("e2",)
    assert skipped.contribution is None
    assert skipped.enabled_model == frozenset()


def test_unknown_object_type_makes_context_non_replayable():
    # the model has no START_ghost, so the context of e1 cannot be replayed
    ocel = make_ocel(
        events=[("e1", "a", 1, ["o1", "g1"])],
        objects=[("o1", "order"), ("g1", "ghost")],
    )
    result = occn_precision(ocel, sequential_net())
    assert result.num_replayable_events == 0
    assert result.num_skipped_events == 1
    assert result.precision == 0.0


def test_empty_log():
    ocel = make_ocel(events=[], objects=[])
    result = occn_precision(ocel, sequential_net())
    assert result.precision == 0.0
    assert result.num_events == 0
    assert result.num_contexts == 0
    assert result.context_details == []


# --- Input formats ------------------------------------------------------------


def editor_json(marker_groups):
    """Wraps marker groups in the OCCN editor JSON format (PR #243)."""
    # round-trip through JSON so tuples become lists as in a real file
    return json.loads(
        json.dumps(
            {
                "format": "occn",
                "version": 1,
                "name": "test",
                "objectTypes": [{"name": "order", "color": "#2563EB"}],
                "activities": [],
                "arcs": [],
                "markerGroups": marker_groups,
            }
        )
    )


def test_accepts_editor_json_dict():
    ocel = make_ocel(
        events=[("e1", "a", 1, ["o1"]), ("e2", "a", 2, ["o2"])],
        objects=[("o1", "order"), ("o2", "order")],
    )
    result = occn_precision(ocel, editor_json(xor_net()))
    assert result.precision == pytest.approx(0.5)


def test_accepts_json_string_and_file(tmp_path):
    ocel = make_ocel(
        events=[("e1", "a", 1, ["o1"]), ("e2", "a", 2, ["o2"])],
        objects=[("o1", "order"), ("o2", "order")],
    )
    text = json.dumps(editor_json(xor_net()))
    assert occn_precision(ocel, text).precision == pytest.approx(0.5)

    json_file = tmp_path / "model.occn.json"
    json_file.write_text(text, encoding="utf-8")
    assert occn_precision(ocel, str(json_file)).precision == pytest.approx(0.5)


def test_accepts_occausalnet_instance():
    ocel = make_ocel(
        events=[("e1", "a", 1, ["o1"])],
        objects=[("o1", "order")],
    )
    net = OCCausalNet.from_dict(sequential_net())
    result = occn_precision(ocel, net)
    assert result.precision == pytest.approx(1.0)


def test_rejects_wrong_format_and_types():
    ocel = make_ocel(
        events=[("e1", "a", 1, ["o1"])],
        objects=[("o1", "order")],
    )
    wrong_format = editor_json(xor_net())
    wrong_format["format"] = "ocpn"
    with pytest.raises(ValueError, match="format"):
        occn_precision(ocel, wrong_format)
    with pytest.raises(ValueError, match="JSON"):
        occn_precision(ocel, "not json {")
    with pytest.raises(TypeError):
        occn_precision(ocel, 42)
    with pytest.raises(ValueError, match="granularity"):
        occn_precision(ocel, sequential_net(), granularity="bogus")
    with pytest.raises(ValueError, match="max_states"):
        occn_precision(ocel, sequential_net(), max_states=0)


# --- Parameters ---------------------------------------------------------------


def test_event_ids_restrict_the_considered_log():
    # full log: o1 does a then b; considering only e1, the b event neither
    # contributes to contexts nor to the enabled log activities
    ocel = make_ocel(
        events=[("e1", "a", 1, ["o1"]), ("e2", "b", 2, ["o1"])],
        objects=[("o1", "order")],
    )
    full = occn_precision(ocel, sequential_net())
    only_first = occn_precision(ocel, sequential_net(), event_ids=["e1"])
    assert full.num_events == 2
    assert only_first.num_events == 1
    assert only_first.precision == pytest.approx(1.0)


def test_max_states_cap_skips_events():
    ocel = make_ocel(
        events=[("e1", "a", 1, ["o1"])],
        objects=[("o1", "order")],
    )
    # starting o1 on the XOR net branches into 2 states > cap
    result = occn_precision(ocel, xor_net(), max_states=1)
    assert result.num_state_capped_replays >= 1
    assert result.num_replayable_events == 0
    assert result.num_skipped_events == 1


def test_timestamp_ties_are_broken_by_log_order():
    ocel = make_ocel(
        events=[("e1", "a", 1, ["o1"]), ("e2", "b", 1, ["o1"])],
        objects=[("o1", "order")],
    )
    result = occn_precision(ocel, sequential_net())
    # e1 is treated as preceding e2, so the log fits and is precise
    assert result.precision == pytest.approx(1.0)


# --- Result invariants ---------------------------------------------------------


def test_contributions_are_consistent_with_precision():
    ocel = make_ocel(
        events=[
            ("e1", "load", 1, ["p1", "b1", "b2"]),
            ("e2", "liftoff", 2, ["p1"]),
            ("e3", "unload", 3, ["p1", "b1", "b2"]),
            ("e4", "pickup", 4, ["b1"]),
            ("e5", "pickup", 5, ["b2"]),
        ],
        objects=[("p1", "plane"), ("b1", "baggage"), ("b2", "baggage")],
    )
    result = occn_precision(ocel, airline_net())
    total = sum(
        d.contribution * len(d.event_ids)
        for d in result.context_details
        if d.replayable
    )
    assert result.precision == pytest.approx(
        total / result.num_replayable_events
    )
    assert sum(len(d.event_ids) for d in result.context_details) == (
        result.num_events
    )
    for detail in result.context_details:
        assert detail.escaping == detail.enabled_model - detail.enabled_log


def test_max_states_none_computes_exact_result():
    ocel = make_ocel(
        events=[
            ("e1", "r", 1, ["o1", "o2"]),
            ("e2", "i", 2, ["o1"]),
            ("e3", "n", 3, ["o2"]),
            ("e4", "archive", 4, ["o1", "o2"]),
        ],
        objects=[("o1", "order"), ("o2", "order")],
    )
    capped = occn_precision(ocel, feedback_net(with_key=False))
    exact = occn_precision(ocel, feedback_net(with_key=False), max_states=None)
    assert exact.num_state_capped_replays == 0
    assert exact.precision == pytest.approx(capped.precision)
    assert exact.precision == pytest.approx((1 + 1 + 1 + 1 / 3) / 4)


def test_editor_json_with_unbounded_cardinalities_and_keys():
    # the editor JSON path with max = -1 markers and a shared-key group
    ocel = make_ocel(
        events=[
            ("e1", "r", 1, ["o1", "o2"]),
            ("e2", "i", 2, ["o1"]),
            ("e3", "n", 3, ["o2"]),
            ("e4", "archive", 4, ["o1", "o2"]),
        ],
        objects=[("o1", "order"), ("o2", "order")],
    )
    as_json = editor_json(feedback_net(with_key=True))
    result = occn_precision(ocel, as_json)
    assert result.precision == pytest.approx(1.0)


def test_replay_consumes_obligations_from_multiple_predecessors():
    # 'a' produces obligations for the same order toward b AND s (AND
    # split); s consumes the obligations from a and from b at once
    net = {
        "START_order": {"omg": [[("a", "order", (1, 1), 0)]]},
        "a": {
            "img": [[("START_order", "order", (1, 1), 0)]],
            "omg": [
                [("b", "order", (1, 1), 1), ("s", "order", (1, 1), 2)],
            ],
        },
        "b": {
            "img": [[("a", "order", (1, 1), 0)]],
            "omg": [[("s", "order", (1, 1), 0)]],
        },
        "s": {
            "img": [
                [("a", "order", (1, 1), 1), ("b", "order", (1, 1), 2)],
            ],
            "omg": [[("END_order", "order", (1, 1), 0)]],
        },
        "END_order": {"img": [[("s", "order", (1, 1), 0)]]},
    }
    ocel = make_ocel(
        events=[
            ("e1", "a", 1, ["o1"]),
            ("e2", "b", 2, ["o1"]),
            ("e3", "s", 3, ["o1"]),
        ],
        objects=[("o1", "order")],
    )
    result = occn_precision(ocel, net)
    # e1: en = {a}; e2: s not yet enabled (needs b's obligation) -> {b};
    # e3: {s}; everything observed
    assert result.precision == pytest.approx(1.0)
    assert result.num_skipped_events == 0


def test_profile_granularity_multiple_object_types():
    ocel = make_ocel(
        events=[
            ("e1", "load", 1, ["p1", "b1", "b2"]),
            ("e2", "liftoff", 2, ["p1"]),
            ("e3", "unload", 3, ["p1", "b1", "b2"]),
            ("e4", "pickup", 4, ["b1"]),
            ("e5", "pickup", 5, ["b2"]),
        ],
        objects=[("p1", "plane"), ("b1", "baggage"), ("b2", "baggage")],
    )
    result = occn_precision(ocel, airline_net(), granularity="profile")
    # e1: en_model = {load w/ 1 baggage, load w/ 2 baggage}          -> 1/2
    # e2: en_model = {liftoff, pickup w/ 1 baggage}                  -> 1/2
    # e3: en_model = {unload w/ 1 baggage, unload w/ 2, pickup w/ 1} -> 1/3
    # e4, e5: en_model = {pickup w/ 1 baggage}                       -> 1, 1
    assert result.precision == pytest.approx((0.5 + 0.5 + 1 / 3 + 1 + 1) / 5)
    load_context = next(
        d for d in result.context_details if d.event_ids == ("e1",)
    )
    assert load_context.enabled_model == frozenset(
        {
            ("load", (("baggage", 1), ("plane", 1))),
            ("load", (("baggage", 2), ("plane", 1))),
        }
    )
