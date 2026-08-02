# OCEL Edge-Case Taxonomy & Acceptance Contract

**Epic #200, Sub-issue #187.** This document defines *which* boundary/corner cases the
platform must be exercised against and *what the right behavior is* for each. It is the
oracle that the tests in `totem_lib/tests/edge_cases/test_edge_cases.py` (Sub-issue #198)
assert against, and the catalogue that the fixtures in `totem_lib/test_data/edge_cases/`
(Sub-issue #188) implement.

Each case is a small, deliberately-constructed OCEL 2.0 log built by
`totem_lib/tests/edge_cases/generate_edge_cases.py`.

## Legend

- **OK** — the pipeline runs and returns a well-formed (possibly empty) result.
- **XFAIL** — a currently-documented crash. The behavior is *wrong* but known; the test
  marks it `xfail(strict=True)` with the exact exception pinned, and a follow-up is tracked
  under Epic #200. When the miner is hardened the test flips to XPASS and forces cleanup.
- **n/a** — the case does not meaningfully exercise this pipeline.

"Polars path" = `import_ocel` + the in-memory `ObjectCentricEventLog` miners
(`totemDiscovery`, `OCDFG.from_ocel`, `discover_oc_petri_net_polars`, `discover_occn`,
Polars `find_variants`). "DuckDB path" = `import_ocel_db` + the `OcelDuckDB` miners
(`totemDiscovery_db`, `OCDFGDb`/`NewOCDFGDb`, DuckDB `find_variants`).

## Structural / size cases

| Case (fixture) | Description | Expected behavior |
|---|---|---|
| **empty** | Zero events, zero objects | Polars `import_ocel` **XFAIL** (`SchemaError`: null-typed timestamp column on a zero-event log). DuckDB `import_ocel_db` **OK** → 0 events / 0 objects. All DuckDB miners **OK** and return empty models (`totemDiscovery_db` → empty tempgraph). All Polars miners **XFAIL** (blocked by the import bug). |
| **single_event** | One event, one object, one type | All pipelines **OK**. Smallest non-empty model. |
| **single_object_type** | Several events/objects, a single object type (no cross-type interaction) | All pipelines **OK**. |
| **event_no_objects** | An event whose relationship list is empty | All pipelines **OK** — the object-less event must not crash graph construction. |
| **dead_object** | An object referenced by no event | All pipelines **OK**. The dead object is dropped on Polars import (`propagate_filtering`); it is retained in the DuckDB `objects` table (referentially valid, just unreferenced). |
| **disconnected_types** | Two object types that never share an event (disjoint subgraphs) | All pipelines **OK**. Variants yields one execution per component. |

## Behavioral / topology cases

| Case (fixture) | Description | Expected behavior |
|---|---|---|
| **self_loop** | Same activity repeated for one object (directly-follows self-loop) | All pipelines **OK**. |
| **long_chain** | 50-step strictly-sequential chain of distinct activities on one object | All pipelines **OK** (checks there is no depth/recursion limit). |
| **cyclic** | Cyclic control flow `A → B → A → B` on one object | Polars/DuckDB import, TOTeM, OCDFG, OCPN, Variants **OK**. `discover_occn` (and therefore `occn_precision`) **XFAIL** (`TypeError`: empty marker list — the Flexible Heuristics Miner build does not currently support cycles). |
| **high_fanout** | One event related to 100+ objects (high/unbounded cardinality) | All pipelines **OK**. Stresses per-event object fan-out. |
| **equal_timestamps** | Concurrent events sharing an identical timestamp | All pipelines **OK**. Ordering ties must not crash the directly-follows / temporal logic. |

## Data-quality cases

| Case (fixture) | Description | Expected behavior |
|---|---|---|
| **out_of_order_timestamps** | Events listed in the file in non-chronological order | All pipelines **OK** — miners sort by timestamp internally, result is order-independent. |
| **null_attributes** | Missing / explicitly-null event and object attribute values | All pipelines **OK** — null attributes must not break import or mining. |
| **unicode_names** | Unicode / special characters (en-dash, CJK, emoji) in activity & object-type names | Polars path, TOTeM, OCDFG, OCPN, OCCN **OK**. DuckDB `find_variants` **XFAIL** (`UnicodeEncodeError`: the variants signature path assumes ASCII). |
| **duplicate_event_ids** | Two events sharing the same id | DuckDB `import_ocel_db(graceful_import=True)` **dedups** (second occurrence dropped → 1 event). The Polars `import_ocel` **does not** dedup — it warns (`UserWarning: Duplicate event IDs detected`) and keeps both rows. TOTeM, OCDFG, Variants **OK** on both paths. `discover_oc_petri_net_polars` **OK** (pm4py 2.7.22.4 no longer raises on duplicate ids). `discover_occn`/`occn_precision` **XFAIL** on the un-deduped Polars log. *Note:* this is the one **invalid** log in the corpus (event ids must be unique). It is kept not as a case the miners must survive, but to pin the user-visible divergence above: the same file yields 1 event on the DuckDB path and 2 on the Polars path. Hard rejection of duplicate ids is owned by the OCEL-upload-validation epic (#166), not here. |

## Summary of currently-documented crashes (XFAIL)

| Fixture | Pipeline | Exception | Follow-up |
|---|---|---|---|
| empty | Polars `import_ocel` (+ all Polars miners) | `polars.exceptions.SchemaError` | Harden zero-event Polars import |
| cyclic | `discover_occn` / `occn_precision` | `TypeError` | OCCN support for cyclic control flow |
| duplicate_event_ids | `discover_occn` / `occn_precision` | `Exception` | OCCN vs duplicate ids (Polars no-dedup) |
| unicode_names | DuckDB `find_variants` | `UnicodeEncodeError` | ASCII assumption in variants signature |

As of the last verified run: **186 passed, 13 xfailed, 0 failed** (`pytest tests/edge_cases/`).
The 13 xfailed test instances collapse to the 5 distinct root causes above — the `empty`
import bug alone accounts for 7 of them, since it blocks every Polars-path miner.

Each XFAIL is a real hardening opportunity; file a follow-up issue under Epic #200 before
removing an entry. See `totem_lib/test_data/edge_cases/README.md` for how to extend the corpus.
