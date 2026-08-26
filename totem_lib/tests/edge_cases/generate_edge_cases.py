"""
Generator for the edge-case OCEL corpus (Epic #200, Sub-issue #188).

Each edge case is a small, deliberately-constructed OCEL 2.0 log that exercises
one boundary/corner condition of the platform (empty log, dead object, cyclic
dependencies, weird timestamps, ...). See ``EDGE_CASES`` below for the catalogue.

For every case this script writes two files into ``totem_lib/test_data/edge_cases/``:

  * ``<name>.json``   -- canonical OCEL 2.0 JSON (matches the schema of the
                         realistic logs in ``test_data/small/``). This is the
                         source of truth; both the Polars importer (``import_ocel``)
                         and the DuckDB importer (``import_ocel_db``) read it.
  * ``<name>.duckdb`` -- derived by round-tripping the JSON through the real
                         conversion path ``import_ocel_db(json).save(duckdb)``.
                         Producing it doubles as a smoke test that the file loads.

The script is idempotent: running it regenerates the whole corpus from scratch.

Usage (from the ``totem_lib/`` directory)::

    python tests/edge_cases/generate_edge_cases.py

To add a new edge case: add a builder to ``EDGE_CASES``, re-run this script, then
add any non-default oracle / xfail entry in ``tests/edge_cases/test_edge_cases.py``.
See ``test_data/edge_cases/README.md`` for the full contributor guide.
"""

import json
import sys
from pathlib import Path

# The corpus lives under test_data/edge_cases/, three levels up from this file
# (tests/edge_cases/ -> tests/ -> totem_lib/).
OUTPUT_DIR = Path(__file__).parent.parent.parent / "test_data" / "edge_cases"

# Base timestamp; helpers offset from here in one-minute steps.
BASE_TS = "2023-01-01T00:00:00Z"


# ---------------------------------------------------------------------------
# Tiny builder helpers (there is no OCEL builder API in totem_lib, so we emit
# the OCEL 2.0 JSON dict shape directly -- see test_data/small/*.json).
# ---------------------------------------------------------------------------

def _ts(minute: int) -> str:
    """ISO-8601 UTC timestamp `minute` minutes after 2023-01-01T00:00:00Z."""
    h, m = divmod(minute, 60)
    d, h = divmod(h, 24)
    return f"2023-01-{1 + d:02d}T{h:02d}:{m:02d}:00Z"


def event(eid, etype, time, objects=None, attributes=None):
    """Build an OCEL event dict.

    objects:    list of (object_id, qualifier) -> E2O relationships.
    attributes: dict {name: value} -> event attributes (value None allowed).
    """
    return {
        "id": eid,
        "type": etype,
        "time": time,
        "attributes": [
            {"name": k, "value": v} for k, v in (attributes or {}).items()
        ],
        "relationships": [
            {"objectId": oid, "qualifier": q} for oid, q in (objects or [])
        ],
    }


def obj(oid, otype, o2o=None, attributes=None):
    """Build an OCEL object dict.

    o2o:        list of (target_object_id, qualifier) -> O2O relationships.
    attributes: list of (name, value, time) -> versioned object attributes.
    """
    return {
        "id": oid,
        "type": otype,
        "attributes": [
            {"name": n, "value": v, "time": t} for n, v, t in (attributes or [])
        ],
        "relationships": [
            {"objectId": tid, "qualifier": q} for tid, q in (o2o or [])
        ],
    }


def ocel(events, objects, extra_event_types=None, extra_object_types=None):
    """Assemble a full OCEL 2.0 document.

    eventTypes / objectTypes are auto-derived from the events / objects present.
    `extra_*_types` lets a case declare a type with no members (e.g. to model a
    declared-but-unused object type).
    """
    event_types = {e["type"] for e in events} | set(extra_event_types or [])
    object_types = {o["type"] for o in objects} | set(extra_object_types or [])
    return {
        "eventTypes": [{"name": t, "attributes": []} for t in sorted(event_types)],
        "objectTypes": [{"name": t, "attributes": []} for t in sorted(object_types)],
        "events": events,
        "objects": objects,
    }


# ---------------------------------------------------------------------------
# Edge case builders. Each returns a complete OCEL 2.0 document.
# Keep them small and readable -- the point is a legible boundary condition,
# not a realistic process.
# ---------------------------------------------------------------------------

def empty():
    """Zero events, zero objects."""
    return ocel([], [])


def single_event():
    """Exactly one event referencing one object of one type."""
    return ocel(
        [event("e1", "Create Order", _ts(0), [("o1", "order")])],
        [obj("o1", "order")],
    )


def single_object_type():
    """Several events/objects but a single object type (no type interaction)."""
    events = [
        event("e1", "Create", _ts(0), [("o1", "order")]),
        event("e2", "Update", _ts(1), [("o1", "order")]),
        event("e3", "Create", _ts(2), [("o2", "order")]),
        event("e4", "Close", _ts(3), [("o2", "order")]),
    ]
    return ocel(events, [obj("o1", "order"), obj("o2", "order")])


def event_no_objects():
    """An event that references no objects at all (empty relationships)."""
    events = [
        event("e1", "Create Order", _ts(0), [("o1", "order")]),
        event("e2", "System Heartbeat", _ts(1), []),  # references nothing
    ]
    return ocel(events, [obj("o1", "order")])


def dead_object():
    """An object referenced by no event (dead object)."""
    events = [event("e1", "Create Order", _ts(0), [("o1", "order")])]
    objects = [
        obj("o1", "order"),
        obj("o_dead", "item"),  # never referenced by any event
    ]
    return ocel(events, objects)


