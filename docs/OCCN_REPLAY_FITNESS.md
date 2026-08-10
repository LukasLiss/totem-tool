# OCCN Replay Fitness

The library-level OCCN replay-fitness implementation checks whether complete,
ordered replay units can be executed by an `OCCausalNet`. It uses the current
OCCN binding semantics directly and does not access Django projects, model
assets, or event-log storage.

## Public API

```python
from totem_lib import occn_replay_fitness

result = occn_replay_fitness(
    occn,
    replay_units,
    max_states=1000,
)
```

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
