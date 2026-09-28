"""Event/object sources for the organizational mining algorithms.

Both the handover-of-work discovery (:mod:`.ochandover`) and the resource
profiling (:mod:`.orgamining`) work on the same, very small slice of an
object-centric event log:

* one row per *(event, object)* pair for the object types under study, with
  the event's activity and Unix timestamp, and
* the object type of every object id that appears in those rows.

Historically that slice was carved out of the polars-based
``ObjectCentricEventLog`` by exploding its ``_objects`` list column. The
tool's backend, however, keeps every uploaded log as an :class:`OcelDuckDB`
and never materialises the polars representation. This module therefore
describes the slice once, as :class:`EventObjectSource`, and provides two
constructors:

``from_ocel``
    Explode the polars ``events`` frame (legacy path, kept for scripts and
    parity tests).
``from_ocel_db``
    Run one SQL query over the relational ``events`` / ``event_object`` /
    ``objects`` tables of an :class:`OcelDuckDB`. Only the requested object
    types are read, and — because the query names the tables unqualified —
    a backend filter shadow (temporary ``events``/``objects`` tables in front
    of ``main``) is honoured automatically.

The resulting polars frames use the same column names the algorithms always
used (``_eventId``, ``_activity``, ``_timestampUnix``, ``_objId``), so the
computation itself is untouched by where the data came from.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Iterable, Sequence

import polars as pl

if TYPE_CHECKING:  # pragma: no cover - typing only
    from ..ocel.ocel import ObjectCentricEventLog
    from ..ocel.ocel_duckdb import OcelDuckDB


EVENT_OBJECT_SCHEMA: dict[str, pl.DataType] = {
    "_eventId": pl.Utf8,
    "_activity": pl.Utf8,
    "_timestampUnix": pl.Int64,
    "_objId": pl.Utf8,
}


def _placeholders(values: Sequence[str]) -> str:
    return ",".join("?" for _ in values)


def _dedupe(types: Iterable[str] | None) -> list[str]:
    """Order-preserving de-duplication that also drops empty names."""
    seen: set[str] = set()
    out: list[str] = []
    for t in types or []:
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out


@dataclass
class EventObjectSource:
    """The slice of a log the organizational mining algorithms operate on.

    Attributes
    ----------
    event_objects
        One row per (event, object) pair, restricted to objects whose type is
        in :attr:`object_types`. Columns: ``_eventId``, ``_activity``,
        ``_timestampUnix`` (Unix seconds), ``_objId``.
    object_type_by_id
        ``obj_id -> obj_type`` for every object referenced in
        :attr:`event_objects` (plus objects of the requested types that never
        appear in an event, so callers can enumerate a type's members).
    object_types
        The object types that were requested when the source was built.
    all_object_types
        Every object type present in the (possibly filtered) log, sorted.
    """

    event_objects: pl.DataFrame
    object_type_by_id: dict[str, str]
    object_types: list[str]
    all_object_types: list[str] = field(default_factory=list)

    # ------------------------------------------------------------------
    # Constructors
    # ------------------------------------------------------------------

    @classmethod
    def from_ocel(
        cls,
        ocel: "ObjectCentricEventLog",
        object_types: Iterable[str] | None = None,
    ) -> "EventObjectSource":
        """Explode the polars OCEL's ``_objects`` column (legacy representation)."""
        all_types = sorted(ocel.object_types)
        types = _dedupe(object_types) if object_types is not None else list(all_types)

        object_type_by_id: dict[str, str] = {}
        for obj_type in types:
            for obj_id in ocel.get_object_ids_by_type(obj_type):
                object_type_by_id[obj_id] = obj_type

        exploded = (
            ocel.events
            .select(["_eventId", "_activity", "_timestampUnix", "_objects"])
            .explode("_objects")
            .rename({"_objects": "_objId"})
            .filter(pl.col("_objId").is_in(list(object_type_by_id.keys())))
            .with_columns(pl.col("_timestampUnix").cast(pl.Int64))
            .select(list(EVENT_OBJECT_SCHEMA.keys()))
        )
        return cls(
            event_objects=exploded,
            object_type_by_id=object_type_by_id,
            object_types=types,
            all_object_types=all_types,
        )

    @classmethod
    def from_ocel_db(
        cls,
        db: "OcelDuckDB",
        object_types: Iterable[str] | None = None,
    ) -> "EventObjectSource":
        """Read the slice from the relational DuckDB tables.

        The tables are referenced unqualified on purpose: when the backend
        has shadowed ``events``/``event_object``/``objects`` with filtered
        TEMP tables, DuckDB resolves those first and the algorithms see the
        filtered log without any extra plumbing here.
        """
        conn = db.conn
        all_types = [
            r[0] for r in conn.execute(
                "SELECT DISTINCT obj_type FROM objects ORDER BY obj_type"
            ).fetchall()
        ]
        types = _dedupe(object_types) if object_types is not None else list(all_types)

        if not types:
            return cls(
                event_objects=pl.DataFrame(schema=EVENT_OBJECT_SCHEMA),
                object_type_by_id={},
                object_types=[],
                all_object_types=all_types,
            )

        ph = _placeholders(types)
        object_type_by_id = {
            obj_id: obj_type
            for obj_id, obj_type in conn.execute(
                f"SELECT obj_id, obj_type FROM objects WHERE obj_type IN ({ph})",
                list(types),
            ).fetchall()
        }

        event_objects = conn.execute(
            f"""
            SELECT e.event_id            AS "_eventId",
                   e.activity            AS "_activity",
                   e.timestamp_unix      AS "_timestampUnix",
                   eo.obj_id             AS "_objId"
            FROM event_object eo
            JOIN events  e ON e.event_id = eo.event_id
            JOIN objects o ON o.obj_id   = eo.obj_id
            WHERE o.obj_type IN ({ph})
            ORDER BY e.timestamp_unix, e.event_id, eo.obj_id
            """,
            list(types),
        ).pl()
        if event_objects.is_empty():
            event_objects = pl.DataFrame(schema=EVENT_OBJECT_SCHEMA)
        else:
            event_objects = event_objects.with_columns(
                pl.col("_timestampUnix").cast(pl.Int64)
            ).select(list(EVENT_OBJECT_SCHEMA.keys()))

        return cls(
            event_objects=event_objects,
            object_type_by_id=object_type_by_id,
            object_types=types,
            all_object_types=all_types,
        )

    # ------------------------------------------------------------------
    # Accessors mirroring the old ``ObjectCentricEventLog`` surface
    # ------------------------------------------------------------------

    def object_ids_of_types(self, object_types: Iterable[str]) -> set[str]:
        """All object ids whose type is one of ``object_types``."""
        wanted = set(object_types)
        return {oid for oid, t in self.object_type_by_id.items() if t in wanted}

    def type_map_for(self, object_types: Iterable[str]) -> dict[str, str]:
        """``obj_id -> obj_type`` restricted to ``object_types``."""
        wanted = set(object_types)
        return {oid: t for oid, t in self.object_type_by_id.items() if t in wanted}

    def restricted_to(self, object_types: Iterable[str]) -> pl.DataFrame:
        """``event_objects`` rows whose object belongs to ``object_types``."""
        ids = self.object_ids_of_types(object_types)
        if not ids:
            return pl.DataFrame(schema=EVENT_OBJECT_SCHEMA)
        return self.event_objects.filter(pl.col("_objId").is_in(list(ids)))
