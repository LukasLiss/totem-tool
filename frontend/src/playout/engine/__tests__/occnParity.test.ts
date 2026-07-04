/**
 * Parity tests: the TypeScript OCCN playout must count exactly the same
 * number of valid binding sequences as totem_lib's Python occn_playout
 * (raw mode: no interleaving pruning, no symmetry reduction, no dedup).
 */

import { describe, expect, it } from 'vitest';
import { createOccnEngine } from '../occn';
import { runPlayout } from '../search';
import type { PlayoutConfig } from '../types';
import { PARITY_FIXTURES } from './pythonParity.fixtures';

const objectTypesOf = (markerGroups: Record<string, unknown>): string[] => {
  const types = new Set<string>();
  for (const act of Object.keys(markerGroups)) {
    if (act.startsWith('START_')) types.add(act.slice('START_'.length));
  }
  return [...types].sort();
};

const rawConfig = (maxBindings: number): PlayoutConfig => ({
  mode: 'raw',
  objectsPerType: {},
  activityLimits: {},
  defaultActivityLimit: maxBindings,
  timeoutMs: 60_000,
  maxStoredVariants: 0,
  maxStates: 50_000_000,
});

describe('OCCN playout parity with totem_lib', () => {
  for (const fixture of PARITY_FIXTURES) {
    describe(fixture.name, () => {
      for (const scenario of fixture.scenarios) {
        const label = `objects=${JSON.stringify(scenario.objects)} maxBindings=${scenario.maxBindings} -> ${scenario.sequenceCount}`;
        it(label, () => {
          const engine = createOccnEngine(
            {
              objectTypes: objectTypesOf(fixture.markerGroups),
              markerGroups: fixture.markerGroups,
            },
            scenario.objects,
          );
          const result = runPlayout(engine, rawConfig(scenario.maxBindings));
          expect(result.exhaustive).toBe(true);
          expect(result.completedRuns).toBe(scenario.sequenceCount);
        });
      }
    });
  }
});
