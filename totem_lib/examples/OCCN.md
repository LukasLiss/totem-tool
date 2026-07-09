# Get Started - Object-Centric Causal Nets (OCCN)

Object-centric causal nets consist of an object-centric dependency graph annotated with marker groups. For more information, consult:
Liss et al. (2025). Object-Centric Causal Nets. CAiSE 2025. https://doi.org/10.1007/978-3-031-94571-7_6.

The miner and visualizer in this library are ported from the original standalone implementation: https://github.com/LukasLiss/OCCN-Miner.

## Discovering OCCNs

There are two ways of creating an OCCN. The most straightforward way is to discover it from an OCEL.

```python
from totem_lib import import_ocel, discover_occn, OCCausalNet

ocel = import_ocel("example_data/ContainerLogistics.json")
occn: OCCausalNet = discover_occn(ocel, relativeOccuranceThreshold=0)
```
Alternatively, OCCNs can be created manually using its ```create_from_dict``` factory. See ```tests/assets/example_occns.py``` for an example.

### Relative Occurence Threshold
The only mandatory parameter for ```discover_occn``` is the relative occurence threshold. This parameter filters out infrequent marker groups. A value of `0` applies no filtering whereas a value of `0 < n <= 1` keeps only marker groups that occur in at least `n*100` percent of the firings of its activity.

The relative occurence threshold does not influence the discovery itself and is applied afterwards. Thus, when trying out multiple values for the relativeOccuranceThreshold, it is recommended to conduct the expensive discovery only once without filtering and then filter the resulting OCCN for different thresholds.

```python
# Discover with no filtering
base_occn = discover_occn(ocel, relativeOccuranceThreshold=0)

# Filter for different thresholds
occn_1 = base_occn.apply_relative_occurrence_threshold(0.1)
occn_2 = base_occn.apply_relative_occurrence_threshold(0.2)
```

An OCCN with `relativeOccuranceThreshold=0` is guaranteed to be able to replay the initial OCEL. A value greater 0 loses this theoretical guarantee and may result in an OCCN with an empty language.

### Discovering from DuckDB

`discover_occn` also accepts an `OcelDuckDB`, the DuckDB-backed OCEL representation used throughout the TOTeM tool. This is the path the web application uses.

```python
from totem_lib import discover_occn
from totem_lib.ocel import import_ocel_db

db = import_ocel_db("test_data/small/container_logistics.duckdb")
occn = discover_occn(db, relativeOccuranceThreshold=0)
```

`import_ocel_db` accepts existing `.duckdb` databases as well as OCEL 2.0 files in `.json`, `.sqlite`, `.xml` and `.csv` format, which are converted on import.

See `examples/example_occn_duckdb.py` for a runnable end-to-end example (discovery → thresholding → serialization).

## Serializing to JSON

`serialize_occn` converts an `OCCausalNet` into a JSON-serializable `dict`. This is the payload the TOTeM frontend consumes (served by the backend's `/api/occn/` endpoint and rendered by the OCCN dashboard component).

```python
import json
from totem_lib import discover_occn, serialize_occn
from totem_lib.ocel import import_ocel_db

db = import_ocel_db("test_data/small/container_logistics.duckdb")
occn = discover_occn(db, relativeOccuranceThreshold=0)

payload = serialize_occn(occn)
json.dumps(payload)  # fully JSON-serializable
```

### JSON schema

The serialized dict has six top-level keys:

| Key | Type | Description |
| --- | --- | --- |
| `object_types` | `list[str]` | All object types in the net, sorted alphabetically. |
| `relative_occurrence_threshold` | `float` | The threshold the net was filtered with (`0` = unfiltered). |
| `activities` | `list[{id, count}]` | Every activity (including synthetic `START_<type>` / `END_<type>` terminals) with its frequency in the event log. |
| `edges` | `list[{source, target, object_type, dependence_measure}]` | Dependency arcs. One entry per (activity pair, object type); `dependence_measure` is the Heuristics-Miner dependency value or `null`. |
| `input_marker_groups` | `dict[activity, list[MarkerGroup]]` | Input bindings per activity. |
| `output_marker_groups` | `dict[activity, list[MarkerGroup]]` | Output bindings per activity. |

A `MarkerGroup` is one binding alternative of an activity:

```jsonc
{
  "support_count": 594,   // how often this binding fired in the log; null = unknown
  "markers": [
    {
      "related_activity": "Order Empty Containers",
      "object_type": "Container",
      "min_count": 1,
      "max_count": null,  // null = unbounded (∞)
      "marker_key": 0     // disambiguates parallel markers between the same pair
    }
  ]
}
```

For rendering, an activity's `input_marker_groups` are the alternative ways it can consume obligations (XOR across groups, AND within a group's markers), and its `output_marker_groups` the alternative sets of obligations it creates.

