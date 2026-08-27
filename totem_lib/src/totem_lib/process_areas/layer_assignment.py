"""
Layer assignment ILP of thesis Def. 4.1.12.

Given the joined forces over object types, find an integer layer per type that

* pushes a resource at least one layer above every type it serves, in proportion
  to how strongly the resource force says so, and
* keeps mutually attracted types close together.

::

    minimize  alpha * sum_{i != j} [phi(i,j)]_+ * [m_ij - (l_i - l_j)]_+
            + beta  * sum_{i <  j}  psi(i,j) * |l_i - l_j|
    s.t.      1 <= l_i <= K,  l_i integer,  K = |OT|

Both penalty terms are linearised the usual way: the hinge becomes a
non-negative variable bounded below by its argument, the absolute difference a
non-negative variable bounded below by both signed differences. Since the
objective minimises them and their coefficients are non-negative, both are tight
at the optimum.

Contrast with ``mlpaDiscovery``, which encodes the ordering as a *hard*
constraint ``level[t2] - level[t1] >= 1``: there, a cycle of dependent relations
makes the problem infeasible. Here ordering is a penalty, so the model always
has a solution and noisy relations trade off against each other instead of
dictating the outcome.
"""

from typing import Dict, Mapping, Sequence, Tuple

from pulp import (
    PULP_CBC_CMD,
    LpInteger,
    LpMinimize,
    LpProblem,
    LpStatus,
    LpVariable,
    lpSum,
    value,
)

TypePair = Tuple[str, str]

#: Layer given to object types the ILP has nothing to say about.
BOTTOM_LAYER = 1


def assign_layers(
    object_types: Sequence[str],
    resource_forces: Mapping[TypePair, float],
    attractive_forces: Mapping[TypePair, float],
    alpha: float = 1.0,
    beta: float = 1.0,
    margin_scale: float = 0.0,
) -> Dict[str, int]:
    """
    Solve the layer-assignment ILP.

    :param object_types: object types in a **stable, deterministic order**.
        CBC may return any one of several equally optimal solutions, and which
        one it returns depends on the order the variables were created in.
        Passing an unordered collection here makes discovery irreproducible and
        breaks result caching, so the order is treated as part of the input.
    :param resource_forces: ``phi`` per ordered type pair. Only positive values
        contribute; negative ones are covered by the mirrored pair.
    :param attractive_forces: ``psi`` per ordered type pair.
    :param alpha: weight on the resource-force hinge — how hard resources are
        pushed above the types they serve. **Thesis convention.**
    :param beta: weight on the attractive-force distance — how hard related
        types are pulled onto the same layer. **Thesis convention.**

        Def. 4.1.12 takes both from ``ℝ⁺``, strictly positive. Zero is accepted
        here because it is well defined — it drops that half of the objective —
        and is useful for isolating one force while testing. It is not a
        hierarchy though: ``alpha = 0`` collapses every object type onto one
        layer, so the UI sliders start at ``0.1`` instead.
    :param margin_scale: extension of the reference implementation, not present
        in the thesis: the hinge margin becomes ``1 + margin_scale * phi``, so a
        stronger resource force demands a wider gap. ``0`` reproduces the
        thesis's margin of exactly ``1``.
    :return: object type to layer, with layer ``1`` at the bottom. Resources
        receive the *higher* numbers. Object types that carry no force at all --
        typically because they never share an event with anything -- are placed
        on :data:`BOTTOM_LAYER`.

    .. note::
        The reference implementation names these weights the other way round —
        its ``alpha`` multiplies the attractive-force term and its ``beta`` the
        resource-force term. This function follows the thesis (deviation D2).
    """
    if alpha < 0 or beta < 0:
        raise ValueError("alpha and beta must be >= 0")
    if alpha == 0 and beta == 0:
        # The objective would be identically zero and every feasible assignment
        # equally optimal, so the "hierarchy" returned would be an artefact of
        # the solver rather than a property of the log.
        raise ValueError("at least one of alpha and beta must be greater than zero")
    if margin_scale < 0:
        raise ValueError("margin_scale must be >= 0")

    types = list(object_types)
    if not types:
        return {}

    num_types = len(types)
    problem = LpProblem("process_area_layer_assignment", LpMinimize)

    # Variables are named by index rather than by object type: type names may
    # contain spaces or punctuation, which PuLP silently rewrites, and two types
    # differing only in such a character would then collide on one variable.
    index_of = {object_type: index for index, object_type in enumerate(types)}
    layer = {
        object_type: LpVariable(
            name=f"layer_{index_of[object_type]}",
            lowBound=1,
            upBound=num_types,
            cat=LpInteger,
        )
        for object_type in types
    }

    # Attractive force: |l_i - l_j|, one variable per unordered pair.
    # A term weighted zero cannot change the optimum, so a zero alpha or beta
    # skips building that half of the model rather than handing CBC variables it
    # will price at nothing.
    distance: Dict[TypePair, LpVariable] = {}
    if beta > 0:
        for position, type_i in enumerate(types):
            for type_j in types[position + 1 :]:
                weight = attractive_forces.get((type_i, type_j), 0.0)
                if weight <= 0:
                    continue
                var = LpVariable(
                    name=f"distance_{index_of[type_i]}_{index_of[type_j]}", lowBound=0
                )
                distance[(type_i, type_j)] = var
                problem += var >= layer[type_i] - layer[type_j]
                problem += var >= layer[type_j] - layer[type_i]

    # Resource force: [m_ij - (l_i - l_j)]_+, one variable per ordered pair.
    hinge: Dict[TypePair, LpVariable] = {}
    if alpha > 0:
        for type_i in types:
            for type_j in types:
                if type_i == type_j:
                    continue
                force = max(0.0, resource_forces.get((type_i, type_j), 0.0))
                if force <= 0:
                    continue
                margin = 1.0 + margin_scale * force
                var = LpVariable(
                    name=f"hinge_{index_of[type_i]}_{index_of[type_j]}", lowBound=0
                )
                hinge[(type_i, type_j)] = var
                problem += var >= margin - layer[type_i] + layer[type_j]

    problem += alpha * lpSum(
        max(0.0, resource_forces[pair]) * var for pair, var in hinge.items()
    ) + beta * lpSum(attractive_forces[pair] * var for pair, var in distance.items())

    status = problem.solve(PULP_CBC_CMD(msg=0))
    if LpStatus[status] != "Optimal":
        raise RuntimeError(f"layer assignment did not solve to optimality: {LpStatus[status]}")

    # An object type with no force at all appears in no constraint and no
    # objective term. CBC drops such a variable from the model entirely and
    # PuLP reports its value as None, so it is pinned to the bottom layer here
    # rather than crashing the caller.
    layers = {}
    for object_type in types:
        solved = value(layer[object_type])
        layers[object_type] = BOTTOM_LAYER if solved is None else int(round(solved))
    return layers
