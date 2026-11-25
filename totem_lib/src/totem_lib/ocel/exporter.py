"""
Export a DuckDB-backed event log to the OCEL 2.0 exchange formats.

Reads the tables of the `OcelDuckDB` schema (`events`, `objects`,
`event_object`, `object_relations`, `object_attribute_history`) and writes
OCEL 2.0 JSON, XML or SQLite as described by the OCEL 2.0 specification
(https://www.ocel-standard.org):

- every event and every object is written, including events without objects
  and objects no event refers to;
- event attributes are the non-null attribute columns of `events`;
- object attributes are written with the time they took their value, from
  `object_attribute_history`. Values found only on `objects` (an object with
  no history row for that attribute) are written as initial values, at the
  Unix epoch;
- all attribute columns are VARCHAR, so every attribute is declared with the
  type ``string``;
- a missing qualifier is written as the empty string.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import duckdb

OCEL2_FORMATS = ("sqlite", "json", "xml")

_FIXED_EVENT_COLS = ("event_id", "activity", "timestamp_unix")
_FIXED_OBJECT_COLS = ("obj_id", "obj_type")
_FIXED_HISTORY_COLS = ("obj_id", "timestamp_unix")
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def export_ocel2(conn: duckdb.DuckDBPyConnection, dest_path: str, fmt: str) -> str:
    """
    Write the event log behind `conn` to `dest_path` as OCEL 2.0.

    Parameters
    ----------
    conn:
        A DuckDB connection holding the `OcelDuckDB` schema.
    dest_path:
        Output file. An existing file is replaced.
    fmt:
        ``"sqlite"``, ``"json"`` or ``"xml"``.

    Returns
    -------
    str
        `dest_path`.
    """
    writers = {"sqlite": _write_sqlite, "json": _write_json, "xml": _write_xml}
    if fmt not in writers:
        raise ValueError(
            f"Unsupported OCEL 2.0 format '{fmt}'. Supported: {', '.join(OCEL2_FORMATS)}"
        )
    log = _read_log(conn)
    if os.path.exists(dest_path):
        os.remove(dest_path)
    writers[fmt](log, dest_path)
    return dest_path


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


@dataclass
class _Event:
    event_id: str
    activity: str
    timestamp_unix: int
    attributes: Dict[str, str]
    #: (object id, qualifier)
    objects: List[Tuple[str, str]] = field(default_factory=list)


@dataclass
class _Object:
    obj_id: str
    obj_type: str
    #: (attribute, timestamp_unix, value), sorted by time
    attributes: List[Tuple[str, int, str]] = field(default_factory=list)
    #: (target object id, qualifier)
    objects: List[Tuple[str, str]] = field(default_factory=list)


@dataclass
class _Log:
    events: List[_Event]
    objects: List[_Object]

    def event_type_attributes(self) -> Dict[str, List[str]]:
        return _attributes_per_type(
            ((e.activity, e.attributes) for e in self.events)
        )

    def object_type_attributes(self) -> Dict[str, List[str]]:
        return _attributes_per_type(
            ((o.obj_type, [name for name, _, _ in o.attributes]) for o in self.objects)
        )


def _attributes_per_type(typed_attributes) -> Dict[str, List[str]]:
    """Every type, mapped to the attribute names used by any of its members."""
    per_type: Dict[str, set] = defaultdict(set)
    for type_name, names in typed_attributes:
        per_type[type_name].update(names)
    return {t: sorted(names) for t, names in sorted(per_type.items())}


def _columns(conn: duckdb.DuckDBPyConnection, table: str, fixed) -> List[str]:
    return [row[0] for row in conn.execute(f"DESCRIBE {table}").fetchall() if row[0] not in fixed]


def _ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _quoted(columns: List[str]) -> str:
    """Columns as a quoted list, each preceded by a comma."""
    return "".join(", " + _ident(c) for c in columns)


def _read_log(conn: duckdb.DuckDBPyConnection) -> _Log:
    event_cols = _columns(conn, "events", _FIXED_EVENT_COLS)
    object_cols = _columns(conn, "objects", _FIXED_OBJECT_COLS)
    history_cols = _columns(conn, "object_attribute_history", _FIXED_HISTORY_COLS)

    events: Dict[str, _Event] = {}
    for row in conn.execute(
        f"SELECT event_id, activity, timestamp_unix{_quoted(event_cols)} "
        "FROM events ORDER BY timestamp_unix, event_id"
    ).fetchall():
        attributes = {c: v for c, v in zip(event_cols, row[3:]) if v is not None}
        events[row[0]] = _Event(row[0], row[1], int(row[2]), attributes)
    for event_id, obj_id, qualifier in conn.execute(
        "SELECT event_id, obj_id, qualifier FROM event_object ORDER BY event_id, obj_id"
    ).fetchall():
        if event_id in events:
            events[event_id].objects.append((obj_id, qualifier or ""))

    objects: Dict[str, _Object] = {}
    current_values: Dict[str, Dict[str, str]] = {}
    for row in conn.execute(
        f"SELECT obj_id, obj_type{_quoted(object_cols)} FROM objects ORDER BY obj_id"
    ).fetchall():
        objects[row[0]] = _Object(row[0], row[1])
        current_values[row[0]] = {
            c: v for c, v in zip(object_cols, row[2:]) if v is not None
        }

    with_history: Dict[str, set] = defaultdict(set)
    for row in conn.execute(
        f"SELECT obj_id, timestamp_unix{_quoted(history_cols)} "
        "FROM object_attribute_history ORDER BY obj_id, timestamp_unix"
    ).fetchall():
        obj = objects.get(row[0])
        if obj is None:
            continue
        for name, value in zip(history_cols, row[2:]):
            if value is not None:
                obj.attributes.append((name, int(row[1]), value))
                with_history[obj.obj_id].add(name)
    for obj_id, values in current_values.items():
        obj = objects[obj_id]
        initial = [
            (name, 0, value)
            for name, value in values.items()
            if name not in with_history[obj_id]
        ]
        if initial:
            obj.attributes = sorted(initial + obj.attributes, key=lambda a: a[1])

    for source, target, qualifier in conn.execute(
        "SELECT source_obj_id, target_obj_id, qualifier FROM object_relations "
        "ORDER BY source_obj_id, target_obj_id"
    ).fetchall():
        if source in objects:
            objects[source].objects.append((target, qualifier or ""))

    return _Log(list(events.values()), list(objects.values()))


def _iso(timestamp_unix: int) -> str:
    # timedelta instead of datetime.fromtimestamp: the latter rejects
    # negative timestamps on Windows.
    return (_EPOCH + timedelta(seconds=timestamp_unix)).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# JSON
# ---------------------------------------------------------------------------


def _type_declarations(attributes_per_type: Dict[str, List[str]]) -> List[dict]:
    return [
        {"name": t, "attributes": [{"name": a, "type": "string"} for a in names]}
        for t, names in attributes_per_type.items()
    ]


def _relationships(pairs: List[Tuple[str, str]]) -> List[dict]:
    return [{"objectId": obj_id, "qualifier": qualifier} for obj_id, qualifier in pairs]


def _write_json(log: _Log, dest_path: str) -> None:
    document = {
        "objectTypes": _type_declarations(log.object_type_attributes()),
        "eventTypes": _type_declarations(log.event_type_attributes()),
        "objects": [
            {
                "id": o.obj_id,
                "type": o.obj_type,
                "attributes": [
                    {"name": name, "time": _iso(ts), "value": value}
                    for name, ts, value in o.attributes
                ],
                "relationships": _relationships(o.objects),
            }
            for o in log.objects
        ],
        "events": [
            {
                "id": e.event_id,
                "type": e.activity,
                "time": _iso(e.timestamp_unix),
                "attributes": [
                    {"name": name, "value": value} for name, value in e.attributes.items()
                ],
                "relationships": _relationships(e.objects),
            }
            for e in log.events
        ],
    }
    with open(dest_path, "w", encoding="utf-8") as f:
        json.dump(document, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# XML
# ---------------------------------------------------------------------------


def _xml_type_declarations(parent: ET.Element, tag: str, attributes_per_type) -> None:
    for type_name, names in attributes_per_type.items():
        element = ET.SubElement(parent, tag, {"name": type_name})
        attributes = ET.SubElement(element, "attributes")
        for name in names:
            ET.SubElement(attributes, "attribute", {"name": name, "type": "string"})


def _xml_relationships(parent: ET.Element, pairs: List[Tuple[str, str]]) -> None:
    objects = ET.SubElement(parent, "objects")
    for obj_id, qualifier in pairs:
        ET.SubElement(
            objects, "relationship", {"object-id": obj_id, "qualifier": qualifier}
        )


def _write_xml(log: _Log, dest_path: str) -> None:
    root = ET.Element("log")
    _xml_type_declarations(
        ET.SubElement(root, "object-types"), "object-type", log.object_type_attributes()
    )
    _xml_type_declarations(
        ET.SubElement(root, "event-types"), "event-type", log.event_type_attributes()
    )

    objects = ET.SubElement(root, "objects")
    for o in log.objects:
        element = ET.SubElement(objects, "object", {"id": o.obj_id, "type": o.obj_type})
        attributes = ET.SubElement(element, "attributes")
        for name, ts, value in o.attributes:
            ET.SubElement(attributes, "attribute", {"name": name, "time": _iso(ts)}).text = value
        _xml_relationships(element, o.objects)

    events = ET.SubElement(root, "events")
    for e in log.events:
        element = ET.SubElement(
            events,
            "event",
            {"id": e.event_id, "type": e.activity, "time": _iso(e.timestamp_unix)},
        )
        attributes = ET.SubElement(element, "attributes")
        for name, value in e.attributes.items():
            ET.SubElement(attributes, "attribute", {"name": name}).text = value
        _xml_relationships(element, e.objects)

    ET.indent(root)
    ET.ElementTree(root).write(dest_path, encoding="UTF-8", xml_declaration=True)


# ---------------------------------------------------------------------------
# SQLite
# ---------------------------------------------------------------------------


def _table_suffixes(type_names) -> Dict[str, str]:
    """
    The ``ocel_type_map`` of every type: its words joined in CamelCase,
    keeping only letters and digits ("receive order" -> "ReceiveOrder").

    SQLite table names are case-insensitive, so suffixes are made unique
    ignoring case, by appending a number where two types would collide.
    """
    suffixes: Dict[str, str] = {}
    taken = set()
    for type_name in type_names:
        words = [w for w in re.split(r"[\W_]+", type_name) if w]
        base = "".join(w[0].upper() + w[1:] for w in words) or "Type"
        suffix, n = base, 1
        while suffix.lower() in taken:
            n += 1
            suffix = f"{base}{n}"
        taken.add(suffix.lower())
        suffixes[type_name] = suffix
    return suffixes


def _write_sqlite(log: _Log, dest_path: str) -> None:
    event_types = log.event_type_attributes()
    object_types = log.object_type_attributes()
    event_suffix = _table_suffixes(event_types)
    object_suffix = _table_suffixes(object_types)

    con = sqlite3.connect(dest_path)
    try:
        con.executescript("""
            CREATE TABLE event_map_type (ocel_type TEXT PRIMARY KEY, ocel_type_map TEXT);
            CREATE TABLE object_map_type (ocel_type TEXT PRIMARY KEY, ocel_type_map TEXT);
            CREATE TABLE event (ocel_id TEXT PRIMARY KEY, ocel_type TEXT);
            CREATE TABLE object (ocel_id TEXT PRIMARY KEY, ocel_type TEXT);
            CREATE TABLE event_object (
                ocel_event_id TEXT, ocel_object_id TEXT, ocel_qualifier TEXT,
                PRIMARY KEY (ocel_event_id, ocel_object_id, ocel_qualifier)
            );
            CREATE TABLE object_object (
                ocel_source_id TEXT, ocel_target_id TEXT, ocel_qualifier TEXT,
                PRIMARY KEY (ocel_source_id, ocel_target_id, ocel_qualifier)
            );
        """)
        con.executemany("INSERT INTO event_map_type VALUES (?, ?)", event_suffix.items())
        con.executemany("INSERT INTO object_map_type VALUES (?, ?)", object_suffix.items())

        for type_name, names in event_types.items():
            columns = "".join(f", {_ident(n)} TEXT" for n in names)
            con.execute(
                f"CREATE TABLE {_ident('event_' + event_suffix[type_name])} "
                f"(ocel_id TEXT PRIMARY KEY, ocel_time TIMESTAMP{columns})"
            )
        for type_name, names in object_types.items():
            columns = "".join(f", {_ident(n)} TEXT" for n in names)
            con.execute(
                f"CREATE TABLE {_ident('object_' + object_suffix[type_name])} "
                f"(ocel_id TEXT, ocel_time TIMESTAMP{columns}, ocel_changed_field TEXT)"
            )

        con.executemany(
            "INSERT INTO event VALUES (?, ?)", ((e.event_id, e.activity) for e in log.events)
        )
        con.executemany(
            "INSERT INTO event_object VALUES (?, ?, ?)",
            ((e.event_id, obj_id, q) for e in log.events for obj_id, q in e.objects),
        )
        events_by_type = defaultdict(list)
        for e in log.events:
            events_by_type[e.activity].append(e)
        for type_name, names in event_types.items():
            table = _ident("event_" + event_suffix[type_name])
            con.executemany(
                f"INSERT INTO {table} (ocel_id, ocel_time{_quoted(names)}) "
                f"VALUES (?, ?{', ?' * len(names)})",
                (
                    [e.event_id, _iso(e.timestamp_unix)] + [e.attributes.get(n) for n in names]
                    for e in events_by_type[type_name]
                ),
            )

        con.executemany(
            "INSERT INTO object VALUES (?, ?)", ((o.obj_id, o.obj_type) for o in log.objects)
        )
        con.executemany(
            "INSERT INTO object_object VALUES (?, ?, ?)",
            ((o.obj_id, target, q) for o in log.objects for target, q in o.objects),
        )
        objects_by_type = defaultdict(list)
        for o in log.objects:
            objects_by_type[o.obj_type].append(o)
        for type_name, names in object_types.items():
            table = _ident("object_" + object_suffix[type_name])
            con.executemany(
                f"INSERT INTO {table} "
                f"(ocel_id, ocel_time{_quoted(names)}, ocel_changed_field) "
                f"VALUES (?, ?{', ?' * len(names)}, ?)",
                (row for o in objects_by_type[type_name] for row in _object_rows(o, names)),
            )
        con.commit()
    finally:
        con.close()


def _object_rows(obj: _Object, names: List[str]):
    """
    Rows of an object's type table: an initial row at the epoch holding the
    values the object starts with (``ocel_changed_field`` NULL), then one row
    per later value, naming the attribute it changes.
    """
    initial: Dict[str, Optional[str]] = {}
    changes = []
    for name, ts, value in obj.attributes:
        if ts == 0 and name not in initial:
            initial[name] = value
        else:
            changes.append((name, ts, value))
    yield [obj.obj_id, _iso(0)] + [initial.get(n) for n in names] + [None]
    for name, ts, value in changes:
        yield [obj.obj_id, _iso(ts)] + [value if n == name else None for n in names] + [name]
