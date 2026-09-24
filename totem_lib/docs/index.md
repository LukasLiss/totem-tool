# totem-lib

Object-centric process mining in Python.

`totem-lib` reads OCEL 2.0 event logs and discovers and checks object-centric
process models. It is the analysis core of the
[TOTeM Tool](https://github.com/LukasLiss/totem-tool) and can be used on its own.

- **TOTeM**: discover Temporal Object Type Models and check them against a log
- **Process areas**: from TOTeM relations or from resource indicators
- **Process models**: directly-follows graphs (OC-DFG), Petri nets (OCPN) and
  causal nets (OCCN)
- **Variants and conformance**: object-centric variants, replay fitness,
  precision and playout

## Where to start

- [Installation](installation.md)
- [Getting started](examples/getting_started.ipynb): load a log, discover a
  TOTeM model and find process areas. You can also
  [open it in Google Colab](https://colab.research.google.com/github/LukasLiss/totem-tool/blob/main/totem_lib/docs/examples/getting_started.ipynb).
- [API reference](api/index.rst): every public function and class

```{toctree}
:hidden:
:caption: Get started

installation
examples/getting_started
```

```{toctree}
:hidden:
:caption: Reference

api/index
```
