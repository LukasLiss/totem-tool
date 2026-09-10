"""
OCEL editor — all mutation, query and export logic for the OCEL editor UI.

The editor operates on a *working copy* of an event log stored as a native
DuckDB file (the same schema as `OcelDuckDB` / `create_ocel_schema`). The
Django backend is a thin HTTP layer around this class: every request opens
(or reuses) an `OcelEditor` for the session's working file and calls exactly
one method here.

Design notes
------------
- Attribute columns are dynamic (VARCHAR) exactly like `OcelDuckDB`. Writing
  an attribute key that has no column yet issues `ALTER TABLE ADD COLUMN` on
  the fly (for objects: on both `objects` and `object_attribute_history`).
- Object attribute edits are mirrored into `object_attribute_history` so the
  attribute values survive a round trip through the polars importer
  (`import_ocel_from_duckdb`) and therefore into every export format.
- All list methods are paginated and support server-side filtering/sorting,
  so the frontend never has to hold the full log.
"""

from __future__ import annotations

import os
import re
import shutil
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import duckdb
import polars as pl

from .ocel_duckdb import create_ocel_schema

_FIXED_EVENT_COLS = ("event_id", "activity", "timestamp_unix")
_FIXED_OBJ_COLS = ("obj_id", "obj_type")

# Only sane identifier-ish attribute names become SQL columns. This is the
# same character set OCEL 2.0 attribute names use in practice and it keeps
# the quoted-identifier SQL below trivially injection-safe.
_ATTR_NAME_RE = re.compile(r"^[A-Za-z0-9_ .:+#/()\[\]-]{1,64}$")

EXPORT_FORMATS = ("duckdb", "sqlite", "json", "xml")


class OcelEditorError(ValueError):
    """User-facing validation error (maps to HTTP 400 in the backend)."""


def _validate_attr_name(name: str) -> str:
    if not isinstance(name, str) or not _ATTR_NAME_RE.match(name):
        raise OcelEditorError(
            f"Invalid attribute name {name!r}. Use 1-64 characters: "
            "letters, digits, spaces and _.:-+#/()[]"
        )
    return name


