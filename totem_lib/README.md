# totem_lib

Library for the TOTeM paper.
Also includes a module for importing [OCEL 2.0](https://www.ocel-standard.org/) files.

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

## Installation

To set up a development environment for totem-lib, follow these steps. This is required for development only.

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

Object-Centric Causal Nets are introduced in [Liss et al. (2025), _Object-Centric Causal Nets_, CAiSE 2025](https://doi.org/10.1007/978-3-031-94571-7_6). See [`examples/OCCN.md`](examples/OCCN.md) for a get-started guide.
