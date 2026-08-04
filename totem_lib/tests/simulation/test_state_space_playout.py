"""End-to-end tests for the state-space (advanced) playout strategy.

Drives ``StateSpacePlayoutStrategy`` through ``OCProcessAreaSimulationModel.run``
(assembled by hand — the ``for_advanced_simulation`` entrypoint is covered by
``test_advanced_simulation_entrypoint``) and checks that a simulated OCEL is
produced whose activities and object types come from the source log's vocabulary.
Each arrival draws an ``ObjectStructureVariant`` and the state space generates the
events over it, but the whole variant playout loop (resources/cooldowns/…) is
reused.
"""

import datetime as dt
import random

import numpy as np
import polars as pl

from totem_lib.ocel.ocel import EVENTS_SCHEMA, OBJECTS_SCHEMA, ObjectCentricEventLog
from totem_lib.simulation.simulation import (
    OCProcessAreaSimulationConfiguration,
    OCProcessAreaSimulationModel,
    StateSpacePlayoutStrategy,
)
from totem_lib.simulation.utils.resource_calendar import WEEKDAYS
from totem_lib.simulation.utils.state_space import StateSpaceModel
from totem_lib.variants.state_space_executions import find_object_structure_variants

UTC = dt.timezone.utc
START = dt.datetime(2024, 1, 1, 10, 0, tzinfo=UTC)  # Monday 10:00
HOUR = 3600


# --- fixtures & helpers ---


def _ev(eid, activity, t, objs):
    return {
        "_eventId": eid,
        "_activity": activity,
        "_timestampUnix": t,
        "_objects": objs,
        "_qualifiers": [],
        "_attributes": "",
    }


def _ob(oid, otype):
    return {"_objId": oid, "_objType": otype, "_targetObjects": [], "_qualifiers": []}


def _order_items_log(n_cases=4):
    """A few identical Order + two Items cases (create/pick/pick/ship)."""
    events, objects, tid = [], [], 0
    base = int(START.timestamp())
    for c in range(n_cases):
        o, i1, i2 = f"o{c}", f"i{c}a", f"i{c}b"
        objects += [_ob(o, "Order"), _ob(i1, "Item"), _ob(i2, "Item")]
        for activity, objs in [
            ("create", [o]),
            ("pick", [o, i1]),
            ("pick", [o, i2]),
            ("ship", [o, i1, i2]),
        ]:
            events.append(_ev(f"e{tid}", activity, base + tid * 60, objs))
            tid += 1
    return ObjectCentricEventLog(
        events=pl.DataFrame(events, schema=EVENTS_SCHEMA),
        objects=pl.DataFrame(objects, schema=OBJECTS_SCHEMA),
    )


def _flat_arrival(rate=3.0):
    per_hour = {h: rate for h in range(24)}
    return {"avg_arrivals_per_hour": {day: per_hour for day in WEEKDAYS}}


def _advanced_model(ocel):
    model = StateSpaceModel.build(ocel)
    structure_variants = find_object_structure_variants(ocel)
    arrival = {sv: _flat_arrival() for sv in structure_variants}
    playout = StateSpacePlayoutStrategy(model, structure_variants, arrival)
    return OCProcessAreaSimulationModel(
        playout_strategy=playout,
        resource_constraints={},
        resource_allocation_strategy={},
        resource_cooldown_distribution={},
        totem_model=None,
        needed_resources_per_activity={},  # no activity needs resources
        simulation_config=OCProcessAreaSimulationConfiguration(
            model_activity_durations=False
        ),
        source_log_start_unix=int(START.timestamp()),
        activity_delays={},
    )


# --- playout end-to-end ---


def test_state_space_playout_produces_events():
    """The advanced playout spawns, generates, and completes instances end-to-end."""
    random.seed(0)
    np.random.seed(0)
    model = _advanced_model(_order_items_log())
    ocel, finished, spawned = model.run(sim_duration_s=6 * HOUR, resource_pool={})

    assert spawned > 0
    assert finished > 0
    assert ocel.events.height > 0
    assert ocel.objects.height > 0
    # Activities and object types stay within the source log's vocabulary.
    assert set(ocel.events["_activity"].to_list()) <= {"create", "pick", "ship"}
    assert set(ocel.objects["_objType"].to_list()) <= {"Order", "Item"}


def test_state_space_playout_no_arrivals_is_empty():
    """A zero arrival rate spawns nothing."""
    random.seed(0)
    np.random.seed(0)
    ocel = _order_items_log()
    structure_variants = find_object_structure_variants(ocel)
    arrival = {sv: _flat_arrival(rate=0.0) for sv in structure_variants}
    playout = StateSpacePlayoutStrategy(
        StateSpaceModel.build(ocel), structure_variants, arrival
    )
    model = OCProcessAreaSimulationModel(
        playout_strategy=playout,
        resource_constraints={},
        resource_allocation_strategy={},
        resource_cooldown_distribution={},
        totem_model=None,
        needed_resources_per_activity={},
        simulation_config=OCProcessAreaSimulationConfiguration(
            model_activity_durations=False
        ),
        source_log_start_unix=int(START.timestamp()),
        activity_delays={},
    )
    ocel, finished, spawned = model.run(sim_duration_s=6 * HOUR, resource_pool={})
    assert spawned == 0
    assert finished == 0
    assert ocel.events.height == 0


def test_next_event_is_generated_in_the_loop_with_runtime_context(monkeypatch):
    """The playout generates each next event by calling ``step`` inside the loop,
    handing it a runtime context (the seam for runtime-conditioned generation)."""
    from totem_lib.simulation.utils import state_space as ss

    captured = []
    original_step = ss.ExecutionGenerator.step

    def spy_step(self, runtime_context=None):
        captured.append(runtime_context)
        return original_step(self, runtime_context)

    monkeypatch.setattr(ss.ExecutionGenerator, "step", spy_step)

    random.seed(0)
    np.random.seed(0)
    model = _advanced_model(_order_items_log())
    model.run(sim_duration_s=6 * HOUR, resource_pool={"Worker": 2})

    # step was invoked (lazy, in-loop generation) with a live runtime context.
    assert captured
    contexts = [rc for rc in captured if rc is not None]
    assert contexts
    assert "resource_utilization" in contexts[0]
    assert "Worker" in contexts[0]["resource_utilization"]
