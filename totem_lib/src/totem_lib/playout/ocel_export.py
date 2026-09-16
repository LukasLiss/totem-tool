"""
Serialization of playout variants to an OCEL 2.0 JSON dict.

Every variant becomes one process execution with its own fresh set of
objects (object ids are suffixed per variant), so the exported log's
object graph consists of perfectly disconnected components — one per
variant. Timestamps are deterministic: variants are one hour apart and
events within a variant one minute apart. Timestamps are formatted like
JS Date.toISOString() (`YYYY-MM-DDTHH:MM:SS.000Z`) so the output is
byte-compatible with the previous frontend export.
"""

from datetime import datetime, timedelta, timezone
from typing import List, Sequence

from .types import PlayoutVariant

_BASE_TIME = datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc)


def _iso_timestamp(dt: datetime) -> str:
    """Format like JS Date.toISOString(): milliseconds and a 'Z' suffix."""
    return f"{dt:%Y-%m-%dT%H:%M:%S}.{dt.microsecond // 1000:03d}Z"


def variants_to_ocel_dict(variants: Sequence[PlayoutVariant]) -> dict:
    """OCEL 2.0 JSON dict (matches totem_lib's import_ocel "json" format)."""
    object_types: set = set()
    event_types: set = set()
    objects: List[dict] = []
    events: List[dict] = []

    for v, variant in enumerate(variants):
        # Fresh objects per variant: "<type>_<k>" -> "<type>_<variant>_<k>".
        export_id = {}
        for ot, count in variant.object_counts.items():
            object_types.add(ot)
            for k in range(1, count + 1):
                obj_id = f"{ot}_{v + 1}_{k}"
                export_id[f"{ot}\x01{ot}_{k}"] = obj_id
                objects.append({"id": obj_id, "type": ot, "attributes": [], "relationships": []})
        for i, event in enumerate(variant.events):
            event_types.add(event.activity)
            relationships = [
                {"objectId": export_id[f"{ot}\x01{obj}"], "qualifier": ot}
                for ot in sorted(event.objects.keys())
                for obj in event.objects[ot]
            ]
            events.append(
                {
                    "id": f"e_{v + 1}_{i + 1}",
                    "type": event.activity,
                    "time": _iso_timestamp(_BASE_TIME + timedelta(hours=v, minutes=i)),
                    "attributes": [],
                    "relationships": relationships,
                }
            )

    return {
        "objectTypes": [{"name": name, "attributes": []} for name in sorted(object_types)],
        "eventTypes": [{"name": name, "attributes": []} for name in sorted(event_types)],
        "objects": objects,
        "events": events,
    }
