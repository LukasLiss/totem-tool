"""
Filter stack for Object-Centric Event Logs.

JSON schema
-----------
A filter stack is a JSON object with a single "filters" key containing an
ordered list of filter rules.  Rules are evaluated with AND semantics: an
event / object must pass *every* enabled rule to survive.

Example:

    {
      "filters": [
        {
          "id":      "a1b2c3d4",
          "type":    "time_range",
          "enabled": true,
          "params":  { "after": 1700000000, "before": 1700100000 }
        },
        {
          "id":      "e5f6g7h8",
          "type":    "object_types",
          "enabled": true,
          "params":  { "include": ["order", "item"] }
        },
        {
          "id":      "i9j0k1l2",
          "type":    "activity",
          "enabled": true,
          "params":  { "include": ["Place Order", "Confirm Payment"] }
        }
      ]
    }

Supported filter types
----------------------
time_range:
    Keeps events whose timestamp_unix falls within [after, before].
    Both bounds are optional (omit or set to null for an open interval).
    params keys:
        after  -- int Unix timestamp, inclusive lower bound (optional)
        before -- int Unix timestamp, inclusive upper bound (optional)

object_types:
    Keeps only objects whose obj_type is listed in params["include"].
    Events that lose all their objects after this filter are removed (cascade).
    params keys:
        include -- list[str] object types to keep; empty list removes all objects

activity:
    Keeps only events whose activity is listed in params["include"].
    Objects that are no longer referenced by any kept event are removed (cascade).
    params keys:
        include -- list[str] activity names to keep; empty list removes all events

Cascade semantics
-----------------
After all rule-level filters are applied independently, a single cascade pass
removes:
  - Events that have no surviving objects
  - Objects that are not referenced by any surviving event
"""

from __future__ import annotations

import duckdb
from typing import Any

from .ocel_duckdb import OcelDuckDB, create_ocel_schema


class FilterRule:
    """A single rule in a FilterStack."""

    def __init__(self, id: str, type: str, enabled: bool, params: dict[str, Any]):
        self.id = id
        self.type = type  # "time_range" | "object_types" | "activity"
        self.enabled = enabled
        self.params = params


class FilterStack:
    """An ordered list of FilterRules applied with AND semantics."""

    def __init__(self, filters: list[FilterRule] | None = None):
        self.filters = filters if filters is not None else []

    @classmethod
    def from_dict(cls, data: dict) -> FilterStack:
        """Parse a FilterStack from a plain dict"""
        return cls(
            filters=[
                FilterRule(
                    id=f["id"],
                    type=f["type"],
                    enabled=f.get("enabled", True),
                    params=f.get("params", {}),
                )
                for f in data.get("filters", [])
            ]
        )


