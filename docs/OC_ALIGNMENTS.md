# Object-Centric Alignments — implementation notes

User-facing description: [user-guide/oc-alignments.md](user-guide/oc-alignments.md).
Method: L. Liß, *Object-Centric Alignments*, Master's thesis, RWTH Aachen (2023),
chapters 4–5.

## Library (`totem_lib/src/totem_lib/oc_alignments/`)

| Module | Content |
| --- | --- |
| `net.py` | `net_from_ocpn_dict` turns an OCPN JSON dict (`format: "ocpn"`, see `MODEL_EDITORS.md`) into an index-based `AlignmentNet`. Arcs are grouped per transition and object type. Mixing variable and regular arcs for one type at one transition is rejected (well-formedness, Def. 3.4). Initial and final places come from the `initial`/`final` flags. Types without flags fall back to "no incoming arcs" and "no outgoing arcs". |
| `execution.py` | `ProcessExecution` (events with `(type, object)` pairs; the partial order comes from object traces) and `project_execution` (drops object types the model lacks and reports them). DuckDB helpers list or load executions from a stored events column (`list/load_stored_execution`) or from business object types and activities (`list/load_area_execution`, built on `variants.extraction.extract_resource_aware`; only the selected activities and the component's objects stay in the execution). |
| `alignment.py` | `compute_oc_alignment(model, execution, ...) -> OCAlignmentResult`. |
| `batch.py` | `align_executions(model, executions, ...)`: one compact row per execution plus aggregates. Per-execution limits default to 50k states / 5 s; a total budget (default 240 s, below gunicorn's 300 s request timeout) marks unreached executions `skipped`. `load_stored_executions` / `load_area_executions` in `execution.py` load all executions of a source in one query. |

### The search

The thesis builds a synchronous product net. Its parts are the de-jure net with variable arcs
unfolded for the execution's object counts (Def. 5.1), the process execution net (Def. 5.3), and
synchronous transitions (Def. 5.4/5.5). It then runs Dijkstra on its state space (Def. 5.6). The
implementation explores the same state space lazily (as in thesis §6.1), without building the
product net:

- **State**: the de-jure marking (tokens `(place, object)`, encoded as sorted ints) plus each
  object's position in its trace. The positions are the marking of the process execution net.
- **Log move**: fire an event whose objects are all at that event in their traces.
  Cost = number of objects.
- **Model move**: fire a binding of a transition. Regular arcs bind exactly one object per type.
  Variable arcs bind any subset, which is what the unfolding of Def. 5.1 enumerates, empty set
  included. A binding uses at least one object. Cost = number of objects; silent = ε.
- **Synchronous move**: an event and an equally labelled transition whose type set and
  regular-type counts fit (T_syn). The binding is the event's objects, which is the ν-net
  requirement. Cost = 0.
- Costs are `(deviation, silent moves)`, so ε is infinitesimal.

**A\*** with an admissible, consistent heuristic replaces Dijkstra, so the deviation cost stays
optimal. The heuristic is `max(a, b)`:

- (a) the objects of remaining events that can never be synchronous;
- (b) the sum over the objects of their exact *flattened* alignment cost, precomputed by backward
  Dijkstra over (marking of the object's type sub-net, trace position). Projected onto one object,
  an object-centric alignment is a flattened alignment, and costs are counted per object, so (b)
  never overestimates. A state from which some object cannot reach its final places is pruned.

Among equally cheap states the search goes deepest into the log first. Ranking fewer silent moves
first would enumerate every interleaving of concurrent objects before any τ step.

**Limits and fallbacks** (reported through `status` / `exact`):

- `max_states` caps the distinct states reached, which bounds memory. `timeout_s` and
  `should_cancel` are checked on every expansion and during binding enumeration.
- If a transition has more than `MAX_BINDINGS_PER_TRANSITION` (4096) bindings in one state, its
  variable arcs only offer ∅, single objects, all candidates, and the object groups the log
  records for that activity. The result is then `exact=False`, unless its cost meets the lower
  bound.
- When the optimal search hits a limit, a best-first search runs on a fresh budget (half the time
  limit, at least 5 s). Its priority is cost + h − log progress. A result returns with
  `status="approximate"`, `exact=False` and `lower_bound`.
- `no_alignment` results carry `diagnostics` (`diagnose_no_alignment`). For each object type of the
  execution it checks whether one object can get from the initial to the final places at all, and
  whether it can only do so through transitions whose regular arcs need an object type the
  execution lacks. Otherwise it reports a generic synchronisation conflict.
- Other statuses: `no_alignment` (the final marking is unreachable with these objects, e.g. a
  forbidden combination of object types, Ch. 5.5) and `empty_execution` (no event left after the
  projection).

The alignment graph (Def. 5.9) connects two moves when they share an object that no move in
between uses (`alignment_edges`).

Tests: `totem_lib/tests/oc_alignments/` cover the thesis' running example (optimal cost 6), the
lower bound, silent moves, the approximate fallback, many objects behind a variable arc, and stored
and area executions on `resource_aware_orders*.json`.

## Backend

| Endpoint | Body | Response |
| --- | --- | --- |
| `POST /api/files/<pk>/oc_alignment_executions/` | `source` (`"area"` \| `"stored"`), `business_object_types`, `business_activities` (empty = all) or `execution_column`, optional `asset_id` | `executions` (id, counts, `object_type_counts`, `ignored_object_types` when `asset_id` is set), `total`, `truncated` (more than 5000) |
| `POST /api/files/<pk>/oc_alignment_batch/` | source fields, `asset_id`, `max_states` (per execution, default 50k), `timeout_s` (per execution, 0.5–600, default 5), `total_timeout_s` (5–3600, default 240) | `OCAlignmentBatchResult.to_dict()`: `rows` (id, status, cost, exact, move counts, ignored types, diagnostics), `aligned`, `fitting`, `average_cost`, `deviations_by_activity`, `status_counts`, `stopped_early` |
| `POST /api/files/<pk>/oc_alignment/` | source fields, `asset_id` (OCPN asset of the log's project), `execution_id`, `max_states` (1k–2M, default 200k), `timeout_s` (1–600, default 60) | `OCAlignmentResult.to_dict()` + the echoed request. `projection.ignored_object_types` lists the ignored types. |

Both live in `backend/api/views/oc_alignment.py` (a mixin on `EventLogViewSet`). They honour the
global filter (query parameters, via `_filter_shadow`) and are cancellable jobs. The search runs
after the per-file lock is released.

`OCAlignmentComponent` (dashboard widget) stores `show_controls`, `automatic_loading`,
`model_asset` (FK, `SET_NULL`; only OCPN assets of the dashboard's project are accepted on save),
`execution_source`, `execution_column`, `business_object_types`, `business_activities`,
`execution_id`, `max_states`, `timeout_s` and `show_silent_moves`.

## Frontend

`frontend/src/components/oc-alignment/`: `OCAlignmentView` (Conformance → OC Alignments),
`OCAlignmentExplorer` (settings panel + run + result), `OCAlignmentSettingsPanel` (model, source,
process area / manual selection, execution picker), `OCAlignmentResultView`, `AlignmentGraph`
(layered DAG of move boxes; layout in `layout.ts`), `OCAlignmentDashboardComponent`, and the
persisted settings mapping in `settings.ts`. The API client is `src/api/ocAlignmentApi.ts`.
