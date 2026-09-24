# Installation

totem-lib needs Python 3.10 or newer. It is not on PyPI yet, so install it
from GitHub:

```bash
pip install "git+https://github.com/LukasLiss/totem-tool.git#subdirectory=totem_lib"
```

This also installs all Python dependencies.

## Graphviz

`Totem.visualize()` draws models with the `dot` program from
[Graphviz](https://graphviz.org/download/), which pip cannot install. Everything
else works without it.

## Example data

The example logs are not part of the package. The
[getting started](examples/getting_started.ipynb) notebook downloads the log it
needs. The others are in
[`totem_lib/example_data/`](https://github.com/LukasLiss/totem-tool/tree/main/totem_lib/example_data)
in the repository. Your own OCEL 2.0 files work too: `.sqlite`, `.json`,
`.xml`, `.csv` or `.duckdb`.

## For development

Clone the repository and install the package in editable mode, with the test
and docs tools:

```bash
git clone https://github.com/LukasLiss/totem-tool.git
cd totem-tool/totem_lib
pip install -e ".[test,docs]"
```
