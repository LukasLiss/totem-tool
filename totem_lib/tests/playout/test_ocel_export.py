"""
Tests for the OCEL 2.0 export of playout variants (port of the frontend's
ocel.test.ts) plus a round trip through totem_lib's import_ocel.
"""

import json

from totem_lib import import_ocel
from totem_lib.playout import PlayoutEvent, PlayoutVariant, variants_to_ocel_dict

VARIANT_A = PlayoutVariant(
    events=[
        PlayoutEvent(activity="pack", visible=True, objects={"item": ["item_1", "item_2"]}),
        PlayoutEvent(
            activity="ship",
            visible=True,
            objects={"item": ["item_1", "item_2"], "order": ["order_1"]},
        ),
    ],
    object_counts={"item": 2, "order": 1},
)
VARIANT_B = PlayoutVariant(
    events=[
        PlayoutEvent(activity="pack", visible=True, objects={"item": ["item_1"]}),
        PlayoutEvent(activity="pack", visible=True, objects={"item": ["item_2"]}),
        PlayoutEvent(
            activity="ship",
            visible=True,
            objects={"item": ["item_1", "item_2"], "order": ["order_1"]},
        ),
    ],
    object_counts={"item": 2, "order": 1},
)


def test_every_variant_gets_its_own_disconnected_set_of_objects():
    ocel = variants_to_ocel_dict([VARIANT_A, VARIANT_B])

    assert [t["name"] for t in ocel["objectTypes"]] == ["item", "order"]
    assert [t["name"] for t in ocel["eventTypes"]] == ["pack", "ship"]
    # 3 objects per variant, ids namespaced by variant.
    assert sorted(o["id"] for o in ocel["objects"]) == sorted(
        ["item_1_1", "item_1_2", "order_1_1", "item_2_1", "item_2_2", "order_2_1"]
    )

    # Every event relationship must reference an existing object of the
    # event's own variant — the object graph has one component per variant.
    object_ids = {o["id"] for o in ocel["objects"]}
    for event in ocel["events"]:
        variant_of_event = event["id"].split("_")[1]
        assert len(event["relationships"]) > 0
        for rel in event["relationships"]:
            assert rel["objectId"] in object_ids
            variant_of_object = rel["objectId"].split("_")[-2]
            assert variant_of_object == variant_of_event

    # Timestamps increase within a variant and across variants.
    times = [e["time"] for e in ocel["events"]]
    assert sorted(times) == times
    assert len(set(times)) == len(times)


def test_timestamps_match_js_date_to_iso_string_format():
    ocel = variants_to_ocel_dict([VARIANT_A, VARIANT_B])
    times = [e["time"] for e in ocel["events"]]
    # Base time 2026-01-01T00:00:00Z, +1h per variant, +1min per event.
    assert times == [
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:01:00.000Z",
        "2026-01-01T01:00:00.000Z",
        "2026-01-01T01:01:00.000Z",
        "2026-01-01T01:02:00.000Z",
    ]


def test_round_trip_through_import_ocel(tmp_path):
    ocel_dict = variants_to_ocel_dict([VARIANT_A, VARIANT_B])
    path = tmp_path / "playout_export.json"
    path.write_text(json.dumps(ocel_dict), encoding="utf-8")

    ocel = import_ocel(str(path))

    # Every playout event references >= 1 object, so the importer's
    # schema-based filtering must not drop any event or object.
    assert ocel.events.height == 5
    assert set(ocel.events["_eventId"].to_list()) == {e["id"] for e in ocel_dict["events"]}
    assert ocel.objects.height == 6
    assert set(ocel.objects["_objId"].to_list()) == {o["id"] for o in ocel_dict["objects"]}
    for related in ocel.events["_objects"].to_list():
        assert len(related) > 0
