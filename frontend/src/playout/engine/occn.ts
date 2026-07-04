/**
 * Object-centric causal net playout engine.
 *
 * Faithful TypeScript port of totem_lib's OCCN semantics
 * (totem_lib/src/totem_lib/occn/{semantics,playout,factory}.py):
 *
 *  - The state is a multiset of pending obligations (source activity,
 *    object, object type) stored at the activity that may consume them.
 *  - A binding of an activity chooses one input marker group (consumed
 *    obligations; markers are AND, groups are XOR, same-key markers bind
 *    disjoint objects) and one output marker group. Every consumed object
 *    is assigned to at least one successor marker of its type, respecting
 *    the cardinality ranges and key constraints.
 *  - START_<type> pseudo activities consume "fake" initial obligations
 *    (one per provided object) and bind any non-empty subset of the not
 *    yet started objects; END_<type> activities consume obligations and
 *    produce nothing.
 *  - A process execution is complete when no obligation is pending (all
 *    objects started and ended).
 *
 * Markers with key 0 get a unique key (no sharing constraint), max -1
 * means unbounded — exactly like OCCausalNet.from_dict.
 */

import type { OccnActivityBindings, OccnMarker } from '../../editors/shared/model-types';
import { eventLetter } from './canon';
import type { PlayoutEngine, PlayoutStep } from './types';
import { combinations, lookup } from './util';

const SEP = '\u0001';
/** Pseudo source of the initial ("fake") obligations of START activities. */
const INIT = '\u0000init';

/** Safety cap on bindings enumerated for a single state. */
const MAX_STEPS_PER_STATE = 100_000;

export class TooManyBindingsError extends Error {
  constructor() {
    super(
      'Too many enabled bindings in a single state — reduce the number of objects or the activity limits.',
    );
  }
}

export type OccnPlayoutInput = {
  objectTypes: string[];
  markerGroups: Record<string, OccnActivityBindings>;
  /** Activities without bindings that should still be known (optional). */
  activities?: string[];
};

type Marker = { related: string; ot: string; min: number; max: number; key: number };
type MarkerGroup = {
  markers: Marker[];
  /** related -> ot -> [min, max]; later duplicate markers win (parity). */
  dictRep: Map<string, Map<string, [number, number]>>;
  /** (relatedA, ot, relatedB) pairs that must bind disjoint objects. */
  keyConstraints: [string, string, string][];
};

/** related -> ot -> object ids, the flow of one side of a binding. */
type Flow = Map<string, Map<string, string[]>>;

export const isStartActivity = (act: string) => act.startsWith('START_');
export const isEndActivity = (act: string) => act.startsWith('END_');
export const occnObjectTypeOf = (act: string) => act.split('_').slice(1).join('_');

