import { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';

import type { TotemRelationEdgeType } from './types';

type Pt = { x: number; y: number };

const SELECTED_COLOR = '#2563EB';
const DEFAULT_COLOR = '#0F172A';

function nodeCenterAndSize(
  node: InternalNode,
): { center: Pt; halfW: number; halfH: number } | null {
  const width = node.measured.width;
  const height = node.measured.height;
  if (!width || !height) return null;
  const { x, y } = node.internals.positionAbsolute;
  return {
    center: { x: x + width / 2, y: y + height / 2 },
    halfW: width / 2,
    halfH: height / 2,
  };
}

/** Intersection of the segment center → toward with the node's rectangle border. */
function rectBorderPoint(center: Pt, halfW: number, halfH: number, toward: Pt): Pt {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return { ...center };
  const scaleX = dx !== 0 ? halfW / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const scaleY = dy !== 0 ? halfH / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const t = Math.min(scaleX, scaleY);
  return { x: center.x + dx * t, y: center.y + dy * t };
}

/**
 * Temporal glyphs drawn in a local frame at a line endpoint where +x points
 * inward along the line (away from the node the endpoint touches).
 */
function SquareGlyph({ fill }: { fill: string }) {
  return <rect x={1.5} y={-4.5} width={9} height={9} fill={fill} />;
}

function ArrowGlyph({ fill }: { fill: string }) {
  // Apex at the node border, pointing at the node.
  return <path d="M 0 0 L 11 -5.5 L 11 5.5 Z" fill={fill} />;
}

function ParallelGlyph({ stroke }: { stroke: string }) {
  return (
    <path
      d="M 8 -6 L 8 6 M 13 -6 L 13 6"
      stroke={stroke}
      strokeWidth={1.8}
      fill="none"
      strokeLinecap="round"
    />
  );
}

/**
 * Floating straight edge between two object types with the full TOTeM
 * annotation set: temporal glyph (■ / ▶ / ∥) at the line endpoints, log
 * cardinalities as plain labels near each node and both event cardinalities
 * inside one black pill at the middle of the line.
 */
const TotemRelationEdge = memo(function TotemRelationEdge({
  id,
  source,
  target,
  selected,
  data,
}: EdgeProps<TotemRelationEdgeType>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode || !data) return null;

  const sourceBox = nodeCenterAndSize(sourceNode);
  const targetBox = nodeCenterAndSize(targetNode);
  if (!sourceBox || !targetBox) return null;

  const s = rectBorderPoint(sourceBox.center, sourceBox.halfW, sourceBox.halfH, targetBox.center);
  const t = rectBorderPoint(targetBox.center, targetBox.halfW, targetBox.halfH, sourceBox.center);

  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const length = Math.hypot(dx, dy);
  if (length < 12) return null; // overlapping nodes — nothing sensible to draw

  // Unit vector source → target and its normal.
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;

  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const color = selected ? SELECTED_COLOR : DEFAULT_COLOR;
  const glow = selected
    ? 'drop-shadow(0 0 3px rgba(37, 99, 235, 0.65))'
    : undefined;

  const path = `M ${s.x},${s.y} L ${t.x},${t.y}`;

  // Local glyph frames: +x pointing inward along the line.
  const sourceEndTransform = `translate(${s.x}, ${s.y}) rotate(${angle})`;
  const targetEndTransform = `translate(${t.x}, ${t.y}) rotate(${angle + 180})`;

  const { temporal, sourceToTarget, targetToSource } = data;

  // Log cardinality label anchor points: LC(a→b) sits near b's box.
  const lcInset = 26;
  const lcOffset = 11;
  const lcNearTarget: Pt = {
    x: t.x - ux * lcInset + nx * lcOffset,
    y: t.y - uy * lcInset + ny * lcOffset,
  };
  const lcNearSource: Pt = {
    x: s.x + ux * lcInset + nx * lcOffset,
    y: s.y + uy * lcInset + ny * lcOffset,
  };

  // Event cardinality pill at the middle, rotated along the line but kept
  // upright-readable. Along the line from source to target the pill reads
  // "EC(target→source) – EC(source→target)" (each value nearer the node that
  // is its direction's target). When the text is flipped to stay readable the
  // two values must swap sides to keep that placement.
  const mid: Pt = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
  const flipped = angle > 90 || angle < -90;
  const pillAngle = flipped ? angle + 180 : angle;
  const pillLeft = flipped ? sourceToTarget.event : targetToSource.event;
  const pillRight = flipped ? targetToSource.event : sourceToTarget.event;

  return (
    <>
      <g style={glow ? { filter: glow } : undefined}>
        <BaseEdge
          id={id}
          path={path}
          interactionWidth={16}
          style={{ stroke: color, strokeWidth: 1.6 }}
        />
        {temporal === 'D' && (
          <g transform={targetEndTransform}>
            <SquareGlyph fill={color} />
          </g>
        )}
        {temporal === 'Di' && (
          <g transform={sourceEndTransform}>
            <SquareGlyph fill={color} />
          </g>
        )}
        {temporal === 'I' && (
          <g transform={targetEndTransform}>
            <ArrowGlyph fill={color} />
          </g>
        )}
        {temporal === 'Ii' && (
          <g transform={sourceEndTransform}>
            <ArrowGlyph fill={color} />
          </g>
        )}
        {temporal === 'P' && (
          <>
            <g transform={sourceEndTransform}>
              <ParallelGlyph stroke={color} />
            </g>
            <g transform={targetEndTransform}>
              <ParallelGlyph stroke={color} />
            </g>
          </>
        )}
      </g>
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan rounded bg-white/80 px-1 text-[10px] font-medium text-slate-700"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${lcNearTarget.x}px, ${lcNearTarget.y}px)`,
            pointerEvents: 'none',
          }}
        >
          {sourceToTarget.log}
        </div>
        <div
          className="nodrag nopan rounded bg-white/80 px-1 text-[10px] font-medium text-slate-700"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${lcNearSource.x}px, ${lcNearSource.y}px)`,
            pointerEvents: 'none',
          }}
        >
          {targetToSource.log}
        </div>
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px) rotate(${pillAngle}deg)`,
            pointerEvents: 'none',
          }}
        >
          <div
            className="rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap text-white"
            style={{
              background: color,
              boxShadow: selected ? '0 0 6px rgba(37, 99, 235, 0.45)' : undefined,
            }}
          >
            {pillLeft} – {pillRight}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

export default TotemRelationEdge;
