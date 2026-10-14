# OCCN Replay Fitness in the TOTeM Tool

OCCN conformance checks whether complete, ordered event sets from an
object-centric event log can be executed by a stored `OCCausalNet`. These event
sets are called replay units.

This document describes how the TOTeM Tool exposes replay fitness: the backend
endpoints and the frontend workflow. The conformance semantics are documented
with the library, in the
[OCCN replay fitness guide](../totem_lib/docs/guide/occn_replay_fitness.md):
replay-unit extraction strategies, the public API, the canonical example, the
replay procedure, result semantics, search limits, and the limitations of the
metric. That guide is the source of truth for them.

Related concerns are documented separately:

- [Model Assets](MODEL_ASSETS.md) defines the canonical OCCN JSON format,
  validation, project scoping, and asset storage.
- [The canonical OCCN example](examples/model-assets/occn-v1.json) is a complete
  model payload accepted by the asset store and OCCN deserializer.
- [The compatibility analysis](OCCN_REPLAY_FITNESS_COMPATIBILITY.md) records
  how the reference algorithm was mapped to the current library. It is design
  history; the library guide defines the implemented behavior.

## Backend Integration

OCCN conformance is exposed below the selected event log resource. All three
endpoints operate on event logs visible to the current user.

### Run conformance

`POST /api/files/{event_log_id}/occn_conformance/`

The request body accepts:

| Field | Requirement |
| --- | --- |
| `asset_id` | Required positive ID of an OCCN model asset. |
| `replay_unit_strategy` | Optional; `connected_components` (default), `leading_object` or `stored_column`. |
| `leading_object_type` | Required only for `leading_object`; rejected otherwise. |
| `execution_column` | Required only for `stored_column`; rejected otherwise. Must be a non-fixed column of the log's `events` table. |
| `restrict_to_model_object_types` | Optional boolean (default `false`); project events onto the model's object types before building units. |
| `max_states` | Optional integer from `1000` through `15000`; defaults to `1000`. |

The backend requires the model asset to be visible to the current user, belong
to the same project as the event log, have asset type `OCCN`, and deserialize
successfully through the canonical OCCN model contract. For leading-object
replay, it also verifies that the selected object type exists in the event log.

After validation, the endpoint loads the selected OCEL, extracts replay units
with the requested strategy, invokes `occn_replay_fitness`, and adds
`file_id`, `asset_id`, the effective strategy, leading object type, and state
limit to the aggregate library result. Invalid request combinations and model
selections return `400`; an inaccessible event log or asset returns `404`;
unexpected extraction or replay failures return `500`.

### List object types

`GET /api/files/{event_log_id}/object_types/`

This returns the object types present in the selected event log. The frontend
uses the response to populate the leading-object-type selection; it does not
infer this list from the model asset.

### Inspect a replay unit

`GET /api/files/{event_log_id}/occn_replay_unit_detail/`

The query must identify `unit_id` and use the same
`replay_unit_strategy` / `leading_object_type` / `execution_column` /
`restrict_to_model_object_types` combination as the conformance run; with
the projection enabled it must also carry the `asset_id` the run used.
`offset` defaults to `0`; `limit` defaults to `50` and may range from `1`
through `250`. `GET /api/files/{event_log_id}/event_columns/` lists the
columns available for `execution_column`.

The endpoint deterministically extracts the replay units again, resolves the
requested unit ID, and returns a bounded page of ordered visible events. Each
event contains its zero-based `event_index`, event ID, activity, Unix
timestamp, and objects grouped by type. Pagination metadata includes total and
returned counts plus previous and next offsets. The endpoint does not persist
replay results or replay-unit snapshots, so callers must retain the strategy
parameters that produced a unit ID.

## Frontend Workflow

The OCCN Conformance view compares the currently selected project event log
with one stored OCCN model asset. It does not discover a replacement model.
Model Assets can open the view with the corresponding OCCN already selected.

Before replay, the user selects the replay-unit strategy and a state limit:

- `Standard` maps to `connected_components`;
- `Leading object type` maps to `leading_object` and loads the available object
  types from the event log;
- `Stored process executions` maps to `stored_column` and loads the event
  columns of the log; a log with exactly one candidate column preselects it;
- `Ignore object types missing from the model` maps to
  `restrict_to_model_object_types` and applies to every strategy;
- the state-limit slider ranges from `1000` through `15000` in steps of `100`;
- raising the limit above `1000` displays a warning about potentially much
  longer computation time.

Changing the event log, project, model, strategy, leading object type, or state
limit clears the previous result. While a request is running, model and
strategy controls are disabled and duplicate submissions are prevented. A
response from an obsolete request context is ignored.

### Result summary and replay units

The result summary always presents fitness, coverage, total replay units, and
the three status counts together. Its top-level label follows these rules, in
order:

1. no units produces `No replay units`;
2. any non-fitting unit produces `Deviations found`, or `Deviations found
   (partial)` when inconclusive units also exist;
3. only inconclusive units produces `Inconclusive`;
4. fitting and inconclusive units produces `Partial result`;
5. only fitting units produces `Fitting`.

The replay-unit table shows status, event count, object types, and explored
states. It can be filtered by status and displays 25 units per page. Selecting
a unit scopes the model annotations to that unit and loads its visible event
sequence in pages of 50. The detail view shows the unit metadata, highlights a
known failure event in the sequence, and distinguishes an inconclusive search
from a proven non-fitting result.

### Model annotations

The conformance visualization renders the selected canonical OCCN asset with
the same visual language as the OCCN analysis/editor view. It does not render a
newly discovered OCCN. Stopping activities are annotated as follows:

- red identifies a proven non-fitting stopping point;
- amber identifies a state-limit stopping point with an inconclusive result;
- when at least one displayed unit is non-fitting, model activities not listed
  as successfully replayed are muted in grey;
- a stopping activity absent from the selected model is added as a separate
  deviation node so the diagnostic remains visible;
- `Focus stopping point` zooms to an annotated activity and cycles through
  multiple stopping points.

The annotation explains why replay stopped, the last successfully replayed
activity where available, and explored-state information for inconclusive
units. When a non-fitting stopping point names involved object types, each type
is offered as a drill-down action. Choosing it immediately runs conformance
again with the leading-object strategy for that type.

These annotations visualize operational replay diagnostics. Grey activities
mean that the displayed replay result did not report them as successfully
passed; they do not prove that the activities are globally unreachable or
incorrect.

## Known Limitations

The limitations of the metric itself are listed in the
[library guide](../totem_lib/docs/guide/occn_replay_fitness.md#known-limitations).
Two more concern the application:

- Replay results and derived units are not persisted. Detail requests repeat
  deterministic extraction, and changing the underlying log would invalidate
  previously retained unit identifiers.
- The visualization derives muted activities from reported replay progress.
  Muting is an aid for inspection, not proof that a model region is impossible
  to reach in another binding branch or replay unit.

## Open Questions

The following are possible follow-up decisions, not promises made by the
current API:

- Should logs with one dominant connected component recommend a leading object
  type, and what evidence should drive that recommendation?
- Should the state limit be calibrated from model/log characteristics, or
  should expensive replay move to cancellable background jobs with explicit
  runtime limits?
- Should reporting add variant grouping while retaining concrete-unit counts,
  and how should repeated or overlapping units then be weighted?
- Should later conformance provide alignments, repair suggestions, or richer
  binding-level explanations beyond the first operational stopping point?
- Should replay results and unit snapshots be cached or persisted so detail
  inspection cannot diverge from the original run after data changes?
