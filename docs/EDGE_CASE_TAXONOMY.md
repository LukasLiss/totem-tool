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
- **XFAIL** — a documented crash. The behavior is *wrong* but known; the test marks it
  `xfail(strict=True)` with the exact exception pinned, and a follow-up is tracked. When the
  miner is hardened the test flips to XPASS and forces cleanup. **No case is XFAIL today.**
- **n/a** — the case does not meaningfully exercise this pipeline.

"Polars path" = `import_ocel` + the in-memory `ObjectCentricEventLog` miners
(`totemDiscovery`, `OCDFG.from_ocel`, `discover_oc_petri_net_polars`, `discover_occn`,
Polars `find_variants`). "DuckDB path" = `import_ocel_db` + the `OcelDuckDB` miners
(`totemDiscovery_db`, `OCDFGDb`/`NewOCDFGDb`, DuckDB `find_variants`).

## Structural / size cases

| Case (fixture) | Description | Expected behavior |
|---|---|---|
| **empty** | Zero events, zero objects | All pipelines **OK** → 0 events / 0 objects, and every miner returns an empty model (`totemDiscovery_db` → empty tempgraph). The raw Polars loaders declare their column types explicitly, so a zero-row frame is `Utf8`/`List(Utf8)` rather than null-typed. Polars `find_variants` is **n/a**: it needs a leading object type and the log has none, so that one test skips. |
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
| **cyclic** | Cyclic control flow `A → B → A → B` on one object | All pipelines **OK**. `discover_occn` recovers the length-2 loop arcs: pm4py's plain dependency measure scores both arcs of such a loop below threshold, and its own loop-repair pass only visits nodes that already cleared that threshold — so on a purely cyclic log it never runs and pm4py emits isolated, arc-less nodes. `_repairLengthTwoLoops` re-runs that repair with pm4py's own loop measure when (and only when) that fallback was hit, so the cycle is discovered and every event replays (`occn_precision` → 4/4 replayable). |
| **high_fanout** | One event related to 100+ objects (high/unbounded cardinality) | All pipelines **OK**. Stresses per-event object fan-out. |
| **equal_timestamps** | Concurrent events sharing an identical timestamp | All pipelines **OK**. Ordering ties must not crash the directly-follows / temporal logic. |

## Data-quality cases

| Case (fixture) | Description | Expected behavior |
|---|---|---|
| **out_of_order_timestamps** | Events listed in the file in non-chronological order | All pipelines **OK** — miners sort by timestamp internally, result is order-independent. |
| **null_attributes** | Missing / explicitly-null event and object attribute values | All pipelines **OK** — null attributes must not break import or mining. |
| **unicode_names** | Unicode / special characters (en-dash, CJK, emoji) in activity & object-type names | All pipelines **OK**. networkx hashes Weisfeiler-Lehman labels as ASCII, so the `wl` / `wl+vf2` strategies used to raise `UnicodeEncodeError`; `iso_strategies._wl_hash` now escapes labels into an injective ASCII form first, which leaves grouping unchanged. |
| **duplicate_event_ids** | Two events sharing the same id | All pipelines **OK**. **Both** importers now dedup, keeping the first occurrence → 1 event. DuckDB does it through its primary keys (`import_ocel_db(graceful_import=True)`); the Polars path does it in `schema_base_filtering`, which still emits `UserWarning: Duplicate event IDs detected`. Deduping is what unblocks `discover_occn`/`occn_precision` (previously `max()` over an empty marker-group list) and pm4py's `discover_oc_petri_net_polars` (previously a `KeyError` on the activity of the dropped event). *Note:* this is the one **invalid** log in the corpus (event ids must be unique). It is kept to pin the *agreement* between the two paths — the same file must yield the same log whichever importer reads it. Hard rejection of duplicate ids is owned by the OCEL-upload-validation epic (#166), not here. |

## Summary of documented crashes (XFAIL)

**None.** The five root causes this corpus originally documented (13 xfailed test instances)
were all fixed under Issue #296:

| Fixture | Pipeline | Was | Fixed by |
|---|---|---|---|
| empty | Polars `import_ocel` (+ all Polars miners) | `polars.exceptions.SchemaError` | Explicit column schemas in the raw loaders (`ocel/importer.py`) |
| cyclic | `discover_occn` / `occn_precision` | `TypeError` | `_repairLengthTwoLoops` restores the loop arcs pm4py skips (`occn/discover.py`) |
| duplicate_event_ids | `discover_occn` / `occn_precision` | `Exception` | Polars import dedups, matching DuckDB (`ocel/utils/filter.py`) |
| duplicate_event_ids | `discover_oc_petri_net_polars` | `KeyError` | same dedup |
| unicode_names | DuckDB `find_variants` | `UnicodeEncodeError` | ASCII-escaped WL labels (`variants/iso_strategies.py`) |

As of the last verified run: **202 passed, 1 skipped, 0 xfailed, 0 failed**
(`pytest tests/edge_cases/`). The one skip is `test_variants_polars[empty]` — the Polars
variants miner needs a leading object type, which a zero-object log does not have.

If a future change re-introduces a crash, pin it: add the fixture stem to the matching
`XFAIL_*` map in `test_edge_cases.py` as `(reason, ExceptionType)` and file a follow-up issue.
Because the maps use `strict=True`, a stale entry can never accumulate silently. See
`totem_lib/test_data/edge_cases/README.md` for how to extend the corpus.
