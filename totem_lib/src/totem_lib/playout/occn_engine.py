"""
Object-centric causal net playout engine.

Follows totem_lib's OCCN semantics
(totem_lib/src/totem_lib/occn/{semantics,playout,factory}.py):

 - The state is a multiset of pending obligations (source activity,
   object, object type) stored at the activity that may consume them.
 - A binding of an activity chooses one input marker group (consumed
   obligations; markers are AND, groups are XOR, same-key markers bind
   disjoint objects) and one output marker group. Every consumed object
   is assigned to at least one successor marker of its type, respecting
   the cardinality ranges and key constraints.
 - START_<type> pseudo activities consume "fake" initial obligations
   (one per provided object) and bind any non-empty subset of the not
   yet started objects; END_<type> activities consume obligations and
   produce nothing.
 - A process execution is complete when no obligation is pending (all
   objects started and ended).

Markers with key 0 get a unique key (no sharing constraint), max -1
means unbounded — exactly like OCCausalNet.from_dict. The input
`marker_groups` dict (OCCausalNet.from_dict shape, activity ->
{img: [[(related, ot, (min, max), key), ...], ...], omg: [...]}) is
never mutated.
"""

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Set, Tuple

from .canon import event_letter
from .types import PlayoutEngine, PlayoutEvent, PlayoutStep, TooManyBindingsError
from .util import combinations

SEP = "\x01"
# Pseudo source of the initial ("fake") obligations of START activities.
INIT = "\x00init"

# Safety cap on bindings enumerated for a single state.
MAX_STEPS_PER_STATE = 100_000


def is_start_activity(act: str) -> bool:
    return act.startswith("START_")


def is_end_activity(act: str) -> bool:
    return act.startswith("END_")


def occn_object_type_of(act: str) -> str:
    return "_".join(act.split("_")[1:])


@dataclass
class _Marker:
    related: str
    ot: str
    min: float
    max: float
    key: int


@dataclass
class _MarkerGroup:
    markers: List[_Marker]
    # related -> ot -> (min, max); later duplicate markers win (parity).
    dict_rep: Dict[str, Dict[str, Tuple[float, float]]]
    # (relatedA, ot, relatedB) pairs that must bind disjoint objects.
    key_constraints: List[Tuple[str, str, str]]


# related -> ot -> object ids, the flow of one side of a binding.
_Flow = Dict[str, Dict[str, List[str]]]


def _validate_marker_groups(marker_groups: Dict[str, dict]) -> None:
    """
    Shape-checks the raw marker-groups dict before any indexing.

    Raises ValueError with a user-readable message for anything that is not
    activity -> {img/omg: [[(related, ot, (min, max), key), ...], ...]}, so
    malformed models surface as invalid input rather than as IndexError.
    """
    if not isinstance(marker_groups, dict):
        raise ValueError("The OCCN marker groups must be an object keyed by activity.")
    for act, bindings in marker_groups.items():
        if bindings is None:
            continue
        if not isinstance(bindings, dict):
            raise ValueError(f'Marker groups of activity "{act}" must be an object.')
        for side in ("img", "omg"):
            groups = bindings.get(side)
            if groups is None:
                continue
            if not isinstance(groups, (list, tuple)):
                raise ValueError(f'"{side}" of activity "{act}" must be a list of marker groups.')
            for group in groups:
                if not isinstance(group, (list, tuple)):
                    raise ValueError(f'Activity "{act}" has a malformed {side} marker group.')
                for m in group:
                    if (
                        not isinstance(m, (list, tuple))
                        or len(m) != 4
                        or not isinstance(m[0], str)
                        or not isinstance(m[1], str)
                        or not isinstance(m[2], (list, tuple))
                        or len(m[2]) != 2
                        or not all(
                            isinstance(x, (int, float)) and not isinstance(x, bool) for x in m[2]
                        )
                        or isinstance(m[3], bool)
                        or not isinstance(m[3], (int, float))
                    ):
                        raise ValueError(
                            f'Activity "{act}" has a malformed marker in a {side} group — '
                            "expected [relatedActivity, objectType, [min, max], key]."
                        )


