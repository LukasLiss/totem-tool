"""End-to-end integration test for the advanced-simulation entrypoint.

Exercises ``OCProcessAreaSimulationModel.for_advanced_simulation`` the way the
backend view calls it — from a raw OCEL through TOTeM/MLPA discovery, process-area
filtering, state-space construction, and the full incremental playout — instead of
assembling the playout strategy by hand (as ``test_state_space_playout`` does).

Guards two historical defects:
- the entrypoint used to crash before it could run at all (audit A5);
- cooldowns/calendars must be discovered for the *resource* types passed in, not
  for the process area's object types (audit H1) — otherwise every real resource
  gets an empty (zero) cooldown and no calendar.
"""

import datetime as dt
import json
import random

import numpy as np
import polars as pl

from totem_lib.ocel.ocel import EVENTS_SCHEMA, OBJECTS_SCHEMA, ObjectCentricEventLog
from totem_lib.simulation.simulation import OCProcessAreaSimulationModel
from totem_lib.simulation.utils.process_area import ProcessArea

UTC = dt.timezone.utc
START = dt.datetime(2024, 1, 1, 9, 0, tzinfo=UTC)  # Monday 09:00
HOUR = 3600


def _ev(eid, activity, t, objs):
    return {
        "_eventId": eid,
        "_activity": activity,
        "_timestampUnix": t,
        "_objects": objs,
        "_qualifiers": [],
        "_attributes": "",
    }


def _ob(oid, otype, targets=None, quals=None):
    return {
        "_objId": oid,
        "_objType": otype,
        "_targetObjects": targets or [],
        "_qualifiers": quals or [],
    }


def _raw_order_log(n_cases=8):
    """A *raw* Order+2-Items log (create/pick/pick/ship) with a shared Worker
    resource that participates as a normal object.

    The Worker is a genuine object here (in ``_objects`` and o2o-free); the
    process area covers only Order/Item, so ``filter_by_process_area`` moves the
    Worker into each event's ``process_area_resources`` attribute — exactly the
    shape ``for_advanced_simulation`` expects. Orders carry an o2o edge to their
    Items so TOTeM discovery has a relation to work with.
    """
    events, objects, tid = [], [], 0
    workers = ["W0", "W1", "W2"]
    objects += [_ob(w, "Worker") for w in workers]
    base = int(START.timestamp())
    for c in range(n_cases):
        o, i1, i2 = f"o{c}", f"i{c}a", f"i{c}b"
        objects += [
            _ob(o, "Order", [i1, i2], ["has", "has"]),
            _ob(i1, "Item"),
            _ob(i2, "Item"),
        ]
        w = workers[c % 3]
        for activity, objs in [
            ("create", [o, w]),
            ("pick", [o, i1, w]),
            ("pick", [o, i2, w]),
            ("ship", [o, i1, i2, w]),
        ]:
            events.append(_ev(f"e{tid}", activity, base + tid * HOUR, objs))
            tid += 1
    return ObjectCentricEventLog(
        events=pl.DataFrame(events, schema=EVENTS_SCHEMA),
        objects=pl.DataFrame(objects, schema=OBJECTS_SCHEMA),
    )


def _process_area():
    return ProcessArea(
        object_types=["Order", "Item"], activities=["create", "pick", "ship"]
    )


def test_for_advanced_simulation_runs_end_to_end():
    """The entrypoint builds a model and completes instances end-to-end, staying
    within the source log's activity/object vocabulary (resources are not objects)."""
    random.seed(0)
    np.random.seed(0)
    model = OCProcessAreaSimulationModel.for_advanced_simulation(
        _raw_order_log(), _process_area(), resource_types=["Worker"]
    )
    sim_log, finished, spawned = model.run(
        sim_duration_s=3 * 24 * HOUR, resource_pool={"Worker": 3}
    )

    assert spawned > 0
    assert finished > 0
    assert sim_log.events.height > 0
    assert set(sim_log.events["_activity"].to_list()) <= {"create", "pick", "ship"}
    # Worker is a resource, not a process object, so it never lands in the objects.
    assert set(sim_log.objects["_objType"].to_list()) <= {"Order", "Item"}


def test_advanced_cooldowns_and_calendars_keyed_by_resource_type():
    """Cooldowns and calendars are discovered for the resource types passed in
    (Worker), not for the process area's object types (audit H1). A Worker-keyed
    cooldown is what actually gates the resource in the playout."""
    model = OCProcessAreaSimulationModel.for_advanced_simulation(
        _raw_order_log(), _process_area(), resource_types=["Worker"]
    )

    # Every activity's cooldown is keyed by the resource type, never by Order/Item.
    for per_type in model.resource_cooldown_distribution.values():
        assert set(per_type) <= {"Worker"}
    assert any(model.resource_cooldown_distribution.values())  # non-empty discovery
    assert set(model.type_calendars) == {"Worker"}


def test_advanced_simulation_actually_allocates_resources():
    """With resource types wired through, the playout allocates Worker resources
    (the machinery is not inert)."""
    random.seed(0)
    np.random.seed(0)
    model = OCProcessAreaSimulationModel.for_advanced_simulation(
        _raw_order_log(), _process_area(), resource_types=["Worker"]
    )
    sim_log, _, _ = model.run(sim_duration_s=3 * 24 * HOUR, resource_pool={"Worker": 3})

    used_types = set()
    for attrs in sim_log.events["_attributes"].to_list():
        if attrs:
            for rid in json.loads(attrs).get("process_area_resources", []):
                used_types.add(rid.rsplit("_", 1)[0])
    assert "Worker" in used_types