def _validate_id(value: str, what: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise OcelEditorError(f"{what} must be a non-empty string.")
    if len(value) > 256:
        raise OcelEditorError(f"{what} must be at most 256 characters.")
    return value.strip()


def latex_escape(text: str) -> str:
    """Escape LaTeX special characters in a plain-text cell."""
    replacements = {
        "\\": r"\textbackslash{}",
        "&": r"\&",
        "%": r"\%",
        "$": r"\$",
        "#": r"\#",
        "_": r"\_",
        "{": r"\{",
        "}": r"\}",
        "~": r"\textasciitilde{}",
        "^": r"\textasciicircum{}",
    }
    return "".join(replacements.get(ch, ch) for ch in str(text))


def _format_ts(ts_unix: int) -> str:
    """Timestamp cell format used in the LaTeX export: dd.mm.yy HH:MM."""
    return datetime.fromtimestamp(int(ts_unix), tz=timezone.utc).strftime(
        "%d.%m.%y %H:%M"
    )


class OcelEditor:
    """
    Read-write editor over an OCEL stored as a native DuckDB file.

    Construct via:
    - ``OcelEditor.create_empty(db_path)``       — new log from scratch
    - ``OcelEditor.from_source(src, db_path)``   — working copy of an
      uploaded / existing OCEL file (.sqlite, .db, .json, .xml, .csv, .duckdb)
    - ``OcelEditor(db_path)``                    — reopen an existing working copy
    """

    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn = duckdb.connect(db_path)

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------

    @classmethod
    def create_empty(cls, db_path: str) -> "OcelEditor":
        """Create a brand-new empty OCEL working file."""
        if os.path.exists(db_path):
            raise OcelEditorError(f"Working file already exists: {db_path}")
        conn = duckdb.connect(db_path)
        create_ocel_schema(conn, [], [])
        conn.close()
        return cls(db_path)

    @classmethod
    def from_source(cls, source_path: str, db_path: str) -> "OcelEditor":
        """
        Create a working copy from an existing OCEL file. `.duckdb` sources
        are copied byte-for-byte; every other supported format goes through
        the streaming importer.
        """
        if os.path.exists(db_path):
            raise OcelEditorError(f"Working file already exists: {db_path}")
        ext = os.path.splitext(source_path)[1].lower()
        if ext not in (".duckdb", ".sqlite", ".db", ".json", ".xml", ".csv"):
            raise OcelEditorError(
                f"Unsupported file type: {ext or source_path}. "
                "Supported: .sqlite, .db, .json, .xml, .csv, .duckdb"
            )
        editor = None
        try:
            if ext == ".duckdb":
                shutil.copyfile(source_path, db_path)
                editor = cls(db_path)
                editor._validate_schema()
                return editor
            # Local import to avoid a circular import at module load time.
            from .importer_db import import_ocel_db

            db = import_ocel_db(source_path, db_path=db_path)
            db.close()
            return cls(db_path)
        except Exception as e:
            # Don't leave a partial working copy behind on a failed import.
            if editor is not None:
                editor.close()
            for leftover in (db_path, f"{db_path}.wal"):
                try:
                    os.remove(leftover)
                except OSError:
                    pass
            if isinstance(e, OcelEditorError):
                raise
            raise OcelEditorError(f"Could not import the file: {e}")

    def _validate_schema(self) -> None:
        present = {
            r[0]
            for r in self.conn.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'main'"
            ).fetchall()
        }
        required = {
            "events",
            "objects",
            "event_object",
            "object_relations",
            "object_attribute_history",
        }
        missing = required - present
        if missing:
            raise OcelEditorError(
                f"File is not a valid OCEL DuckDB: missing tables {sorted(missing)}"
            )

    def close(self) -> None:
        self.conn.close()

    def __enter__(self) -> "OcelEditor":
        return self

    def __exit__(self, *_) -> None:
        self.close()

    # ------------------------------------------------------------------
    # Attribute columns
    # ------------------------------------------------------------------

    def _attr_cols(self, table: str) -> List[str]:
        fixed = _FIXED_EVENT_COLS if table == "events" else _FIXED_OBJ_COLS
        cols = [
            r[0]
            for r in self.conn.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = ? ORDER BY ordinal_position",
                [table],
            ).fetchall()
        ]
        return [c for c in cols if c not in fixed]

    def event_attribute_columns(self) -> List[str]:
        return self._attr_cols("events")

    def object_attribute_columns(self) -> List[str]:
        return self._attr_cols("objects")

    def _ensure_event_attr_cols(self, names: List[str]) -> None:
        existing = set(self.event_attribute_columns())
        for name in names:
            _validate_attr_name(name)
            if name not in existing:
                self.conn.execute(f'ALTER TABLE events ADD COLUMN "{name}" VARCHAR')

    def _ensure_object_attr_cols(self, names: List[str]) -> None:
        existing = set(self.object_attribute_columns())
        for name in names:
            _validate_attr_name(name)
            if name not in existing:
                self.conn.execute(f'ALTER TABLE objects ADD COLUMN "{name}" VARCHAR')
                self.conn.execute(
                    f'ALTER TABLE object_attribute_history ADD COLUMN "{name}" VARCHAR'
                )

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------

    def summary(self) -> dict:
        num_events = self.conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        num_objects = self.conn.execute("SELECT COUNT(*) FROM objects").fetchone()[0]
        num_e2o = self.conn.execute("SELECT COUNT(*) FROM event_object").fetchone()[0]
        num_o2o = self.conn.execute(
            "SELECT COUNT(*) FROM object_relations"
        ).fetchone()[0]
        object_types = [
            r[0]
            for r in self.conn.execute(
                "SELECT DISTINCT obj_type FROM objects ORDER BY obj_type"
            ).fetchall()
        ]
        activities = [
            r[0]
            for r in self.conn.execute(
                "SELECT DISTINCT activity FROM events ORDER BY activity"
            ).fetchall()
        ]
        return {
            "num_events": num_events,
            "num_objects": num_objects,
            "num_e2o": num_e2o,
            "num_o2o": num_o2o,
            "object_types": object_types,
            "activities": activities,
            "event_attribute_columns": self.event_attribute_columns(),
            "object_attribute_columns": self.object_attribute_columns(),
        }

    # ------------------------------------------------------------------
    # Events (with their E2O relations)
    # ------------------------------------------------------------------

    def list_events(
        self,
        page: int = 1,
        page_size: int = 50,
        sort_by: str = "timestamp",
        sort_dir: str = "asc",
        search: Optional[str] = None,
        activity: Optional[str] = None,
        object_type: Optional[str] = None,
        object_id: Optional[str] = None,
    ) -> dict:
        """
        Paginated events joined with their related objects (the E2O table).

        Filters: `search` matches event id or activity (case-insensitive
        substring), `activity` is an exact match, `object_type` /
        `object_id` keep only events related to a matching object.
        """
        page = max(1, int(page))
        page_size = min(500, max(1, int(page_size)))
        sort_col = {
            "id": "e.event_id",
            "activity": "e.activity",
            "timestamp": "e.timestamp_unix",
        }.get(sort_by, "e.timestamp_unix")
        order = "DESC" if str(sort_dir).lower() == "desc" else "ASC"

        where, params = ["1=1"], []
        if search:
            where.append("(e.event_id ILIKE ? OR e.activity ILIKE ?)")
            like = f"%{search}%"
            params += [like, like]
        if activity:
            where.append("e.activity = ?")
            params.append(activity)
        if object_type:
            where.append(
                "e.event_id IN (SELECT eo.event_id FROM event_object eo "
                "JOIN objects o ON o.obj_id = eo.obj_id WHERE o.obj_type = ?)"
            )
            params.append(object_type)
        if object_id:
            where.append(
                "e.event_id IN (SELECT event_id FROM event_object WHERE obj_id = ?)"
            )
            params.append(object_id)
        where_sql = " AND ".join(where)

        total = self.conn.execute(
            f"SELECT COUNT(*) FROM events e WHERE {where_sql}", params
        ).fetchone()[0]

        attr_cols = self.event_attribute_columns()
        attr_select = "".join(f', e."{c}"' for c in attr_cols)
        rows = self.conn.execute(
            f"""
            SELECT e.event_id, e.activity, e.timestamp_unix{attr_select}
            FROM events e
            WHERE {where_sql}
            ORDER BY {sort_col} {order}, e.event_id {order}
            LIMIT ? OFFSET ?
            """,
            params + [page_size, (page - 1) * page_size],
        ).fetchall()

        event_ids = [r[0] for r in rows]
        related: Dict[str, list] = {eid: [] for eid in event_ids}
        if event_ids:
            placeholders = ", ".join(["?"] * len(event_ids))
            for eid, oid, otype, qual in self.conn.execute(
                f"""
                SELECT eo.event_id, eo.obj_id, o.obj_type, eo.qualifier
                FROM event_object eo
                JOIN objects o ON o.obj_id = eo.obj_id
                WHERE eo.event_id IN ({placeholders})
                ORDER BY o.obj_type, eo.obj_id
                """,
                event_ids,
            ).fetchall():
                related[eid].append(
                    {"object_id": oid, "object_type": otype, "qualifier": qual}
                )

        items = []
        for row in rows:
            attributes = {
                c: row[3 + i] for i, c in enumerate(attr_cols) if row[3 + i] is not None
            }
            items.append(
                {
                    "id": row[0],
                    "activity": row[1],
                    "timestamp": row[2],
                    "attributes": attributes,
                    "objects": related.get(row[0], []),
                }
            )
        return {"items": items, "total": total, "page": page, "page_size": page_size}

    def _event_exists(self, event_id: str) -> bool:
        return (
            self.conn.execute(
                "SELECT 1 FROM events WHERE event_id = ?", [event_id]
            ).fetchone()
            is not None
        )

    def _object_exists(self, obj_id: str) -> bool:
        return (
            self.conn.execute(
                "SELECT 1 FROM objects WHERE obj_id = ?", [obj_id]
            ).fetchone()
            is not None
        )

    def _check_related_objects(self, objects: List[dict]) -> List[Tuple[str, str]]:
        """Validate an E2O relation list and return (obj_id, qualifier) pairs."""
        pairs: List[Tuple[str, str]] = []
        seen = set()
        for rel in objects or []:
            obj_id = _validate_id(rel.get("object_id", ""), "Related object id")
            if obj_id in seen:
                raise OcelEditorError(
                    f"Object '{obj_id}' is related to the event more than once."
                )
            seen.add(obj_id)
            if not self._object_exists(obj_id):
                raise OcelEditorError(
                    f"Object '{obj_id}' does not exist. Create it first in the objects table."
                )
            qualifier = rel.get("qualifier") or None
            pairs.append((obj_id, qualifier))
        return pairs

    def create_event(
        self,
        event_id: str,
        activity: str,
        timestamp: int,
        attributes: Optional[Dict[str, str]] = None,
        objects: Optional[List[dict]] = None,
    ) -> dict:
        event_id = _validate_id(event_id, "Event id")
        activity = _validate_id(activity, "Activity")
        try:
            timestamp = int(timestamp)
        except (TypeError, ValueError):
            raise OcelEditorError("Timestamp must be an integer (unix seconds).")
        if self._event_exists(event_id):
            raise OcelEditorError(f"Event id '{event_id}' already exists.")
        pairs = self._check_related_objects(objects or [])

        attributes = attributes or {}
        self._ensure_event_attr_cols(list(attributes.keys()))
        attr_cols = self.event_attribute_columns()
        col_sql = "".join(f', "{c}"' for c in attributes if c in attr_cols)
        val_sql = ", ?" * len([c for c in attributes if c in attr_cols])
        self.conn.execute(
            f"INSERT INTO events (event_id, activity, timestamp_unix{col_sql}) "
            f"VALUES (?, ?, ?{val_sql})",
            [event_id, activity, timestamp]
            + [str(attributes[c]) for c in attributes if c in attr_cols],
        )
        for obj_id, qualifier in pairs:
            self.conn.execute(
                "INSERT INTO event_object VALUES (?, ?, ?)",
                [event_id, obj_id, qualifier],
            )
        return self.get_event(event_id)

    def get_event(self, event_id: str) -> dict:
        attr_cols = self.event_attribute_columns()
        attr_select = "".join(f', "{c}"' for c in attr_cols)
        row = self.conn.execute(
            f"SELECT event_id, activity, timestamp_unix{attr_select} "
            "FROM events WHERE event_id = ?",
            [event_id],
        ).fetchone()
        if row is None:
            raise OcelEditorError(f"Event '{event_id}' not found.")
        objects = [
            {"object_id": oid, "object_type": otype, "qualifier": qual}
            for oid, otype, qual in self.conn.execute(
                """
                SELECT eo.obj_id, o.obj_type, eo.qualifier
                FROM event_object eo JOIN objects o ON o.obj_id = eo.obj_id
                WHERE eo.event_id = ? ORDER BY o.obj_type, eo.obj_id
                """,
                [event_id],
            ).fetchall()
        ]
        return {
            "id": row[0],
            "activity": row[1],
            "timestamp": row[2],
            "attributes": {
                c: row[3 + i] for i, c in enumerate(attr_cols) if row[3 + i] is not None
            },
            "objects": objects,
        }

    def update_event(
        self,
        event_id: str,
        new_event_id: Optional[str] = None,
        activity: Optional[str] = None,
        timestamp: Optional[int] = None,
        attributes: Optional[Dict[str, str]] = None,
        objects: Optional[List[dict]] = None,
    ) -> dict:
        if not self._event_exists(event_id):
            raise OcelEditorError(f"Event '{event_id}' not found.")

        if new_event_id is not None and new_event_id != event_id:
            new_event_id = _validate_id(new_event_id, "Event id")
            if self._event_exists(new_event_id):
                raise OcelEditorError(f"Event id '{new_event_id}' already exists.")
            self.conn.execute(
                "UPDATE events SET event_id = ? WHERE event_id = ?",
                [new_event_id, event_id],
            )
            self.conn.execute(
                "UPDATE event_object SET event_id = ? WHERE event_id = ?",
                [new_event_id, event_id],
            )
            event_id = new_event_id

        if activity is not None:
            activity = _validate_id(activity, "Activity")
            self.conn.execute(
                "UPDATE events SET activity = ? WHERE event_id = ?",
                [activity, event_id],
            )
        if timestamp is not None:
            try:
                timestamp = int(timestamp)
            except (TypeError, ValueError):
                raise OcelEditorError("Timestamp must be an integer (unix seconds).")
            self.conn.execute(
                "UPDATE events SET timestamp_unix = ? WHERE event_id = ?",
                [timestamp, event_id],
            )

        if attributes is not None:
            # Full replacement of the attribute set: unknown keys get columns,
            # keys absent from the payload are cleared for this event.
            self._ensure_event_attr_cols(list(attributes.keys()))
            for col in self.event_attribute_columns():
                value = attributes.get(col)
                self.conn.execute(
                    f'UPDATE events SET "{col}" = ? WHERE event_id = ?',
                    [None if value is None else str(value), event_id],
                )

        if objects is not None:
            pairs = self._check_related_objects(objects)
            self.conn.execute(
                "DELETE FROM event_object WHERE event_id = ?", [event_id]
            )
            for obj_id, qualifier in pairs:
                self.conn.execute(
                    "INSERT INTO event_object VALUES (?, ?, ?)",
                    [event_id, obj_id, qualifier],
                )
        return self.get_event(event_id)

    def delete_event(self, event_id: str) -> None:
        if not self._event_exists(event_id):
            raise OcelEditorError(f"Event '{event_id}' not found.")
        self.conn.execute("DELETE FROM event_object WHERE event_id = ?", [event_id])
        self.conn.execute("DELETE FROM events WHERE event_id = ?", [event_id])

    # ------------------------------------------------------------------
    # Objects (with attributes and O2O relations)
    # ------------------------------------------------------------------

    def list_objects(
        self,
        page: int = 1,
        page_size: int = 50,
        sort_by: str = "id",
        sort_dir: str = "asc",
        search: Optional[str] = None,
        object_type: Optional[str] = None,
    ) -> dict:
        page = max(1, int(page))
        page_size = min(500, max(1, int(page_size)))
        sort_col = {"id": "o.obj_id", "type": "o.obj_type"}.get(sort_by, "o.obj_id")
        order = "DESC" if str(sort_dir).lower() == "desc" else "ASC"

        where, params = ["1=1"], []
        if search:
            where.append("(o.obj_id ILIKE ? OR o.obj_type ILIKE ?)")
            like = f"%{search}%"
            params += [like, like]
        if object_type:
            where.append("o.obj_type = ?")
            params.append(object_type)
        where_sql = " AND ".join(where)

        total = self.conn.execute(
            f"SELECT COUNT(*) FROM objects o WHERE {where_sql}", params
        ).fetchone()[0]

        attr_cols = self.object_attribute_columns()
        attr_select = "".join(f', o."{c}"' for c in attr_cols)
        rows = self.conn.execute(
            f"""
            SELECT o.obj_id, o.obj_type{attr_select}
            FROM objects o
            WHERE {where_sql}
            ORDER BY {sort_col} {order}, o.obj_id {order}
            LIMIT ? OFFSET ?
            """,
            params + [page_size, (page - 1) * page_size],
        ).fetchall()

        obj_ids = [r[0] for r in rows]
        relations: Dict[str, list] = {oid: [] for oid in obj_ids}
        event_counts: Dict[str, int] = {oid: 0 for oid in obj_ids}
        if obj_ids:
            placeholders = ", ".join(["?"] * len(obj_ids))
            for src, tgt, qual in self.conn.execute(
                f"""
                SELECT source_obj_id, target_obj_id, qualifier
                FROM object_relations
                WHERE source_obj_id IN ({placeholders})
                ORDER BY target_obj_id
                """,
                obj_ids,
            ).fetchall():
                relations[src].append({"target": tgt, "qualifier": qual})
            for oid, count in self.conn.execute(
                f"""
                SELECT obj_id, COUNT(*) FROM event_object
                WHERE obj_id IN ({placeholders}) GROUP BY obj_id
                """,
                obj_ids,
            ).fetchall():
                event_counts[oid] = count

        items = []
        for row in rows:
            attributes = {
                c: row[2 + i] for i, c in enumerate(attr_cols) if row[2 + i] is not None
            }
            items.append(
                {
                    "id": row[0],
                    "type": row[1],
                    "attributes": attributes,
                    "relations": relations.get(row[0], []),
                    "event_count": event_counts.get(row[0], 0),
                }
            )
        return {"items": items, "total": total, "page": page, "page_size": page_size}

    def get_object(self, obj_id: str) -> dict:
        attr_cols = self.object_attribute_columns()
        attr_select = "".join(f', "{c}"' for c in attr_cols)
        row = self.conn.execute(
            f"SELECT obj_id, obj_type{attr_select} FROM objects WHERE obj_id = ?",
            [obj_id],
        ).fetchone()
        if row is None:
            raise OcelEditorError(f"Object '{obj_id}' not found.")
        relations = [
            {"target": tgt, "qualifier": qual}
            for tgt, qual in self.conn.execute(
                "SELECT target_obj_id, qualifier FROM object_relations "
                "WHERE source_obj_id = ? ORDER BY target_obj_id",
                [obj_id],
            ).fetchall()
        ]
        return {
            "id": row[0],
            "type": row[1],
            "attributes": {
                c: row[2 + i] for i, c in enumerate(attr_cols) if row[2 + i] is not None
            },
            "relations": relations,
        }

    def _write_object_attributes(
        self, obj_id: str, attributes: Dict[str, str]
    ) -> None:
        """
        Replace the object's attribute values on `objects` and mirror them
        into `object_attribute_history` (upsert at the latest known snapshot
        timestamp, or 0 for objects without history) so exports keep them.
        """
        self._ensure_object_attr_cols(list(attributes.keys()))
        attr_cols = self.object_attribute_columns()
        for col in attr_cols:
            value = attributes.get(col)
            self.conn.execute(
                f'UPDATE objects SET "{col}" = ? WHERE obj_id = ?',
                [None if value is None else str(value), obj_id],
            )
        if not attr_cols:
            return
        ts_row = self.conn.execute(
            "SELECT MAX(timestamp_unix) FROM object_attribute_history WHERE obj_id = ?",
            [obj_id],
        ).fetchone()
        ts = ts_row[0] if ts_row and ts_row[0] is not None else 0
        self.conn.execute(
            "DELETE FROM object_attribute_history WHERE obj_id = ? AND timestamp_unix = ?",
            [obj_id, ts],
        )
        col_sql = "".join(f', "{c}"' for c in attr_cols)
        val_sql = ", ?" * len(attr_cols)
        self.conn.execute(
            f"INSERT INTO object_attribute_history (obj_id, timestamp_unix{col_sql}) "
            f"VALUES (?, ?{val_sql})",
            [obj_id, ts]
            + [
                None if attributes.get(c) is None else str(attributes.get(c))
                for c in attr_cols
            ],
        )

    def _check_o2o_targets(self, relations: List[dict]) -> List[Tuple[str, str]]:
        pairs: List[Tuple[str, str]] = []
        seen = set()
        for rel in relations or []:
            target = _validate_id(rel.get("target", ""), "Target object id")
            if target in seen:
                raise OcelEditorError(f"Duplicate relation target '{target}'.")
            seen.add(target)
            if not self._object_exists(target):
                raise OcelEditorError(f"Target object '{target}' does not exist.")
            pairs.append((target, rel.get("qualifier") or None))
        return pairs

    def create_object(
        self,
        obj_id: str,
        obj_type: str,
        attributes: Optional[Dict[str, str]] = None,
        relations: Optional[List[dict]] = None,
    ) -> dict:
        obj_id = _validate_id(obj_id, "Object id")
        obj_type = _validate_id(obj_type, "Object type")
        if self._object_exists(obj_id):
            raise OcelEditorError(f"Object id '{obj_id}' already exists.")
        self.conn.execute(
            "INSERT INTO objects (obj_id, obj_type) VALUES (?, ?)",
            [obj_id, obj_type],
        )
        if attributes:
            self._write_object_attributes(obj_id, attributes)
        if relations:
            for target, qualifier in self._check_o2o_targets(relations):
                self.conn.execute(
                    "INSERT INTO object_relations VALUES (?, ?, ?)",
                    [obj_id, target, qualifier],
                )
        return self.get_object(obj_id)

    def update_object(
        self,
        obj_id: str,
        new_obj_id: Optional[str] = None,
        obj_type: Optional[str] = None,
        attributes: Optional[Dict[str, str]] = None,
        relations: Optional[List[dict]] = None,
    ) -> dict:
        if not self._object_exists(obj_id):
            raise OcelEditorError(f"Object '{obj_id}' not found.")

        if new_obj_id is not None and new_obj_id != obj_id:
            new_obj_id = _validate_id(new_obj_id, "Object id")
            if self._object_exists(new_obj_id):
                raise OcelEditorError(f"Object id '{new_obj_id}' already exists.")
            for sql in (
                "UPDATE objects SET obj_id = ? WHERE obj_id = ?",
                "UPDATE event_object SET obj_id = ? WHERE obj_id = ?",
                "UPDATE object_relations SET source_obj_id = ? WHERE source_obj_id = ?",
                "UPDATE object_relations SET target_obj_id = ? WHERE target_obj_id = ?",
                "UPDATE object_attribute_history SET obj_id = ? WHERE obj_id = ?",
            ):
                self.conn.execute(sql, [new_obj_id, obj_id])
            obj_id = new_obj_id

        if obj_type is not None:
            obj_type = _validate_id(obj_type, "Object type")
            self.conn.execute(
                "UPDATE objects SET obj_type = ? WHERE obj_id = ?",
                [obj_type, obj_id],
            )
        if attributes is not None:
            self._write_object_attributes(obj_id, attributes)
        if relations is not None:
            pairs = self._check_o2o_targets(relations)
            self.conn.execute(
                "DELETE FROM object_relations WHERE source_obj_id = ?", [obj_id]
            )
            for target, qualifier in pairs:
                self.conn.execute(
                    "INSERT INTO object_relations VALUES (?, ?, ?)",
                    [obj_id, target, qualifier],
                )
        return self.get_object(obj_id)

    def delete_object(self, obj_id: str) -> None:
        if not self._object_exists(obj_id):
            raise OcelEditorError(f"Object '{obj_id}' not found.")
        self.conn.execute("DELETE FROM event_object WHERE obj_id = ?", [obj_id])
        self.conn.execute(
            "DELETE FROM object_relations WHERE source_obj_id = ? OR target_obj_id = ?",
            [obj_id, obj_id],
        )
        self.conn.execute(
            "DELETE FROM object_attribute_history WHERE obj_id = ?", [obj_id]
        )
        self.conn.execute("DELETE FROM objects WHERE obj_id = ?", [obj_id])

    # ------------------------------------------------------------------
    # O2O relations table
    # ------------------------------------------------------------------

    def list_relations(
        self,
        page: int = 1,
        page_size: int = 50,
        sort_by: str = "source",
        sort_dir: str = "asc",
        search: Optional[str] = None,
    ) -> dict:
        page = max(1, int(page))
        page_size = min(500, max(1, int(page_size)))
        sort_col = {
            "source": "r.source_obj_id",
            "target": "r.target_obj_id",
            "qualifier": "r.qualifier",
        }.get(sort_by, "r.source_obj_id")
        order = "DESC" if str(sort_dir).lower() == "desc" else "ASC"

        where, params = ["1=1"], []
        if search:
            where.append(
                "(r.source_obj_id ILIKE ? OR r.target_obj_id ILIKE ? OR r.qualifier ILIKE ?)"
            )
            like = f"%{search}%"
            params += [like, like, like]
        where_sql = " AND ".join(where)

        total = self.conn.execute(
            f"SELECT COUNT(*) FROM object_relations r WHERE {where_sql}", params
        ).fetchone()[0]
        rows = self.conn.execute(
            f"""
            SELECT r.source_obj_id, r.target_obj_id, r.qualifier,
                   so.obj_type, to_.obj_type
            FROM object_relations r
            LEFT JOIN objects so  ON so.obj_id  = r.source_obj_id
            LEFT JOIN objects to_ ON to_.obj_id = r.target_obj_id
            WHERE {where_sql}
            ORDER BY {sort_col} {order}, r.source_obj_id, r.target_obj_id
            LIMIT ? OFFSET ?
            """,
            params + [page_size, (page - 1) * page_size],
        ).fetchall()
        items = [
            {
                "source": r[0],
                "target": r[1],
                "qualifier": r[2],
                "source_type": r[3],
                "target_type": r[4],
            }
            for r in rows
        ]
        return {"items": items, "total": total, "page": page, "page_size": page_size}

    def set_relation(
        self, source: str, target: str, qualifier: Optional[str] = None
    ) -> dict:
        """Create or update (upsert) a single O2O relation."""
        source = _validate_id(source, "Source object id")
        target = _validate_id(target, "Target object id")
        if source == target:
            raise OcelEditorError("Source and target must be different objects.")
        for oid in (source, target):
            if not self._object_exists(oid):
                raise OcelEditorError(f"Object '{oid}' does not exist.")
        self.conn.execute(
            "DELETE FROM object_relations WHERE source_obj_id = ? AND target_obj_id = ?",
            [source, target],
        )
        self.conn.execute(
            "INSERT INTO object_relations VALUES (?, ?, ?)",
            [source, target, qualifier or None],
        )
        return {"source": source, "target": target, "qualifier": qualifier or None}

    def delete_relation(self, source: str, target: str) -> None:
        deleted = self.conn.execute(
            "DELETE FROM object_relations WHERE source_obj_id = ? AND target_obj_id = ? "
            "RETURNING source_obj_id",
            [source, target],
        ).fetchall()
        if not deleted:
            raise OcelEditorError(f"Relation '{source}' → '{target}' not found.")

    # ------------------------------------------------------------------
    # LaTeX export
    # ------------------------------------------------------------------

    LATEX_PREAMBLE = (
        "% Please add the following required packages to your document preamble:\n"
        "% \\usepackage{multirow}\n"
        "% \\usepackage[table,xcdraw]{xcolor}\n"
        "% Beamer presentation requires \\usepackage{colortbl} instead of "
        "\\usepackage[table,xcdraw]{xcolor}\n"
    )

    def latex_e2o(self, max_rows: int = 500, **filters) -> dict:
        """
        Render the E2O table as a LaTeX tabular: one row per event with
        id / activity / timestamp and one column per object type listing
        the related objects. `filters` are forwarded to `list_events`.
        """
        data = self.list_events(page=1, page_size=max_rows, **filters)
        truncated = data["total"] > len(data["items"])

        # Column order: object types by first appearance in the log.
        object_types = [
            r[0]
            for r in self.conn.execute(
                """
                SELECT o.obj_type
                FROM event_object eo
                JOIN objects o ON o.obj_id = eo.obj_id
                JOIN events e  ON e.event_id = eo.event_id
                GROUP BY o.obj_type
                ORDER BY MIN(e.timestamp_unix), o.obj_type
                """
            ).fetchall()
        ]
        n_types = len(object_types)

        lines = [self.LATEX_PREAMBLE]
        lines.append("\\begin{table}[]")
        type_cols = "l" * max(1, n_types)
        lines.append(f"\\begin{{tabular}}{{|l|l|l|{type_cols}|}}")
        lines.append("\\hline")
        if n_types > 0:
            lines.append(
                "                     &                            &"
                "                             & "
                f"\\multicolumn{{{n_types}}}{{l|}}{{object types}} \\\\ "
                f"\\cline{{4-{3 + n_types}}} "
            )
            header_cells = [
                "\\multirow{-2}{*}{id}",
                "\\multirow{-2}{*}{activity}",
                "\\multirow{-2}{*}{timestamp}",
            ]
            for i, otype in enumerate(object_types):
                cell = latex_escape(otype)
                if i < n_types - 1:
                    header_cells.append(f"\\multicolumn{{1}}{{l|}}{{{cell}}}")
                else:
                    header_cells.append(cell)
            lines.append(" & ".join(header_cells) + " \\\\ \\hline")
        else:
            lines.append("id & activity & timestamp &  \\\\ \\hline")

        for event in data["items"]:
            by_type: Dict[str, List[str]] = {}
            for rel in event["objects"]:
                by_type.setdefault(rel["object_type"], []).append(rel["object_id"])
            cells = [
                latex_escape(event["id"]),
                latex_escape(event["activity"]),
                _format_ts(event["timestamp"]),
            ]
            for i, otype in enumerate(object_types):
                content = latex_escape(", ".join(by_type.get(otype, [])))
                if i < n_types - 1:
                    cells.append(f"\\multicolumn{{1}}{{l|}}{{{content}}}")
                else:
                    cells.append(content)
            if n_types == 0:
                cells.append("")
            lines.append(" & ".join(cells) + " \\\\ \\hline")

        lines.append("\\end{tabular}")
        lines.append("\\end{table}")
        return {
            "latex": "\n".join(lines),
            "rows": len(data["items"]),
            "total": data["total"],
            "truncated": truncated,
        }

    def latex_o2o(self, max_rows: int = 500, **filters) -> dict:
        """Render the O2O relations as a LaTeX tabular (source/target/qualifier)."""
        data = self.list_relations(page=1, page_size=max_rows, **filters)
        truncated = data["total"] > len(data["items"])

        lines = [self.LATEX_PREAMBLE]
        lines.append("\\begin{table}[]")
        lines.append("\\begin{tabular}{|l|l|l|}")
        lines.append("\\hline")
        lines.append("source object & target object & qualifier \\\\ \\hline")
        for rel in data["items"]:
            lines.append(
                " & ".join(
                    [
                        latex_escape(rel["source"]),
                        latex_escape(rel["target"]),
                        latex_escape(rel["qualifier"] or ""),
                    ]
                )
                + " \\\\ \\hline"
            )
        lines.append("\\end{tabular}")
        lines.append("\\end{table}")
        return {
            "latex": "\n".join(lines),
            "rows": len(data["items"]),
            "total": data["total"],
            "truncated": truncated,
        }

    # ------------------------------------------------------------------
    # File export
    # ------------------------------------------------------------------

    def export(self, dest_path: str, fmt: str) -> str:
        """
        Export the working log to `dest_path` in the given format.

        - ``duckdb``: native DuckDB copy (works from the live connection).
        - ``sqlite`` / ``json`` / ``xml``: OCEL 2.0 via pm4py, enriched with
          the event and object attribute columns.
        """
        fmt = (fmt or "").lower()
        if fmt not in EXPORT_FORMATS:
            raise OcelEditorError(
                f"Unsupported export format '{fmt}'. Supported: {', '.join(EXPORT_FORMATS)}"
            )
        if os.path.exists(dest_path):
            os.remove(dest_path)

        if fmt == "duckdb":
            self.conn.execute(f"ATTACH '{dest_path}' AS _export_dest")
            try:
                for table in (
                    "events",
                    "objects",
                    "event_object",
                    "object_relations",
                    "object_attribute_history",
                ):
                    self.conn.execute(
                        f"CREATE TABLE _export_dest.{table} AS SELECT * FROM {table}"
                    )
            finally:
                self.conn.execute("DETACH _export_dest")
            return dest_path

        import pm4py

        from .importer_duckdb import import_ocel_from_duckdb
        from .pm4py_adapter import (
            PM4PY_EVENT_ID,
            PM4PY_OBJECT_ID,
            convert_ocel_polars_to_pm4py,
        )

        # The polars importer opens its own read-only connection, which
        # DuckDB refuses while our read-write connection is open on the same
        # file. Go through a temporary native copy instead.
        tmp_copy = f"{dest_path}.tmp.duckdb"
        self.export(tmp_copy, "duckdb")
        try:
            polars_ocel = import_ocel_from_duckdb(tmp_copy)
        finally:
            os.remove(tmp_copy)
        converted = convert_ocel_polars_to_pm4py(polars_ocel)
        # The adapter fills e2e / object_changes with column-less empty
        # DataFrames, which pm4py's OCEL 2.0 exporters reject. Rebuild the
        # OCEL and let the constructor create correctly-columned defaults.
        from pm4py.objects.ocel.obj import OCEL

        pm4py_ocel = OCEL(
            events=converted.events,
            objects=converted.objects,
            relations=converted.relations,
            o2o=converted.o2o,
        )

        # The shared adapter drops attributes; re-attach them from the
        # DuckDB tables so exports keep everything the user edited.
        event_attr_cols = self.event_attribute_columns()
        if event_attr_cols:
            cols = "".join(f', "{c}"' for c in event_attr_cols)
            events_attrs = self.conn.execute(
                f'SELECT event_id AS "{PM4PY_EVENT_ID}"{cols} FROM events'
            ).pl()
            pm4py_ocel.events = (
                pm4py_ocel.events.merge(
                    events_attrs.to_pandas(), on=PM4PY_EVENT_ID, how="left"
                )
            )
        obj_attr_cols = self.object_attribute_columns()
        if obj_attr_cols:
            cols = "".join(f', "{c}"' for c in obj_attr_cols)
            objects_attrs = self.conn.execute(
                f'SELECT obj_id AS "{PM4PY_OBJECT_ID}"{cols} FROM objects'
            ).pl()
            pm4py_ocel.objects = (
                pm4py_ocel.objects.merge(
                    objects_attrs.to_pandas(), on=PM4PY_OBJECT_ID, how="left"
                )
            )

        if fmt == "sqlite":
            pm4py.write_ocel2_sqlite(pm4py_ocel, dest_path)
        elif fmt == "json":
            pm4py.write_ocel2_json(pm4py_ocel, dest_path)
        else:  # xml
            pm4py.write_ocel2_xml(pm4py_ocel, dest_path)
        return dest_path
