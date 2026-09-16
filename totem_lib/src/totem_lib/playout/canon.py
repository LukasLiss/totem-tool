"""
Canonicalization of process executions into object-centric variants.

Two complete executions are the same variant iff their visible events
(activity + bound objects) form isomorphic structures: equal up to
renaming objects within an object type and up to reordering independent
events (events that share no object). The canonical key is the
lexicographically minimal serialization over
  - all type-preserving object renamings that respect per-object
    activity signatures (renamings across different signatures can never
    yield an isomorphism), and
  - the greedy-minimal linearization of the visible-event partial order.

Invisible events (silent transitions, START_/END_ pseudo activities)
do not appear in the key, but the ordering constraints they induce
between visible events are kept.
"""

import itertools
from dataclasses import dataclass
from typing import Dict, List, Sequence, Set, Tuple

from .types import PlayoutEvent, PlayoutVariant

SEP = "\x01"


def event_letter(activity: str, objects: Dict[str, List[str]]) -> str:
    """Stable letter for an event: activity plus sorted per-type object lists."""
    parts = [f"{ot}={','.join(sorted(objects[ot]))}" for ot in sorted(objects.keys())]
    return f"{activity}{SEP}{';'.join(parts)}"


# Cap on renaming candidates tried per execution during canonicalization.
PERMUTATION_CAP = 1000


@dataclass
class CanonicalExecution:
    key: str
    variant: PlayoutVariant
    # True if the permutation cap prevented full minimization.
    approximate: bool


@dataclass
class _VisibleEvent:
    activity: str
    objects: Dict[str, List[str]]
    # Indices (into the visible list) of visible events that must precede.
    ancestors: Set[int]


def canonicalize_execution(events: Sequence[PlayoutEvent]) -> CanonicalExecution:
    """
    Reduces a complete execution (all events in firing order) to its
    canonical variant key plus the canonical variant for display/export.
    """
    visible = _project_to_visible(events)

    # Per-object visible activity signature; objects that never appear in a
    # visible event do not influence the variant.
    object_type: Dict[str, str] = {}
    signature: Dict[str, List[str]] = {}
    first_use: Dict[str, int] = {}
    for i, ev in enumerate(visible):
        for ot in ev.objects.keys():
            for obj in ev.objects[ot]:
                object_type[obj] = ot
                sig = signature.get(obj)
                if sig is None:
                    sig = []
                    signature[obj] = sig
                    first_use[obj] = i
                sig.append(ev.activity)

    # Group interchangeable-candidate objects: same type and same signature.
    groups: Dict[str, List[str]] = {}
    for obj, sig in signature.items():
        group_key = f"{object_type[obj]}{SEP}{SEP.join(sig)}"
        groups.setdefault(group_key, []).append(obj)
    sorted_groups = [
        sorted(members, key=lambda obj: first_use[obj])
        for _, members in sorted(groups.items(), key=lambda entry: entry[0])
    ]

    # Canonical names are assigned per type in group order; index padding
    # keeps name comparison aligned with index order.
    type_counters: Dict[str, int] = {}
    base_names: Dict[str, str] = {}
    display_names: Dict[str, str] = {}
    for members in sorted_groups:
        for obj in members:
            ot = object_type[obj]
            idx = type_counters.get(ot, 0)
            type_counters[ot] = idx + 1
            base_names[obj] = f"{ot}{SEP}{idx:03d}"
            display_names[obj] = f"{ot}_{idx + 1}"

    # Permutations only make a difference within groups of size > 1.
    perm_groups = [g for g in sorted_groups if len(g) > 1]
    perm_count = 1
    for g in perm_groups:
        for i in range(2, len(g) + 1):
            if perm_count > PERMUTATION_CAP:
                break
            perm_count *= i
    approximate = perm_count > PERMUTATION_CAP

    best: List = [None]  # [ (key, order, rename) ]

    def try_renaming(rename: Dict[str, str]) -> None:
        key, order = _minimal_linearization(visible, rename)
        if best[0] is None or key < best[0][0]:
            best[0] = (key, order, dict(rename))

    if approximate or len(perm_groups) == 0:
        try_renaming(base_names)
    else:
        # Iterate the cross product of within-group permutations.
        perms = [list(itertools.permutations(range(len(g)))) for g in perm_groups]
        for choice in itertools.product(*perms):
            rename = dict(base_names)
            for gi, members in enumerate(perm_groups):
                perm = choice[gi]
                for pos, obj in enumerate(members):
                    rename[obj] = base_names[members[perm[pos]]]
            try_renaming(rename)

    winner_key, winner_order, winner_rename = best[0]
    # Build the canonical variant with display names in canonical order.
    base_to_display = {base: display_names[obj] for obj, base in base_names.items()}
    canonical_events: List[PlayoutEvent] = []
    for vi in winner_order:
        ev = visible[vi]
        objects: Dict[str, List[str]] = {}
        for ot in sorted(ev.objects.keys()):
            objects[ot] = [
                base_to_display[base]
                for base in sorted(winner_rename[obj] for obj in ev.objects[ot])
            ]
        canonical_events.append(PlayoutEvent(activity=ev.activity, visible=True, objects=objects))
    object_counts = {ot: type_counters[ot] for ot in sorted(type_counters.keys())}

    return CanonicalExecution(
        key=winner_key,
        variant=PlayoutVariant(events=canonical_events, object_counts=object_counts),
        approximate=approximate,
    )


def _project_to_visible(events: Sequence[PlayoutEvent]) -> List[_VisibleEvent]:
    """
    Extracts visible events and the visible-projected causality order.
    Direct dependence (shared object) between any two events induces order;
    chains through invisible events are preserved by propagating ancestor
    sets along per-object last-event links.
    """
    visible: List[_VisibleEvent] = []
    # For every event (visible or not): the set of visible indices that must
    # precede anything depending on it.
    last_event_ancestors: Dict[str, Set[int]] = {}  # per object
    for ev in events:
        ancestors: Set[int] = set()
        objs: List[str] = []
        for ot in ev.objects.keys():
            for obj in ev.objects[ot]:
                objs.append(obj)
                prev = last_event_ancestors.get(obj)
                if prev:
                    ancestors.update(prev)
        carried = ancestors
        if ev.visible:
            vi = len(visible)
            visible.append(_VisibleEvent(activity=ev.activity, objects=ev.objects, ancestors=ancestors))
            carried = set(ancestors)
            carried.add(vi)
        for obj in objs:
            last_event_ancestors[obj] = carried
    return visible


def _minimal_linearization(
    visible: List[_VisibleEvent],
    rename: Dict[str, str],
) -> Tuple[str, List[int]]:
    """
    Greedy lexicographically minimal linearization of the visible partial
    order under a given object renaming. Equal letters can never be ready at
    the same time (equal letters share objects, hence are ordered), so the
    greedy choice is unambiguous.
    """
    letters = [
        event_letter(
            ev.activity,
            {ot: [rename[obj] for obj in ev.objects[ot]] for ot in ev.objects.keys()},
        )
        for ev in visible
    ]

    emitted = [False] * len(visible)
    order: List[int] = []
    parts: List[str] = []
    for _step in range(len(visible)):
        best_idx = -1
        for i in range(len(visible)):
            if emitted[i]:
                continue
            ready = True
            for a in visible[i].ancestors:
                if not emitted[a]:
                    ready = False
                    break
            if not ready:
                continue
            if best_idx == -1 or letters[i] < letters[best_idx]:
                best_idx = i
        emitted[best_idx] = True
        order.append(best_idx)
        parts.append(letters[best_idx])
    return "\n".join(parts), order
