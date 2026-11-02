from tests.assets.ocel_helpers import event as _event
from tests.assets.ocel_helpers import make_ocel as _make_ocel
from tests.assets.ocel_helpers import obj as _object
from totem_lib.simulation.utils.resource_external_load import (
    discover_pa_capacity_shares,
)

# --- discover_pa_capacity_shares ---


def test_share_is_one_when_all_events_are_in_the_area():
    ocel = _make_ocel(
        [
            _event("e1", "Load", 0, ["r1"]),
            _event("e2", "Unload", 100, ["r1"]),
        ],
        [_object("r1", "Worker")],
    )
    assert discover_pa_capacity_shares(ocel, ["Worker"], ["Load", "Unload"]) == {
        "Worker": 1.0
    }


def test_share_is_the_event_fraction_inside_the_area():
    """Two of four Worker events belong to the area -> s = 0.5. Durations play
    no role: the long gap after Drive does not weigh it more."""
    ocel = _make_ocel(
        [
            _event("e1", "Load", 0, ["r1"]),
            _event("e2", "Drive", 10, ["r1"]),
            _event("e3", "Unload", 10_000, ["r1"]),
            _event("e4", "Drive", 10_010, ["r1"]),
        ],
        [_object("r1", "Worker")],
    )
    assert discover_pa_capacity_shares(ocel, ["Worker"], ["Load", "Unload"]) == {
        "Worker": 0.5
    }


def test_share_pools_the_instances_of_a_type():
    """r1 works only inside, r2 only outside: the type share pools both."""
    ocel = _make_ocel(
        [
            _event("e1", "Load", 0, ["r1"]),
            _event("e2", "Load", 10, ["r1"]),
            _event("e3", "Load", 20, ["r1"]),
            _event("e4", "Drive", 30, ["r2"]),
        ],
        [_object("r1", "Worker"), _object("r2", "Worker")],
    )
    assert discover_pa_capacity_shares(ocel, ["Worker"], ["Load"]) == {"Worker": 0.75}


def test_event_counts_once_per_resource_instance():
    """An event counts once for every distinct resource in it, and a resource
    listed twice in one event still counts once."""
    ocel = _make_ocel(
        [
            _event("e1", "Load", 0, ["r1", "r2"]),
            _event("e2", "Drive", 10, ["r1", "r1"]),
        ],
        [_object("r1", "Worker"), _object("r2", "Worker")],
    )
    assert discover_pa_capacity_shares(ocel, ["Worker"], ["Load"]) == {"Worker": 2 / 3}


def test_shares_are_per_resource_type():
    ocel = _make_ocel(
        [
            _event("e1", "Load", 0, ["w1", "c1"]),
            _event("e2", "Drive", 10, ["w1"]),
        ],
        [_object("w1", "Worker"), _object("c1", "Crane")],
    )
    assert discover_pa_capacity_shares(ocel, ["Worker", "Crane"], ["Load"]) == {
        "Worker": 0.5,
        "Crane": 1.0,
    }


def test_type_without_events_is_omitted():
    """No evidence about the type -> no entry; the playout treats it as s = 1."""
    ocel = _make_ocel(
        [_event("e1", "Load", 0, ["w1"])],
        [_object("w1", "Worker"), _object("c1", "Crane")],
    )
    assert discover_pa_capacity_shares(ocel, ["Worker", "Crane"], ["Load"]) == {
        "Worker": 1.0
    }


def test_non_resource_objects_are_ignored():
    """Process objects in the same events do not count towards any share."""
    ocel = _make_ocel(
        [
            _event("e1", "Load", 0, ["o1", "w1"]),
            _event("e2", "Drive", 10, ["o1"]),
        ],
        [_object("o1", "Order"), _object("w1", "Worker")],
    )
    assert discover_pa_capacity_shares(ocel, ["Worker"], ["Load"]) == {"Worker": 1.0}


def test_no_resource_types_gives_no_shares():
    ocel = _make_ocel(
        [_event("e1", "Load", 0, ["w1"])],
        [_object("w1", "Worker")],
    )
    assert discover_pa_capacity_shares(ocel, [], ["Load"]) == {}
