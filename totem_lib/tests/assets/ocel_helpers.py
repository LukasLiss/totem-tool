import polars as pl

from totem_lib.ocel.ocel import ObjectCentricEventLog


def make_ocel(events, objects):
    return ObjectCentricEventLog(
        events=pl.DataFrame(events),
        objects=pl.DataFrame(objects),
    )


def event(eid, activity, t, objects):
    return {
        "_eventId": eid,
        "_activity": activity,
        "_timestampUnix": t,
        "_objects": objects,
        "_qualifiers": [],
        "_attributes": "",
    }


def obj(oid, otype):
    return {"_objId": oid, "_objType": otype, "_targetObjects": [], "_qualifiers": []}
