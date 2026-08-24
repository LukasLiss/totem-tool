# OCCN Replay Fitness

OCCN conformance checks whether complete, ordered event sets from an
object-centric event log can be executed by a stored `OCCausalNet`. These event
sets are called replay units. The selected extraction strategy defines what one
unit represents and therefore also defines the population over which fitness is
reported.

This document is the implementation-level contract for replay-unit extraction
and replay fitness. Related concerns are documented separately:

- [Model Assets](MODEL_ASSETS.md) defines the canonical OCCN JSON format,
  validation, project scoping, and asset storage.
- [The canonical OCCN example](examples/model-assets/occn-v1.json) is a complete
  model payload accepted by the asset store and OCCN deserializer.
- The library README contains a concise API entry point; this document is the
  source of truth for conformance semantics and limitations.

The library API is storage-independent after extraction. It does not access
Django projects, model assets, or HTTP state. The backend is responsible for
loading the selected event log and model asset before invoking the library.

## Replay-Unit Extraction

`extract_occn_replay_units` accepts either an `ObjectCentricEventLog` or an
`OcelDuckDB`. Both storage paths first normalize visible events into immutable
`OCCNReplayEvent` values containing the event ID, activity, Unix timestamp, and
objects grouped by object type.

The normalized contract is deterministic:

- events are ordered by `(timestamp_unix, event_id)`;
- object types and object IDs are sorted;
- duplicate event IDs and inconsistent object metadata are rejected;
- objectless events remain available to the connected-components strategy;
- replay units contain visible log events only.

Two extraction strategies are implemented.

### Connected components (`connected_components`)

This is the default strategy. It builds an undirected bipartite graph of event
and object nodes and creates one replay unit for every connected component.
Consequently, two events belong to the same unit when they are connected by a
chain of shared objects, even if they do not directly share an object.

Units are ordered by their ordered event sequence and receive deterministic IDs
such as `connected_components:000001`. An event belongs to exactly one unit.
An objectless event forms a singleton component. Objects without events do not
create empty units.

This strategy preserves complete connected process executions, but highly
connected logs can collapse into one very large replay unit. The resulting
unit is not a traditional single-object trace or a precomputed variant.

### Leading object (`leading_object`)

This strategy requires `leading_object_type`. It creates one replay unit for
each object of that type and includes every visible event that directly
references the leading object. Unit IDs use the object identifier, for example
`leading_object:order-42`.

Events shared by several leading objects occur in each corresponding replay
unit. Events that do not reference an object of the selected type are excluded,
even when they are indirectly connected through other objects. The resulting
units are therefore overlapping leading-object projections rather than a
partition of the log.

Leading-object replay is useful for investigating whether a deviation affects
all or only some objects of a selected type. Its aggregate fitness has a
different denominator from connected-component fitness and the two values must
not be compared as if they described the same replay-unit population.

## Public API

```python
from totem_lib import (
    LEADING_OBJECT_REPLAY_STRATEGY,
    extract_occn_replay_units,
    occn_replay_fitness,
)

replay_units = extract_occn_replay_units(
    event_log,
    strategy=LEADING_OBJECT_REPLAY_STRATEGY,
    leading_object_type="orders",
)

result = occn_replay_fitness(
    occn,
    replay_units,
    max_states=1000,
)
```

Omitting `strategy` selects connected components. `leading_object_type` is
required for leading-object replay and rejected for connected-component replay.
Unsupported strategy values are rejected.

`occn` must already be deserialized as an `OCCausalNet`. `replay_units` must
contain the storage-independent `OCCNReplayUnit` values produced by the replay
unit extraction API.

Pass `max_states=None` to request exhaustive replay without the deterministic
state limit.

## Replay Procedure

Replay starts from the empty OCCN state and processes every replay unit in its
existing event order.

1. Each newly observed object is introduced through its artificial
   `START_<object type>` activity immediately before its first visible event.
   When an event introduces several objects, they are started in deterministic
   `(object type, object ID)` order.
2. A visible event is replayed only by bindings that involve exactly the
   objects observed for that event.
3. Every possible valid input and output binding is retained until it fails or
   reaches completion.
4. Exactly equal states at the same replay position are deduplicated. States
   with different pending obligations remain separate.
5. After the visible events, each object is processed by its artificial
   `END_<object type>` activity.
6. The unit is fitting when at least one binding sequence reaches the empty
   state.

Artificial start and end events are internal replay operations. They are not
added to the event log or returned as visible events.

The implementation advances a frontier of possible OCCN states. A replay step
can therefore branch when several bindings are enabled. Failure of one branch
does not make the unit non-fitting while another branch remains. A unit is
proven non-fitting only when a replay phase produces no successor state across
the complete current frontier.

The stopping phase and reason identify where that frontier became empty:

| Phase | Reason | Meaning |
| --- | --- | --- |
| `object_start` | `no_enabled_object_start` | A newly observed object could not be introduced through its artificial start activity. |
| `visible_event` | `no_enabled_event_binding` | No enabled binding matched the activity and exact observed object set. |
| `object_end` | `no_enabled_object_end` | An observed object could not complete through its artificial end activity. |
| `completion` | `remaining_obligations` | All end activities were processed, but no explored state was empty. |

