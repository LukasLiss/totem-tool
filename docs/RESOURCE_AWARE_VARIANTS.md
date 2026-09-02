# Resource-Aware Variants and Stored Process Executions

This document covers three features that build on each other:

1. **Resource-aware variant calculation** — a process-execution extraction in
   which the user decides which object types are *business objects* and which
   activities are *business activities*. Shared resources (a worker, a
   machine, a truck) no longer glue unrelated executions together.
2. **Storing process executions in the event log** — the Variants Explorer
   can write the execution id (and optionally the variant id) of every event
   into a column of the log's `events` table.
3. **OCCN conformance on stored executions** — the OCCN conformance view can
   replay exactly those stored executions, optionally ignoring object types
   the model does not contain.

The process-area filter action (hover a process area, click the filter
circle) is described at the end because it is the quickest way to obtain a
sensible business-object / business-activity selection.

## 1. Resource-aware extraction

`find_variants(..., extraction="resource_aware", business_object_types=[...],
business_activities=[...])` in `totem_lib/src/totem_lib/variants/` works as
follows:

1. Every object whose type is a business object type and that occurs in at
   least one event is a node of the *business-object graph*.
2. Two nodes are connected iff they share an event whose activity is a
   business activity (`business_activities=None` means every activity).
3. Each connected component is one process execution. Its **events** are all
   events that reference one of the component's objects — including events of
   non-business activities and events shared with a resource.
4. The variant graph of an execution only uses edges induced by the
   execution's own (business) objects. The resource therefore never appears
   as a lane and its schedule does not influence the variant.

Steps 2 and 3 differ from the classic *connected components* extraction,
where every object is a node and every event connects; there a single worker
touching all orders collapses the whole log into one execution.

Executions are identified by their lexicographically smallest object id (the
same convention the connected-components extraction uses).

## 2. Process executions as event columns

`totem_lib.variants.extract_process_executions` returns the executions of
any extraction technique as `case_id -> event ids`;
`partition_events` turns them into a per-event assignment and
`totem_lib.ocel.write_event_columns_to_file` writes it to a DuckDB log.

The invariant of a stored column is: **every event carries at most one
execution id, and an id identifies exactly one execution.** Consequences:

- An event that lies in several executions (possible with the leading-object
  techniques, e.g. an event shared by two leading objects) is *ambiguous* and
  gets no id. The response reports how many events this affected.
