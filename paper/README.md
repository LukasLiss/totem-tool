# VLDB Paper: Object-Centric Process Mining Inside the Database

This directory contains the LaTeX sources of the paper draft
*"Object-Centric Process Mining Inside the Database: Scalable and
Incremental Discovery over Relational Event Data"* (PVLDB format,
acmart-based template).

## Building

```bash
make            # builds main.pdf via latexmk
make clean
```

Requires a TeX Live installation with `acmart` dependencies
(`texlive-latex-extra`, `texlive-fonts-recommended`, `texlive-bibtex-extra`).

## Reproducing the experiments

All numbers and figures in the evaluation section are produced by the
benchmark suite in `../totem_lib/evaluation/vldb/`:

```bash
pip install -e ../totem_lib
cd ../totem_lib/evaluation/vldb
python run_all.py            # full run (hours, ~10 GB scratch in /tmp)
python run_all.py --quick    # pipeline smoke test (minutes)
```

`run_all.py` runs five benchmarks (scaling, ablation, incremental
maintenance, bounded memory, real logs), writes raw results as CSV to
`evaluation/vldb/results/`, and regenerates the figure PDFs in
`paper/figures/`.

The components evaluated in the paper live in `../totem_lib/src/totem_lib/`:

| Paper section | Code |
| --- | --- |
| Relational OCEL schema (Sec. 4) | `ocel/ocel_duckdb.py`, `ocel/importer_db.py` |
| OC-DFG in SQL (Sec. 5.1) | `dfg/ocdfg_db.py` (window) vs `dfg/ocdfg_db_naive.py` (self-join) |
| TOTeM in SQL (Sec. 5.2) | `totem/totem_db.py` (eager) vs `totem/totem_db_naive.py` (lazy) |
| Variants (Sec. 5.3) | `variants/ocvariants_db.py` |
| Incremental discovery (Sec. 6) | `incremental/` |
| Synthetic log generator (Sec. 7) | `generator/synthetic.py` |

Correctness of every DB-backed and incremental implementation against the
in-memory reference implementations is enforced by the test suite:

```bash
cd ../totem_lib && python -m pytest tests/
```
