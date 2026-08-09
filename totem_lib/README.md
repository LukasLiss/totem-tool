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

## Evaluation logs

Runtime evaluation runs against real OCEL logs published on
[ocel-standard.org](https://www.ocel-standard.org/event-logs/overview/). A log's "size"
means its **number of events**.

| Log | Events | Location |
|---|---|---|
| `ocel2-p2p` | 14,671 | `test_data/small/` (in git) |
| `order-management` | 21,008 | `test_data/small/` (in git) |
| `container_logistics` | 35,372 | `test_data/small/` (in git) |

These ship with the repo and need no setup. Larger logs do not belong in git, so
`test_data/large/` is gitignored and populated on demand by a download script. Run from
the `totem_lib/` directory:

```bash
python evaluation/download_logs.py --list
python evaluation/download_logs.py --logs <name>
python evaluation/log_sizes.py
```

`evaluation/datasets.py` is the manifest — names, source links, locations and recorded
event counts, with the full details in its module docstring. `log_sizes.py` re-measures
the event counts and reports any that have drifted from what the manifest records.

The module docstring also records why the largest available OCEL log (Age of Empires 2,
2.4M events) cannot be used yet: it has 831 activity types, and `import_ocel`'s SQLite
path exceeds SQLite's compound-`SELECT` limit on logs that wide.

## Acknowledgements
The TOTeM module is based on the original implementation by [Lukas Liss](https://github.com/LukasLiss/multi-level-resource-detection/).
The TOTeM visualization function is adapted from [this repository](https://github.com/loeseke/object-centric-streaming-discovery/).
The OCCN class and its conformance checking functions are adapted from [this repository](https://github.com/olekuhlmann/OCCN-OCPN-Transformer).
The OCCN-Miner is based on the original implementation by [Caspar Mensing](https://github.com/CasparMensing/OCFHM).