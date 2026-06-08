import json
import os
from datetime import datetime, timezone

from . import ObjectCentricEventLog


def export_ocel(
    filename: str,
    ocel: ObjectCentricEventLog,
    file_format: str = "csv",
    file_path: str | None = None,
) -> str:
    """
    Exports the given OCEL to a file in the specified format.

    Args:
        filename: name of the output file (without extension)
        ocel: OCEL to export
        file_format: format to export to
        file_path: optional path to export to; if not given, exports to current working directory

    Returns:
        str: the full path of the written file.
    """
    exporters = {
        "json": export_ocel_to_json,
    }

    if file_format not in exporters:
        raise ValueError(
            f"Unsupported file format: {file_format}. "
            f"Supported formats: {list(exporters.keys())}"
        )
    exporter = exporters[file_format]

    full_path = (
        os.path.join(file_path, f"{filename}.{file_format}")
        if file_path
        else f"{filename}.{file_format}"
    )

    if file_path:
        os.makedirs(file_path, exist_ok=True)

    exporter(ocel, full_path)
    return full_path


def _unix_to_iso(timestamp_unix: int | None) -> str:
    """Converts a Unix timestamp (seconds) to an ISO 8601 string in UTC."""
    if timestamp_unix is None:
        raise ValueError(
            "OCEL export requires non-null timestamps; got None for _timestampUnix."
        )
    return datetime.fromtimestamp(int(timestamp_unix), tz=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%S.000Z"
    )


def _infer_ocel_type(value) -> str:
    """Infers the OCEL 2.0 attribute type for a Python value.

    Maps to one of the OCEL 2.0 primitive types. ``bool`` is checked before
    ``int`` because ``bool`` is a subclass of ``int``. Strings (including
    ISO timestamps) are reported as ``"string"``; ``"time"`` is not inferred.
    """
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "float"
    return "string"


def export_ocel_to_json(ocel: ObjectCentricEventLog, full_path: str) -> None:
    """
    Exports an OCEL to an OCEL 2.0 JSON file

    Args:
        ocel: The object-centric event log to export.
        full_path: The full path (including filename and extension) to write to.

    Raises:
        ValueError: If an event or object attribute record has a null timestamp.
    """
    obj_type_map = ocel.obj_type_map

    # Track attribute name & Inferred type => Widen to String if conflicting
    event_type_attrs: dict[str, dict[str, str]] = {}
    object_type_attrs: dict[str, dict[str, str]] = {}

    def register_attr_type(registry: dict, type_key: str, name: str, value) -> None:
        inferred = _infer_ocel_type(value)
        attrs = registry.setdefault(type_key, {})
        existing = attrs.get(name)
        attrs[name] = (
            "string" if existing is not None and existing != inferred else inferred
        )

    has_attributes = "_attributes" in ocel.events.columns

    # --- Events -------------------------------------------------------------
    events_json = []
    event_columns = [
        "_eventId",
        "_activity",
        "_timestampUnix",
        "_objects",
        "_qualifiers",
    ]
    if has_attributes:
        event_columns.append("_attributes")
    events_iter = ocel.events.select(event_columns).iter_rows(named=True)

    for event in events_iter:
        activity = event["_activity"]
        objects = event["_objects"] or []
        qualifiers = event["_qualifiers"] or []

        relationships = [
            {
                "objectId": obj_id,
                "qualifier": qualifiers[idx] if idx < len(qualifiers) else "",
            }
            for idx, obj_id in enumerate(objects)
        ]

        attributes = []
        attributes_json = event["_attributes"] if has_attributes else None
        if attributes_json:
            try:
                parsed = json.loads(attributes_json)
            except json.JSONDecodeError:
                parsed = {}
            for key, value in parsed.items():
                attributes.append({"name": key, "value": value})
                register_attr_type(event_type_attrs, activity, key, value)

        event_type_attrs.setdefault(activity, {})
        events_json.append(
            {
                "id": event["_eventId"],
                "type": activity,
                "time": _unix_to_iso(event["_timestampUnix"]),
                "attributes": attributes,
                "relationships": relationships,
            }
        )

    # --- Object attributes (grouped by object id) ---------------------------
    obj_attributes: dict[str, list[dict]] = {}
    if ocel.object_attributes.height > 0:
        attr_iter = (
            ocel.object_attributes.sort("_timestampUnix")
            .select(["_objId", "_timestampUnix", "_jsonObjAttributes"])
            .iter_rows(named=True)
        )
        for record in attr_iter:
            obj_id = record["_objId"]
            attributes_json = record["_jsonObjAttributes"]
            if not attributes_json:
                continue
            try:
                parsed = json.loads(attributes_json)
            except json.JSONDecodeError:
                continue
            time_iso = _unix_to_iso(record["_timestampUnix"])
            obj_type = obj_type_map.get(obj_id, "UNKNOWN")
            for key, value in parsed.items():
                obj_attributes.setdefault(obj_id, []).append(
                    {"name": key, "value": value, "time": time_iso}
                )
                register_attr_type(object_type_attrs, obj_type, key, value)

    # --- Objects ------------------------------------------------------------
    objects_json = []
    objects_iter = ocel.objects.select(
        ["_objId", "_objType", "_targetObjects", "_qualifiers"]
    ).iter_rows(named=True)

    for obj in objects_iter:
        obj_id = obj["_objId"]
        obj_type = obj["_objType"]
        targets = obj["_targetObjects"] or []
        qualifiers = obj["_qualifiers"] or []

        relationships = [
            {
                "objectId": target_id,
                "qualifier": qualifiers[idx] if idx < len(qualifiers) else "",
            }
            for idx, target_id in enumerate(targets)
        ]

        object_type_attrs.setdefault(obj_type, {})
        objects_json.append(
            {
                "id": obj_id,
                "type": obj_type,
                "attributes": obj_attributes.get(obj_id, []),
                "relationships": relationships,
            }
        )

    # --- Type declarations --------------------------------------------------
    object_types_json = [
        {
            "name": obj_type,
            "attributes": [
                {"name": name, "type": attr_type}
                for name, attr_type in sorted(attrs.items())
            ],
        }
        for obj_type, attrs in sorted(object_type_attrs.items())
    ]
    event_types_json = [
        {
            "name": activity,
            "attributes": [
                {"name": name, "type": attr_type}
                for name, attr_type in sorted(attrs.items())
            ],
        }
        for activity, attrs in sorted(event_type_attrs.items())
    ]

    ocel_json = {
        "objectTypes": object_types_json,
        "eventTypes": event_types_json,
        "objects": objects_json,
        "events": events_json,
    }

    with open(full_path, "w", encoding="utf-8") as f:
        json.dump(ocel_json, f, ensure_ascii=False, indent=2)
