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
- User guide: [causal nets](guide/occn.md), their
  [replay fitness](guide/occn_replay_fitness.md) and
  [precision](guide/occn_precision.md), and
  [process areas](guide/process_areas.md)
- [API reference](api/index.rst): every public function and class

```{toctree}
:hidden:
:caption: Get started

installation
examples/getting_started
```

```{toctree}
:hidden:
:caption: User guide

Causal nets (OCCN) <guide/occn>
OCCN replay fitness <guide/occn_replay_fitness>
OCCN precision <guide/occn_precision>
Process areas <guide/process_areas>
```

```{toctree}
:hidden:
:caption: Reference

api/index
```