# Play-Out

In play-out, the language of valid sequences for an OCCN is computed. Since this language is usually intractably (or infinitely) large, we usually compute a subset of it.
Furthermore, we have to define a set of objects per object type. Every sequence generated will feature exactly these objects. Consider the following small example.

```python
from totem_lib import occn_playout
from tests.assets.example_occns import occn_ABC

# Very small OCCN
occn = occn_ABC()

# Define objects
objects = {"order": {"o1", "o2"}}

# Play-out entire language
valid_sequences_iter = occn_playout(occn, objects, max_bindings_per_activity=3)
valid_sequences = list(valid_sequences_iter)

# Activities fired in first sequence
print(", ".join([a for (a, _, _) in valid_sequences[0]]))
# First binding of first sequence
print(valid_sequences[0][0])
# Number of valid sequences in langauge
print(len(valid_sequences))
```

In the output, we can see that the first computed sequence fires the activities `START_order, START_order, a, b, a, b, c, END_order, c, END_order`. The first binding of this sequence is `('START_order', None, (('a', (('order', ('o1',)),)),))`, indicating that `START_order` is fired, no obligations are consumed, and an obligation for the order `o1` is created towards the activity `a`. 
This very small OCCN has a language of 252 sequences in total with the specified objects. 
The `return_ocel` parameter can be enabled to get the generated sequences an an OCEL instead of an iterator of sequences. In this case, it may be useful to set the `make_objects_unique_per_sequence` parameter as well. 

## Parameters
The only mandatory parameter is `max_bindings_per_activity`. This limits the amount that each acivity can be fired in a generated sequence. Setting this parameter to a finite value renders the language of the OCCN finitely large.

Since the OCCN language is intractably large in general, it is often required to set the `branching_factor_activities` and `branching_factor_bindings` parameters. These limit the branching factor in the state space search that powers the play-out. Smaller values (usually `1 < n < 2`) speed up the computation and reduce the size of the subset of the language generated. Larger values (usually `n > 1.5`) have the opposite effect. Too small values usually lead to the play-out not generating any sequences. Too large values increase the runtime exponentially, leading to memory issues.

For the following medium-sized net with few objects, branching factors of 1.2 have proved well to generate a small amount of sequences instantly.

```python
from totem_lib import occn_playout
from examples.assets.occn.container_logistics_occn import occn_container_logistics

occn = occn_container_logistics()

# Define objects
objects = {
    "Customer Order": ["cu_1"],
    "Transport Document": ["td_1"],
    "Container": ["c_1", "c_2"],
    "Handling Unit": ["hu_1", "hu_2"],
}

# Apply play-out
valid_sequences_iter = occn_playout(
    occn,
    objects,
    max_bindings_per_activity=5,
    branching_factor_activities=1.2,
    branching_factor_bindings=1.2,
)

valid_sequences = list(valid_sequences_iter)
print(len(valid_sequences))
```

Try executing the code multiple times. The number of generated sequences should be between 0 and 20. Finding applicable branching factors is usually tricky.





