"""
Generate the tiny "orders, items, packages and one worker" example logs.

The logs are deliberately small enough to check every step of the
resource-aware workflow by hand:

* four orders; ``o1`` and ``o2`` are independent and get their own package,
  ``o3`` and ``o4`` share package ``p3``;
* every item is picked, packed and shipped by the single worker ``w1``, who
  therefore connects *all* objects -- classic connected components collapse
  the whole log into one execution, the resource-aware extraction does not;
* ``w1`` also has two worker-only events (``start shift`` / ``end shift``)
  that belong to no order at all.

``resource_aware_orders.json`` is the clean log; in
``resource_aware_orders_deviating.json`` the event ``pick item`` for item
``i4`` (order ``o2``) is missing, so an OCCN mined from the clean log finds
one non-fitting execution in the deviating one.

Run from the totem_lib directory::

    python3 examples/generate_resource_aware_logs.py

The files are written to ``test_data/small/`` and are also referenced by the
tests in ``tests/variants/test_resource_aware.py``.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "test_data" / "small"
CLEAN = OUT_DIR / "resource_aware_orders.json"
DEVIATING = OUT_DIR / "resource_aware_orders_deviating.json"

START = datetime(2026, 3, 2, 8, 0, tzinfo=timezone.utc)

OBJECTS = {
    "order": ["o1", "o2", "o3", "o4"],
    "item": ["i1", "i2", "i3", "i4", "i5", "i6"],
    "package": ["p1", "p2", "p3"],
    "worker": ["w1"],
}
ORDER_ITEMS = {"o1": ["i1", "i2"], "o2": ["i3", "i4"], "o3": ["i5"], "o4": ["i6"]}
PACKAGE_ITEMS = {"p1": ["i1", "i2"], "p2": ["i3", "i4"], "p3": ["i5", "i6"]}

# (event id, activity, objects) -- timestamps are one hour apart in this order.
EVENTS = [
    ("e01", "start shift", ["w1"]),
    ("e02", "place order", ["o1", "i1", "i2"]),
    ("e03", "place order", ["o2", "i3", "i4"]),
    ("e04", "pick item", ["i1", "w1"]),
    ("e05", "pick item", ["i2", "w1"]),
    ("e06", "pack items", ["p1", "i1", "i2", "w1"]),
    ("e07", "ship package", ["p1", "w1"]),
    ("e08", "close order", ["o1", "w1"]),
    ("e09", "pick item", ["i3", "w1"]),
    ("e10", "pick item", ["i4", "w1"]),
    ("e11", "pack items", ["p2", "i3", "i4", "w1"]),
    ("e12", "ship package", ["p2", "w1"]),
    ("e13", "close order", ["o2", "w1"]),
    ("e14", "place order", ["o3", "i5"]),
    ("e15", "place order", ["o4", "i6"]),
    ("e16", "pick item", ["i5", "w1"]),
    ("e17", "pick item", ["i6", "w1"]),
    ("e18", "pack items", ["p3", "i5", "i6", "w1"]),
    ("e19", "ship package", ["p3", "w1"]),
    ("e20", "close order", ["o3", "w1"]),
    ("e21", "close order", ["o4", "w1"]),
    ("e22", "end shift", ["w1"]),
]

#: Removed from the deviating log: the pick of item i4 (order o2).
MISSING_IN_DEVIATING_LOG = {"e10"}

OBJECT_TYPE_OF = {obj: ot for ot, objs in OBJECTS.items() for obj in objs}


def build_log(skip_event_ids: set[str] | None = None) -> dict:
    skip = skip_event_ids or set()
    activities = sorted({activity for _, activity, _ in EVENTS})

    objects = []
    for object_type, ids in OBJECTS.items():
        for obj_id in ids:
            relationships = []
            for item in ORDER_ITEMS.get(obj_id, []):
                relationships.append({"objectId": item, "qualifier": "contains"})
            for item in PACKAGE_ITEMS.get(obj_id, []):
                relationships.append({"objectId": item, "qualifier": "packs"})
            objects.append(
                {
                    "id": obj_id,
                    "type": object_type,
                    "attributes": [],
                    "relationships": relationships,
                }
            )

    events = []
    for index, (event_id, activity, obj_ids) in enumerate(EVENTS):
        if event_id in skip:
            continue
        timestamp = START + timedelta(hours=index)
        events.append(
            {
                "id": event_id,
                "type": activity,
                "time": timestamp.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "attributes": [],
                "relationships": [
                    {"objectId": obj_id, "qualifier": OBJECT_TYPE_OF[obj_id]}
                    for obj_id in obj_ids
                ],
            }
        )

    return {
        "objectTypes": [{"name": ot, "attributes": []} for ot in OBJECTS],
        "eventTypes": [{"name": activity, "attributes": []} for activity in activities],
        "objects": objects,
        "events": events,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    CLEAN.write_text(json.dumps(build_log(), indent=2) + "\n", encoding="utf-8")
    DEVIATING.write_text(
        json.dumps(build_log(MISSING_IN_DEVIATING_LOG), indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {CLEAN}")
    print(f"wrote {DEVIATING}")


if __name__ == "__main__":
    main()
