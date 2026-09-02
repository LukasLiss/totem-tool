import { TOTEM_FORMAT, type TotemModelFile } from '@/editors/shared/model-types';

/**
 * Built-in example: the car assembly process from Fig. 1 of
 * Liss et al., "TOTeM: Temporal Object Type Model" (BPM 2024).
 * Cardinalities are illustrative of the figure.
 */
export const EXAMPLE_MODEL: TotemModelFile = {
  format: TOTEM_FORMAT,
  version: 1,
  name: 'Car assembly (TOTeM example)',
  objectTypes: [
    { name: 'rubber', position: { x: 40, y: 40 } },
    { name: 'metal', position: { x: 330, y: 40 } },
    { name: 'worker', position: { x: 620, y: 40 } },
    { name: 'tire', position: { x: 40, y: 300 } },
    { name: 'car', position: { x: 330, y: 300 } },
    { name: 'order', position: { x: 620, y: 470 } },
  ],
  relations: [
    {
      id: 'rel-rubber-tire',
      source: 'rubber',
      target: 'tire',
      temporal: 'I',
      sourceToTarget: { log: '1', event: '0..1' },
      targetToSource: { log: '1..*', event: '0..*' },
    },
    {
      id: 'rel-rubber-metal',
      source: 'rubber',
      target: 'metal',
      temporal: 'P',
      sourceToTarget: { log: '0..*', event: '0' },
      targetToSource: { log: '0..*', event: '0' },
    },
    {
      id: 'rel-metal-car',
      source: 'metal',
      target: 'car',
      temporal: 'I',
      sourceToTarget: { log: '0..1', event: '0..1' },
      targetToSource: { log: '1..*', event: '1..*' },
    },
    {
      id: 'rel-tire-car',
      source: 'tire',
      target: 'car',
      temporal: 'I',
      sourceToTarget: { log: '0..1', event: '0..1' },
      targetToSource: { log: '0..*', event: '0..*' },
    },
    {
      id: 'rel-tire-order',
      source: 'tire',
      target: 'order',
      temporal: 'D',
      sourceToTarget: { log: '1', event: '0..1' },
      targetToSource: { log: '1', event: '0..*' },
    },
    {
      id: 'rel-car-order',
      source: 'car',
      target: 'order',
      temporal: 'D',
      sourceToTarget: { log: '1', event: '1' },
      targetToSource: { log: '0..1', event: '0..1' },
    },
    {
      id: 'rel-worker-tire',
      source: 'worker',
      target: 'tire',
      temporal: 'P',
      sourceToTarget: { log: '0..*', event: '0..*' },
      targetToSource: { log: '0..*', event: '0..*' },
    },
  ],
};
