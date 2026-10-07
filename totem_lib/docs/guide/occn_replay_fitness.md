# OCCN Replay Fitness

OCCN conformance checks whether complete, ordered event sets from an
object-centric event log can be executed by a stored `OCCausalNet`. These event
sets are called replay units. The selected extraction strategy defines what one
unit represents and therefore also defines the population over which fitness is
reported.

This page is the implementation-level contract for replay-unit extraction
and replay fitness. Related concerns are documented separately:

- [OCCN precision](occn_precision.md) covers the complementary question: how
  much behavior the model permits that the log never exhibits.
- [OCCN Replay Fitness in the TOTeM Tool](https://github.com/LukasLiss/totem-tool/blob/main/docs/OCCN_REPLAY_FITNESS.md)
  describes the backend endpoints and the conformance view built on this API.
- [Model Assets](https://github.com/LukasLiss/totem-tool/blob/main/docs/MODEL_ASSETS.md) defines the canonical OCCN JSON format,
  validation, project scoping, and asset storage.
- [The canonical OCCN example](https://github.com/LukasLiss/totem-tool/blob/main/docs/examples/model-assets/occn-v1.json) is a
  complete model payload accepted by the asset store and OCCN deserializer.
- [The compatibility analysis](https://github.com/LukasLiss/totem-tool/blob/main/docs/OCCN_REPLAY_FITNESS_COMPATIBILITY.md) records
  how the reference algorithm was mapped to the current library. It is design
  history; this page defines the implemented behavior.
- The library README contains a concise API entry point; this page is the
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

Three extraction strategies are implemented, and every strategy can be
combined with a projection onto the model's object types (see below).

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

### Stored process executions (`stored_column`)

This strategy requires `execution_column`, the name of a column of the
`events` table that holds precomputed process execution ids -- typically
written by the Variants Explorer (see
[`RESOURCE_AWARE_VARIANTS.md`](https://github.com/LukasLiss/totem-tool/blob/main/docs/RESOURCE_AWARE_VARIANTS.md)). Every
distinct value becomes one replay unit with the id `stored_column:<value>`;
events without a value belong to no unit. Because a stored column assigns
at most one id per event, the units partition the events that carry an id.

Unlike connected components, the population of units is decided by whoever
wrote the column -- for example a resource-aware extraction in which a
shared worker does not merge executions.

### Projection onto the model's object types

`extract_occn_replay_units(..., object_types=[...])` drops every object whose
type is not listed from the events before units are built; events left
without objects are dropped entirely. The backend exposes this as
`restrict_to_model_object_types`, which uses the object types of the selected
OCCN. It exists because replay matches bindings against *exactly* the
observed objects of an event: a model that deliberately leaves out a shared
worker resource would otherwise report every event touching the worker as
non-fitting at `START_worker`.

The projection changes the unit population of the connected-components
strategy as well (a projected-away resource no longer connects anything), so
results with and without projection are not comparable.

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

## Canonical Example

The repository's [OCCN v1 example](https://github.com/LukasLiss/totem-tool/blob/main/docs/examples/model-assets/occn-v1.json) models
one visible activity, `a`, synchronizing the `order` and `item` object types.
Its marker groups require exactly one order and at least one item. The file is a
model payload and can be uploaded directly through Model Assets; it is not an
asset API envelope and does not contain a project or asset name.

With the default state limit, the following single-event replay units exercise
both central outcomes:

| Visible event | Observed objects | Result | Diagnostic |
| --- | --- | --- | --- |
| `a` | `order-1`, `item-1` | `fitting` | Replay passes `START_item`, `START_order`, `a`, `END_item`, and `END_order`. |
| `a` | `order-1` only | `non_fitting` | Replay stops at visible activity `a` with `no_enabled_event_binding` because the required item binding is absent. |

These examples illustrate exact observed-object matching. They are intentionally
small contract examples, not representative performance benchmarks or a
recommendation for choosing replay units in a production log.

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
they can be requested through the TOTeM Tool's
[replay-unit detail endpoint](https://github.com/LukasLiss/totem-tool/blob/main/docs/OCCN_REPLAY_FITNESS.md#inspect-a-replay-unit).

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

## Process Executions, Components, and Variants

The reference OCCN fitness algorithm describes its inputs as concrete process
executions. This implementation uses the more explicit term *replay unit*
because the extraction strategy determines which event set is being tested.
The terms are related, but they are not interchangeable in every strategy.

| Concept | Meaning in this implementation | Effect on fitness |
| --- | --- | --- |
| Connected component | A maximal set of events connected through shared objects. Visible events are partitioned across components. | Each component is replayed once and contributes one equally weighted unit. |
| Connected process execution | The process-execution interpretation used for a connected component by the reference algorithm. | Valid only under the modeling assumption that event-object connectedness defines one execution. |
| Leading-object projection | All events directly referencing one selected object. Units may overlap and omit events unrelated to that leading type. | Each leading object contributes one unit; this creates a different population and denominator. |
| Variant | A group of executions with equivalent behavior according to a separate variant definition. | Variants are not calculated or grouped for OCCN replay fitness. |

Connected-component replay therefore evaluates concrete connected event sets,
not one representative per variant. Two behaviorally identical components are
both replayed and both contribute to the aggregate. Conversely, one highly
connected component contributes only one unit even when it contains many
business objects or repeated behavioral patterns.

Leading-object replay is an investigative projection rather than a partition
of the log. A shared event can influence several units, and events without the
selected leading type do not influence the resulting score. Fitness values
from the two strategies must always be interpreted with their strategy and
unit counts; they are not directly comparable measurements of an unchanged
population.

Replay fitness also differs from precision. Fitness asks whether the observed
replay units can be executed by the model. It does not penalize behavior that
the model permits but the log never exhibits. That complementary question is
handled by the separate [OCCN precision](occn_precision.md) metric.

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

## Known Limitations

- OCCN binding search can grow exponentially. The state limit makes the result
  bounded and deterministic but does not impose a strict runtime limit on
  successor enumeration.
- A connected log can collapse into one very large component. This can make
  standard replay expensive and can make one unit represent more behavior than
  users intuitively consider one process execution.
- Leading-object units include only events that directly reference the leading
  object. They do not follow indirect connections, they can overlap, and there
  is no universally correct leading object type.
- Timestamp ties are resolved by event ID because the supported OCEL storage
  representations do not expose one common source-row order.
- Activity labels and observed object bindings are matched exactly. Missing
  activities, object types, or compatible bindings can therefore stop replay;
  the result does not infer mappings between model and log terminology.
- A stopping point identifies where all current binding branches failed or the
  state budget was exhausted. It is not a cost-optimal alignment, minimal
  repair, or causal root-cause explanation.
- Inconclusive units are excluded from fitness. A higher state limit can turn
  them into fitting or non-fitting units and can therefore change both fitness
  and coverage.
- Every extracted unit has equal aggregate weight. The implementation does not
  provide variant-weighted, event-weighted, or business-volume-weighted
  fitness.
