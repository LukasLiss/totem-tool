# OCCN Replay Fitness Compatibility

This note supports issue #220. It compares the replay-fitness implementation
in `LukasLiss/OCCN-ConfCheck` with the OCCN and OCEL APIs currently available
in `totem_lib`.

The comparison uses commit
`d335c957a1ae1c11f4e05a83ebedbff19fa23bf0` from the external repository's
default branch, `feature/ocpn-occn-translation-evaluation`. The main reference
implementation is:

`pm4py/algo/occn_evaluation/replay_fitness/variants/process_execution_replay.py`

The relevant current implementations are:

- `totem_lib/src/totem_lib/occn/occn.py`
- `totem_lib/src/totem_lib/occn/semantics.py`
- `totem_lib/src/totem_lib/occn/precision.py`
- `totem_lib/src/totem_lib/ocel/ocel.py`
- `totem_lib/src/totem_lib/ocel/ocel_duckdb.py`
- `totem_lib/src/totem_lib/variants/extraction.py`
- `totem_lib/src/totem_lib/variants/ocvariants_db.py`

## 1. Reference Algorithm

The external implementation calculates fitness over process executions. A
process execution is fitting if its complete event sequence can be replayed
by the OCCN and the replay finishes without outstanding obligations.

### 1.1 Replay-unit extraction

The entry point accepts precomputed process executions or derives them through
PM4Py. Its default extraction strategy is `connected_components`.

Each process execution initially consists of event identifiers. Extraction and
variant grouping are separate concerns: fitness is calculated per concrete
execution, not once per variant.

### 1.2 Event preprocessing

Before replay, the implementation builds lookup maps for:

- event identifier to timestamp and activity;
- object identifier to object type;
- event identifier to related object identifiers.

Events in a process execution are sorted by timestamp. Each event is converted
to:

```text
(activity, {(object_type, {object_ids})})
```

The actual representation uses nested `frozenset` values so it can be hashed.

For every object involved in the execution, preprocessing adds:

- one artificial `START_<object type>` event before the visible events;
- one artificial `END_<object type>` event after the visible events.

The algorithm assumes that artificial start and end activities bind one
object at a time.

### 1.3 Binding search

Replay starts with an empty `OCCausalNetState` and recursively processes one
event at a time.

For an artificial start event, the algorithm enumerates bindings using
`enabled_bindings_start_activity`.

For every other event, it enumerates only bindings that involve exactly the
objects observed for that event. Every enabled binding creates a successor
state. The search continues depth-first until one of two outcomes occurs:

- fitting: all events have been processed and the final state is empty;
- non-fitting: no binding branch can process the complete sequence into an
  empty state.

The first successful branch ends the search for that execution.

### 1.4 Aggregation

The external result reports:

- number of process executions;
- number of fitting process executions;
- log fitness as `fitting / total`;
- diagnostic timing and recursive-call counts used by its evaluation code.

It does not provide a failure position or reason. A non-fitting result only
states that no explored binding sequence completed successfully.

## 2. Representation Mapping

| Concern | External implementation | Current `totem_lib` | Compatibility |
|---|---|---|---|
| Event log | PM4Py `OCEL` with pandas tables | `ObjectCentricEventLog` with Polars tables, plus `OcelDuckDB` | Same information, different access API |
| Replay unit | Collection of event IDs | Variant executions and connected-component extraction already expose event-ID collections | Conceptually compatible |
| Event order | Timestamp sort | Timestamp and stable source order are available | Compatible, but deterministic tie-breaking must be explicit |
| Event payload | Activity plus objects grouped by type | `event_cache`, object maps, and DuckDB queries expose these fields | Compatible after conversion |
| OCCN | External PM4Py `OCCausalNet` | `totem_lib.occn.OCCausalNet` | Same modeling concepts, current class has evolved |
| State | Pending obligations grouped by target activity | `OCCausalNetState` with counters of `(predecessor, object, type)` | Compatible |
| Binding | Activity with consumed and produced object flows | Internal tuple and external dictionary binding formats | Compatible after using the current API |
| Start/end activities | `START_<type>` and `END_<type>` | Same naming and one-object binding assumption | Compatible |
| Final-state check | No outstanding state activities | `OCCausalNetState.is_empty` / empty `activities` | Compatible |
| Aggregate fitness | Fitting executions divided by all executions | No dedicated replay-fitness result type yet | Must be added by #222 |

## 3. API Differences

The external algorithm is not source-compatible with the current semantics
class. The algorithmic idea is reusable, but the calls cannot be copied
unchanged.

### 3.1 Object-constrained visible bindings

External call:

```python
OCCausalNetSemantics.enabled_bindings(
    occn, activity, state, objects=objects
)
```

