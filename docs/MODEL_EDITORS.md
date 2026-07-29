# Visual Model Editors

The **Editor** category in the left side panel provides visual editors for the
three object-centric model types supported by the TOTeM tool:

| Editor | Model | Reference |
| --- | --- | --- |
| TOTeM Model | Temporal Object Type Model | Liss et al., *TOTeM: Temporal Object Type Model for Object-Centric Process Mining*, BPM 2024 |
| OC Causal Net | Object-Centric Causal Net (OCCN) | Liss et al., *Object-Centric Causal Nets*, CAiSE 2025 |
| OC Petri Net | Object-Centric Petri Net (OCPN) | van der Aalst & Berti, *Discovering Object-Centric Petri Nets*, Fundamenta Informaticae |

All three editors share the same workflow:

- **Start from scratch** — add elements from the floating toolbar on the
  canvas, connect them by dragging between the small handles on node borders,
  and edit every property in the panel on the right.
- **Example** — loads a small built-in example model that demonstrates the
  full notation.
- **Load JSON / Save JSON** — models are stored as plain JSON files (formats
  below). Loading validates the file and reports precise errors; loading a
  file that belongs to another editor tells you which editor to use.
- **Undo/redo** (Ctrl+Z / Ctrl+Y), **auto layout** (magic-wand button, ELK
  based) and canvas deletion via the Delete/Backspace key are supported
  everywhere. Node positions are saved in the JSON, so a model reopens with
  the same layout.

## TOTeM model format (`"format": "totem-model"`)

Object types are nodes; each unordered pair of types can have one relation
carrying a temporal relation plus log/event cardinalities per direction.
Temporal relation codes match `totem_lib.totem`: `D`/`Di` during(-inverse,
drawn as ■ at the marked end), `I`/`Ii` precedes(-inverse, drawn as ▶), `P`
parallel (drawn as ∥ at both ends). Cardinalities: log `1, 0..1, 1..*, 0..*`;
event additionally `0`.

```json
{
  "format": "totem-model",
  "version": 1,
  "name": "Car assembly",
  "objectTypes": [
    { "name": "tire", "color": "#8B5CF6", "position": { "x": 40, "y": 300 } },
    { "name": "order", "color": "#06B6D4", "position": { "x": 640, "y": 470 } }
  ],
  "relations": [
    {
      "id": "rel-tire-order",
      "source": "tire",
      "target": "order",
      "temporal": "D",
      "sourceToTarget": { "log": "1", "event": "0..1" },
      "targetToSource": { "log": "1", "event": "0..*" }
    }
  ]
}
```

## OCCN format (`"format": "occn"`)

Activities (including one `START_<type>` / `END_<type>` pseudo-activity per
object type), typed dependency arcs, and input/output marker groups per
activity. `markerGroups` uses exactly the dictionary format of
`totem_lib.OCCausalNet.from_dict`: marker tuples
`[relatedActivity, objectType, [min, max], key]` with `max = -1` meaning
unbounded — so the saved file's `markerGroups` can be handed directly to the
Python library. Arcs are also stored explicitly so arcs without bindings
survive a round trip.

```json
{
  "format": "occn",
  "version": 1,
  "name": "Shipping example",
  "objectTypes": [{ "name": "order", "color": "#2563EB" }],
  "activities": [
    { "name": "START_order", "position": { "x": 40, "y": 210 } },
    { "name": "send", "position": { "x": 470, "y": 205 } }
  ],
  "arcs": [{ "source": "START_order", "target": "send", "objectType": "order" }],
  "markerGroups": {
    "START_order": { "img": [], "omg": [[["send", "order", [1, 1], 0]]] },
    "send": { "img": [[["START_order", "order", [1, -1], 0]]], "omg": [] }
  }
}
```

Markers are drawn on the arcs (circle = exactly one object, square =
multiple); markers of the same group are joined by a thin line (AND), while
separate groups are XOR alternatives. Markers sharing a key within one group
bind disjoint objects. Clicking a marker opens its group in the side panel;
**dragging a marker onto another marker** of the same activity side merges
the two groups into one AND group.

The read-only OCCN **discovery visualizer** (Dashboard / Analysis / Overview,
`react_component/OCCNVisualizer.tsx`) renders discovered nets with these same
editor primitives (`editors/occn/`: nodes, arcs, marker overlay, ELK layout),
so discovered and hand-authored nets share one notation. On top of the editor
rendering it adds discovery-only affordances: an occurrence-threshold slider,
group-support and dependence-measure tooltips, activity counts, self-loop
arcs, and "+N in / +N out" chips when an activity's marker groups exceed the
per-side render cap. A possible follow-up is an "Open in Editor" bridge that
converts a discovered net into this file format for hand-editing (needs an
unsaved-session confirmation and a size guard for huge nets).

## OCPN format (`"format": "ocpn"`)

An object-centric Petri net `(N, pt, F_var)`: places typed by object type
(`pt` total), labeled transitions (silent transitions have `"label": null`),
bipartite arcs, and variable arcs (`"variable": true`, drawn as double lines)
that consume/produce a set of objects. `initial`/`final` mark the source/sink
places of each object type. The editor automatically enforces well-formedness
(Def. 5.2): per transition and object type, arcs are uniformly variable or
uniformly non-variable.

Arcs float: they attach wherever the node border faces the other endpoint
(hover a node to reveal the four connectors that start a new arc; pressing
anywhere else on the node moves it). Double-clicking an arc adds a **bend
point** that can be dragged to route the arc; double-clicking a bend point
removes it again. Bend points are saved as an optional `"waypoints"` array on
the arc — a pure layout hint (like node positions) that consumers reading
just the net can ignore:

```json
{ "id": "a1", "source": "o1", "target": "t_place",
  "waypoints": [{ "x": 120, "y": 80 }] }
```

```json
{
  "format": "ocpn",
  "version": 1,
  "name": "Order fulfilment",
  "objectTypes": [{ "name": "Order", "color": "#10B981" }],
  "places": [
    { "id": "o1", "objectType": "Order", "initial": true, "position": { "x": 0, "y": 0 } },
    { "id": "o2", "objectType": "Order", "position": { "x": 220, "y": 0 } }
  ],
  "transitions": [{ "id": "t_place", "label": "place order", "position": { "x": 110, "y": 0 } }],
  "arcs": [
    { "id": "a1", "source": "o1", "target": "t_place" },
    { "id": "a2", "source": "t_place", "target": "o2" }
  ]
}
```
