# Get Started - Advanced Resource-Based Process Areas

A **process area** groups object types that belong to the same perspective of a
process, and stacks those groups into layers so that resources sit above the
objects they serve. `totem_lib` has two algorithms for finding that layering:

|              | `mlpaDiscovery`                            | `discover_process_areas`                    |
| ------------ | ------------------------------------------ | ------------------------------------------- |
| Module       | `totem_lib.totem.totem`                    | `totem_lib.process_areas`                   |
| Input signal | TOTeM temporal relations only              | three weighted resource indicators          |
| Ordering     | hard constraint `level[b] - level[a] >= 1` | soft penalty on the resource force          |
| Tunable      | no                                         | indicator weights, `alpha`, `beta`          |
| Reference    | Liss & van der Aalst, BPM 2026             | Schlegelmilch, BSc thesis 2026, chapter 4.1 |

Both return the same structure, so they are interchangeable at the call site.

## Quick start

```python
from totem_lib import import_ocel
from totem_lib.process_areas import discover_process_areas

ocel = import_ocel("test_data/small/container_logistics.json")
process_view = discover_process_areas(ocel)

for level in sorted(process_view):
    for object_types, event_types in process_view[level]:
        print(level, sorted(object_types), len(event_types), "activities")
```

```
0 ['Handling Unit'] 2 activities
1 ['Container'] 9 activities
2 ['Customer Order', 'Transport Document', 'Vehicle'] 3 activities
2 ['Truck'] 0 activities
3 ['Forklift'] 0 activities
```

Level `0` is the bottom. Resources receive the **higher** numbers — forklifts and
trucks end up above the containers and handling units they move.

See [`example_process_areas.py`](example_process_areas.py) for a runnable script.

### Discovering from DuckDB

`discover_process_areas_db` takes an `OcelDuckDB` instead. **This is the path the
web application uses**, and the one to prefer for anything large: every counter
is aggregated inside DuckDB, so only `O(|OT|^2)` rows ever reach Python and
DuckDB spills its own intermediates to disk. A log bigger than RAM goes through.

```python
from totem_lib.ocel import import_ocel_db
from totem_lib.process_areas import discover_process_areas_db

db = import_ocel_db("test_data/small/container_logistics.duckdb")
process_view = discover_process_areas_db(db)
```

Both paths produce identical results; `tests/process_areas/test_preparation_db.py`
asserts that on two logs.

### Re-running with different parameters

Preparation reads the log; the parameters do not touch it. Splitting the two
turns a parameter change from a full rediscovery into a solve — roughly 0.3s
down to 0.02s on `order-management`.

```python
from totem_lib.process_areas import prepare_db, process_areas_from_aggregates

aggregates = prepare_db(db)                       # once per log
flat  = process_areas_from_aggregates(aggregates, alpha=1)
steep = process_areas_from_aggregates(aggregates, alpha=8)
```

## The three resource indicators

Each indicator scores every ordered pair of object types `(a, b)` twice:

| API                      | Thesis     | Range                    | Meaning                                                                    |
| ------------------------ | ---------- | ------------------------ | -------------------------------------------------------------------------- |
| `resource_force(a, b)`   | `phi(a,b)` | `[-1, 1]`, antisymmetric | positive: `a` acts as a resource for `b`, so `a` belongs on a higher layer |
| `attractive_force(a, b)` | `psi(a,b)` | `[0, 1]`, symmetric      | high: `a` and `b` are peers and belong on the same layer                   |

**Temporal** (thesis 4.1.1) — _resources outlive the objects they serve._
`phi` is the imbalance in lifespan containment; `psi` is the share of relations
that merely hand over from one lifespan to the next.

**Cardinality** (thesis 4.1.2) — _resources serve a varying number of objects._
A forklift touches thousands of handling units; an order has a stable number of
items. `phi` is the difference in irregularity, `psi` the share of objects on
both sides that follow the dominant cardinality pattern.

**Divergence** (thesis 4.1.3) — _resources are interchangeable._ An object
diverges under another if it can be swapped out across executions of the same
activity while the other stays fixed. `phi` is the imbalance of the two
divergence ratios; `psi` combines low divergence in both directions with
object-type closeness.

### Joining them

The joined indicator (thesis Def. 4.1.11) is a weighted mean:

```
phi(a,b) = sum_i w_i * phi_i(a,b) / sum_i w_i        (likewise for psi)
```

Weights are passed as `{"temporal": 1.0, "cardinality": 1.0, "divergence": 1.0}`.
A weight of `0` drops the indicator entirely rather than multiplying it out.

## The layer assignment ILP

```
minimize  alpha * sum_{i != j} [phi(i,j)]_+ * [m_ij - (l_i - l_j)]_+
        + beta  * sum_{i <  j}  psi(i,j) * |l_i - l_j|
s.t.      1 <= l_i <= K,  l_i integer,  K = |OT|
```

- **`alpha`** weights the resource force: how hard resources are pushed above the
  types they serve. Turn it up for a taller hierarchy.
- **`beta`** weights the attractive force: how hard related types are pulled onto
  the same layer. Turn it up for a flatter one.
- `m_ij` is the required gap, `1` by default (see `margin_scale` below).