These diagnostics describe the first replay phase at which all candidate paths
were eliminated. They are a bounded operational stopping point, not proof that
the named activity is the root cause of the process deviation.

## Result Semantics

`OCCNReplayFitnessResult` contains the aggregate values and ordered
`OCCNReplayUnitResult` entries. Each unit has one of three statuses:

- `fitting`: at least one complete binding sequence reaches the empty state;
- `non_fitting`: exhaustive replay proves that no complete binding sequence
  exists;
- `inconclusive`: the configured state limit was reached before either outcome
  was proven.

Each unit result also contains its event count, involved object types, explored
state count, and any available failure or search-limit information. The JSON
fields have the following meanings:

| Field | Meaning |
| --- | --- |
| `unit_id` | Deterministic identifier assigned during replay-unit extraction. |
| `status` | `fitting`, `non_fitting`, or `inconclusive`. |
| `replayable` | `true` for fitting, `false` for non-fitting, and `null` for inconclusive. |
| `event_count` | Number of visible log events in the replay unit. |
| `explored_state_count` | Distinct replay-position/state pairs admitted for this unit, including the initial empty state. |
| `object_types` | Alphabetically sorted object types represented in the unit. |
| `failure_event_index` | Zero-based visible-event index when visible replay or a preceding object start failed; otherwise `null`. |
| `failure_event_id` | Event ID at `failure_event_index`; otherwise `null`. |
| `limit_reason` | `max_states` when bounded search was exhausted; otherwise `null`. |
| `stopping_activity` | Visible or artificial activity being attempted when replay stopped. |
| `stopping_phase` | Replay phase listed in the stopping table above. |
| `stopping_reason` | Machine-readable reason for the stopping point. |
| `last_replayed_activity` | Last activity successfully passed before replay stopped. |
| `replayed_activities` | Activities successfully passed by the frontier, in first-occurrence order; artificial start and end activities may be included. |
| `stopping_object_types` | Object types involved in the activity at which replay stopped. |

Fields without applicable diagnostic information are `null` or an empty list.
Full event and object details are deliberately omitted from the fitness result;
they can be requested through the replay-unit detail endpoint.

Inconclusive units are not treated as deviations. Aggregate values are:

```text
fitness = fitting / (fitting + non_fitting)
coverage = (fitting + non_fitting) / total
```

`fitness` is `None` when no unit has a conclusive result. A result with coverage
below `1.0` is partial and must be presented together with its coverage and
inconclusive count.

For a visible event that has no successor state, the unit result records the
first proven failure event. A completion failure does not claim a specific
visible event as its cause.

The aggregate JSON repeats `fitness` and `coverage` alongside `total_units`,
`fitting_units`, `non_fitting_units`, `inconclusive_units`, and the ordered
`unit_results`. Empty replay-unit populations have coverage `1.0` and fitness
`null` because there is nothing to classify.

## Backend Integration

OCCN conformance is exposed below the selected event log resource. All three
endpoints operate on event logs visible to the current user.

### Run conformance

`POST /api/files/{event_log_id}/occn_conformance/`

The request body accepts:

| Field | Requirement |
| --- | --- |
| `asset_id` | Required positive ID of an OCCN model asset. |
| `replay_unit_strategy` | Optional; defaults to `connected_components`. |
| `leading_object_type` | Required only for `leading_object`; rejected for `connected_components`. |
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
`replay_unit_strategy`/`leading_object_type` combination as the conformance
run. `offset` defaults to `0`; `limit` defaults to `50` and may range from `1`
through `250`.

The endpoint deterministically extracts the replay units again, resolves the
requested unit ID, and returns a bounded page of ordered visible events. Each
event contains its zero-based `event_index`, event ID, activity, Unix
timestamp, and objects grouped by type. Pagination metadata includes total and
returned counts plus previous and next offsets. The endpoint does not persist
replay results or replay-unit snapshots, so callers must retain the strategy
parameters that produced a unit ID.

## Search Limits

Binding search can grow exponentially with the number of events, objects, and
alternative marker-group assignments. Layered exploration prevents recursion
loops, while `max_states` limits the number of distinct replay-position/state
pairs admitted for each unit. The default limit is `1000`.

The limit bounds admitted search states, but the semantics layer may still need
to enumerate many bindings while producing the successors of one state. The
limit is therefore a deterministic correctness safeguard, not a strict runtime
or memory guarantee. Backend request cancellation or timeouts remain separate
concerns.

## Scope Boundaries

- Replay-unit extraction and partitioning are handled outside this metric.
- Model-asset deserialization and validation belong to the backend integration.
- The metric reports replayability and a bounded failure position, not a
  cost-optimal alignment or a complete causal diagnosis.
- The current default state limit is an initial safeguard and has not been
  calibrated as a universal value for all logs and models.