Current call:

```python
OCCausalNetSemantics.enabled_bindings_for_objects(
    occn, activity, state, objects
)
```

The current method is the correct target. It was introduced specifically to
enumerate bindings that explain an observed event without enumerating
irrelevant object subsets.

### 3.2 Executing a binding

The external implementation passes the OCCN, activity, converted consumed and
produced dictionaries, and state as separate arguments.

The current API accepts the complete binding and state:

```python
OCCausalNetSemantics.bind_activity(binding, state)
```

It supports the internal tuple representation returned by the enabled-binding
methods. Replay fitness therefore does not need to convert each binding to the
external dictionary representation.

### 3.3 Start bindings

Both implementations use:

```python
OCCausalNetSemantics.enabled_bindings_start_activity(
    occn, start_activity, object_type, objects
)
```

The current method can be used directly. Replay fitness must still call it
with one object at a time to preserve the assumption made by the reference
algorithm and the current OCCN model.

### 3.4 Event-log access

The external lookup-building code depends on PM4Py's pandas column names and
`OCEL.relations`. It must be replaced with the current event-log abstraction.

`ObjectCentricEventLog.event_cache` and `obj_type_map` already provide the
necessary data for an in-memory log. `OcelDuckDB` can supply the same data
without materializing the complete log, but #221 must define one replay-unit
contract that hides this storage difference from replay fitness.

### 3.5 Process-execution extraction

The current `ObjectCentricEventLog.process_executions` property is not an
equivalent replacement. It currently returns one execution containing every
event for compatibility with the TOTeM miner.

Connected-component extraction exists in the variant subsystem, including:

- `variants.extraction.extract_connected_components`;
- `variants.ocvariants_db.find_variants(..., extraction="connected")`.

#221 must determine how to expose the concrete executions and their raw
event/object data without coupling conformance to the variant visualization
payload.

### 3.6 Model input

The external function receives an already constructed OCCN. The tool workflow
receives a stored canonical OCCN JSON asset. The backend integration must
deserialize and validate that asset before calling replay fitness. This
belongs to #223; the library-level fitness function should continue to receive
an `OCCausalNet`.

## 4. Existing Replay Support

The current precision implementation already contains a more defensive state
exploration than the external fitness prototype:

- exact-object binding enumeration through
  `enabled_bindings_for_objects`;
- state-front deduplication and dominance pruning;
- caching of repeated binding searches;
- a configurable state cap;
- deterministic introduction of objects through start bindings.

Some, but not all, of these capabilities can be reused for fitness.

### 4.1 Safe reuse

The following operations have the same meaning for precision and fitness:

- introducing one object with its artificial start activity;
- enumerating bindings for a visible event that involve exactly its observed
  objects;
- applying an internal binding to an `OCCausalNetState`;
- deduplicating exactly equal states;
- caching binding enumeration for equal activity/obligation/object inputs.

These operations should be implemented as small internal helpers in
`totem_lib/src/totem_lib/occn/replay.py`. The helpers should yield successor
states without deciding which states a metric may discard. Precision and
fitness can then apply their own frontier policy.

### 4.2 Dominance pruning must remain precision-specific

The `_StateFront` in `precision.py` retains only maximal states under
multiset inclusion. This is correct for precision because a larger state
enables every binding available in a smaller state and therefore covers its
enabled behavior.

It is not correct for replay fitness. Fitness requires an exactly empty final
state. A larger state may follow the same remaining bindings as a smaller
state but retain additional obligations at the end. Conversely, a smaller
state may lack an obligation needed by a later event. Neither state can be
discarded solely because one contains the other.

Fitness must therefore retain every distinct reachable state. It may
deduplicate equal states, but it must not use the precision dominance rule.

## 5. Target Architecture

The replay implementation should be an independent implementation based on
the published behavior and current `totem_lib` APIs. It must not copy the
AGPL-licensed source of the external prototype.

### 5.1 Shared internal replay helpers

Target module:

`totem_lib/src/totem_lib/occn/replay.py`

This internal module should contain metric-independent successor generation
for:

- starting one object immediately before its first visible event;
- applying one visible event with exactly its observed objects;
- applying one artificial end event for one object;
- creating a canonical signature for exact state deduplication and caches.

Starting an object immediately before its first visible event is equivalent
to starting all objects before the execution under the current one-object
start assumption. It reduces intermediate states and matches the established
precision implementation.

The helpers must not contain aggregate fitness calculations, replay-unit
extraction, dominance pruning, or backend concerns.

### 5.2 Public replay-fitness module

Target module:

`totem_lib/src/totem_lib/occn/replay_fitness.py`

The public entry point should be:

