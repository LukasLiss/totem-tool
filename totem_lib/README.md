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
[ocel-standard.org](https://www.ocel-standard.org/event-logs/overview/). Each log records
several size statistics, so runtime can be plotted against any of them.

| Log | Events | Objects | Activities | Object types | E2O relations | O2O relations |
|---|---|---|---|---|---|---|
| `ocel2-p2p` | 14,671 | 9,054 | 10 | 7 | 35,927 | 16,757 |
| `order-management` | 21,008 | 10,840 | 11 | 6 | 147,463 | 28,391 |
| `container_logistics` | 35,372 | 13,882 | 14 | 7 | 74,272 | 15,920 |

Which log is "bigger" depends on the metric: `order-management` has fewer events than
`container_logistics` but twice as many event-to-object relations.

All three ship with the repo and need no setup. Larger logs do not belong in git, so
`test_data/large/` is gitignored and populated on demand by a download script. Run from
the `totem_lib/` directory:

```bash
python evaluation/download_logs.py --list
python evaluation/download_logs.py --logs <name>
python evaluation/log_stats.py
```

`evaluation/datasets.py` is the manifest — names, source links, locations and recorded
statistics, with the full details in its module docstring. `log_stats.py` re-measures the
statistics and reports any that have drifted from what the manifest records.

The module docstring also records why the largest available OCEL log (Age of Empires 2,
2.4M events) cannot be used yet: it has 831 activity types, and `import_ocel`'s SQLite
path exceeds SQLite's compound-`SELECT` limit on logs that wide.

## Running the benchmarks

One command runs every main algorithm on every log and reports time and peak memory:

```bash
python evaluation/run_benchmarks.py
python evaluation/run_benchmarks.py --list
python evaluation/run_benchmarks.py --logs ocel2-p2p --repeats 1
python evaluation/run_benchmarks.py --algorithms totemDiscovery,OCDFG.from_ocel
```

Results print as each measurement finishes, so an interrupted run still shows everything
measured so far, and `--logs` / `--algorithms` fill in the rest later. A failing algorithm
is reported and the run continues.

The algorithms differ enormously in cost — from `CCDFG.from_ocel` at ~0.01 s to
`discover_occn` at ~20 s on the smallest log — so try anything new on `ocel2-p2p` with
`--repeats 1` first. `evaluation/algorithms.py` lists what runs and how each one is
called; it is also where a new algorithm gets added.

## Acknowledgements
The TOTeM module is based on the original implementation by [Lukas Liss](https://github.com/LukasLiss/multi-level-resource-detection/).
The TOTeM visualization function is adapted from [this repository](https://github.com/loeseke/object-centric-streaming-discovery/).
The OCCN class and its conformance checking functions are adapted from [this repository](https://github.com/olekuhlmann/OCCN-OCPN-Transformer).
The OCCN-Miner is based on the original implementation by [Caspar Mensing](https://github.com/CasparMensing/OCFHM).