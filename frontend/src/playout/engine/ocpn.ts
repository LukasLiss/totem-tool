/**
 * Object-centric Petri net playout engine.
 *
 * Token-game semantics following van der Aalst & Berti, "Discovering
 * Object-Centric Petri Nets" (the formalism the OCPN editor implements):
 *
 *  - Every place is typed; the marking assigns each place a multiset of
 *    objects of its type.
 *  - A transition fires under a binding that selects, per involved object
 *    type, exactly one object (non-variable arcs) or a non-empty set of
 *    objects (variable arcs). Each selected object must have a token in
 *    every input place of its type; firing consumes those tokens and adds
 *    one token per output place of the type.
 *  - The initial marking puts every object into each `initial` place of
 *    its type; an execution is complete when no token remains outside a
 *    `final` place.
 *  - Silent transitions (label null / silent flag) fire like any other
 *    transition but do not contribute visible events; their occurrence
 *    budget is keyed by `τ:<transition id>`.
 */

import type { OcpnModelFile } from '../../editors/shared/model-types';
import { eventLetter } from './canon';
import type { PlayoutEngine, PlayoutStep } from './types';
import { lookup, nonEmptySubsets } from './util';

const SEP = '\u0001';

/** Safety cap on bindings enumerated for a single state. */
const MAX_STEPS_PER_STATE = 100_000;

/** Budget/limit key of a transition: its activity label, or a τ key. */
export function ocpnBudgetKey(transition: {
  id: string;
  label?: string | null;
  silent?: boolean;
}): string {
  const silent = transition.silent || transition.label === null || transition.label === undefined
    || transition.label === '';
  return silent ? `τ:${transition.id}` : transition.label!;
}

export function isOcpnSilent(transition: { label?: string | null; silent?: boolean }): boolean {
  return (
    transition.silent === true ||
    transition.label === null ||
    transition.label === undefined ||
    transition.label === ''
  );
}

type TransitionInfo = {
  id: string;
  budgetKey: string;
  visible: boolean;
  /** Input/output place ids and variability per object type. */
  inputs: Map<string, { places: string[]; variable: boolean }>;
  outputs: Map<string, { places: string[]; variable: boolean }>;
  /** Never enabled (no inputs, or an output type without input type). */
  disabled: boolean;
};