def disconnected_types():
    """Two object types whose events never share an event (disjoint subgraphs)."""
    events = [
        event("e1", "Create Order", _ts(0), [("o1", "order")]),
        event("e2", "Ship Order", _ts(1), [("o1", "order")]),
        event("e3", "Create Invoice", _ts(2), [("i1", "invoice")]),
        event("e4", "Pay Invoice", _ts(3), [("i1", "invoice")]),
    ]
    return ocel(events, [obj("o1", "order"), obj("i1", "invoice")])


def self_loop():
    """The same activity repeated for one object (directly-follows self loop)."""
    events = [
        event("e1", "Retry", _ts(0), [("o1", "order")]),
        event("e2", "Retry", _ts(1), [("o1", "order")]),
        event("e3", "Retry", _ts(2), [("o1", "order")]),
    ]
    return ocel(events, [obj("o1", "order")])


def long_chain():
    """A long strictly-sequential chain of distinct activities on one object."""
    n = 50
    events = [
        event(f"e{i}", f"Step_{i:02d}", _ts(i), [("o1", "order")])
        for i in range(n)
    ]
    return ocel(events, [obj("o1", "order")])


def cyclic():
    """Cyclic control flow: A -> B -> A -> B for one object."""
    events = [
        event("e1", "A", _ts(0), [("o1", "order")]),
        event("e2", "B", _ts(1), [("o1", "order")]),
        event("e3", "A", _ts(2), [("o1", "order")]),
        event("e4", "B", _ts(3), [("o1", "order")]),
    ]
    return ocel(events, [obj("o1", "order")])


def high_fanout():
    """One event related to many objects (unbounded cardinality / high fan-out)."""
    items = [obj(f"i{i}", "item") for i in range(100)]
    order = obj("o1", "order")
    rels = [("o1", "order")] + [(f"i{i}", "item") for i in range(100)]
    events = [event("e1", "Bulk Ship", _ts(0), rels)]
    return ocel(events, [order] + items)


def equal_timestamps():
    """Concurrent events sharing an identical timestamp."""
    events = [
        event("e1", "A", _ts(0), [("o1", "order")]),
        event("e2", "B", _ts(0), [("o1", "order")]),  # same timestamp as e1
        event("e3", "C", _ts(0), [("o1", "order")]),  # same timestamp again
    ]
    return ocel(events, [obj("o1", "order")])


def out_of_order_timestamps():
    """Events listed in the file in non-chronological order."""
    events = [
        event("e3", "C", _ts(2), [("o1", "order")]),
        event("e1", "A", _ts(0), [("o1", "order")]),
        event("e2", "B", _ts(1), [("o1", "order")]),
    ]
    return ocel(events, [obj("o1", "order")])


def null_attributes():
    """Events/objects with missing or explicitly-null attribute values."""
    events = [
        event("e1", "Create Order", _ts(0), [("o1", "order")],
              attributes={"priority": None, "note": "first"}),
        event("e2", "Update Order", _ts(1), [("o1", "order")],
              attributes={}),  # no attributes at all
    ]
    objects = [
        obj("o1", "order", attributes=[("price", None, _ts(0))]),
    ]
    return ocel(events, objects)


def unicode_names():
    """Unicode / special characters in activity and object-type names."""
    events = [
        event("e1", "Bestellung anlegen – über", _ts(0), [("o1", "Auftrag")]),
        event("e2", "发货 \U0001f4e6", _ts(1), [("o1", "Auftrag")]),
    ]
    return ocel(events, [obj("o1", "Auftrag")])


def duplicate_event_ids():
    """Two events sharing the same id (should be deduped or rejected)."""
    events = [
        event("e1", "Create Order", _ts(0), [("o1", "order")]),
        event("e1", "Create Order Again", _ts(1), [("o1", "order")]),  # dup id
    ]
    return ocel(events, [obj("o1", "order")])


# The corpus. Order is cosmetic (tests glob + sort the directory).
EDGE_CASES = {
    "empty": empty,
    "single_event": single_event,
    "single_object_type": single_object_type,
    "event_no_objects": event_no_objects,
    "dead_object": dead_object,
    "disconnected_types": disconnected_types,
    "self_loop": self_loop,
    "long_chain": long_chain,
    "cyclic": cyclic,
    "high_fanout": high_fanout,
    "equal_timestamps": equal_timestamps,
    "out_of_order_timestamps": out_of_order_timestamps,
    "null_attributes": null_attributes,
    "unicode_names": unicode_names,
    "duplicate_event_ids": duplicate_event_ids,
}


def _write_duckdb(json_path: Path, duckdb_path: Path) -> None:
    """Derive the .duckdb fixture from the JSON via the real conversion path."""
    # Imported lazily so the JSON files can still be regenerated in an
    # environment where totem_lib's heavy deps are not installed.
    sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))
    from totem_lib.ocel.importer_db import import_ocel_db

    if duckdb_path.exists():
        duckdb_path.unlink()  # OcelDuckDB.save/connect will not overwrite in place
    db = import_ocel_db(str(json_path), db_path=":memory:")
    db.save(str(duckdb_path))
    db.close()


def generate(write_duckdb: bool = True) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, builder in EDGE_CASES.items():
        doc = builder()
        json_path = OUTPUT_DIR / f"{name}.json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2, ensure_ascii=False)
            f.write("\n")
        line = f"  wrote {json_path.name}"
        if write_duckdb:
            duckdb_path = OUTPUT_DIR / f"{name}.duckdb"
            _write_duckdb(json_path, duckdb_path)
            line += f" + {duckdb_path.name}"
        print(line)
    print(f"Generated {len(EDGE_CASES)} edge-case logs in {OUTPUT_DIR}")


if __name__ == "__main__":
    # `--json-only` skips the DuckDB derivation (useful when deps are missing).
    generate(write_duckdb="--json-only" not in sys.argv)