- Events in no execution (a worker's "start shift") stay empty.
- The global filter applies: executions are computed on the filtered log and
  events outside the filter get no id.
- Writing a column that already exists replaces all of its values.

### Backend

| Endpoint | Purpose |
| --- | --- |
| `GET /api/files/<pk>/event_columns/` | Non-fixed columns of `events` with `non_null_count` / `distinct_count`. |
| `POST /api/files/<pk>/process_executions/` | Extract executions, write `execution_column`, optionally compute variants and write `variant_column`. |

`POST` body:

```json
{
  "extraction": "resource_aware",
  "business_object_types": ["order", "item", "package"],
  "business_activities": ["place order", "pick item", "pack items", "ship package", "close order"],
  "execution_column": "process execution",
  "compute_variants": true,
  "iso": "wl+vf2",
  "timeout_s": 10,
  "variant_column": "variant"
}
```

`leading_type` replaces the business lists for the `leading_1hop` /
`leading_bfs` extractions. `GET /api/variants/` accepts the same extraction
parameters as query parameters; list parameters are *repeated*
(`?business_activities=a&business_activities=b`), never comma-separated.

The response contains `execution_count`, `total_event_count`,
`assigned_event_count`, `ambiguous_event_count`, `unassigned_event_count`,
`variant_count` / `variants` (null when variants were skipped) and echoes the
resolved parameters.

Writing requires a read-write DuckDB connection while the backend keeps
read-only ones. `_rewrite_ocel_db_file` in `backend/api/views.py` closes the
registry connection under the per-file lock, applies the write and reopens
it; readers queued on the lock pick up the fresh connection. The results
cache misses by itself because its keys contain the file's mtime and size.

### Frontend

The Variants Explorer settings panel has three numbered boxes:

1. **Process executions** — extraction, leading type *or* (resource-aware)
   a process-area picker plus multi-selects for business object types and
   activities. The picker lists the areas the Process Area component
   computed for this log (shared through `store/processAreaStore.ts`); if
   none exist yet, they can be computed with default settings in place.
2. **Variant grouping** — isomorphism strategy and timeout; greyed out when
   variants are skipped.
3. **Store in event log** — a switch, the execution column name, "also
   compute variants" and "store variant id" with its column name.

The boxes wrap to one column on narrow widths; nothing scrolls
horizontally. Computation is an explicit click (`Compute variants` /
`Compute & store`) except for dashboard components with *automatic
loading*, which recompute after settings changes — never when storing.

## 3. OCCN conformance on stored executions

`extract_occn_replay_units(db, strategy="stored_column",
execution_column="process execution", object_types=...)` builds one replay
unit per distinct value of the column (`stored_column:<id>`); events without
a value are skipped. `object_types` projects every event onto the given
types first and applies to all strategies (see `docs/OCCN_REPLAY_FITNESS.md`).

In the OCCN conformance view choose **Stored process executions** as the
replay unit strategy, pick the column, and switch on **Ignore object types
missing from the model** when the model was mined without the resource.
Without that switch every event that touches the resource is non-fitting,
because replay matches bindings against exactly the observed objects.

## Walkthrough with the example logs

`totem_lib/test_data/small/resource_aware_orders.json` (clean) and
`resource_aware_orders_deviating.json` (order `o2` never picks item `i4`)
are generated by `totem_lib/examples/generate_resource_aware_logs.py`. Four
orders, one worker `w1` who handles everything; `o3` and `o4` share package
`p3`; `w1` has two worker-only events (`start shift`, `end shift`).

1. Upload the clean log. In **Analysis → Process Area** the worker lands on
   its own level above the order / item / package area.
2. Hover that lower area and click the filter circle at its top-right
   corner. The dialog lists the object types and activities that would be
   kept; with the detailed view off, activities already claimed by a lower
   area are left out. Confirm to overwrite the global object-type and
   activity filters.
3. **Analysis → OCCN**: restrict the object types to `order`, `item`,
   `package` (or keep the global filter on) and save the discovered model as
   an asset, then download it.
4. Upload the deviating log and upload the OCCN asset into its project.
5. **Analysis → Variants → Settings**: extraction *Resource-aware*, pick the
   process area (or select the three business types and the five business
   activities by hand), enable *Store process executions* with column
   `process execution`, and click *Compute & store*. Expect 3 executions
   (`connected components` would give 1), 20 assigned events and 2
   unassigned shift events.
6. **Conformance → OCCN Conformance**: strategy *Stored process executions*,
   column `process execution`, *Ignore object types missing from the model*
   on. Result: 2 of 3 units fit; `stored_column:i3` (order `o2`) is
   non-fitting at `pack items`, because the pick of item `i4` is missing.

The library test `totem_lib/tests/occn/test_stored_column_replay_units.py`
and the backend test `backend/api/test_process_executions.py` run this
scenario end to end.

## Process-area filter action

Every process area drawn by the Process Area component shows a small filter
circle above its top-right corner while hovered. Clicking it opens a dialog
that previews the object types and activities to keep and, on confirmation,
replaces the global *object types* and *activities* filters (a time-range
filter is kept) and applies them. The activities follow the visualizer's
view mode:

- level-based view (default): the activities the backend assigned to the
  area, i.e. those not already claimed by a lower area;
- detailed view ("show all activities"): every activity of the area's object
  types.

The logic lives in `frontend/src/react_component/process-area/`; applying a
filter goes through `store/applyGlobalFilter.ts`, which the filter chip
stack uses as well, so the header arcs and the chips stay in sync.
