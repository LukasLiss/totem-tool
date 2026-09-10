"""
Object-centric Petri net playout engine.

Token-game semantics following van der Aalst & Berti, "Discovering
Object-Centric Petri Nets" (the formalism the OCPN editor implements):

 - Every place is typed; the marking assigns each place a multiset of
   objects of its type.
 - A transition fires under a binding that selects, per involved object
   type, exactly one object (non-variable arcs) or a non-empty set of
   objects (variable arcs). Each selected object must have a token in
   every input place of its type; firing consumes those tokens and adds
   one token per output place of the type.
 - The initial marking puts every object into each `initial` place of
   its type; an execution is complete when no token remains outside a
   `final` place.
 - Silent transitions (label null / silent flag) fire like any other
   transition but do not contribute visible events; their occurrence
   budget is keyed by `τ:<transition id>`.

The model is the editor's OcpnModelFile JSON dict: `{name, objectTypes:
[{name, color?}], places: [{id, objectType, initial?, final?}],
transitions: [{id, label?, silent?}], arcs: [{source, target, variable?}]}`.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Set

from .canon import event_letter
from .types import PlayoutEngine, PlayoutEvent, PlayoutStep, TooManyBindingsError
from .util import non_empty_subsets

SEP = "\x01"

# Safety cap on bindings enumerated for a single state.
MAX_STEPS_PER_STATE = 100_000


def ocpn_budget_key(transition: dict) -> str:
    """Budget/limit key of a transition: its activity label, or a τ key."""
    label = transition.get("label")
    silent = bool(transition.get("silent")) or label is None or label == ""
    return f"τ:{transition['id']}" if silent else label


def is_ocpn_silent(transition: dict) -> bool:
    label = transition.get("label")
    return transition.get("silent") is True or label is None or label == ""


@dataclass
class _ArcGroup:
    places: List[str] = field(default_factory=list)
    variable: bool = False


@dataclass
class _TransitionInfo:
    id: str
    budget_key: str
    visible: bool
    # Input/output place ids and variability per object type.
    inputs: Dict[str, _ArcGroup] = field(default_factory=dict)
    outputs: Dict[str, _ArcGroup] = field(default_factory=dict)
    # Never enabled (no inputs, or an output type without input type).
    disabled: bool = False


def create_ocpn_engine(model: dict, objects_per_type: Dict[str, int]) -> PlayoutEngine:
    warnings: List[str] = []

    place_type: Dict[str, str] = {}
    final_places: Set[str] = set()
    for place in model["places"]:
        place_type[place["id"]] = place["objectType"]
        if place.get("final"):
            final_places.add(place["id"])

    transitions = [
        _TransitionInfo(
            id=t["id"],
            budget_key=ocpn_budget_key(t),
            visible=not is_ocpn_silent(t),
        )
        for t in model["transitions"]
    ]
    transition_by_id = {t.id: t for t in transitions}

    for arc in model["arcs"]:
        place_as_source = arc["source"] in place_type
        transition = transition_by_id.get(arc["target"] if place_as_source else arc["source"])
        place_id = arc["source"] if place_as_source else arc["target"]
        ot = place_type.get(place_id)
        if transition is None or ot is None:
            continue  # malformed arc — parser reports it
        side = transition.inputs if place_as_source else transition.outputs
        group = side.get(ot)
        if group is None:
            group = _ArcGroup()
            side[ot] = group
        group.places.append(place_id)
        if arc.get("variable"):
            group.variable = True
    # Well-formedness: per (transition, type) arcs are uniformly variable.
    for t in transitions:
        for ot in set(t.inputs.keys()) | set(t.outputs.keys()):
            variable = (ot in t.inputs and t.inputs[ot].variable) or (
                ot in t.outputs and t.outputs[ot].variable
            )
            if ot in t.inputs:
                t.inputs[ot].variable = variable
            if ot in t.outputs:
                t.outputs[ot].variable = variable

    def transition_name(t: _TransitionInfo) -> str:
        return f'"{t.budget_key}"'

    for t in transitions:
        if len(t.inputs) == 0:
            t.disabled = True
            warnings.append(
                f"Transition {transition_name(t)} has no input places and can never fire during playout."
            )
            continue
        for ot in t.outputs.keys():
            if ot not in t.inputs:
                t.disabled = True
                warnings.append(
                    f'Transition {transition_name(t)} produces "{ot}" tokens without consuming any '
                    "— it can never fire during playout (objects cannot be created)."
                )
        for ot in t.inputs.keys():
            if ot not in t.outputs:
                warnings.append(
                    f'Transition {transition_name(t)} consumes "{ot}" tokens without producing any '
                    "— those objects disappear and cannot reach a final place."
                )

    # Objects in canonical order per type, marking = tokens per place.
    objects: Dict[str, List[str]] = {}
    marking: Dict[str, Dict[str, int]] = {}
    tokens_outside_final = 0

    def add_token(place_id: str, obj: str, delta: int) -> None:
        nonlocal tokens_outside_final
        by_obj = marking.get(place_id)
        if by_obj is None:
            by_obj = {}
            marking[place_id] = by_obj
        nxt = by_obj.get(obj, 0) + delta
        if nxt < 0:
            raise RuntimeError(f"Negative token count in place {place_id}")
        if nxt == 0:
            del by_obj[obj]
        else:
            by_obj[obj] = nxt
        if place_id not in final_places:
            tokens_outside_final += delta

    for type_def in model["objectTypes"]:
        ot = type_def["name"]
        count = objects_per_type.get(ot, 0)
        objects[ot] = [f"{ot}{SEP}{i:03d}" for i in range(count)]
        if count == 0:
            continue
        initial_places = [p for p in model["places"] if p["objectType"] == ot and p.get("initial")]
        if len(initial_places) == 0:
            warnings.append(
                f'Object type "{ot}" has no initial place — its objects can never take part.'
            )
            continue
        if not any(p["objectType"] == ot and p.get("final") for p in model["places"]):
            warnings.append(
                f'Object type "{ot}" has no final place — process executions can never complete.'
            )
        for place in initial_places:
            for obj in objects[ot]:
                add_token(place["id"], obj, 1)

    def eligible_objects(places: List[str]) -> List[str]:
        """Objects of the given type with a token in every listed place."""
        first = marking.get(places[0])
        if not first:
            return []
        result: List[str] = []
        for obj in first.keys():
            everywhere = True
            for i in range(1, len(places)):
                by_obj = marking.get(places[i])
                if by_obj is None or obj not in by_obj:
                    everywhere = False
                    break
            if everywhere:
                result.append(obj)
        return sorted(result)

    def make_step(
        t: _TransitionInfo, event_objects: Dict[str, List[str]], object_ids: List[str]
    ) -> PlayoutStep:
        def apply():
            for ot, objs in event_objects.items():
                for obj in objs:
                    for place in t.inputs[ot].places:
                        add_token(place, obj, -1)
                    if ot in t.outputs:
                        for place in t.outputs[ot].places:
                            add_token(place, obj, 1)

            def undo():
                for ot, objs in event_objects.items():
                    for obj in objs:
                        if ot in t.outputs:
                            for place in t.outputs[ot].places:
                                add_token(place, obj, -1)
                        for place in t.inputs[ot].places:
                            add_token(place, obj, 1)

            return undo

        return PlayoutStep(
            letter=event_letter(t.budget_key, event_objects),
            object_ids=object_ids,
            budget_key=t.budget_key,
            event=PlayoutEvent(activity=t.budget_key, visible=t.visible, objects=event_objects),
            apply=apply,
        )

    def enabled_steps(used_objects: Set[str], raw: bool) -> List[PlayoutStep]:
        steps: List[PlayoutStep] = []
        for t in transitions:
            if t.disabled:
                continue

            # Candidate object selections per input type.
            types: List[str] = []
            selections_per_type: List[List[List[str]]] = []
            no_binding = False
            for ot, group in t.inputs.items():
                eligible = eligible_objects(group.places)
                if len(eligible) == 0:
                    no_binding = True
                    break
                if raw:
                    selections = (
                        non_empty_subsets(eligible)
                        if group.variable
                        else [[obj] for obj in eligible]
                    )
                else:
                    # Fresh-object symmetry: objects that took part in no step yet
                    # are mutually interchangeable, so only the first k of them are
                    # considered. All fresh objects of a type are eligible for the
                    # same transitions (identical token distribution).
                    used = [obj for obj in eligible if obj in used_objects]
                    fresh = [obj for obj in eligible if obj not in used_objects]
                    if group.variable:
                        selections = []
                        used_subsets: List[List[str]] = [[]] + non_empty_subsets(used)
                        for subset in used_subsets:
                            for k in range(len(fresh) + 1):
                                if len(subset) + k == 0:
                                    continue
                                selections.append(subset + fresh[:k])
                    else:
                        selections = [[obj] for obj in used]
                        if len(fresh) > 0:
                            selections.append([fresh[0]])
                if len(selections) == 0:
                    no_binding = True
                    break
                types.append(ot)
                selections_per_type.append(selections)
            if no_binding:
                continue

            # Cross product over input types.
            cross_size = 1
            for s in selections_per_type:
                cross_size *= len(s)
            if cross_size > MAX_STEPS_PER_STATE or len(steps) + cross_size > MAX_STEPS_PER_STATE:
                raise TooManyBindingsError()
            choice = [0] * len(types)
            while True:
                event_objects: Dict[str, List[str]] = {}
                object_ids: List[str] = []
                for i in range(len(types)):
                    sel = sorted(selections_per_type[i][choice[i]])
                    event_objects[types[i]] = sel
                    object_ids.extend(sel)
                steps.append(make_step(t, event_objects, object_ids))
                i = 0
                while i < len(types):
                    choice[i] += 1
                    if choice[i] == len(selections_per_type[i]):
                        choice[i] = 0
                        i += 1
                    else:
                        break
                if i == len(types):
                    break
        return steps

    def state_key() -> str:
        parts: List[str] = []
        for place_id in sorted(marking.keys()):
            by_obj = marking[place_id]
            if len(by_obj) == 0:
                continue
            tokens = ",".join(f"{obj}*{c}" for obj, c in sorted(by_obj.items()))
            parts.append(f"{place_id}{{{tokens}}}")
        return "\n".join(parts)

    return PlayoutEngine(
        objects=objects,
        warnings=warnings,
        enabled_steps=enabled_steps,
        is_complete=lambda: tokens_outside_final == 0,
        state_key=state_key,
        budget_keys=list(dict.fromkeys(t.budget_key for t in transitions)),
    )
