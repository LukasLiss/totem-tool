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

Every run saves its results to `evaluation/results/`:

| File | For |
|---|---|
| `benchmark_results.md` | reading - two tables, one for the logs and one for the measurements |
| `benchmark_results.csv` | plots and other tools |
| `benchmark_results.json` | the same data plus a note of when the run happened |

Use `--out-dir` to save somewhere else and `--formats` to write only some of them, for
example `--formats md`. Each run overwrites the previous files. The generated JSON is
gitignored; the Markdown and CSV are not, so an example run can be committed.

It also saves one plot per size metric to `figures/`, named
`runtime_vs_<metric>.png`. Each figure uses two channels: the line **colour** says which
algorithm, the **marker shape** says which log a point came from. Runtime is on a log
scale because the algorithms differ by five orders of magnitude.

The two loading steps are drawn as grey baselines rather than coloured lines, because
they are what the other algorithms build on rather than discovery algorithms themselves.
`import_ocel` is dashed and reads the log into Polars; `import_ocel_db` is dotted and
reads the same file into DuckDB. Which one applies depends on the algorithm: five of
them need the Polars log, two need the DuckDB one.

Use `--no-figures` for a quick partial run: a filtered run would otherwise overwrite the
committed figures with incomplete data. To rebuild the figures from the saved results
without running anything:

```python
from evaluation.plots import plot_all, rows_from_csv
plot_all(rows_from_csv("evaluation/results/benchmark_results.csv"))
```

The algorithms differ enormously in cost — from `CCDFG.from_ocel` at ~0.01 s to
`discover_occn` at over 7 minutes on `order-management` — so try anything new on
`ocel2-p2p` with `--repeats 1` first. `evaluation/algorithms.py` lists what runs and how each one is
called; it is also where a new algorithm gets added.

## Example run

One full run is committed, so the output can be read without running anything. It was
produced on an otherwise idle machine with the default three repeats, leaving out the one
algorithm that cannot complete (see below):

```bash
python evaluation/run_benchmarks.py --repeats 3 \
  --algorithms import_ocel,import_ocel_db,totemDiscovery,totemDiscovery_db,mlpaDiscovery,discover_oc_petri_net_polars,discover_occn,OCDFG.from_ocel,CCDFG.from_ocel
```

That takes about 30 minutes, almost all of it `discover_occn` on `order-management`.

- [`evaluation/results/benchmark_results.md`](evaluation/results/benchmark_results.md) — the tables
- [`evaluation/results/benchmark_results.csv`](evaluation/results/benchmark_results.csv) — the same rows, for tools
- [`figures/`](figures/) — one plot per size metric

![Algorithm runtime against number of events](figures/runtime_vs_num_events.png)

### What it shows

The choice of x-axis changes the story, which is why the tool records six size metrics
instead of only the event count.

`discover_occn` is by far the slowest algorithm, and it is slowest on
`order-management` — the log in the **middle** by event count, not the largest. Plotted
against events its line spikes and then falls, which reads as nonsense. Plotted against
event-to-object relations it rises steadily, because that is what it actually scales
with: `order-management` has 147k such relations against 74k for the larger
`container_logistics`.

Compare the two figures side by side:

- [runtime against events](figures/runtime_vs_num_events.png) — the misleading view
- [runtime against event-to-object relations](figures/runtime_vs_num_e2o_relations.png) — the explanatory one

### DuckDB is fast, but the loading is not free

`totemDiscovery_db` looks dramatically faster than the Polars `totemDiscovery` — 9x to
17x on the algorithm alone. That is real, but on its own it is misleading, because the
two need different loaders and loading into DuckDB costs more.

| Log | Loading | Algorithm alone | Whole job |
|---|---|---|---|
| `ocel2-p2p` | 2.90 s / 6.12 s | 3.28 s / 0.29 s = 11.3x | 6.18 s / 6.41 s = **0.96x** |
| `order-management` | 3.52 s / 8.58 s | 7.42 s / 0.80 s = 9.2x | 10.94 s / 9.38 s = **1.17x** |
| `container_logistics` | 3.46 s / 4.40 s | 6.53 s / 0.40 s = 16.5x | 9.99 s / 4.79 s = **2.08x** |

(Polars / DuckDB.)

Read end to end, the advantage shrinks a lot, and on the smallest log it disappears — the
whole job is slightly *slower* through DuckDB. The win grows with the log, so DuckDB
still looks like the better bet as logs get bigger. But one load feeding many algorithms
is where it pays off, not one load feeding one algorithm.

### How to read the numbers

- **Timings are from one machine** (a Windows dev laptop) and are only meaningful
  relative to each other. Re-run the command to get numbers for your own hardware.
- **Peak RAM understates Polars and DuckDB.** It comes from `tracemalloc`, which counts
  Python allocations only, and both libraries do most of their work in native memory.
- **Two metrics are weak axes.** Object types (6–7) and activities (10–14) barely vary
  across three logs, so those two figures show little. A larger log would fix this; the
  2.4M-event Age of Empires log is not usable yet, for the reason recorded in
  `evaluation/datasets.py`.
- **`find_variants` is missing.** It exhausts memory on `order-management` and ends in a
  `MemoryError`, so it is left out of the committed run rather than taking the machine
  down with it. `order-management` has 147k event-to-object relations, twice
  `container_logistics`, and variant extraction scales with that rather than with events.
  Run it on its own if you want to measure it.
- **The two importers disagree slightly.** The `_db` algorithms build their DuckDB copy
  from the same OCEL file the Polars side reads, so both measure the same log. They are
  not byte-identical though: the Polars importer filters out objects the DuckDB one
  keeps, so `ocel2-p2p` has 9,543 objects on the DuckDB side against 9,054 on the Polars
  side. Event counts and labels match everywhere.
- **Both loaders are timed, so compare like with like.** A Polars algorithm costs
  `import_ocel` plus its own time; a DuckDB one costs `import_ocel_db` plus its own. The
  algorithm rows on their own leave the loading out.
- **Re-running with `--logs` or `--algorithms` overwrites these files** with partial
  data. Regenerate the committed example only from the full command.

## Acknowledgements
The TOTeM module is based on the original implementation by [Lukas Liss](https://github.com/LukasLiss/multi-level-resource-detection/).
The TOTeM visualization function is adapted from [this repository](https://github.com/loeseke/object-centric-streaming-discovery/).
The OCCN class and its conformance checking functions are adapted from [this repository](https://github.com/olekuhlmann/OCCN-OCPN-Transformer).
The OCCN-Miner is based on the original implementation by [Caspar Mensing](https://github.com/CasparMensing/OCFHM).