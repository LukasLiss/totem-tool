# Why the subprocess half of the process-area thesis is not implemented

TOTeM-Tool implements **chapter 4.1** of Moritz Schlegelmilch's bachelor thesis
*Discovering Advanced Resource-Based Process Areas* — the resource indicators and
the layer assignment. Chapters 4.2 and 4.3 are not implemented, and this note
records why, so the question does not need re-litigating.

It is not a prioritisation call. Those chapters are defined over object-centric
**Petri nets**, and specifically over their *places*. TOTeM-Tool does not render
a Petri net anywhere a process area is shown.

## What the later chapters need

| Thesis machinery | Requires | OCDFG | OCCN |
|---|---|---|---|
| Flattened net `N_ot` | places typed by object type | no places | no places |
| Case-centric subprocess boundary `(p_in, p_out)` | the boundary **is** a pair of places | — | — |
| Dominance / postdominance | the bipartite place–transition graph | — | — |
| Self-containment `t' subset of union of P_i` | presets and postsets of places | — | marker groups instead |
| Complexity `g|P| + d|F| + e|F_var|` | places, variable arcs | — | — |
| Object-centric precision | OCPN binding semantics | — | different semantics |

The process-area **detail view** renders an OCDFG (`/api/ocdfg/`), and the rest of
the tool renders OCCNs. A directly-follows graph has no places at all; an OCCN
replaces them with marker-group binding semantics. An object-centric subprocess
is *defined by* its place boundary, so porting chapter 4.2 would not be porting —
it would mean re-deriving an equivalent notion of a subprocess per formalism, and
then re-deriving the quality metrics that are stated in terms of place counts.

The thesis says the same thing in its own future work (chapter 8): the framework
*"could be adapted to other object-centric process models, such as object-centric
directly-follows graphs"*.

## Concretely out of scope

- Object-centric subprocess detection (Algorithms 1 and 2, chapter 4.2)
- Activity lifting (Algorithms 3 and 4, chapter 4.3.3)
- Quality metrics — complexity, simplicity gain, information loss, OC precision
- Collapsed Petri nets (Def. 4.3.4)
- Resource-involvement annotation `R` (Def. 4.3.8, the coloured dots). This one
  *is* model-agnostic and cheap; it is deferred rather than blocked, and is a
  reasonable follow-up.
- OCPN discovery per process area

## What is implemented

`totem_lib/src/totem_lib/process_areas/` — the three resource indicators, the
joined indicator, and the layer-assignment ILP, exposed at
`GET /api/files/<pk>/discover_process_areas/` and selectable in the Process Area
Visualizer. See [`totem_lib/examples/PROCESS_AREAS.md`](../totem_lib/examples/PROCESS_AREAS.md),
which also lists every deviation between our implementation, the thesis text and
the thesis's own reference implementation.
