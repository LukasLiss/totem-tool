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

1. Each object is introduced through its artificial `START_<object type>`
   activity immediately before its first visible event.
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

## Result Semantics

`OCCNReplayFitnessResult` contains the aggregate values and ordered
`OCCNReplayUnitResult` entries. Each unit has one of three statuses:

- `fitting`: at least one complete binding sequence reaches the empty state;
- `non_fitting`: exhaustive replay proves that no complete binding sequence
  exists;
- `inconclusive`: the configured state limit was reached before either outcome
  was proven.

Each unit result also contains its event count, involved object types, explored
state count, and any available failure or search-limit information. Object
types are returned in deterministic alphabetical order. The result contract
does not include full event or object details; those remain replay-unit input
data rather than aggregate fitness data.

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