def apply_filter_stack(
    ocel: OcelDuckDB,
    filter_stack: FilterStack | dict,
) -> tuple[OcelDuckDB, dict]:
    """
    Apply *filter_stack* to *ocel* and return a new filtered OcelDuckDB with statistics about how much of the log survived.

    Args:
        ocel:         An OcelDuckDB instance to filter.
        filter_stack: A FilterStack or a plain dict matching the JSON schema described.

    Returns:
        A tuple ``(filtered_ocel, stats)`` where:

        filtered_ocel
            A fresh in-memory OcelDuckDB containing only the surviving events,
            objects, event-object links, object attribute history, and
            object-to-object relations.

        stats
            A dict with keys:
              event_count_before  -- int
              event_count_after   -- int
              event_percentage    -- float in [0.0, 1.0] (fraction of events kept)
              object_count_before -- int
              object_count_after  -- int
              object_percentage   -- float in [0.0, 1.0] (fraction of objects kept)
    """
    if isinstance(filter_stack, dict):
        filter_stack = FilterStack.from_dict(filter_stack)

    active = [r for r in filter_stack.filters if r.enabled]

    # ------------------------------------------------------------------
    # One flat WHERE clause across all filter types.
    # Event conditions use the "e." prefix, object conditions use "o.".
    # ------------------------------------------------------------------
    conditions: list[str] = []
    params: list = []
    empty = False

    for rule in active:
        if rule.type == "time_range":
            after = rule.params.get("after")
            before = rule.params.get("before")
            if after is not None:
                conditions.append("e.timestamp_unix >= ?")
                params.append(int(after))
            if before is not None:
                conditions.append("e.timestamp_unix <= ?")
                params.append(int(before))
        elif rule.type == "activity":
            include = rule.params.get("include")
            if include is not None:
                if len(include) == 0:
                    empty = True
                    break
                conditions.append("e.activity = ANY(?)")
                params.append(list(include))
        elif rule.type == "object_types":
            include = rule.params.get("include")
            if include is not None:
                if len(include) == 0:
                    empty = True
                    break
                conditions.append("o.obj_type = ANY(?)")
                params.append(list(include))

    # ------------------------------------------------------------------
    # Get before-counts, then materialise surviving IDs into a temp table
    # so downstream copies reference it without re-binding large lists.
    # ------------------------------------------------------------------
    n_events, n_objects = ocel.conn.execute(
        "SELECT (SELECT COUNT(*) FROM events), (SELECT COUNT(*) FROM objects)"
    ).fetchone()

    new_conn = duckdb.connect(":memory:")
    create_ocel_schema(new_conn, ocel._event_attr_cols, ocel._obj_attr_cols)

    if empty:
        n_after_events = 0
        n_after_objects = 0
    else:
        where = " AND ".join(conditions) if conditions else "TRUE"
        try:
            ocel.conn.execute(
                f"""
                CREATE TEMP TABLE surviving AS
                SELECT DISTINCT e.event_id, o.obj_id
                FROM   events       e
                JOIN   event_object eo ON e.event_id = eo.event_id
                JOIN   objects      o  ON eo.obj_id  = o.obj_id
                WHERE  {where}
                """,
                params,
            )

            n_after_events, n_after_objects = ocel.conn.execute(
                "SELECT COUNT(DISTINCT event_id), COUNT(DISTINCT obj_id) FROM surviving"
            ).fetchone()

            for sql, table in [
                (
                    "SELECT * FROM events"
                    " WHERE event_id IN (SELECT event_id FROM surviving)",
                    "events",
                ),
                (
                    "SELECT * FROM objects"
                    " WHERE obj_id IN (SELECT obj_id FROM surviving)",
                    "objects",
                ),
                (
                    "SELECT eo.* FROM event_object eo"
                    " WHERE eo.event_id IN (SELECT event_id FROM surviving)"
                    "   AND eo.obj_id   IN (SELECT obj_id   FROM surviving)",
                    "event_object",
                ),
                (
                    "SELECT * FROM object_attribute_history"
                    " WHERE obj_id IN (SELECT obj_id FROM surviving)",
                    "object_attribute_history",
                ),
                (
                    "SELECT * FROM object_relations"
                    " WHERE source_obj_id IN (SELECT obj_id FROM surviving)"
                    "   AND target_obj_id IN (SELECT obj_id FROM surviving)",
                    "object_relations",
                ),
            ]:
                df = ocel.conn.execute(sql).pl()
                new_conn.register("temp", df)
                new_conn.execute(f"INSERT INTO {table} SELECT * FROM temp")
                new_conn.unregister("temp")
        finally:
            ocel.conn.execute("DROP TABLE IF EXISTS surviving")

    filtered_ocel = OcelDuckDB._from_prepared_connection(
        new_conn, ocel._event_attr_cols, ocel._obj_attr_cols
    )

    stats = {
        "event_count_before":  n_events,
        "event_count_after":   n_after_events,
        "event_percentage":    n_after_events  / n_events  if n_events  > 0 else 0.0,
        "object_count_before": n_objects,
        "object_count_after":  n_after_objects,
        "object_percentage":   n_after_objects / n_objects if n_objects > 0 else 0.0,
    }

    return filtered_ocel, stats
