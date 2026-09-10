# totem-lib

Object-centric process mining in Python: OCEL 2.0 import, TOTeM
(Temporal Object Type Model) discovery and conformance checking, process
areas, object-centric directly-follows graphs (OC-DFG), object-centric Petri
nets (OCPN) and object-centric causal nets (OCCN).

`totem-lib` is the analysis core of the
[TOTeM Tool](https://github.com/LukasLiss/totem-tool); it has no web or UI
dependencies and can be used on its own.

## Installation

```bash
pip install totem-lib
```

Requires Python 3.10 or newer. All Python dependencies are installed
automatically. The [Graphviz](https://graphviz.org/download/) system binary
(`dot`) is only needed for rendering with `Totem.visualize()` and the other
`visualize` helpers; import, discovery and conformance checking work without
it.

The `example_data/` and `test_data/` directories referenced in the examples
below are not part of the wheel. Clone the
[repository](https://github.com/LukasLiss/totem-tool) to get them, or point
`import_ocel` at your own OCEL 2.0 file (`.sqlite`, `.json`, `.xml`, `.csv`
or `.duckdb`).

## Example usage

```python
from totem_lib import import_ocel, totemDiscovery, mlpaDiscovery

# Importing with automatic filetype detection
ocel = import_ocel("example_data/ContainerLogistics.sqlite")

# Mine the temporal graph first
totem = totemDiscovery(ocel, tau=0.9)

# Process Areas Mining
process_view = mlpaDiscovery(totem)
```

## TOTeM conformance checking

TOTeM conformance compares an independently loaded model with a current event
log. It does not discover or modify the model during the check.

```python
from totem_lib import conformance_of_totem, totem_from_dict
from totem_lib.ocel import import_ocel_db

model = totem_from_dict(model_json)
event_log = import_ocel_db("example_data/ContainerLogistics.sqlite")
try:
    result = conformance_of_totem(model, event_log)
    response_data = result.to_dict()
finally:
    event_log.close()
```

The implementation runs directly on `OcelDuckDB`. Discovery and conformance
share their aggregate histogram queries, while conformance uses the symmetric,
qualified object-to-object relation behavior of the original paper branch. No
Polars conversion or temporary model discovery is required.

`TotemConformanceResult` contains overall metrics, averages per object type,
metrics per directed type pair, and aggregate and detailed histograms. Its
`to_dict()` output is deterministic and JSON-compatible. Compound keys such as
type pairs are represented as records with named fields so object-type names do
not need delimiter escaping.

## OCCN replay-unit extraction

OCCN conformance checks concrete event sets called replay units. The default
strategy groups events by connected components of their shared objects. A
leading-object strategy is also available for targeted investigation:

```python
from totem_lib import (
    LEADING_OBJECT_REPLAY_STRATEGY,
    extract_occn_replay_units,
    import_ocel,
)

event_log = import_ocel("example_data/ocel2-p2p.json")
connected_units = extract_occn_replay_units(event_log)
order_units = extract_occn_replay_units(
    event_log,
    strategy=LEADING_OBJECT_REPLAY_STRATEGY,
    leading_object_type="orders",
)
```

The same API accepts an `ObjectCentricEventLog` or an `OcelDuckDB`. Both paths
produce immutable `OCCNReplayUnit` values with the same deterministic contract:

- events are ordered by `(timestamp_unix, event_id)`;
- units are ordered by their first event and receive IDs such as
  `connected_components:000001`;
- activity names, event IDs, timestamps, object IDs, and object types remain
  available for replay and diagnostics;
- events without objects remain visible as singleton units;
- objects without events do not create empty units;
- an empty log produces no replay units.

Connected-component units partition the visible events. Leading-object units
contain all events that directly reference one object of the selected type;
shared events can therefore occur in several leading-object units. Their IDs
use the leading object, for example `leading_object:order-42`.

Replay units contain only visible log events. Artificial `START_<type>` and
`END_<type>` activities are introduced internally by replay fitness and are
not added to the event log or extraction result.

Connected-component extraction can produce a very large unit when a few
objects connect most of a log. Neither strategy groups units into variants.
Timestamp ties are resolved by event ID because the supported storage backends
do not expose a shared source-row index. See
[`docs/OCCN_REPLAY_FITNESS.md`](https://github.com/LukasLiss/totem-tool/blob/main/docs/OCCN_REPLAY_FITNESS.md) for the complete
strategy, replay, result, and limitation contract.

## Development setup

To work on totem-lib itself (not needed for `pip install totem-lib`), clone the
repository and follow these steps inside `totem_lib/`.

### 1. Create a Virtual Environment

It is recommended to use a virtual environment to manage dependencies. Run the following command to create a virtual environment named `.venv`:

```bash
python -m venv .venv
# .venv\Scripts\activate # On Windows
source .venv/bin/activate # On Linux/MacOS
```

### 2. Install Dependencies

Once the virtual environment is activated, install the required packages:

```bash
pip install -r requirements.txt
```

### 3. Install the Package in Editable Mode

Finally, install the project itself in editable mode so changes to the code are immediately reflected:

```bash
pip install -e .
```

To run all tests, execute:

```bash
pytest ./tests/
```

## Acknowledgements

The TOTeM module is based on the original implementation by [Lukas Liss](https://github.com/LukasLiss/multi-level-resource-detection/).

The TOTeM visualization function is adapted from [this repository](https://github.com/loeseke/object-centric-streaming-discovery/).

The OCCN class and its conformance checking functions are adapted from [this repository](https://github.com/olekuhlmann/OCCN-OCPN-Transformer).

The OCCN miner and visualizer are ported from the [OCCN-Miner](https://github.com/LukasLiss/OCCN-Miner), originally implemented by [Caspar Mensing](https://github.com/CasparMensing/OCFHM).

Object-Centric Causal Nets are introduced in [Liss et al. (2025), _Object-Centric Causal Nets_, CAiSE 2025](https://doi.org/10.1007/978-3-031-94571-7_6). See [`examples/OCCN.md`](https://github.com/LukasLiss/totem-tool/blob/main/totem_lib/examples/OCCN.md) for a get-started guide.

The `process_areas` module implements chapter 4.1 of Moritz Schlegelmilch's bachelor thesis _Discovering Advanced Resource-Based Process Areas_ (PADS, RWTH Aachen, 2026), and is ported from its [reference implementation](https://github.com/moritzkschlegelmilch/Thesis). It extends the multi-level process area detection of [Liss & van der Aalst (2026), _Process Area Extraction by Multilevel Resource Detection for Object-Centric Process Mining_, BPM 2026](https://doi.org/10.1007/978-3-032-02867-9_13), which `mlpaDiscovery` implements. See [`examples/PROCESS_AREAS.md`](https://github.com/LukasLiss/totem-tool/blob/main/totem_lib/examples/PROCESS_AREAS.md) for a get-started guide.
