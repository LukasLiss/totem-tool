/**
 * Canonicalization of process executions into object-centric variants.
 *
 * Two complete executions are the same variant iff their visible events
 * (activity + bound objects) form isomorphic structures: equal up to
 * renaming objects within an object type and up to reordering independent
 * events (events that share no object). The canonical key is the
 * lexicographically minimal serialization over
 *   - all type-preserving object renamings that respect per-object
 *     activity signatures (renamings across different signatures can never
 *     yield an isomorphism), and
 *   - the greedy-minimal linearization of the visible-event partial order.
 *
 * Invisible events (silent transitions, START_/END_ pseudo activities)
 * do not appear in the key, but the ordering constraints they induce
 * between visible events are kept.
 */

import type { PlayoutEvent, PlayoutVariant } from './types';

const SEP = '\u0001';

/** Stable letter for an event: activity plus sorted per-type object lists. */
export function eventLetter(activity: string, objects: Record<string, string[]>): string {
  const parts = Object.keys(objects)
    .sort()
    .map((ot) => `${ot}=${[...objects[ot]].sort().join(',')}`);
  return `${activity}${SEP}${parts.join(';')}`;
}

/** Cap on renaming candidates tried per execution during canonicalization. */
export const PERMUTATION_CAP = 1000;

export type CanonicalExecution = {
  key: string;
  variant: PlayoutVariant;
  /** True if the permutation cap prevented full minimization. */
  approximate: boolean;
};

type VisibleEvent = {
  activity: string;
  objects: Record<string, string[]>;
  /** Indices (into the visible list) of visible events that must precede. */
  ancestors: Set<number>;
};

/**
 * Reduces a complete execution (all events in firing order) to its
 * canonical variant key plus the canonical variant for display/export.
 */
export function canonicalizeExecution(events: readonly PlayoutEvent[]): CanonicalExecution {
  const visible = projectToVisible(events);

  // Per-object visible activity signature; objects that never appear in a
  // visible event do not influence the variant.
  const objectType = new Map<string, string>();
  const signature = new Map<string, string[]>();
  const firstUse = new Map<string, number>();
  visible.forEach((ev, i) => {
    for (const ot of Object.keys(ev.objects)) {
      for (const obj of ev.objects[ot]) {
        objectType.set(obj, ot);
        let sig = signature.get(obj);
        if (!sig) {
          sig = [];
          signature.set(obj, sig);
          firstUse.set(obj, i);
        }
        sig.push(ev.activity);
      }
    }
  });

  // Group interchangeable-candidate objects: same type and same signature.
  const groups = new Map<string, string[]>();
  for (const [obj, sig] of signature) {
    const groupKey = `${objectType.get(obj)}${SEP}${sig.join(SEP)}`;
    let members = groups.get(groupKey);
    if (!members) {
      members = [];
      groups.set(groupKey, members);
    }
    members.push(obj);
  }
  const sortedGroups = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, members]) => members.sort((a, b) => firstUse.get(a)! - firstUse.get(b)!));

  // Canonical names are assigned per type in group order; index padding
  // keeps name comparison aligned with index order.
  const typeCounters = new Map<string, number>();
  const baseNames = new Map<string, string>();
  const displayNames = new Map<string, string>();
  for (const members of sortedGroups) {
    for (const obj of members) {
      const ot = objectType.get(obj)!;
      const idx = typeCounters.get(ot) ?? 0;
      typeCounters.set(ot, idx + 1);
      baseNames.set(obj, `${ot}${SEP}${String(idx).padStart(3, '0')}`);
      displayNames.set(obj, `${ot}_${idx + 1}`);
    }
  }

  // Permutations only make a difference within groups of size > 1.
  const permGroups = sortedGroups.filter((g) => g.length > 1);
  let permCount = 1;
  for (const g of permGroups) {
    for (let i = 2; i <= g.length && permCount <= PERMUTATION_CAP; i++) permCount *= i;
  }
  const approximate = permCount > PERMUTATION_CAP;

  let best: { key: string; order: number[]; rename: Map<string, string> } | null = null;

  const tryRenaming = (rename: Map<string, string>) => {
    const { key, order } = minimalLinearization(visible, rename);
    if (best === null || key < best.key) best = { key, order, rename: new Map(rename) };
  };

  if (approximate || permGroups.length === 0) {
    tryRenaming(baseNames);
  } else {
    // Iterate the cross product of within-group permutations.
    const perms = permGroups.map((g) => allPermutations(g.length));
    const choice = new Array<number>(permGroups.length).fill(0);
    for (;;) {
      const rename = new Map(baseNames);
      permGroups.forEach((members, gi) => {
        const perm = perms[gi][choice[gi]];
        members.forEach((obj, pos) => {
          rename.set(obj, baseNames.get(members[perm[pos]])!);
        });
      });
      tryRenaming(rename);
      let gi = 0;
      while (gi < permGroups.length && ++choice[gi] === perms[gi].length) choice[gi++] = 0;
      if (gi === permGroups.length) break;
    }
  }

  const winner = best!;
  // Build the canonical variant with display names in canonical order.
  const baseToDisplay = new Map<string, string>();
  for (const [obj, base] of baseNames) baseToDisplay.set(base, displayNames.get(obj)!);
  const canonicalEvents: PlayoutEvent[] = winner.order.map((vi) => {
    const ev = visible[vi];
    const objects: Record<string, string[]> = {};
    for (const ot of Object.keys(ev.objects).sort()) {
      objects[ot] = ev.objects[ot]
        .map((obj) => winner.rename.get(obj)!)
        .sort()
        .map((base) => baseToDisplay.get(base)!);
    }
    return { activity: ev.activity, visible: true, objects };
  });
  const objectCounts: Record<string, number> = {};
  for (const ot of [...typeCounters.keys()].sort()) objectCounts[ot] = typeCounters.get(ot)!;

  return {
    key: winner.key,
    variant: { events: canonicalEvents, objectCounts },
    approximate,
  };
}

