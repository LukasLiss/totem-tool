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

These capabilities are relevant to replay fitness. Pass 2 of this analysis
will decide whether they should be extracted into a shared replay module or
adapted separately for fitness.

## 5. Behavioral and Technical Risks

### Search growth

The external depth-first recursion has no memoization, state limit, recursion
limit handling, or timeout. Runtime can grow exponentially with the number of
possible input/output bindings. Cycles can also produce many equivalent
search paths.

### Incomplete-search semantics

A bounded implementation must distinguish "proven non-fitting" from "search
limit reached." Treating a stopped search as non-fitting would silently
underestimate fitness.

### Replay-unit size

Connected components can become very large when a few objects connect most of
the log. The extraction strategy is deterministic, but it does not guarantee
small replay units.

### Event ordering

Sorting only by timestamp leaves ties dependent on input order. #221 must
define a stable secondary ordering that is preserved between in-memory and
DuckDB-backed logs.

### Source-code licensing

The external reference file carries an AGPL license header while this project
uses the MIT license. Its behavior and published algorithm can guide an
independent implementation, but source code must not be copied directly
without confirming a compatible licensing path.

## 6. Pass 1 Conclusion

- The external replay-fitness behavior maps cleanly to the current OCCN model.
- The external implementation cannot be ported as a direct source-level copy.
- Current semantics already provide the exact-object binding operation needed
  for observed event replay.
- Current event-log and extraction APIs contain the required information, but
  #221 must establish a stable replay-unit boundary.
- Search control and reuse of the precision replay machinery are the main
  architecture decisions remaining for Pass 2.
