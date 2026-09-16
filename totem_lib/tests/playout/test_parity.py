"""
Raw-mode parity tests: the new playout engine, driven through run_playout
with mode='raw', must count exactly the same number of valid binding
sequences as totem_lib's occn_playout (no interleaving pruning, no
symmetry reduction, no dedup).

The activity limits are built like the frontend did: every real activity
is limited to N (= max_bindings_per_activity) and the START_<ot>/END_<ot>
pseudo activities to the object count of their type. A handful of frozen
sequence counts from the frontend's pythonParity fixtures (generated with
a uniform limit, occn_playout's exact budget model) serve as an extra
cross-check.
"""

from copy import deepcopy

import pytest
from tests.assets.example_occns import (
    TEST_OCCN_FACTORIES,
    occn_ABC,
    occn_basic,
    occn_key,
    occn_multi,
    occn_multi_marker,
    occn_start_parallel,
)
from totem_lib.occn import occn_playout
from totem_lib.playout import PlayoutConfig, create_occn_engine, run_playout

# Per-case budget for the new engine's raw search; cases that exceed it are
# skipped so the whole suite stays fast.
PRECHECK_TIMEOUT_S = 5.0
PRECHECK_MAX_STATES = 1_500_000


def _net_to_marker_groups(net):
    """OCCausalNet back to the from_dict marker-groups shape."""

    def convert(groups):
        return [
            [
                (
                    marker.related_activity,
                    marker.object_type,
                    (
                        marker.min_count,
                        -1 if marker.max_count == float("inf") else marker.max_count,
                    ),
                    marker.marker_key,
                )
                for marker in group.markers
            ]
            for group in groups
        ]

    return {
        act: {
            "img": convert(net.input_marker_groups.get(act, [])),
            "omg": convert(net.output_marker_groups.get(act, [])),
        }
        for act in net.activities
    }


def _frontend_activity_limits(net, objects_per_type, max_bindings):
    """Real activities -> N; START_<ot>/END_<ot> -> object count of the type."""
    limits = {}
    for act in net.activities:
        if act.startswith("START_") or act.startswith("END_"):
            ot = act.split("_", 1)[1]
            limits[act] = objects_per_type.get(ot, 0)
        else:
            limits[act] = max_bindings
    return limits


def _run_raw(net, objects_per_type, activity_limits, default_limit=1):
    engine = create_occn_engine(
        sorted(net.object_types), _net_to_marker_groups(net), objects_per_type
    )
    return run_playout(
        engine,
        PlayoutConfig(
            mode="raw",
            objects_per_type=objects_per_type,
            activity_limits=activity_limits,
            default_activity_limit=default_limit,
            timeout_s=PRECHECK_TIMEOUT_S,
            max_stored_variants=0,
            max_states=PRECHECK_MAX_STATES,
        ),
    )


@pytest.mark.parametrize(
    "factory", TEST_OCCN_FACTORIES, ids=[f.__name__ for f in TEST_OCCN_FACTORIES]
)
@pytest.mark.parametrize("objects_per_type_count", [1, 2], ids=["obj1", "obj2"])
@pytest.mark.parametrize("max_bindings", [2, 3], ids=["N2", "N3"])
def test_raw_mode_matches_occn_playout(factory, objects_per_type_count, max_bindings):
    net = factory()
    objects_per_type = {ot: objects_per_type_count for ot in sorted(net.object_types)}

    result = _run_raw(
        net, objects_per_type, _frontend_activity_limits(net, objects_per_type, max_bindings)
    )
    if not result.exhaustive:
        pytest.skip("raw search exceeds the per-case budget")

    objects = {
        ot: {f"o{ot}{i}" for i in range(1, count + 1)}
        for ot, count in deepcopy(objects_per_type).items()
    }
    expected = len(
        list(occn_playout(factory(), objects, max_bindings_per_activity=max_bindings))
    )
    assert result.completed_runs == expected


@pytest.mark.parametrize(
    "order_count,max_bindings,expected",
    [
        (1, 3, 1),
        (2, 3, 252),
    ],
)
def test_occn_abc_known_sequence_counts(order_count, max_bindings, expected):
    net = occn_ABC()
    objects_per_type = {"order": order_count}
    result = _run_raw(
        net, objects_per_type, _frontend_activity_limits(net, objects_per_type, max_bindings)
    )
    assert result.exhaustive is True
    assert result.completed_runs == expected


# Frozen counts from frontend/src/playout/engine/__tests__/pythonParity.fixtures.ts,
# generated with occn_playout's uniform max_bindings_per_activity budget model
# (the limit applies to START_/END_ too), i.e. a uniform default limit here.
@pytest.mark.parametrize(
    "factory,objects_per_type,max_bindings,expected",
    [
        (occn_basic, {"order": 1, "item": 1}, 3, 4),
        (occn_basic, {"order": 1, "item": 2}, 3, 64),
        (occn_multi, {"order": 2}, 3, 43),
        (occn_multi_marker, {"order": 2}, 3, 18),
        (occn_start_parallel, {"order": 1}, 3, 10),
        (occn_ABC, {"order": 2}, 1, 0),
        (occn_key, {"order": 1}, 3, 0),
    ],
    ids=[
        "occn_basic-1-1",
        "occn_basic-1-2",
        "occn_multi-2",
        "occn_multi_marker-2",
        "occn_start_parallel-1",
        "occn_ABC-limit1",
        "occn_key-1",
    ],
)
def test_frozen_uniform_limit_sequence_counts(factory, objects_per_type, max_bindings, expected):
    net = factory()
    result = _run_raw(net, objects_per_type, {}, default_limit=max_bindings)
    assert result.exhaustive is True
    assert result.completed_runs == expected