Unlike `mlpaDiscovery`, ordering here is a _penalty_, not a constraint. A cycle
of dependent relations makes MLPA's model infeasible; this one always has a
solution, and noisy relations trade off against each other rather than dictating
the outcome.

On `ocel2-p2p` the defaults `alpha = beta = 1` collapse the log onto a single
layer — the attractive force wins everywhere. `alpha = 3` recovers a three-layer
hierarchy. This is what the parameters are for; there is no single right setting
across domains.

## Parameters

| Parameter      | Default    | Range                           | Meaning                                                                |
| -------------- | ---------- | ------------------------------- | ---------------------------------------------------------------------- |
| `weights`      | `1.0` each | `w_i ∈ ℝ≥0`, at least one `> 0` | per-indicator weights; `0` drops an indicator                          |
| `alpha`        | `1.0`      | `ℝ⁺` (Def. 4.1.12)              | weight on the resource-force hinge (separation)                        |
| `beta`         | `1.0`      | `ℝ⁺` (Def. 4.1.12)              | weight on the attractive-force distance (cohesion)                     |
| `margin_scale` | `0.0`      | `≥ 0`                           | widens the required gap to `1 + margin_scale * phi`; `0` is the thesis |

Note the asymmetry: the thesis allows a weight of zero (Def. 4.1.11 takes
`w_i ∈ ℝ≥0`) but not an `alpha` or `beta` of zero. The degenerate cases show
why — `alpha = 0` leaves nothing to separate the object types and collapses the
whole log onto one layer, `beta = 0` leaves nothing holding peers together.
`assign_layers` still accepts `0` for either, because it is well defined and
useful for isolating one force while testing; the UI sliders start at `0.1`.
Both zero at once is rejected outright: the objective would be identically zero
and the "hierarchy" whatever the solver happened to pick.

## Deviations from the thesis text

The implementation is a port of the thesis's own reference implementation, which
is what produced its evaluation numbers. Where that code and the thesis text
disagree, the code wins — but the disagreements are real, and comparing our
output against the thesis without this table will look like a bug.

| #   | Deviation                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | --- |
| D1  | **The cardinality indicator uses no entropy.** Thesis Def. 4.1.6/4.1.7 define a normalised Shannon entropy over cardinality distributions. The reference builds a _bilateral signature_ per source object — its forward cardinality plus the sorted reverse cardinalities of the objects it points at — takes the most frequent signature as "constant", and derives both forces from that mode share. Same intent, different mathematics. This is the largest of the deviations. |
| D2  | **`alpha` and `beta` are swapped** between the thesis and the reference implementation. In the reference, `alpha` multiplies the attractive-force term and `beta` the resource-force term. This library exposes the **thesis** convention and maps internally.                                                                                                                                                                                                                    |
| D3  | **The temporal attractive force counts disjoint lifespans as handovers.** Thesis Def. 4.1.4 sets `psi_temp = \|partial overlaps\| / \|O2O\|`, where partial overlap requires the two lifespans to actually intersect. The reference uses TOTeM's _initiating_ relation instead, which also counts pairs whose lifespans are completely disjoint. On `container_logistics` that is 650 of the 5032 pairs in the numerator (13%); on `order-management`, 5 of 12660 (0.04%). The `phi_temp` side matches the thesis exactly — TOTeM's _dependent_ relation is precisely the lifespan containment of Def. 4.1.3. |
| D4  | `margin_scale` is a reference-implementation extension, not in the thesis: the hinge margin becomes `1 + margin_scale * phi`. Defaults to `0`, which is the thesis's margin of exactly 1.                                                                                                                                                                                                                                                                                         |
| D5  | **Objects that never appear in an event are excluded** from every population count, where the thesis's `O↓ot` is all objects of the type. Such an object has no lifespan, no activity and no O2O relation, so no indicator can score it; including it would only dilute the denominators.                                                                                                                                                                                         |
| D6  | **Ours.** The thesis puts exactly one process area per layer (Def. 4.3.2). We split each layer into connected components over the co-occurring type pairs, which is what TOTeM-Tool has always rendered.                                                                                                                                                                                                                                                                          |

Two things that look like deviations but are not:

- **Divergence matches the thesis exactly.** The reference buckets by
  `(type pair, activity, source object)` and marks `union - intersection` of the
  observed partner sets as divergent. That is Def. 4.1.8 restated: a partner in
  the union but not the intersection is one that co-occurred in some event of
  that activity and was absent from another — exactly the thesis's `o1 ∆ o2`.
  The `psi` side (Def. 4.1.10, with the closeness `delta` of Def. 4.1.9) is a
  literal transcription.
- **Compacting layer numbers** is sanctioned by the thesis, not an addition:
  Def. 4.1.13 notes that empty layers can be removed by renormalising the
  solution. The activity assignment likewise follows Def. 4.1.14 literally — an
  activity belongs to the lowest layer any of its events touches.

Three defects in the reference implementation are fixed rather than ported:
its prepared-data cache was keyed by `id(ocel)` (unsafe once ids are reused),
object types were passed as an unordered set (making the ILP's chosen optimum
vary between runs), and LP variables were named after object types (which PuLP
rewrites, so `handling unit` and `handling_unit` would collide).

## Reference

Schlegelmilch, M. _Discovering Advanced Resource-Based Process Areas_. BSc thesis,
PADS, RWTH Aachen, 2026.
