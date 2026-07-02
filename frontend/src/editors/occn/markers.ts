import type { OccnMarker, XY } from '@/editors/shared/model-types';

import { arcCubic, cubicPointAt, cubicTangentAt, type Box, type Cubic } from './geometry';
import {
  arcId,
  nodeFallbackSize,
  type BindingsMap,
  type GroupRef,
  type OccnEdge,
  type OccnNode,
} from './types';

/**
 * Positions of all binding markers (and the AND-group connector lines) in
 * flow coordinates. Uses the same cubic geometry as the custom edge, so the
 * markers sit exactly on the drawn arcs.
 */

export type MarkerVis = {
  id: string;
  ref: GroupRef;
  markerIndex: number;
  marker: OccnMarker;
  pos: XY;
  /** Normalised curve tangent at the marker, used to place the labels. */
  tangent: XY;
  shape: 'circle' | 'square';
  color: string;
  /** Cardinality label, only when the range is not (1,1). */
  cardinality: string | null;
  /** Key badge, only when ≥2 markers of the group share this (non-zero) key. */
  keyBadge: number | null;
};

export type GroupLineVis = {
  id: string;
  ref: GroupRef;
  points: XY[];
};

const INPUT_BASE_T = 0.85;
const OUTPUT_BASE_T = 0.15;
const STACK_STEP_T = 0.11;
/**
 * Span along the curve available for stacked markers: inputs occupy
 * t ∈ [0.55, 0.85], outputs t ∈ [0.15, 0.45]. With many groups on one arc end
 * the step shrinks so markers compress but never coincide.
 */
const STACK_SPAN_T = 0.3;

export function computeMarkerLayout(args: {
  nodes: OccnNode[];
  edges: OccnEdge[];
  bindings: BindingsMap;
  typeColors: Record<string, string>;
  parallelOffset: Record<string, number>;
}): { markers: MarkerVis[]; lines: GroupLineVis[] } {
  const { nodes, edges, bindings, typeColors, parallelOffset } = args;

  const boxes = new Map<string, Box>();
  for (const node of nodes) {
    const fallback = nodeFallbackSize(node.data.kind);
    boxes.set(node.id, {
      x: node.position.x,
      y: node.position.y,
      width: node.measured?.width ?? fallback.width,
      height: node.measured?.height ?? fallback.height,
    });
  }

  const edgeIds = new Set(edges.map((edge) => edge.id));
  const cubics = new Map<string, Cubic>();
  const cubicFor = (id: string, source: string, target: string): Cubic | null => {
    if (!edgeIds.has(id)) return null;
    const cached = cubics.get(id);
    if (cached) return cached;
    const sourceBox = boxes.get(source);
    const targetBox = boxes.get(target);
    if (!sourceBox || !targetBox) return null;
    const cubic = arcCubic(sourceBox, targetBox, parallelOffset[id] ?? 0);
    cubics.set(id, cubic);
    return cubic;
  };

  // Markers of several groups on the same arc end stack along the arc.
  const slots = new Map<string, number>();
  const takeSlot = (key: string) => {
    const slot = slots.get(key) ?? 0;
    slots.set(key, slot + 1);
    return slot;
  };

  // Pre-count markers per arc end (same placement predicate as below) so the
  // stacking step can adapt to the number of stacked markers.
  const slotCounts = new Map<string, number>();
  for (const node of nodes) {
    const b = bindings[node.id];
    if (!b) continue;
    for (const side of ['img', 'omg'] as const) {
      for (const group of b[side]) {
        for (const [related, objectType] of group) {
          const source = side === 'img' ? related : node.id;
          const target = side === 'img' ? node.id : related;
          const id = arcId(source, target, objectType);
          if (!edgeIds.has(id) || !boxes.has(source) || !boxes.has(target)) continue;
          const key = `${id}|${side === 'img' ? 'in' : 'out'}`;
          slotCounts.set(key, (slotCounts.get(key) ?? 0) + 1);
        }
      }
    }
  }

  const markers: MarkerVis[] = [];
  const lines: GroupLineVis[] = [];

  for (const node of nodes) {
    const activity = node.id;
    const b = bindings[activity];
    if (!b) continue;
    for (const side of ['img', 'omg'] as const) {
      b[side].forEach((group, groupIndex) => {
        const ref: GroupRef = { activity, side, groupIndex };
        const keyCounts = new Map<number, number>();
        for (const [, , , key] of group) {
          if (key > 0) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
        }
        const points: XY[] = [];
        group.forEach((marker, markerIndex) => {
          const [related, objectType, [min, max], key] = marker;
          const source = side === 'img' ? related : activity;
          const target = side === 'img' ? activity : related;
          const id = arcId(source, target, objectType);
          const cubic = cubicFor(id, source, target);
          if (!cubic) return;
          const slotKey = `${id}|${side === 'img' ? 'in' : 'out'}`;
          const slot = takeSlot(slotKey);
          const count = slotCounts.get(slotKey) ?? 1;
          const step =
            count > 1 ? Math.min(STACK_STEP_T, STACK_SPAN_T / (count - 1)) : 0;
          const t =
            side === 'img'
              ? INPUT_BASE_T - slot * step
              : OUTPUT_BASE_T + slot * step;
          const pos = cubicPointAt(cubic, t);
          points.push(pos);
          markers.push({
            id: `${activity}|${side}|${groupIndex}|${markerIndex}`,
            ref,
            markerIndex,
            marker,
            pos,
            tangent: cubicTangentAt(cubic, t),
            shape: min === 1 && max === 1 ? 'circle' : 'square',
            color: typeColors[objectType] ?? '#64748B',
            cardinality:
              min === 1 && max === 1 ? null : `(${min},${max === -1 ? '*' : max})`,
            keyBadge: key > 0 && (keyCounts.get(key) ?? 0) >= 2 ? key : null,
          });
        });
        if (points.length >= 2) {
          lines.push({ id: `${activity}|${side}|${groupIndex}`, ref, points });
        }
      });
    }
  }

  return { markers, lines };
}
