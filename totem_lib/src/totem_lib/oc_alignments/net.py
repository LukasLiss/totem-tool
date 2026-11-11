"""The de-jure model of an object-centric alignment: an accepting OCPN.

The model arrives in the repository's OCPN JSON exchange format
(``{"format": "ocpn", "version": 1, "objectTypes", "places",
"transitions", "arcs"}`` -- see ``docs/MODEL_EDITORS.md``), which is what the
OCPN miner, the OCPN editor and the ``OCPN`` model assets use.

:class:`AlignmentNet` is a read-only, index-based view of that net tailored to
the alignment search (Liss, *Object-Centric Alignments*, Def. 3.3 - 3.7):

* every place is typed (``pt``),
* a transition is labelled with an activity or silent (``tau``),
* arcs are either regular or variable (``F_var``); per transition and object
  type they are uniformly one or the other (well-formedness, Def. 3.4),
* the initial marking puts every object into each ``initial`` place of its
  type, the final marking expects it in each ``final`` place of its type.

Places without an explicit ``initial`` / ``final`` flag fall back to the
structural definition of Def. 5.1: a place without incoming arcs is initial,
a place without outgoing arcs is final -- but only for object types that do
not flag any place at all, so partially flagged models keep their intent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, FrozenSet, List, Mapping, Optional, Tuple


class AlignmentModelError(ValueError):
    """The OCPN cannot be used as the de-jure model of an alignment."""


@dataclass(frozen=True)
class NetTransition:
    """One transition of the de-jure net with its arcs grouped by object type."""

    index: int
    id: str
    #: Activity label, ``None`` for silent transitions.
    label: Optional[str]
    #: ``object type -> input place indices`` of that type.
    inputs: Mapping[str, Tuple[int, ...]]
    #: ``object type -> output place indices`` of that type.
    outputs: Mapping[str, Tuple[int, ...]]
    #: Object types connected through variable arcs.
    variable_types: FrozenSet[str]

    @property
    def silent(self) -> bool:
        return self.label is None

    @property
    def object_types(self) -> Tuple[str, ...]:
        """``tpl(t)``: every object type the transition is connected to."""
        return tuple(sorted(set(self.inputs) | set(self.outputs)))

    @property
    def regular_types(self) -> Tuple[str, ...]:
        """``tpl_nv(t)``: types bound to exactly one object per firing."""
        return tuple(t for t in self.object_types if t not in self.variable_types)


@dataclass(frozen=True)
class AlignmentNet:
    """Index-based accepting object-centric Petri net."""

    name: str
    place_ids: Tuple[str, ...]
    place_types: Tuple[str, ...]
    initial_places: Mapping[str, Tuple[int, ...]]
    final_places: Mapping[str, Tuple[int, ...]]
    transitions: Tuple[NetTransition, ...]
    object_types: Tuple[str, ...]
    #: ``activity -> transitions labelled with it``.
    transitions_by_label: Mapping[str, Tuple[int, ...]] = field(default_factory=dict)

    @property
    def activities(self) -> FrozenSet[str]:
        return frozenset(self.transitions_by_label)


def _string(value) -> Optional[str]:
    if isinstance(value, str) and value.strip():
        return value
    return None


def net_from_ocpn_dict(model: Mapping) -> AlignmentNet:
    """Build an :class:`AlignmentNet` from an OCPN JSON dict.

    Raises :class:`AlignmentModelError` for structurally unusable models
    (missing ids, arcs between two places, arcs that point nowhere, a type
    with mixed variable and regular arcs at one transition, ...).
    """
    if not isinstance(model, Mapping):
        raise AlignmentModelError("The OCPN model must be a JSON object.")
    places = model.get("places")
    transitions = model.get("transitions")
    arcs = model.get("arcs") or []
    if not isinstance(places, list) or not isinstance(transitions, list):
        raise AlignmentModelError('The OCPN model needs "places" and "transitions" lists.')
    if not isinstance(arcs, list):
        raise AlignmentModelError('"arcs" must be a list.')

    place_index: Dict[str, int] = {}
    place_ids: List[str] = []
    place_types: List[str] = []
    flagged_initial: Dict[str, List[int]] = {}
    flagged_final: Dict[str, List[int]] = {}
    for position, place in enumerate(places):
        if not isinstance(place, Mapping):
            raise AlignmentModelError(f"Place #{position + 1} must be an object.")
        pid = _string(place.get("id"))
        object_type = _string(place.get("objectType"))
        if pid is None or object_type is None:
            raise AlignmentModelError(
                f'Place #{position + 1} needs an "id" and an "objectType".'
            )
        if pid in place_index:
            raise AlignmentModelError(f'Duplicate place id "{pid}".')
        index = len(place_ids)
        place_index[pid] = index
        place_ids.append(pid)
        place_types.append(object_type)
        if place.get("initial"):
            flagged_initial.setdefault(object_type, []).append(index)
        if place.get("final"):
            flagged_final.setdefault(object_type, []).append(index)

    transition_index: Dict[str, int] = {}
    transition_raw: List[Tuple[str, Optional[str]]] = []
    for position, transition in enumerate(transitions):
        if not isinstance(transition, Mapping):
            raise AlignmentModelError(f"Transition #{position + 1} must be an object.")
        tid = _string(transition.get("id"))
        if tid is None:
            raise AlignmentModelError(f'Transition #{position + 1} needs an "id".')
        if tid in transition_index or tid in place_index:
            raise AlignmentModelError(f'Duplicate node id "{tid}".')
        label = transition.get("label")
        silent = transition.get("silent") is True or not isinstance(label, str) or label == ""
        transition_index[tid] = len(transition_raw)
        transition_raw.append((tid, None if silent else label))

    inputs: List[Dict[str, List[int]]] = [dict() for _ in transition_raw]
    outputs: List[Dict[str, List[int]]] = [dict() for _ in transition_raw]
    variability: List[Dict[str, set]] = [dict() for _ in transition_raw]
    has_incoming = [False] * len(place_ids)
    has_outgoing = [False] * len(place_ids)
    seen_arcs = set()
    for position, arc in enumerate(arcs):
        if not isinstance(arc, Mapping):
            raise AlignmentModelError(f"Arc #{position + 1} must be an object.")
        source, target = _string(arc.get("source")), _string(arc.get("target"))
        if (source, target) in seen_arcs:
            continue  # a duplicate arc adds nothing for unit-weight nets
        seen_arcs.add((source, target))
        if source in place_index and target in transition_index:
            p, t, side = place_index[source], transition_index[target], inputs
            has_outgoing[p] = True
        elif source in transition_index and target in place_index:
            p, t, side = place_index[target], transition_index[source], outputs
            has_incoming[p] = True
        else:
            raise AlignmentModelError(
                f"Arc #{position + 1} ({source} -> {target}) must connect a place and a transition."
            )
        object_type = place_types[p]
        side[t].setdefault(object_type, []).append(p)
        variability[t].setdefault(object_type, set()).add(bool(arc.get("variable")))

    net_transitions: List[NetTransition] = []
    by_label: Dict[str, List[int]] = {}
    for t, (tid, label) in enumerate(transition_raw):
        variable_types = set()
        for object_type, flags in variability[t].items():
            if len(flags) > 1:
                raise AlignmentModelError(
                    f'Transition "{label or tid}" mixes variable and regular arcs '
                    f'for object type "{object_type}" (the net is not well-formed).'
                )
            if True in flags:
                variable_types.add(object_type)
        net_transitions.append(
            NetTransition(
                index=t,
                id=tid,
                label=label,
                inputs={k: tuple(v) for k, v in inputs[t].items()},
                outputs={k: tuple(v) for k, v in outputs[t].items()},
                variable_types=frozenset(variable_types),
            )
        )
        if label is not None:
            by_label.setdefault(label, []).append(t)

    object_types = sorted(set(place_types))
    initial: Dict[str, Tuple[int, ...]] = {}
    final: Dict[str, Tuple[int, ...]] = {}
    for object_type in object_types:
        typed = [i for i, ot in enumerate(place_types) if ot == object_type]
        initial[object_type] = tuple(
            flagged_initial.get(object_type)
            or [i for i in typed if not has_incoming[i]]
        )
        final[object_type] = tuple(
            flagged_final.get(object_type)
            or [i for i in typed if not has_outgoing[i]]
        )

    name = model.get("name")
    return AlignmentNet(
        name=name if isinstance(name, str) else "",
        place_ids=tuple(place_ids),
        place_types=tuple(place_types),
        initial_places=initial,
        final_places=final,
        transitions=tuple(net_transitions),
        object_types=tuple(object_types),
        transitions_by_label={k: tuple(v) for k, v in by_label.items()},
    )
