"""
The individual directly-follows steps of the OC-DFG, for its token animation.

Every step is one object moving from one of its events to its next event:
object ``o`` of type ``T`` goes from activity ``A`` (at its event's time) to
activity ``B`` (at the next event's time). Aggregated per ``(T, A, B)`` these
steps are exactly the arcs of ``NewOCDFGDb.from_ocel_db``; start and end arcs
have no time of their own and are left out.

This module deliberately repeats the per-object event sequence of
``NewOCDFGDb.from_ocel_db`` instead of sharing code with it, so the graph
computation stays untouched, and it only runs when a view asks for the
animation.
"""

from typing import List, Optional

import polars as pl

from totem_lib.ocel.ocel_duckdb import OcelDuckDB

from ..progress import as_progress
from .ocdfg_db import NewOCDFGDb


def ocdfg_flows_from_ocel_db(
    ocel_db: OcelDuckDB,
    object_types: Optional[List[str]] = None,
    variant_ranks: bool = False,
    progress=None,
) -> dict:
    """
    Collect every directly-follows step of the selected object types.

    Each object's events are ordered like the OC-DFG orders them (by
    timestamp, then event id), so the steps add up to its arcs.

    Args:
        ocel_db: DuckDB-backed event log (filters applied by the caller).
        object_types: Restrict to these types; ``None`` → all types.
        variant_ranks: Also return each object's variant rank: the rank of
            its activity sequence among its type's variants, as
            ``NewOCDFGDb.compute_variants`` orders them (1 = most frequent).
        progress: Optional ``callback(fraction, message)``.

    Returns:
        A column-oriented dict, compact for large logs::

            {
                "activities":   [str, ...],
                "object_types": [str, ...],
                "objects": {
                    "type":         [index into object_types, ...],
                    "variant_rank": [int, ...] or None,
                },
                "flows": {          # sorted by start time
                    "object":   [index into objects, ...],
                    "source":   [index into activities, ...],
                    "target":   [index into activities, ...],
                    "start":    [unix seconds, ...],
                    "duration": [seconds, ...],   # raw, may be 0
                },
                "total_objects": int,   # objects with at least one step
            }
    """
    progress = as_progress(progress)
    progress.report(0.0, "Collecting directly-follows steps")

    type_filter = ""
    params: list = []
    if object_types is not None:
        placeholders = ", ".join(["?"] * len(object_types))
        type_filter = f"WHERE o.obj_type IN ({placeholders})"
        params = list(object_types)

    sql = f"""
        WITH event_sequence AS (
            SELECT
                e.event_id,
                e.activity,
                e.timestamp_unix,
                o.obj_id,
                o.obj_type,
                LEAD(e.activity)       OVER w AS next_activity,
                LEAD(e.timestamp_unix) OVER w AS next_timestamp_unix
            FROM events e
            JOIN event_object eo ON e.event_id = eo.event_id
            JOIN objects o       ON eo.obj_id  = o.obj_id
            {type_filter}
            WINDOW w AS (PARTITION BY eo.obj_id ORDER BY e.timestamp_unix, e.event_id)
        )
        SELECT
            obj_id,
            obj_type,
            activity                             AS source,
            next_activity                        AS target,
            timestamp_unix                       AS start,
            next_timestamp_unix - timestamp_unix AS duration
        FROM event_sequence
        WHERE next_activity IS NOT NULL
        ORDER BY timestamp_unix, obj_id, event_id
    """
    steps = (
        ocel_db.conn.execute(sql, params).pl()
        if params
        else ocel_db.conn.execute(sql).pl()
    )
    progress.report(0.6, "Preparing the animation data")

    if steps.is_empty():
        return {
            "activities": [],
            "object_types": [],
            "objects": {"type": [], "variant_rank": [] if variant_ranks else None},
            "flows": {"object": [], "source": [], "target": [], "start": [], "duration": []},
            "total_objects": 0,
        }

    activities = sorted(
        pl.concat([steps["source"], steps["target"]]).unique().to_list()
    )
    # One row per object, in order of its first step.
    objects = steps.select(["obj_id", "obj_type"]).unique("obj_id", keep="first", maintain_order=True)
    object_ids = objects["obj_id"].to_list()
    object_type_names = sorted(objects["obj_type"].unique().to_list())

    def indices(column: pl.Series, categories: list) -> list:
        return column.cast(pl.Enum(categories)).to_physical().to_list()

    ranks = None
    if variant_ranks:
        progress.report(0.75, "Ranking object variants")
        rank_of: dict = {}
        variants = NewOCDFGDb.compute_variants(ocel_db, object_types=object_type_names)
        for type_data in variants.values():
            for rank, variant in enumerate(type_data.get("variants", []), start=1):
                for obj_id in variant.get("objects", []):
                    rank_of[obj_id] = rank
        ranks = [rank_of.get(obj_id, 0) for obj_id in object_ids]

    progress.report(0.9, "Serializing the animation data")
    return {
        "activities": activities,
        "object_types": object_type_names,
        "objects": {
            "type": indices(objects["obj_type"], object_type_names),
            "variant_rank": ranks,
        },
        "flows": {
            "object": indices(steps["obj_id"], object_ids),
            "source": indices(steps["source"], activities),
            "target": indices(steps["target"], activities),
            "start": steps["start"].to_list(),
            "duration": steps["duration"].to_list(),
        },
        "total_objects": len(object_ids),
    }