```python
occn_replay_fitness(
    occn: OCCausalNet,
    replay_units: Iterable[OCCNReplayUnit],
    *,
    max_states: Optional[int] = 1000,
) -> OCCNReplayFitnessResult
```

The library function receives an already deserialized `OCCausalNet` and
storage-independent replay units. It must not read project assets, query
Django models, or choose an extraction strategy.

The module should define:

- `OCCNReplayStatus`: `FITTING`, `NON_FITTING`, or `INCONCLUSIVE`;
- `OCCNReplayUnitResult`: unit identifier, status, event count, failure
  position when proven, explored-state count, and optional limit reason;
- `OCCNReplayFitnessResult`: aggregate fitness, coverage, counts per status,
  and ordered per-unit results.

The exact replay-unit input structure is finalized in Pass 3 with #221.

### 5.3 Exact replay procedure

Fitness should use iterative, event-layered state exploration rather than the
external recursive depth-first function:

1. Start with a frontier containing the empty state.
2. Before an object's first event, introduce it through all enabled start
   bindings.
3. For each visible event, generate successors through
   `enabled_bindings_for_objects`.
4. Deduplicate exactly equal successor states.
5. After all visible events, execute one `END_<type>` event per involved
   object in deterministic type/identifier order.
6. Report `FITTING` when at least one branch reaches the empty state.
7. Report `NON_FITTING` when the complete, uncapped frontier becomes empty or
   no terminal branch reaches the empty state.

Artificial start and end events are internal replay steps. They must not be
inserted into the stored event log or exposed as user events.

## 6. Search Safeguards and Result Semantics

### 6.1 Exact-state deduplication

At each event index, equal states represent the same remaining search problem
and can be merged. A state signature must ignore empty counters and use the
activity, predecessor, object identifier, object type, and obligation count.

Layered exploration removes recursion-depth risk. The event index always
advances, so the search cannot loop indefinitely even when the OCCN contains
cycles.

### 6.2 Binding cache

Enabled visible bindings depend on the activity, its relevant outstanding
obligations, and the event's exact object set. Results should be cached under
that key. Start and end binding results can be cached by model, activity,
object type, and object identifier where applicable.

### 6.3 Deterministic state limit

`max_states` should count distinct `(replay position, state)` pairs admitted
across all frontiers of one replay unit. The initial default should be `1000`,
matching the existing precision safeguard, while `None` requests an uncapped
exact search.

A state cap is preferred over a library-level wall-clock timeout because it is
deterministic and testable. Request-level cancellation or timeouts can still
be added by the backend.

The implementation may stop as soon as an empty terminal state is found,
because fitting is existential. If the state cap is reached before fitting or
non-fitting is proven, the unit status must be `INCONCLUSIVE`.

### 6.4 Aggregate fitness and coverage

An inconclusive unit must not be counted as non-fitting. Aggregate values
should be:

```text
fitness = fitting / (fitting + non_fitting)
coverage = (fitting + non_fitting) / total
```

Fitness is `None` when there are no conclusive units. The result must always
report total, fitting, non-fitting, and inconclusive counts so the frontend
cannot display a partial result as complete.

### 6.5 Failure information

If exact exploration produces no successor for a visible event, that event
index can be reported as the proven failure position. If visible events can be
replayed but no terminal empty state is reachable, the failure phase is
`completion`.

No causal explanation should be invented. An `INCONCLUSIVE` result reports
only the configured limit and explored-state count.

### 6.6 Remaining extraction risks

Connected components can become very large when a few objects connect most of
the log. #221 must preserve deterministic event ordering and define a stable
secondary order for timestamp ties. These concerns belong to extraction and
must not be hidden inside the fitness function.

## 7. Pass 2 Decisions

- Implement replay fitness independently against the current semantics API.
- Place metric-independent successor generation in internal `occn/replay.py`.
- Place the public fitness API and result types in
  `occn/replay_fitness.py`.
- Reuse exact-object binding behavior and exact state deduplication.
- Do not reuse precision's dominance pruning for fitness.
- Use iterative layered exploration with a deterministic state cap.
- Represent capped searches as `INCONCLUSIVE`, never as non-fitting.
- Exclude inconclusive units from fitness and report coverage separately.
- Keep replay-unit extraction outside the fitness module.

## 8. Replay-Unit Contract

Issue #221 should define the storage-independent input consumed by #222 in:

`totem_lib/src/totem_lib/occn/replay_units.py`

The initial strategy identifier is `connected_components`. The extraction API
may accept either the in-memory or DuckDB-backed OCEL representation, but it
must return the same contract.

### 8.1 Event structure

