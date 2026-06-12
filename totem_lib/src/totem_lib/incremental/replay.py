"""
Utilities to replay an existing OCEL database as a stream of append batches.

split_batches() cuts a source log into a base portion plus n equally sized
append batches following the global (timestamp, event_id) order — the order
in which an operational system would have produced the events. Objects are
assigned to the batch of the first event referencing them; object-to-object
relations to the batch where both endpoints exist.

Used by the incremental-maintenance correctness tests and benchmarks.
"""

from dataclasses import dataclass
from typing import List

import duckdb
import polars as pl

from ..ocel.ocel_duckdb import OcelDuckDB, create_ocel_schema


@dataclass
class Batch:
    events: pl.DataFrame            # event_id, activity, timestamp_unix
    event_object: pl.DataFrame      # event_id, obj_id, qualifier
    objects: pl.DataFrame           # obj_id, obj_type
    object_relations: pl.DataFrame  # source_obj_id, target_obj_id, qualifier


def empty_ocel_db(path: str = ":memory:") -> OcelDuckDB:
    """Create an empty OCEL database with the standard five-table schema."""
    conn = duckdb.connect(path)
    create_ocel_schema(conn, [], [])
    return OcelDuckDB._from_prepared_connection(conn, [], [])


def split_batches(
    source: OcelDuckDB,
    n_batches: int = 10,
    base_fraction: float = 0.5,
) -> List[Batch]:
    """
    Split the source log into 1 + n_batches batches (index 0 is the base).

    :param source: Populated OCEL database (left unmodified).
    :param n_batches: Number of append batches after the base.
    :param base_fraction: Fraction of events that form the base batch.
    """
    conn = source.conn
    n = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    base_n = int(n * base_fraction)
    rest = max(n - base_n, 1)

    conn.execute(f"""
        CREATE TEMP TABLE replay_event_batch AS
        SELECT event_id,
               CASE WHEN rk <= {base_n} THEN 0
                    ELSE 1 + CAST(FLOOR((rk - {base_n} - 1) * {n_batches} / {rest}) AS INT)
               END AS batch_id
        FROM (
            SELECT event_id,
                   ROW_NUMBER() OVER (ORDER BY timestamp_unix, event_id) AS rk
            FROM events
        )
    """)
    conn.execute("""
        CREATE TEMP TABLE replay_obj_batch AS
        SELECT o.obj_id, COALESCE(MIN(b.batch_id), 0) AS batch_id
        FROM objects o
        LEFT JOIN event_object eo ON o.obj_id = eo.obj_id
        LEFT JOIN replay_event_batch b ON eo.event_id = b.event_id
        GROUP BY o.obj_id
    """)

    batches: List[Batch] = []
    for b in range(n_batches + 1):
        events = conn.execute(f"""
            SELECT e.event_id, e.activity, e.timestamp_unix
            FROM events e
            JOIN replay_event_batch rb ON e.event_id = rb.event_id
            WHERE rb.batch_id = {b}
            ORDER BY e.timestamp_unix, e.event_id
        """).pl()
        event_object = conn.execute(f"""
            SELECT eo.event_id, eo.obj_id, eo.qualifier
            FROM event_object eo
            JOIN replay_event_batch rb ON eo.event_id = rb.event_id
            WHERE rb.batch_id = {b}
        """).pl()
        objects = conn.execute(f"""
            SELECT o.obj_id, o.obj_type
            FROM objects o
            JOIN replay_obj_batch ob ON o.obj_id = ob.obj_id
            WHERE ob.batch_id = {b}
        """).pl()
        object_relations = conn.execute(f"""
            SELECT r.source_obj_id, r.target_obj_id, r.qualifier
            FROM object_relations r
            LEFT JOIN replay_obj_batch sb ON r.source_obj_id = sb.obj_id
            LEFT JOIN replay_obj_batch tb ON r.target_obj_id = tb.obj_id
            WHERE GREATEST(COALESCE(sb.batch_id, 0), COALESCE(tb.batch_id, 0)) = {b}
        """).pl()
        batches.append(Batch(events, event_object, objects, object_relations))

    conn.execute("DROP TABLE replay_event_batch")
    conn.execute("DROP TABLE replay_obj_batch")
    return batches
