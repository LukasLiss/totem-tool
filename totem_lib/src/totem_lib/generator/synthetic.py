"""
Set-based synthetic OCEL generator.

Generates object-centric event logs of arbitrary size directly inside DuckDB
using INSERT ... SELECT over range() — no Python-level row loops. Generating
10M events takes seconds, which makes controlled scalability experiments
practical.

Process model ("hierarchical interaction model"):

- K object types ot0 .. ot{K-1} arranged in a hierarchy (e.g. order → item →
  package). Each object of type k > 0 references one parent object of type
  k - 1, chosen pseudo-randomly via hash().
- Every object runs through its own lifecycle of `events_per_object` events
  whose activities cycle through `activities_per_type` type-specific
  activities. A child object starts its lifecycle after its parent started,
  so lifetimes of related objects overlap and nest — producing a realistic
  mix of TOTeM temporal relations (dependent / initiating / parallel).
- A configurable percentage of child events additionally references the
  parent object (shared events), which creates event-level interaction
  between types: type-pair connections, event cardinalities > 0, and
  co-occurrence pairs.
- Child → parent links are also materialized as o2o relations for a
  configurable percentage of objects.

All randomness is derived from DuckDB's hash() of (seed, type, index), so a
given configuration is fully deterministic and reproducible.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Union

import duckdb

from ..ocel.ocel_duckdb import OcelDuckDB, create_ocel_schema


@dataclass
class SyntheticLogConfig:
    n_types: int = 3
    objects_per_type: Union[int, List[int]] = 1000
    events_per_object: int = 10
    activities_per_type: int = 5
    share_pct: int = 30          # % of child events also linked to the parent
    o2o_pct: int = 100           # % of child objects with an o2o edge to the parent
    time_step: int = 60          # seconds between consecutive lifecycle events
    seed: int = 42

    def objects_for_type(self, k: int) -> int:
        if isinstance(self.objects_per_type, int):
            return self.objects_per_type
        return self.objects_per_type[k]

    @property
    def total_events(self) -> int:
        return sum(
            self.objects_for_type(k) * self.events_per_object
            for k in range(self.n_types)
        )


def generate_synthetic_ocel(
    config: Optional[SyntheticLogConfig] = None,
    db_path: str = ":memory:",
    **kwargs,
) -> OcelDuckDB:
    """
    Generate a synthetic OCEL directly into a DuckDB database.

    :param config: Generator configuration. If None, one is built from kwargs.
    :param db_path: ':memory:' or a file path for an on-disk database.
    :param kwargs: Shorthand for SyntheticLogConfig fields, e.g.
                   generate_synthetic_ocel(objects_per_type=10_000, seed=1).
    :return: OcelDuckDB wrapping the populated database.
    """
    cfg = config or SyntheticLogConfig(**kwargs)
    if config is not None and kwargs:
        raise ValueError("Pass either a config object or kwargs, not both")
    if cfg.n_types < 1:
        raise ValueError("n_types must be >= 1")

    conn = duckdb.connect(db_path)
    create_ocel_schema(conn, [], [])

    # Time horizon wide enough that root objects spread out but lifetimes
    # of related objects still overlap.
    lifetime = cfg.events_per_object * cfg.time_step
    horizon = max(lifetime * 10, 1)

    for k in range(cfg.n_types):
        n_k = cfg.objects_for_type(k)
        salt = cfg.seed * 1_000_003 + k * 7919

        if k == 0:
            conn.execute(f"""
                CREATE TEMP TABLE gen_obj_{k} AS
                SELECT
                    i AS idx,
                    'o{k}_' || i AS obj_id,
                    CAST(NULL AS BIGINT) AS parent_idx,
                    CAST(hash({salt} + i) % {horizon} AS BIGINT) AS start_ts
                FROM range({n_k}) t(i)
            """)
        else:
            n_parent = cfg.objects_for_type(k - 1)
            # Child starts somewhere within the first half of the parent
            # lifetime, so child lifetimes nest in or overlap the parent's.
            conn.execute(f"""
                CREATE TEMP TABLE gen_obj_{k} AS
                SELECT
                    t.i AS idx,
                    'o{k}_' || t.i AS obj_id,
                    CAST(hash({salt} + 17 * t.i) % {n_parent} AS BIGINT) AS parent_idx,
                    p.start_ts + 1
                        + CAST(hash({salt} + 31 * t.i) % {max(lifetime // 2, 1)} AS BIGINT)
                        AS start_ts
                FROM range({n_k}) t(i)
                JOIN gen_obj_{k - 1} p
                  ON p.idx = CAST(hash({salt} + 17 * t.i) % {n_parent} AS BIGINT)
            """)

        conn.execute(f"""
            INSERT INTO objects (obj_id, obj_type)
            SELECT obj_id, 'ot{k}' FROM gen_obj_{k}
        """)

        conn.execute(f"""
            INSERT INTO events (event_id, activity, timestamp_unix)
            SELECT
                'e{k}_' || g.idx || '_' || r.j,
                'a{k}_' || (r.j % {cfg.activities_per_type}),
                g.start_ts + r.j * {cfg.time_step}
                    + CAST(hash({salt} + g.idx * 131 + r.j) % {cfg.time_step} AS BIGINT)
            FROM gen_obj_{k} g
            CROSS JOIN range({cfg.events_per_object}) r(j)
        """)

        # Every event references its owning object.
        conn.execute(f"""
            INSERT INTO event_object (event_id, obj_id, qualifier)
            SELECT 'e{k}_' || g.idx || '_' || r.j, g.obj_id, 'owner'
            FROM gen_obj_{k} g
            CROSS JOIN range({cfg.events_per_object}) r(j)
        """)

        if k > 0 and cfg.share_pct > 0:
            conn.execute(f"""
                INSERT INTO event_object (event_id, obj_id, qualifier)
                SELECT DISTINCT
                    'e{k}_' || g.idx || '_' || r.j,
                    p.obj_id,
                    'parent'
                FROM gen_obj_{k} g
                JOIN gen_obj_{k - 1} p ON p.idx = g.parent_idx
                CROSS JOIN range({cfg.events_per_object}) r(j)
                WHERE hash({salt} + g.idx * 257 + r.j) % 100 < {cfg.share_pct}
            """)

        if k > 0 and cfg.o2o_pct > 0:
            conn.execute(f"""
                INSERT INTO object_relations (source_obj_id, target_obj_id, qualifier)
                SELECT g.obj_id, p.obj_id, 'parent'
                FROM gen_obj_{k} g
                JOIN gen_obj_{k - 1} p ON p.idx = g.parent_idx
                WHERE hash({salt} + g.idx * 509) % 100 < {cfg.o2o_pct}
            """)

        if k > 0:
            conn.execute(f"DROP TABLE gen_obj_{k - 1}")

    conn.execute(f"DROP TABLE gen_obj_{cfg.n_types - 1}")

    return OcelDuckDB._from_prepared_connection(conn, [], [])