```python
@dataclass(frozen=True)
class OCCNReplayEvent:
    event_id: str
    activity: str
    timestamp_unix: Union[int, float]
    objects_by_type: Tuple[
        Tuple[str, Tuple[str, ...]],
        ...
    ]
```

Contract rules:

- object types are sorted by name;
- object identifiers within a type are sorted;
- every object identifier occurs at most once in an event;
- `objects_by_type` is immutable and hashable;
- event ordering is not inferred again by the fitness module.

The flattened object set needed by `enabled_bindings_for_objects` is derived
from `objects_by_type`.

### 8.2 Replay-unit structure

```python
@dataclass(frozen=True)
class OCCNReplayUnit:
    unit_id: str
    strategy: str
    events: Tuple[OCCNReplayEvent, ...]
```

Contract rules:

- `events` contains only visible log events;
- every event identifier occurs once within the unit;
- event order is ascending by `(timestamp_unix, event_id)`;
- `unit_id` is deterministic for an unchanged log and strategy;
- artificial start and end events are not part of the contract;
- an empty replay unit is invalid.

For connected components, units are sorted by the ordering key of their first
event. Identifiers use that deterministic position:

```text
connected_components:000001
connected_components:000002
...
```

The endpoint may combine this library identifier with a file identifier, but
the library contract must not depend on Django models.

### 8.3 Connected-component extraction

The initial extraction procedure is:

1. Create one object-graph node per object.
2. Connect objects that participate in the same event.
3. Compute connected components of the object graph.
4. Assign every event to the component containing its objects.
5. Sort events in each component by `(timestamp_unix, event_id)`.
6. Sort components by the first event's ordering key.
7. Build one `OCCNReplayUnit` per component.

All objects of one event belong to the same component because that event
connects them. An event without objects cannot be replayed by the current OCCN
semantics. Extraction should retain such an event as a deterministic singleton
unit so it is reported as non-fitting instead of silently disappearing.

Connected-component extraction produces concrete executions. Variant grouping
may group their results for reporting later, but a representative variant
must not replace all of its concrete executions in the initial fitness
calculation.

### 8.4 Boundary between #221 and #222

Issue #221 owns:

- reading events and objects from the selected OCEL representation;
- connected-component construction;
- deterministic event and unit ordering;
- stable unit identifiers;
- construction and validation of `OCCNReplayUnit` values.

Issue #222 owns:

- introduction of artificial start activities;
- exact-object binding search;
- artificial end activities and the empty-state check;
- state limits and replay status;
- aggregate fitness and coverage.

Issue #222 must not query an event log, compute connected components, or group
variants. Issue #221 must not depend on an OCCN or decide replayability.

## 9. Follow-Up Implementation Guidance

| Issue | Required implementation outcome |
|---|---|
| #221 | Add `replay_units.py`, connected-component extraction, contract validation, and deterministic fixtures for in-memory and DuckDB-backed logs. |
| #222 | Add `replay.py` and `replay_fitness.py`, exact layered search, three-state results, aggregate fitness, coverage, and bounded-search tests. |
| #223 | Deserialize the selected OCCN asset, request replay units from #221, call #222, and serialize its result without changing metric semantics. |
| #224 | Initially expose only `connected_components`; do not present unimplemented strategies. |
| #225 | Display fitness together with coverage and visibly separate inconclusive units from non-fitting units. |
| #226 | Use the event and object data already present in replay-unit results; display a failure position only when the search proves one. |
| #227 | Document the connected-component interpretation, state cap, inconclusive status, and the difference between fitness and precision. |

## 10. Known Limitations and Review Points

- Connected components may collapse a highly connected log into one large
  replay unit.
- Timestamp ties are resolved by event identifier because the different
  storage backends do not expose one shared source-row index.
- A state cap of `1000` is an initial deterministic safeguard, not an
  empirically calibrated universal value.
- Fitness with coverage below `1.0` is a partial result and must be labeled as
  such by the API and frontend.
- The initial metric weights concrete replay units equally, matching the
  reference algorithm. Variant-weighted reporting is out of scope.
- The AGPL reference implementation is not copied. The implementation is
  derived independently from the algorithm and the current public semantics
  API.

The three-state replay result and initial state cap should be reviewed with
the project owner, but they do not block implementation: they are conservative
defaults that avoid reporting unproven deviations as non-fitting.

## 11. Issue #220 Outcome

The compatibility analysis is complete:

- the external replay behavior has been mapped to current OCCN semantics;
- source-level incompatibilities and licensing constraints are documented;
- the implementation target modules are identified;
- safe reuse and unsafe precision-specific behavior are distinguished;
- the extraction/fitness contract is defined;
- termination behavior and incomplete-search semantics are defined;
- #221 through #227 have concrete implementation boundaries.