/**
 * Extracts visible events and the visible-projected causality order.
 * Direct dependence (shared object) between any two events induces order;
 * chains through invisible events are preserved by propagating ancestor
 * sets along per-object last-event links.
 */
function projectToVisible(events: readonly PlayoutEvent[]): VisibleEvent[] {
  const visible: VisibleEvent[] = [];
  // For every event (visible or not): the set of visible indices that must
  // precede anything depending on it.
  const lastEventAncestors = new Map<string, Set<number>>(); // per object
  for (const ev of events) {
    const ancestors = new Set<number>();
    const objs: string[] = [];
    for (const ot of Object.keys(ev.objects)) {
      for (const obj of ev.objects[ot]) {
        objs.push(obj);
        const prev = lastEventAncestors.get(obj);
        if (prev) for (const a of prev) ancestors.add(a);
      }
    }
    let carried = ancestors;
    if (ev.visible) {
      const vi = visible.length;
      visible.push({ activity: ev.activity, objects: ev.objects, ancestors });
      carried = new Set(ancestors);
      carried.add(vi);
    }
    for (const obj of objs) lastEventAncestors.set(obj, carried);
  }
  return visible;
}

/**
 * Greedy lexicographically minimal linearization of the visible partial
 * order under a given object renaming. Equal letters can never be ready at
 * the same time (equal letters share objects, hence are ordered), so the
 * greedy choice is unambiguous.
 */
function minimalLinearization(
  visible: VisibleEvent[],
  rename: Map<string, string>,
): { key: string; order: number[] } {
  const letters = visible.map((ev) => {
    const renamed: Record<string, string[]> = {};
    for (const ot of Object.keys(ev.objects)) {
      renamed[ot] = ev.objects[ot].map((obj) => rename.get(obj)!);
    }
    return eventLetter(ev.activity, renamed);
  });

  const emitted = new Array<boolean>(visible.length).fill(false);
  const order: number[] = [];
  const parts: string[] = [];
  for (let step = 0; step < visible.length; step++) {
    let bestIdx = -1;
    for (let i = 0; i < visible.length; i++) {
      if (emitted[i]) continue;
      let ready = true;
      for (const a of visible[i].ancestors) {
        if (!emitted[a]) {
          ready = false;
          break;
        }
      }
      if (!ready) continue;
      if (bestIdx === -1 || letters[i] < letters[bestIdx]) bestIdx = i;
    }
    emitted[bestIdx] = true;
    order.push(bestIdx);
    parts.push(letters[bestIdx]);
  }
  return { key: parts.join('\n'), order };
}

/** All permutations of [0..n) (n is small — capped by PERMUTATION_CAP). */
function allPermutations(n: number): number[][] {
  const result: number[][] = [];
  const arr = Array.from({ length: n }, (_, i) => i);
  const heap = (k: number) => {
    if (k === 1) {
      result.push([...arr]);
      return;
    }
    for (let i = 0; i < k; i++) {
      heap(k - 1);
      const j = k % 2 === 0 ? i : 0;
      [arr[j], arr[k - 1]] = [arr[k - 1], arr[j]];
    }
  };
  heap(n);
  return result;
}
