import json
import polars as pl

from totem_lib.ocel.ocel import ObjectCentricEventLog, EVENTS_SCHEMA, OBJECTS_SCHEMA


def make_ocel(events, objects):
    # Allows easy OCEL creation within tests, without having to entier OCELs
    return ObjectCentricEventLog(
        events=pl.DataFrame(events, schema=EVENTS_SCHEMA),
        objects=pl.DataFrame(objects, schema=OBJECTS_SCHEMA),
    )


def event(eid, activity, t, objects, resources=None):
    return {
        "_eventId": eid,
        "_activity": activity,
        "_timestampUnix": t,
        "_objects": objects,
        "_qualifiers": [],
        "_attributes": json.dumps({"process_area_resources": resources}) if resources is not None else "",
    }


def obj(oid, otype):
    return {"_objId": oid, "_objType": otype, "_targetObjects": [], "_qualifiers": []}
