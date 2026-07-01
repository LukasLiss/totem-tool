"""
Example: creating and querying an OCEL DuckDB database.

Run from the totem_lib/ directory:
    python example_duckdb.py
"""

import sys
from totem_lib.ocel.importer import import_ocel
from totem_lib.ocel.ocel_duckdb import OcelDuckDB


# ---------------------------------------------------------------------------
# Helper: simple union-find for connected components
# ---------------------------------------------------------------------------

class _UnionFind:
    def __init__(self):
        self._parent: dict[str, str] = {}

    def find(self, x: str) -> str:
        if self._parent.setdefault(x, x) != x:
            self._parent[x] = self.find(self._parent[x])
        return self._parent[x]

    def union(self, a: str, b: str) -> None:
        self._parent[self.find(a)] = self.find(b)

    def components(self) -> dict[str, list[str]]:
        groups: dict[str, list[str]] = {}
        for node in self._parent:
            root = self.find(node)
            groups.setdefault(root, []).append(node)
        return groups


# ---------------------------------------------------------------------------
# Load OCEL
# ---------------------------------------------------------------------------

ocel_path = "example_data/ContainerLogistics.sqlite"
print(f"Loading OCEL from {ocel_path} ...")
ocel = import_ocel(ocel_path)
print(ocel)
print()

# ---------------------------------------------------------------------------
# Build DuckDB (in-memory). Use a file path like "ocel.duckdb" to persist.
# ---------------------------------------------------------------------------

print("Building DuckDB database ...")
db = OcelDuckDB(ocel, path=":memory:")

print(f"  Event attribute columns : {db._event_attr_cols}")
print(f"  Object attribute columns: {db._obj_attr_cols}")
print()

# ---------------------------------------------------------------------------
# 1. Object lifetimes
# ---------------------------------------------------------------------------

print("=" * 60)
print("1. Object lifetimes (min/max event timestamp per object)")
print("=" * 60)
lifetimes = db.get_object_lifetimes()
print(lifetimes.head(10))
print()

# ---------------------------------------------------------------------------
# 2. Connected components via co-occurring object pairs
# ---------------------------------------------------------------------------

print("=" * 60)
print("2. Connected components (objects sharing events)")
print("=" * 60)
pairs = db.get_co_occurring_pairs()
print(f"  Co-occurrence pairs: {len(pairs)}")

uf = _UnionFind()
for obj1, obj2 in pairs.iter_rows():
    uf.union(obj1, obj2)

components = uf.components()
print(f"  Connected components: {len(components)}")
sizes = sorted((len(v) for v in components.values()), reverse=True)
print(f"  Largest component size: {sizes[0] if sizes else 0}")
print(f"  Component size distribution (top 10): {sizes[:10]}")
print()

# ---------------------------------------------------------------------------
# 3. Temporal relation data (base for totem computation)
# ---------------------------------------------------------------------------

print("=" * 60)
print("3. Temporal relation data (co-occurring object pairs with lifetimes)")
print("=" * 60)
temporal = db.get_temporal_relation_data()
print(temporal.head(10))
print()

# ---------------------------------------------------------------------------
# 4. Events joined with objects
# ---------------------------------------------------------------------------

print("=" * 60)
print("4. Events with objects (replaces hot loop in totem.py)")
print("=" * 60)
events_with_objects = db.get_events_with_objects()
print(events_with_objects.head(10))
print()

# ---------------------------------------------------------------------------
# 5. User-defined KPI queries (plain column names, no JSON extraction)
# ---------------------------------------------------------------------------

print("=" * 60)
print("5. User-defined KPI queries")
print("=" * 60)

# How many events per activity?
result = db.query("""
    SELECT activity, COUNT(*) AS event_count
    FROM events
    GROUP BY activity
    ORDER BY event_count DESC
""")
print("Events per activity:")
print(result)
print()

# How many events involve each object type?
result = db.query("""
    SELECT o.obj_type, COUNT(DISTINCT eo.event_id) AS event_count
    FROM objects o
    JOIN event_object eo ON o.obj_id = eo.obj_id
    GROUP BY o.obj_type
    ORDER BY event_count DESC
""")
print("Events per object type:")
print(result)
print()

# Object lifetime duration per type
result = db.query("""
    WITH lifetimes AS (
        SELECT o.obj_id, o.obj_type,
               MAX(e.timestamp_unix) - MIN(e.timestamp_unix) AS duration
        FROM objects o
        JOIN event_object eo ON o.obj_id    = eo.obj_id
        JOIN events e        ON eo.event_id  = e.event_id
        GROUP BY o.obj_id, o.obj_type
    )
    SELECT obj_type,
           AVG(duration) AS avg_duration_s,
           MAX(duration) AS max_duration_s,
           MIN(duration) AS min_duration_s
    FROM lifetimes
    GROUP BY obj_type
    ORDER BY avg_duration_s DESC
""")
print("Lifetime statistics per object type (seconds):")
print(result)
print()

# If the log has a 'resource' event attribute, show workload per resource
if "resource" in db._event_attr_cols:
    result = db.query("""
        SELECT resource, activity, COUNT(*) AS count
        FROM events
        WHERE resource IS NOT NULL
        GROUP BY resource, activity
        ORDER BY count DESC
        LIMIT 20
    """)
    print("Workload per resource and activity:")
    print(result)
    print()

# ---------------------------------------------------------------------------
# 6. Ad-hoc SQL example
# ---------------------------------------------------------------------------

print("=" * 60)
print("6. Ad-hoc SQL: objects involved in the most events")
print("=" * 60)
result = db.query("""
    SELECT o.obj_id, o.obj_type, COUNT(eo.event_id) AS event_count
    FROM objects o
    JOIN event_object eo ON o.obj_id = eo.obj_id
    GROUP BY o.obj_id, o.obj_type
    ORDER BY event_count DESC
    LIMIT 10
""")
print(result)
print()

# ---------------------------------------------------------------------------
# Clean up
# ---------------------------------------------------------------------------

db.close()
print("Done.")