export function createOcpnEngine(
  model: OcpnModelFile,
  objectsPerType: Record<string, number>,
): PlayoutEngine {
  const warnings: string[] = [];

  const placeType = new Map<string, string>();
  const finalPlaces = new Set<string>();
  for (const place of model.places) {
    placeType.set(place.id, place.objectType);
    if (place.final) finalPlaces.add(place.id);
  }

  const transitions: TransitionInfo[] = model.transitions.map((t) => ({
    id: t.id,
    budgetKey: ocpnBudgetKey(t),
    visible: !isOcpnSilent(t),
    inputs: new Map(),
    outputs: new Map(),
    disabled: false,
  }));
  const transitionById = new Map(transitions.map((t) => [t.id, t]));

  for (const arc of model.arcs) {
    const placeAsSource = placeType.has(arc.source);
    const transition = transitionById.get(placeAsSource ? arc.target : arc.source);
    const placeId = placeAsSource ? arc.source : arc.target;
    const ot = placeType.get(placeId);
    if (!transition || ot === undefined) continue; // malformed arc — parser reports it
    const side = placeAsSource ? transition.inputs : transition.outputs;
    let group = side.get(ot);
    if (!group) {
      group = { places: [], variable: false };
      side.set(ot, group);
    }
    group.places.push(placeId);
    if (arc.variable) group.variable = true;
  }
  // Well-formedness: per (transition, type) arcs are uniformly variable.
  for (const t of transitions) {
    for (const ot of new Set([...t.inputs.keys(), ...t.outputs.keys()])) {
      const variable = (t.inputs.get(ot)?.variable ?? false) || (t.outputs.get(ot)?.variable ?? false);
      if (t.inputs.has(ot)) t.inputs.get(ot)!.variable = variable;
      if (t.outputs.has(ot)) t.outputs.get(ot)!.variable = variable;
    }
  }

  const transitionName = (t: TransitionInfo) => `"${t.budgetKey}"`;
  for (const t of transitions) {
    if (t.inputs.size === 0) {
      t.disabled = true;
      warnings.push(
        `Transition ${transitionName(t)} has no input places and can never fire during playout.`,
      );
      continue;
    }
    for (const ot of t.outputs.keys()) {
      if (!t.inputs.has(ot)) {
        t.disabled = true;
        warnings.push(
          `Transition ${transitionName(t)} produces "${ot}" tokens without consuming any — it can never fire during playout (objects cannot be created).`,
        );
      }
    }
    for (const ot of t.inputs.keys()) {
      if (!t.outputs.has(ot)) {
        warnings.push(
          `Transition ${transitionName(t)} consumes "${ot}" tokens without producing any — those objects disappear and cannot reach a final place.`,
        );
      }
    }
  }

  // Objects in canonical order per type, marking = tokens per place.
  const objects: Record<string, string[]> = {};
  const marking = new Map<string, Map<string, number>>();
  let tokensOutsideFinal = 0;
  const addToken = (placeId: string, obj: string, delta: number) => {
    let byObj = marking.get(placeId);
    if (!byObj) {
      byObj = new Map();
      marking.set(placeId, byObj);
    }
    const next = (byObj.get(obj) ?? 0) + delta;
    if (next < 0) throw new Error(`Negative token count in place ${placeId}`);
    if (next === 0) byObj.delete(obj);
    else byObj.set(obj, next);
    if (!finalPlaces.has(placeId)) tokensOutsideFinal += delta;
  };

  for (const typeDef of model.objectTypes) {
    const ot = typeDef.name;
    const count = lookup(objectsPerType, ot) ?? 0;
    objects[ot] = Array.from(
      { length: count },
      (_, i) => `${ot}${SEP}${String(i).padStart(3, '0')}`,
    );
    if (count === 0) continue;
    const initialPlaces = model.places.filter((p) => p.objectType === ot && p.initial);
    if (initialPlaces.length === 0) {
      warnings.push(
        `Object type "${ot}" has no initial place — its objects can never take part.`,
      );
      continue;
    }
    if (!model.places.some((p) => p.objectType === ot && p.final)) {
      warnings.push(
        `Object type "${ot}" has no final place — process executions can never complete.`,
      );
    }
    for (const place of initialPlaces) {
      for (const obj of objects[ot]) addToken(place.id, obj, 1);
    }
  }

  /** Objects of the given type with a token in every listed place. */
  const eligibleObjects = (places: string[]): string[] => {
    const first = marking.get(places[0]);
    if (!first || first.size === 0) return [];
    const result: string[] = [];
    for (const obj of first.keys()) {
      let everywhere = true;
      for (let i = 1; i < places.length; i++) {
        if (!marking.get(places[i])?.has(obj)) {
          everywhere = false;
          break;
        }
      }
      if (everywhere) result.push(obj);
    }
    return result.sort();
  };

  const enabledSteps = (usedObjects: ReadonlySet<string>, raw: boolean): PlayoutStep[] => {
    const steps: PlayoutStep[] = [];
    for (const t of transitions) {
      if (t.disabled) continue;

      // Candidate object selections per input type.
      const types: string[] = [];
      const selectionsPerType: string[][][] = [];
      let noBinding = false;
      for (const [ot, group] of t.inputs) {
        const eligible = eligibleObjects(group.places);
        if (eligible.length === 0) {
          noBinding = true;
          break;
        }
        let selections: string[][];
        if (raw) {
          selections = group.variable
            ? nonEmptySubsets(eligible)
            : eligible.map((obj) => [obj]);
        } else {
          // Fresh-object symmetry: objects that took part in no step yet
          // are mutually interchangeable, so only the first k of them are
          // considered. All fresh objects of a type are eligible for the
          // same transitions (identical token distribution).
          const used = eligible.filter((obj) => usedObjects.has(obj));
          const fresh = eligible.filter((obj) => !usedObjects.has(obj));
          if (group.variable) {
            selections = [];
            const usedSubsets: string[][] = [[], ...nonEmptySubsets(used)];
            for (const subset of usedSubsets) {
              for (let k = 0; k <= fresh.length; k++) {
                if (subset.length + k === 0) continue;
                selections.push([...subset, ...fresh.slice(0, k)]);
              }
            }
          } else {
            selections = used.map((obj) => [obj]);
            if (fresh.length > 0) selections.push([fresh[0]]);
          }
        }
        if (selections.length === 0) {
          noBinding = true;
          break;
        }
        types.push(ot);
        selectionsPerType.push(selections);
      }
      if (noBinding) continue;

      // Cross product over input types.
      let crossSize = 1;
      for (const s of selectionsPerType) crossSize *= s.length;
      if (crossSize > MAX_STEPS_PER_STATE || steps.length + crossSize > MAX_STEPS_PER_STATE) {
        throw new Error(
          'Too many enabled bindings in a single state — reduce the number of objects or the activity limits.',
        );
      }
      const choice = new Array<number>(types.length).fill(0);
      for (;;) {
        const eventObjects: Record<string, string[]> = {};
        const objectIds: string[] = [];
        for (let i = 0; i < types.length; i++) {
          const sel = [...selectionsPerType[i][choice[i]]].sort();
          eventObjects[types[i]] = sel;
          objectIds.push(...sel);
        }
        steps.push(makeStep(t, eventObjects, objectIds));
        let i = 0;
        while (i < types.length && ++choice[i] === selectionsPerType[i].length) choice[i++] = 0;
        if (i === types.length) break;
      }
    }
    return steps;
  };

  const makeStep = (
    t: TransitionInfo,
    eventObjects: Record<string, string[]>,
    objectIds: string[],
  ): PlayoutStep => ({
    letter: eventLetter(t.budgetKey, eventObjects),
    objectIds,
    budgetKey: t.budgetKey,
    event: { activity: t.budgetKey, visible: t.visible, objects: eventObjects },
    apply: () => {
      for (const [ot, objs] of Object.entries(eventObjects)) {
        for (const obj of objs) {
          for (const place of t.inputs.get(ot)!.places) addToken(place, obj, -1);
          for (const place of t.outputs.get(ot)?.places ?? []) addToken(place, obj, 1);
        }
      }
      return () => {
        for (const [ot, objs] of Object.entries(eventObjects)) {
          for (const obj of objs) {
            for (const place of t.outputs.get(ot)?.places ?? []) addToken(place, obj, -1);
            for (const place of t.inputs.get(ot)!.places) addToken(place, obj, 1);
          }
        }
      };
    },
  });

  const stateKey = (): string => {
    const parts: string[] = [];
    for (const placeId of [...marking.keys()].sort()) {
      const byObj = marking.get(placeId)!;
      if (byObj.size === 0) continue;
      const tokens = [...byObj.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([obj, c]) => `${obj}*${c}`)
        .join(',');
      parts.push(`${placeId}{${tokens}}`);
    }
    return parts.join('\n');
  };

  return {
    objects,
    warnings,
    enabledSteps,
    isComplete: () => tokensOutsideFinal === 0,
    stateKey,
  };
}