def create_occn_engine(
    object_types: Sequence[str],
    marker_groups: Dict[str, dict],
    objects_per_type: Dict[str, int],
    activities: Optional[Sequence[str]] = None,
) -> PlayoutEngine:
    _validate_marker_groups(marker_groups)
    warnings: List[str] = []
    all_activities = sorted(set(list(activities or [])) | set(marker_groups.keys()))

    # Normalize marker groups (unique keys for key=0, infinity for max=-1).
    max_key = max(
        (
            m[3]
            for bindings in marker_groups.values()
            for group in list((bindings or {}).get("img") or []) + list((bindings or {}).get("omg") or [])
            for m in group
        ),
        default=0,
    )
    max_key = max(0, max_key)

    def normalize_group(group: Sequence[Sequence]) -> Optional[_MarkerGroup]:
        key_counter = max_key + 1
        markers: List[_Marker] = []
        for related, ot, (mn, mx), key in group:
            if key == 0:
                key = key_counter
                key_counter += 1
            markers.append(
                _Marker(related=related, ot=ot, min=mn, max=math.inf if mx == -1 else mx, key=key)
            )
        if len(markers) == 0:
            return None
        if any(m.min > m.max for m in markers):
            return None
        dict_rep: Dict[str, Dict[str, Tuple[float, float]]] = {}
        for m in markers:
            dict_rep.setdefault(m.related, {})[m.ot] = (m.min, m.max)
        by_key_ot: Dict[Tuple[int, str], List[str]] = {}
        for m in markers:
            by_key_ot.setdefault((m.key, m.ot), []).append(m.related)
        key_constraints: List[Tuple[str, str, str]] = []
        for (_key, ot), related_list in by_key_ot.items():
            for i in range(len(related_list)):
                for j in range(i + 1, len(related_list)):
                    key_constraints.append((related_list[i], ot, related_list[j]))
        return _MarkerGroup(markers=markers, dict_rep=dict_rep, key_constraints=key_constraints)

    img: Dict[str, List[_MarkerGroup]] = {}
    omg: Dict[str, List[_MarkerGroup]] = {}
    for act in all_activities:
        bindings = marker_groups.get(act) or {}
        img_raw = bindings.get("img") or []
        omg_raw = bindings.get("omg") or []
        img_groups = [g for g in (normalize_group(group) for group in img_raw) if g is not None]
        omg_groups = [g for g in (normalize_group(group) for group in omg_raw) if g is not None]
        if len(img_raw) > len(img_groups) or len(omg_raw) > len(omg_groups):
            warnings.append(f'Activity "{act}": some invalid marker groups were ignored.')
        img[act] = img_groups
        omg[act] = omg_groups
        if not is_start_activity(act) and len(img_groups) == 0:
            warnings.append(f'Activity "{act}" has no input marker groups and can never occur.')
        if not is_end_activity(act) and len(omg_groups) == 0:
            warnings.append(f'Activity "{act}" has no output marker groups and can never occur.')

    # Objects in canonical order per type (padded index keeps name order).
    objects: Dict[str, List[str]] = {}
    for ot in object_types:
        count = objects_per_type.get(ot, 0)
        objects[ot] = [f"{ot}{SEP}{i:03d}" for i in range(count)]
        if count > 0 and f"START_{ot}" not in all_activities:
            warnings.append(
                f'Object type "{ot}" has no START_{ot} activity — its objects can never take part.'
            )

    # State: consuming activity -> obligation key -> pending count.
    state: Dict[str, Dict[str, int]] = {}
    total_pending = 0
    obl_parts: Dict[str, Tuple[str, str, str]] = {}

    def obl_key(src: str, obj: str, ot: str) -> str:
        key = f"{src}{SEP}{obj}{SEP}{ot}"
        if key not in obl_parts:
            obl_parts[key] = (src, obj, ot)
        return key

    def add_obligation(act: str, key: str, delta: int) -> None:
        nonlocal total_pending
        by_key = state.get(act)
        if by_key is None:
            by_key = {}
            state[act] = by_key
        nxt = by_key.get(key, 0) + delta
        if nxt < 0:
            raise RuntimeError(f"Negative obligation count for {act}: {key}")
        if nxt == 0:
            del by_key[key]
        else:
            by_key[key] = nxt
        total_pending += delta

    for ot in object_types:
        start_act = f"START_{ot}"
        if start_act not in all_activities:
            continue
        for obj in objects[ot]:
            add_obligation(start_act, obl_key(INIT, obj, ot), 1)

    def build_obligation_index(act: str) -> Dict[str, List[str]]:
        """Pending objects per (source, ot) for one activity, objects sorted."""
        index: Dict[str, List[str]] = {}
        by_key = state.get(act)
        if by_key is None:
            return index
        sets: Dict[str, Set[str]] = {}
        for key in by_key.keys():
            src, obj, ot = obl_parts[key]
            sets.setdefault(f"{src}{SEP}{ot}", set()).add(obj)
        for k, v in sets.items():
            index[k] = sorted(v)
        return index

    def serialize_flow(flow: _Flow) -> str:
        return "|".join(
            f"{rel}("
            + ";".join(
                f"{ot}:{','.join(sorted(flow[rel][ot]))}" for ot in sorted(flow[rel].keys())
            )
            + ")"
            for rel in sorted(flow.keys())
        )

    def flow_objects_by_ot(flow: _Flow) -> Dict[str, Set[str]]:
        by_ot: Dict[str, Set[str]] = {}
        for per_ot in flow.values():
            for ot, objs in per_ot.items():
                by_ot.setdefault(ot, set()).update(objs)
        return by_ot

    def violates_key_constraints(
        flow: _Flow, constraints: List[Tuple[str, str, str]]
    ) -> bool:
        for rel_a, ot, rel_b in constraints:
            a = flow.get(rel_a, {}).get(ot)
            b = flow.get(rel_b, {}).get(ot)
            if a and b and any(o in b for o in a):
                return True
        return False

    def generate_consumed(act: str) -> List[_Flow]:
        """All possible consumed flows of `act` (port of __generate_consumed)."""
        index = build_obligation_index(act)
        results: Dict[str, _Flow] = {}
        for group in img.get(act) or []:
            entries: List[Tuple[str, str, List[List[str]]]] = []  # (rel, ot, combos)
            group_fails = False
            for rel, by_ot in group.dict_rep.items():
                for ot, (mn, mx) in by_ot.items():
                    available = index.get(f"{rel}{SEP}{ot}", [])
                    if len(available) < mn:
                        group_fails = True
                        break
                    if len(available) == 0:
                        continue  # optional marker, nothing there
                    combos: List[List[str]] = []
                    upper = min(mx, len(available))
                    r = int(mn)
                    while r <= upper:
                        combos.extend(combinations(available, r))
                        r += 1
                    entries.append((rel, ot, combos))
                if group_fails:
                    break
            if group_fails or len(entries) == 0:
                continue

            # Cross product over all markers of the group.
            choice = [0] * len(entries)
            cross_size = 1
            for _, _, combos in entries:
                cross_size *= len(combos)
            if cross_size > MAX_STEPS_PER_STATE:
                raise TooManyBindingsError()
            while True:
                flow: _Flow = {}
                for i in range(len(entries)):
                    rel, ot, combos = entries[i]
                    objs = combos[choice[i]]
                    if len(objs) == 0:
                        continue
                    flow.setdefault(rel, {})[ot] = objs
                if len(flow) > 0 and not violates_key_constraints(flow, group.key_constraints):
                    key = serialize_flow(flow)
                    if key not in results:
                        results[key] = flow
                i = 0
                while i < len(entries):
                    choice[i] += 1
                    if choice[i] == len(entries[i][2]):
                        choice[i] = 0
                        i += 1
                    else:
                        break
                if i == len(entries):
                    break
        return list(results.values())

    def generate_produced(act: str, consumed_by_ot: Dict[str, Set[str]]) -> List[_Flow]:
        """
        All produced flows for the given consumed objects (port of
        __generate_produced_for_omg / __generate_successor_assignments):
        every consumed object is assigned to >= 1 successor marker of its
        type; cardinality ranges and same-key disjointness are respected.
        """
        results: Dict[str, _Flow] = {}
        for group in omg.get(act) or []:
            reqs_by_ot: Dict[str, List[Tuple[str, float, float]]] = {}  # (succ, min, max)
            for succ, by_ot in group.dict_rep.items():
                for ot, (mn, mx) in by_ot.items():
                    reqs_by_ot.setdefault(ot, []).append((succ, mn, mx))
            key_pairs_by_ot: Dict[str, Set[str]] = {}
            for s1, ot, s2 in group.key_constraints:
                key_pairs_by_ot.setdefault(ot, set()).add(SEP.join(sorted([s1, s2])))

            # Every consumed type needs a marker; unconsumed types must be optional.
            ok = True
            for ot in consumed_by_ot.keys():
                if ot not in reqs_by_ot:
                    ok = False
                    break
            if not ok:
                continue
            for ot, reqs in reqs_by_ot.items():
                if ot not in consumed_by_ot and any(mn > 0 for _, mn, _ in reqs):
                    ok = False
                    break
            if not ok:
                continue

            # Valid successor assignments per object type.
            ots_in_order: List[str] = []
            assignments_in_order: List[List[Dict[str, List[str]]]] = []
            group_fails = False
            for ot, obj_set in consumed_by_ot.items():
                reqs = reqs_by_ot[ot]
                succs = [succ for succ, _, _ in reqs]
                key_pairs = key_pairs_by_ot.get(ot, set())
                objs = sorted(obj_set)

                per_object_choices: List[List[List[str]]] = []
                for _obj in objs:
                    choices: List[List[str]] = []
                    for size in range(1, len(succs) + 1):
                        for subset in combinations(succs, size):
                            valid = True
                            for i in range(len(subset)):
                                for j in range(i + 1, len(subset)):
                                    if SEP.join(sorted([subset[i], subset[j]])) in key_pairs:
                                        valid = False
                                        break
                                if not valid:
                                    break
                            if valid:
                                choices.append(subset)
                    if len(choices) == 0:
                        group_fails = True
                        break
                    per_object_choices.append(choices)
                if group_fails:
                    break

                cross_size = 1
                for c in per_object_choices:
                    cross_size *= len(c)
                if cross_size > MAX_STEPS_PER_STATE:
                    raise TooManyBindingsError()

                valid_assignments: List[Dict[str, List[str]]] = []
                choice = [0] * len(objs)
                while True:
                    assignment: Dict[str, List[str]] = {}
                    for i in range(len(objs)):
                        for succ in per_object_choices[i][choice[i]]:
                            assignment.setdefault(succ, []).append(objs[i])
                    counts_ok = True
                    for succ, mn, mx in reqs:
                        count = len(assignment.get(succ, []))
                        if count < mn or count > mx:
                            counts_ok = False
                            break
                    if counts_ok:
                        valid_assignments.append(assignment)
                    i = 0
                    while i < len(objs):
                        choice[i] += 1
                        if choice[i] == len(per_object_choices[i]):
                            choice[i] = 0
                            i += 1
                        else:
                            break
                    if i == len(objs):
                        break
                if len(valid_assignments) == 0:
                    group_fails = True
                    break
                ots_in_order.append(ot)
                assignments_in_order.append(valid_assignments)
            if group_fails or len(ots_in_order) == 0:
                continue

            # Cross product over object types.
            cross_size = 1
            for a in assignments_in_order:
                cross_size *= len(a)
            if cross_size > MAX_STEPS_PER_STATE:
                raise TooManyBindingsError()
            choice = [0] * len(ots_in_order)
            while True:
                flow: _Flow = {}
                for i in range(len(ots_in_order)):
                    ot = ots_in_order[i]
                    for succ, objs in assignments_in_order[i][choice[i]].items():
                        if len(objs) == 0:
                            continue
                        flow.setdefault(succ, {})[ot] = objs
                if len(flow) > 0:
                    key = serialize_flow(flow)
                    if key not in results:
                        results[key] = flow
                i = 0
                while i < len(ots_in_order):
                    choice[i] += 1
                    if choice[i] == len(assignments_in_order[i]):
                        choice[i] = 0
                        i += 1
                    else:
                        break
                if i == len(ots_in_order):
                    break
        return list(results.values())

    def make_step(act: str, consumed: Optional[_Flow], produced: Optional[_Flow]) -> PlayoutStep:
        # Event objects: consumed objects (or the started objects for START).
        source = consumed if consumed is not None else produced
        by_ot = flow_objects_by_ot(source) if source is not None else {}
        event_objects: Dict[str, List[str]] = {}
        object_ids: List[str] = []
        for ot, obj_set in by_ot.items():
            objs = sorted(obj_set)
            event_objects[ot] = objs
            object_ids.extend(objs)

        def apply():
            if consumed is not None:
                for src, per_ot in consumed.items():
                    for ot, objs in per_ot.items():
                        for obj in objs:
                            add_obligation(act, obl_key(src, obj, ot), -1)
            if produced is not None:
                for succ, per_ot in produced.items():
                    for ot, objs in per_ot.items():
                        for obj in objs:
                            add_obligation(succ, obl_key(act, obj, ot), 1)

            def undo():
                if produced is not None:
                    for succ, per_ot in produced.items():
                        for ot, objs in per_ot.items():
                            for obj in objs:
                                add_obligation(succ, obl_key(act, obj, ot), -1)
                if consumed is not None:
                    for src, per_ot in consumed.items():
                        for ot, objs in per_ot.items():
                            for obj in objs:
                                add_obligation(act, obl_key(src, obj, ot), 1)

            return undo

        return PlayoutStep(
            letter=event_letter(act, event_objects),
            object_ids=object_ids,
            budget_key=act,
            event=PlayoutEvent(
                activity=act,
                visible=not is_start_activity(act) and not is_end_activity(act),
                objects=event_objects,
            ),
            apply=apply,
        )

    def enabled_steps(used_objects: Set[str], raw: bool) -> List[PlayoutStep]:
        steps: List[PlayoutStep] = []
        for act in all_activities:
            if is_start_activity(act):
                # Objects with pending fake obligations have not fired any event
                # yet (their START is always their first event), so they are all
                # fresh — `used_objects` can never contain them.
                ot = occn_object_type_of(act)
                pending = build_obligation_index(act).get(f"{INIT}{SEP}{ot}", [])
                if len(pending) == 0:
                    continue
                selections: List[List[str]] = []
                if raw:
                    for k in range(1, len(pending) + 1):
                        selections.extend(combinations(pending, k))
                else:
                    # Fresh-object symmetry: unstarted objects are interchangeable —
                    # only the first k of them need to be considered.
                    for k in range(1, len(pending) + 1):
                        selections.append(pending[:k])
                for sel in selections:
                    consumed_by_ot = {ot: set(sel)}
                    for produced in generate_produced(act, consumed_by_ot):
                        fake_consumed: _Flow = {INIT: {ot: sel}}
                        steps.append(make_step(act, fake_consumed, produced))
                        if len(steps) > MAX_STEPS_PER_STATE:
                            raise TooManyBindingsError()
            elif is_end_activity(act):
                for consumed in generate_consumed(act):
                    steps.append(make_step(act, consumed, None))
                    if len(steps) > MAX_STEPS_PER_STATE:
                        raise TooManyBindingsError()
            else:
                for consumed in generate_consumed(act):
                    consumed_by_ot = dict(flow_objects_by_ot(consumed))
                    for produced in generate_produced(act, consumed_by_ot):
                        steps.append(make_step(act, consumed, produced))
                        if len(steps) > MAX_STEPS_PER_STATE:
                            raise TooManyBindingsError()
        return steps

    def state_key() -> str:
        parts: List[str] = []
        for act in sorted(state.keys()):
            by_key = state[act]
            if len(by_key) == 0:
                continue
            obls = ",".join(f"{k}*{c}" for k, c in sorted(by_key.items()))
            parts.append(f"{act}{{{obls}}}")
        return "\n".join(parts)

    return PlayoutEngine(
        objects=objects,
        warnings=warnings,
        enabled_steps=enabled_steps,
        is_complete=lambda: total_pending == 0,
        state_key=state_key,
        budget_keys=list(all_activities),
    )