export function createOccnEngine(
  input: OccnPlayoutInput,
  objectsPerType: Record<string, number>,
): PlayoutEngine {
  const warnings: string[] = [];
  const activities = [
    ...new Set([...(input.activities ?? []), ...Object.keys(input.markerGroups)]),
  ].sort();

  // Normalize marker groups (unique keys for key=0, Infinity for max=-1).
  const maxKey = Math.max(
    0,
    ...Object.values(input.markerGroups).flatMap((b) =>
      [...(b.img ?? []), ...(b.omg ?? [])].flatMap((group) => group.map((m) => m[3])),
    ),
  );
  const normalizeGroup = (group: OccnMarker[]): MarkerGroup | null => {
    let keyCounter = maxKey + 1;
    const markers: Marker[] = group.map(([related, ot, [min, max], key]) => ({
      related,
      ot,
      min,
      max: max === -1 ? Infinity : max,
      key: key === 0 ? keyCounter++ : key,
    }));
    if (markers.length === 0) return null;
    if (markers.some((m) => m.min > m.max)) return null;
    const dictRep: MarkerGroup['dictRep'] = new Map();
    for (const m of markers) {
      let byOt = dictRep.get(m.related);
      if (!byOt) {
        byOt = new Map();
        dictRep.set(m.related, byOt);
      }
      byOt.set(m.ot, [m.min, m.max]);
    }
    const byKeyOt = new Map<string, string[]>();
    for (const m of markers) {
      const k = `${m.key}${SEP}${m.ot}`;
      const list = byKeyOt.get(k) ?? [];
      list.push(m.related);
      byKeyOt.set(k, list);
    }
    const keyConstraints: MarkerGroup['keyConstraints'] = [];
    for (const [k, related] of byKeyOt) {
      const ot = k.split(SEP)[1];
      for (let i = 0; i < related.length; i++) {
        for (let j = i + 1; j < related.length; j++) {
          keyConstraints.push([related[i], ot, related[j]]);
        }
      }
    }
    return { markers, dictRep, keyConstraints };
  };

  const img = new Map<string, MarkerGroup[]>();
  const omg = new Map<string, MarkerGroup[]>();
  for (const act of activities) {
    const bindings = input.markerGroups[act] ?? {};
    const imgGroups = (bindings.img ?? []).map(normalizeGroup).filter((g): g is MarkerGroup => !!g);
    const omgGroups = (bindings.omg ?? []).map(normalizeGroup).filter((g): g is MarkerGroup => !!g);
    if ((bindings.img ?? []).length > imgGroups.length || (bindings.omg ?? []).length > omgGroups.length) {
      warnings.push(`Activity "${act}": some invalid marker groups were ignored.`);
    }
    img.set(act, imgGroups);
    omg.set(act, omgGroups);
    if (!isStartActivity(act) && imgGroups.length === 0) {
      warnings.push(`Activity "${act}" has no input marker groups and can never occur.`);
    }
    if (!isEndActivity(act) && omgGroups.length === 0) {
      warnings.push(`Activity "${act}" has no output marker groups and can never occur.`);
    }
  }

  // Objects in canonical order per type (padded index keeps name order).
  const objects: Record<string, string[]> = {};
  for (const ot of input.objectTypes) {
    const count = lookup(objectsPerType, ot) ?? 0;
    objects[ot] = Array.from(
      { length: count },
      (_, i) => `${ot}${SEP}${String(i).padStart(3, '0')}`,
    );
    if (count > 0 && !activities.includes(`START_${ot}`)) {
      warnings.push(
        `Object type "${ot}" has no START_${ot} activity — its objects can never take part.`,
      );
    }
  }

  // State: consuming activity -> obligation key -> pending count.
  const state = new Map<string, Map<string, number>>();
  let totalPending = 0;
  const oblParts = new Map<string, { src: string; obj: string; ot: string }>();
  const oblKey = (src: string, obj: string, ot: string) => {
    const key = `${src}${SEP}${obj}${SEP}${ot}`;
    if (!oblParts.has(key)) oblParts.set(key, { src, obj, ot });
    return key;
  };
  const addObligation = (act: string, key: string, delta: number) => {
    let byKey = state.get(act);
    if (!byKey) {
      byKey = new Map();
      state.set(act, byKey);
    }
    const next = (byKey.get(key) ?? 0) + delta;
    if (next < 0) throw new Error(`Negative obligation count for ${act}: ${key}`);
    if (next === 0) byKey.delete(key);
    else byKey.set(key, next);
    totalPending += delta;
  };

  for (const ot of input.objectTypes) {
    const startAct = `START_${ot}`;
    if (!activities.includes(startAct)) continue;
    for (const obj of objects[ot]) addObligation(startAct, oblKey(INIT, obj, ot), 1);
  }

  /** Pending objects per (source, ot) for one activity, objects sorted. */
  const buildObligationIndex = (act: string): Map<string, string[]> => {
    const index = new Map<string, string[]>();
    const byKey = state.get(act);
    if (!byKey) return index;
    const sets = new Map<string, Set<string>>();
    for (const key of byKey.keys()) {
      const { src, obj, ot } = oblParts.get(key)!;
      const groupKey = `${src}${SEP}${ot}`;
      let set = sets.get(groupKey);
      if (!set) {
        set = new Set();
        sets.set(groupKey, set);
      }
      set.add(obj);
    }
    for (const [k, v] of sets) index.set(k, [...v].sort());
    return index;
  };

  const serializeFlow = (flow: Flow): string =>
    [...flow.keys()]
      .sort()
      .map(
        (rel) =>
          `${rel}(${[...flow.get(rel)!.keys()]
            .sort()
            .map((ot) => `${ot}:${[...flow.get(rel)!.get(ot)!].sort().join(',')}`)
            .join(';')})`,
      )
      .join('|');

  const flowObjectsByOt = (flow: Flow): Map<string, Set<string>> => {
    const byOt = new Map<string, Set<string>>();
    for (const perOt of flow.values()) {
      for (const [ot, objs] of perOt) {
        let set = byOt.get(ot);
        if (!set) {
          set = new Set();
          byOt.set(ot, set);
        }
        for (const o of objs) set.add(o);
      }
    }
    return byOt;
  };

  /** All possible consumed flows of `act` (port of __generate_consumed). */
  const generateConsumed = (act: string): Flow[] => {
    const index = buildObligationIndex(act);
    const results = new Map<string, Flow>();
    for (const group of img.get(act) ?? []) {
      const entries: { rel: string; ot: string; combos: string[][] }[] = [];
      let groupFails = false;
      for (const [rel, byOt] of group.dictRep) {
        for (const [ot, [min, max]] of byOt) {
          const available = index.get(`${rel}${SEP}${ot}`) ?? [];
          if (available.length < min) {
            groupFails = true;
            break;
          }
          if (available.length === 0) continue; // optional marker, nothing there
          const combos: string[][] = [];
          const upper = Math.min(max, available.length);
          for (let r = min; r <= upper; r++) combos.push(...combinations(available, r));
          entries.push({ rel, ot, combos });
        }
        if (groupFails) break;
      }
      if (groupFails || entries.length === 0) continue;

      // Cross product over all markers of the group.
      const choice = new Array<number>(entries.length).fill(0);
      let crossSize = 1;
      for (const e of entries) crossSize *= e.combos.length;
      if (crossSize > MAX_STEPS_PER_STATE) throw new TooManyBindingsError();
      for (;;) {
        const flow: Flow = new Map();
        for (let i = 0; i < entries.length; i++) {
          const objs = entries[i].combos[choice[i]];
          if (objs.length === 0) continue;
          const { rel, ot } = entries[i];
          let byOt = flow.get(rel);
          if (!byOt) {
            byOt = new Map();
            flow.set(rel, byOt);
          }
          byOt.set(ot, objs);
        }
        if (flow.size > 0 && !violatesKeyConstraints(flow, group.keyConstraints)) {
          const key = serializeFlow(flow);
          if (!results.has(key)) results.set(key, flow);
        }
        let i = 0;
        while (i < entries.length && ++choice[i] === entries[i].combos.length) choice[i++] = 0;
        if (i === entries.length) break;
      }
    }
    return [...results.values()];
  };

  const violatesKeyConstraints = (
    flow: Flow,
    constraints: [string, string, string][],
  ): boolean => {
    for (const [relA, ot, relB] of constraints) {
      const a = flow.get(relA)?.get(ot);
      const b = flow.get(relB)?.get(ot);
      if (a && b && a.some((o) => b.includes(o))) return true;
    }
    return false;
  };

  /**
   * All produced flows for the given consumed objects (port of
   * __generate_produced_for_omg / __generate_successor_assignments):
   * every consumed object is assigned to >= 1 successor marker of its
   * type; cardinality ranges and same-key disjointness are respected.
   */
  const generateProduced = (act: string, consumedByOt: Map<string, Set<string>>): Flow[] => {
    const results = new Map<string, Flow>();
    for (const group of omg.get(act) ?? []) {
      const reqsByOt = new Map<string, { succ: string; min: number; max: number }[]>();
      for (const [succ, byOt] of group.dictRep) {
        for (const [ot, [min, max]] of byOt) {
          const list = reqsByOt.get(ot) ?? [];
          list.push({ succ, min, max });
          reqsByOt.set(ot, list);
        }
      }
      const keyPairsByOt = new Map<string, Set<string>>();
      for (const [s1, ot, s2] of group.keyConstraints) {
        let set = keyPairsByOt.get(ot);
        if (!set) {
          set = new Set();
          keyPairsByOt.set(ot, set);
        }
        set.add([s1, s2].sort().join(SEP));
      }

      // Every consumed type needs a marker; unconsumed types must be optional.
      let ok = true;
      for (const ot of consumedByOt.keys()) {
        if (!reqsByOt.has(ot)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      for (const [ot, reqs] of reqsByOt) {
        if (!consumedByOt.has(ot) && reqs.some((r) => r.min > 0)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      // Valid successor assignments per object type.
      const otsInOrder: string[] = [];
      const assignmentsInOrder: Map<string, string[]>[][] = [];
      let groupFails = false;
      for (const [ot, objSet] of consumedByOt) {
        const reqs = reqsByOt.get(ot)!;
        const succs = reqs.map((r) => r.succ);
        const keyPairs = keyPairsByOt.get(ot) ?? new Set<string>();
        const objs = [...objSet].sort();

        const perObjectChoices: string[][][] = [];
        for (const obj of objs) {
          void obj;
          const choices: string[][] = [];
          for (let size = 1; size <= succs.length; size++) {
            for (const subset of combinations(succs, size)) {
              let valid = true;
              outer: for (let i = 0; i < subset.length; i++) {
                for (let j = i + 1; j < subset.length; j++) {
                  if (keyPairs.has([subset[i], subset[j]].sort().join(SEP))) {
                    valid = false;
                    break outer;
                  }
                }
              }
              if (valid) choices.push(subset);
            }
          }
          if (choices.length === 0) {
            groupFails = true;
            break;
          }
          perObjectChoices.push(choices);
        }
        if (groupFails) break;

        let crossSize = 1;
        for (const c of perObjectChoices) crossSize *= c.length;
        if (crossSize > MAX_STEPS_PER_STATE) throw new TooManyBindingsError();

        const validAssignments: Map<string, string[]>[] = [];
        const choice = new Array<number>(objs.length).fill(0);
        for (;;) {
          const assignment = new Map<string, string[]>();
          for (let i = 0; i < objs.length; i++) {
            for (const succ of perObjectChoices[i][choice[i]]) {
              const list = assignment.get(succ) ?? [];
              list.push(objs[i]);
              assignment.set(succ, list);
            }
          }
          let countsOk = true;
          for (const { succ, min, max } of reqs) {
            const count = assignment.get(succ)?.length ?? 0;
            if (count < min || count > max) {
              countsOk = false;
              break;
            }
          }
          if (countsOk) validAssignments.push(assignment);
          let i = 0;
          while (i < objs.length && ++choice[i] === perObjectChoices[i].length) choice[i++] = 0;
          if (i === objs.length) break;
        }
        if (validAssignments.length === 0) {
          groupFails = true;
          break;
        }
        otsInOrder.push(ot);
        assignmentsInOrder.push(validAssignments);
      }
      if (groupFails || otsInOrder.length === 0) continue;

      // Cross product over object types.
      let crossSize = 1;
      for (const a of assignmentsInOrder) crossSize *= a.length;
      if (crossSize > MAX_STEPS_PER_STATE) throw new TooManyBindingsError();
      const choice = new Array<number>(otsInOrder.length).fill(0);
      for (;;) {
        const flow: Flow = new Map();
        for (let i = 0; i < otsInOrder.length; i++) {
          const ot = otsInOrder[i];
          for (const [succ, objs] of assignmentsInOrder[i][choice[i]]) {
            if (objs.length === 0) continue;
            let byOt = flow.get(succ);
            if (!byOt) {
              byOt = new Map();
              flow.set(succ, byOt);
            }
            byOt.set(ot, objs);
          }
        }
        if (flow.size > 0) {
          const key = serializeFlow(flow);
          if (!results.has(key)) results.set(key, flow);
        }
        let i = 0;
        while (i < otsInOrder.length && ++choice[i] === assignmentsInOrder[i].length) {
          choice[i++] = 0;
        }
        if (i === otsInOrder.length) break;
      }
    }
    return [...results.values()];
  };

  const makeStep = (act: string, consumed: Flow | null, produced: Flow | null): PlayoutStep => {
    // Event objects: consumed objects (or the started objects for START).
    const source = consumed ?? produced;
    const byOt = source ? flowObjectsByOt(source) : new Map<string, Set<string>>();
    const eventObjects: Record<string, string[]> = {};
    const objectIds: string[] = [];
    for (const [ot, set] of byOt) {
      const list = [...set].sort();
      eventObjects[ot] = list;
      objectIds.push(...list);
    }
    return {
      letter: eventLetter(act, eventObjects),
      objectIds,
      budgetKey: act,
      event: {
        activity: act,
        visible: !isStartActivity(act) && !isEndActivity(act),
        objects: eventObjects,
      },
      apply: () => {
        if (consumed) {
          for (const [src, perOt] of consumed) {
            for (const [ot, objs] of perOt) {
              for (const obj of objs) addObligation(act, oblKey(src, obj, ot), -1);
            }
          }
        }
        if (produced) {
          for (const [succ, perOt] of produced) {
            for (const [ot, objs] of perOt) {
              for (const obj of objs) addObligation(succ, oblKey(act, obj, ot), 1);
            }
          }
        }
        return () => {
          if (produced) {
            for (const [succ, perOt] of produced) {
              for (const [ot, objs] of perOt) {
                for (const obj of objs) addObligation(succ, oblKey(act, obj, ot), -1);
              }
            }
          }
          if (consumed) {
            for (const [src, perOt] of consumed) {
              for (const [ot, objs] of perOt) {
                for (const obj of objs) addObligation(act, oblKey(src, obj, ot), 1);
              }
            }
          }
        };
      },
    };
  };

  const enabledSteps = (usedObjects: ReadonlySet<string>, raw: boolean): PlayoutStep[] => {
    const steps: PlayoutStep[] = [];
    for (const act of activities) {
      if (isStartActivity(act)) {
        // Objects with pending fake obligations have not fired any event
        // yet (their START is always their first event), so they are all
        // fresh — `usedObjects` can never contain them.
        void usedObjects;
        const ot = occnObjectTypeOf(act);
        const pending = buildObligationIndex(act).get(`${INIT}${SEP}${ot}`) ?? [];
        if (pending.length === 0) continue;
        const selections: string[][] = [];
        if (raw) {
          for (let k = 1; k <= pending.length; k++) selections.push(...combinations(pending, k));
        } else {
          // Fresh-object symmetry: unstarted objects are interchangeable —
          // only the first k of them need to be considered.
          for (let k = 1; k <= pending.length; k++) selections.push(pending.slice(0, k));
        }
        for (const sel of selections) {
          const consumedByOt = new Map<string, Set<string>>([[ot, new Set(sel)]]);
          for (const produced of generateProduced(act, consumedByOt)) {
            const fakeConsumed: Flow = new Map([[INIT, new Map([[ot, sel]])]]);
            steps.push(makeStep(act, fakeConsumed, produced));
            if (steps.length > MAX_STEPS_PER_STATE) throw new TooManyBindingsError();
          }
        }
      } else if (isEndActivity(act)) {
        for (const consumed of generateConsumed(act)) {
          steps.push(makeStep(act, consumed, null));
          if (steps.length > MAX_STEPS_PER_STATE) throw new TooManyBindingsError();
        }
      } else {
        for (const consumed of generateConsumed(act)) {
          const consumedByOt = new Map<string, Set<string>>();
          for (const [ot, set] of flowObjectsByOt(consumed)) consumedByOt.set(ot, set);
          for (const produced of generateProduced(act, consumedByOt)) {
            steps.push(makeStep(act, consumed, produced));
            if (steps.length > MAX_STEPS_PER_STATE) throw new TooManyBindingsError();
          }
        }
      }
    }
    return steps;
  };

  const stateKey = (): string => {
    const parts: string[] = [];
    for (const act of [...state.keys()].sort()) {
      const byKey = state.get(act)!;
      if (byKey.size === 0) continue;
      const obls = [...byKey.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, c]) => `${k}*${c}`)
        .join(',');
      parts.push(`${act}{${obls}}`);
    }
    return parts.join('\n');
  };

  return {
    objects,
    warnings,
    enabledSteps,
    isComplete: () => totalPending === 0,
    stateKey,
  };
}
