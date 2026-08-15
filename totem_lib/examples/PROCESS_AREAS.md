# Get Started - Advanced Resource-Based Process Areas

A **process area** groups object types that belong to the same perspective of a
process, and stacks those groups into layers so that resources sit above the
objects they serve. `totem_lib` has two algorithms for finding that layering:

| | `mlpaDiscovery` | `discover_process_areas` |
|---|---|---|
| Module | `totem_lib.totem.totem` | `totem_lib.process_areas` |
| Input signal | TOTeM temporal relations only | three weighted resource indicators |
| Ordering | hard constraint `level[b] - level[a] >= 1` | soft penalty on the resource force |
| Tunable | no | indicator weights, `alpha`, `beta` |
| Reference | Liss & van der Aalst, BPM 2025 | Schlegelmilch, BSc thesis 2026, chapter 4.1 |

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

| API | Thesis | Range | Meaning |
|---|---|---|---|
| `resource_force(a, b)` | `phi(a,b)` | `[-1, 1]`, antisymmetric | positive: `a` acts as a resource for `b`, so `a` belongs on a higher layer |
| `attractive_force(a, b)` | `psi(a,b)` | `[0, 1]`, symmetric | high: `a` and `b` are peers and belong on the same layer |

**Temporal** (thesis 4.1.1) — *resources outlive the objects they serve.*
`phi` is the imbalance in lifespan containment; `psi` is the share of relations
that merely hand over from one lifespan to the next.

**Cardinality** (thesis 4.1.2) — *resources serve a varying number of objects.*
A forklift touches thousands of handling units; an order has a stable number of
items. `phi` is the difference in irregularity, `psi` the share of objects on
both sides that follow the dominant cardinality pattern.

**Divergence** (thesis 4.1.3) — *resources are interchangeable.* An object
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

Unlike `mlpaDiscovery`, ordering here is a *penalty*, not a constraint. A cycle
of dependent relations makes MLPA's model infeasible; this one always has a
solution, and noisy relations trade off against each other rather than dictating
the outcome.

On `ocel2-p2p` the defaults `alpha = beta = 1` collapse the log onto a single
layer — the attractive force wins everywhere. `alpha = 3` recovers a three-layer
hierarchy. This is what the parameters are for; there is no single right setting
across domains.

## Parameters

| Parameter | Default | Meaning |
|---|---|---|
| `weights` | `1.0` each | per-indicator weights; at least one must be `> 0` |
| `alpha` | `1.0` | weight on the resource-force hinge (separation) |
| `beta` | `1.0` | weight on the attractive-force distance (cohesion) |
| `margin_scale` | `0.0` | widens the required gap to `1 + margin_scale * phi`; `0` is the thesis |

## Deviations from the thesis text

The implementation is a port of the thesis's own reference implementation, which
is what produced its evaluation numbers. Where that code and the thesis text
disagree, the code wins — but the disagreements are real, and comparing our
output against the thesis without this table will look like a bug.

| # | Deviation |
|---|---|
| D1 | **The cardinality indicator uses no entropy.** Thesis Def. 4.1.6/4.1.7 define a normalised Shannon entropy over cardinality distributions. The reference builds a *bilateral signature* per source object — its forward cardinality plus the sorted reverse cardinalities of the objects it points at — takes the most frequent signature as "constant", and derives both forces from that mode share. Same intent, different mathematics. |
| D2 | **`alpha` and `beta` are swapped** between the thesis and the reference implementation. In the reference, `alpha` multiplies the attractive-force term and `beta` the resource-force term. This library exposes the **thesis** convention and maps internally. |
| D3 | The temporal indicator is computed from TOTeM's `D`/`I` relation counts rather than the thesis's containment/overlap sets. Semantically aligned. |
| D4 | Divergence `phi` is computed from target-set variation per `(type pair, activity, source object)` rather than the thesis's existential swap-out. Directionally equivalent; the `psi` side matches the thesis exactly. |
| D5 | `margin_scale` is a reference-implementation extension, not in the thesis. Defaults to `0`. |
| D6 | **Ours.** The thesis puts exactly one process area per layer (Def. 4.3.2). We split each layer into connected components over the co-occurring type pairs, which is what TOTeM-Tool has always rendered. |

Three defects in the reference implementation are fixed rather than ported:
its prepared-data cache was keyed by `id(ocel)` (unsafe once ids are reused),
object types were passed as an unordered set (making the ILP's chosen optimum
vary between runs), and LP variables were named after object types (which PuLP
rewrites, so `handling unit` and `handling_unit` would collide).

## What is not implemented

Only chapter 4.1 of the thesis. Chapters 4.2 (object-centric subprocesses) and
4.3 (activity lifting, collapsed nets, quality metrics) are defined over
Petri-net **places** — a subprocess boundary *is* a pair of places. TOTeM-Tool
renders an OCDFG in the process-area detail view and OCCNs elsewhere, and
neither has places. See [`../../docs/PROCESS_AREA_SUBPROCESSES.md`](../../docs/PROCESS_AREA_SUBPROCESSES.md).

## Reference

Schlegelmilch, M. *Discovering Advanced Resource-Based Process Areas*. BSc thesis,
PADS, RWTH Aachen, 2026.
