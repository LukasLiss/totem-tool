import { memo } from 'react';
import {
  BaseEdge,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';

import {
  TOTEM_ARROW_SIZE,
  TOTEM_BAR_GAP,
  TOTEM_BAR_HALF_LENGTH,
  TOTEM_BAR_STROKE_WIDTH,
  TOTEM_BUBBLE_FONT_SIZE,
  TOTEM_BUBBLE_RY,
  TOTEM_EDGE_COLOR,
  TOTEM_EDGE_MUTED_COLOR,
  TOTEM_EDGE_SELECTED_COLOR,
  TOTEM_EDGE_STROKE_WIDTH,
  TOTEM_FONT_FAMILY,
  TOTEM_LABEL_FONT_SIZE,
  TOTEM_LABEL_OFFSET,
  TOTEM_PARALLEL_STROKE_WIDTH,
  TOTEM_SOURCE_CLEARANCE,
  TOTEM_SOURCE_LABEL_T,
  TOTEM_SQUARE_SIZE,
  TOTEM_TARGET_CLEARANCE,
  TOTEM_TARGET_LABEL_T,
  formatTotemCardinality,
  totemBubbleWidth,
} from './totemTheme';

/** Cardinalities of one reading direction of a relation. */
export type TotemDirectionCardinalities = {
  log: string | null;
  event: string | null;
};

export type TotemRelationEdgeData = {
  /** Temporal relation, read source → target; null when the model states none. */
  temporal: 'D' | 'Di' | 'I' | 'Ii' | 'P' | null;
  sourceToTarget: TotemDirectionCardinalities;
  targetToSource: TotemDirectionCardinalities;
  /** Overrides the line colour, e.g. for conformance fitness bands. */
  strokeColor?: string;
  /**
   * Overrides the colour of single notation elements, per end of the line.
   * `target` holds the elements drawn at the target box, which describe the
   * source → target direction (log and event cardinality of that direction,
   * and the target half of the line with its temporal marker); `source`
   * holds the mirror image. Conformance checking uses it to point at exactly
   * the element that deviates.
   */
  elementColors?: {
    source: TotemEdgeEndColors;
    target: TotemEdgeEndColors;
  };
};

/** Colours of the notation elements drawn at one end of a relation. */
export type TotemEdgeEndColors = {
  temporal?: string;
  log?: string;
  event?: string;
};

export type TotemRelationEdgeType = Edge<TotemRelationEdgeData>;

type Point = { x: number; y: number };

/** Shown where a model declares no cardinality for a direction. */
const MISSING_CARDINALITY = '–';

/** Below this the two boxes touch and there is nothing sensible to draw. */
const MIN_EDGE_LENGTH = 12;

function nodeBox(
  node: InternalNode,
): { center: Point; halfWidth: number; halfHeight: number } | null {
  const width = node.measured.width;
  const height = node.measured.height;
  if (!width || !height) return null;
  const { x, y } = node.internals.positionAbsolute;
  return {
    center: { x: x + width / 2, y: y + height / 2 },
    halfWidth: width / 2,
    halfHeight: height / 2,
  };
}

/** Where the ray from `center` towards `toward` leaves the box around `center`. */
function clipToBorder(
  center: Point,
  halfWidth: number,
  halfHeight: number,
  toward: Point,
): Point {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return { ...center };
  const scale = Math.min(
    halfWidth / Math.abs(dx || 1e-9),
    halfHeight / Math.abs(dy || 1e-9),
  );
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function lerp(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** Filled triangle with its apex on `tip`, pointing away from `from`. */
function arrowPath(from: Point, tip: Point, size: number): string {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const baseX = tip.x - ux * size;
  const baseY = tip.y - uy * size;
  const wing = size * 0.42;
  return `M ${tip.x} ${tip.y} L ${baseX + px * wing} ${baseY + py * wing} L ${
    baseX - px * wing
  } ${baseY - py * wing} Z`;
}

function bubblePart(value: string | null): string {
  return formatTotemCardinality(value) || MISSING_CARDINALITY;
}

/**
 * A TOTeM relation drawn in the notation of the TOTeM paper, matching the
 * Analysis TOTeM Miner: a straight line between the two boxes, the temporal
 * marker at the end it belongs to (■ during, ▶ precedes, ∥ at both ends for
 * parallel), the log cardinality of each direction as a bare label near the
 * box it counts, and both event cardinalities in an oval at the middle.
 *
 * The line floats between the two boxes rather than hanging off handles, so
 * it stays correct while a node is dragged around in the editor.
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

  const sourceBox = nodeBox(sourceNode);
  const targetBox = nodeBox(targetNode);
  if (!sourceBox || !targetBox) return null;

  const start = clipToBorder(
    sourceBox.center,
    sourceBox.halfWidth + TOTEM_SOURCE_CLEARANCE,
    sourceBox.halfHeight + TOTEM_SOURCE_CLEARANCE,
    targetBox.center,
  );
  const end = clipToBorder(
    targetBox.center,
    targetBox.halfWidth + TOTEM_TARGET_CLEARANCE,
    targetBox.halfHeight + TOTEM_TARGET_CLEARANCE,
    sourceBox.center,
  );

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < MIN_EDGE_LENGTH) return null;

  const unitX = dx / length;
  const unitY = dy / length;
  const normalX = -unitY;
  const normalY = unitX;

  const { temporal, sourceToTarget, targetToSource } = data;
  const isParallel = temporal === 'P';
  const baseColor = data.strokeColor ?? (temporal ? TOTEM_EDGE_COLOR : TOTEM_EDGE_MUTED_COLOR);
  const elementColors = data.elementColors;
  // With per-element colours a selection must not paint over the very
  // deviations it was clicked for, so it is shown as a halo instead.
  const pick = (override: string | undefined) =>
    elementColors
      ? override ?? baseColor
      : selected
        ? TOTEM_EDGE_SELECTED_COLOR
        : baseColor;
  const sourceTemporalColor = pick(elementColors?.source.temporal);
  const targetTemporalColor = pick(elementColors?.target.temporal);
  const sourceLogColor = pick(elementColors?.source.log);
  const targetLogColor = pick(elementColors?.target.log);
  const sourceEventColor = pick(elementColors?.source.event);
  const targetEventColor = pick(elementColors?.target.event);
  const ovalColor = pick(undefined);

  // Parallel relations leave room for a second bar at each end.
  const barGap = Math.min(TOTEM_BAR_GAP, length * 0.25);
  const innerStart: Point = { x: start.x + unitX * barGap, y: start.y + unitY * barGap };
  const innerEnd: Point = { x: end.x - unitX * barGap, y: end.y - unitY * barGap };
  const lineStart = isParallel ? innerStart : start;
  const lineEnd = isParallel ? innerEnd : end;
  const path = `M ${lineStart.x},${lineStart.y} L ${lineEnd.x},${lineEnd.y}`;
  const midpoint = lerp(start, end, 0.5);
  const targetHalfPath = `M ${midpoint.x},${midpoint.y} L ${lineEnd.x},${lineEnd.y}`;
  const lineWidth = isParallel ? TOTEM_PARALLEL_STROKE_WIDTH : TOTEM_EDGE_STROKE_WIDTH;

  const sourceLabel = formatTotemCardinality(targetToSource.log);
  const targetLabel = formatTotemCardinality(sourceToTarget.log);
  const sourceLabelPoint = lerp(start, end, TOTEM_SOURCE_LABEL_T);
  const targetLabelPoint = lerp(start, end, TOTEM_TARGET_LABEL_T);

  // The oval is nudged along the line by the edge's horizontal tilt, the same
  // way the miner spreads the ovals of a fan of relations apart.
  const bubblePoint = lerp(start, end, 0.5 + unitX * 0.15);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const flipped = angle > 90 || angle < -90;
  const bubbleAngle = flipped ? angle + 180 : angle;
  // Each event cardinality stays on the side of the type it counts, so the two
  // swap places when the text is flipped to stay readable.
  const sourceEventText = bubblePart(targetToSource.event);
  const targetEventText = bubblePart(sourceToTarget.event);
  const [leftText, rightText] = flipped
    ? [targetEventText, sourceEventText]
    : [sourceEventText, targetEventText];
  const [leftColor, rightColor] = flipped
    ? [targetEventColor, sourceEventColor]
    : [sourceEventColor, targetEventColor];
  const bubbleLabel = `${leftText}|${rightText}`;
  const bubbleWidth = totemBubbleWidth(bubbleLabel);
  const bubbleRx = bubbleWidth / 2;
  const ovalTop = `${bubblePoint.x},${bubblePoint.y - TOTEM_BUBBLE_RY}`;
  const ovalBottom = `${bubblePoint.x},${bubblePoint.y + TOTEM_BUBBLE_RY}`;

  const bar = (point: Point, key: string, color: string) => (
    <line
      key={key}
      x1={point.x + normalX * TOTEM_BAR_HALF_LENGTH}
      y1={point.y + normalY * TOTEM_BAR_HALF_LENGTH}
      x2={point.x - normalX * TOTEM_BAR_HALF_LENGTH}
      y2={point.y - normalY * TOTEM_BAR_HALF_LENGTH}
      stroke={color}
      strokeWidth={TOTEM_BAR_STROKE_WIDTH}
      strokeLinecap="butt"
    />
  );

  const square = (point: Point, color: string) => (
    <rect
      x={point.x - TOTEM_SQUARE_SIZE / 2}
      y={point.y - TOTEM_SQUARE_SIZE / 2}
      width={TOTEM_SQUARE_SIZE}
      height={TOTEM_SQUARE_SIZE}
      fill={color}
    />
  );

  const label = (point: Point, text: string, key: string, color: string) => (
    <text
      key={key}
      x={point.x + normalX * TOTEM_LABEL_OFFSET}
      y={point.y + normalY * TOTEM_LABEL_OFFSET}
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize={TOTEM_LABEL_FONT_SIZE}
      fontFamily={TOTEM_FONT_FAMILY}
      fontWeight="600"
      fill={color}
      style={{ userSelect: 'none' }}
    >
      {text}
    </text>
  );

  return (
    <>
      {elementColors && selected && (
        <path
          d={path}
          fill="none"
          stroke={TOTEM_EDGE_SELECTED_COLOR}
          strokeOpacity={0.3}
          strokeWidth={lineWidth + 8}
          strokeLinecap="round"
          style={{ pointerEvents: 'none' }}
        />
      )}
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={16}
        style={{ stroke: sourceTemporalColor, strokeWidth: lineWidth }}
      />
      <g style={{ pointerEvents: 'none' }}>
        {targetTemporalColor !== sourceTemporalColor && (
          <path
            data-testid="totem-edge-target-half"
            d={targetHalfPath}
            fill="none"
            stroke={targetTemporalColor}
            strokeWidth={lineWidth}
          />
        )}
        {temporal === 'D' && square(end, targetTemporalColor)}
        {temporal === 'Di' && square(start, sourceTemporalColor)}
        {temporal === 'I' && (
          <path d={arrowPath(start, end, TOTEM_ARROW_SIZE)} fill={targetTemporalColor} />
        )}
        {temporal === 'Ii' && (
          <path d={arrowPath(end, start, TOTEM_ARROW_SIZE)} fill={sourceTemporalColor} />
        )}
        {isParallel && [
          bar(start, 'bar-start-outer', sourceTemporalColor),
          bar(innerStart, 'bar-start-inner', sourceTemporalColor),
          bar(innerEnd, 'bar-end-inner', targetTemporalColor),
          bar(end, 'bar-end-outer', targetTemporalColor),
        ]}
        {sourceLabel && label(sourceLabelPoint, sourceLabel, 'log-source', sourceLogColor)}
        {targetLabel && label(targetLabelPoint, targetLabel, 'log-target', targetLogColor)}
        <g transform={`rotate(${bubbleAngle}, ${bubblePoint.x}, ${bubblePoint.y})`}>
          <ellipse
            cx={bubblePoint.x}
            cy={bubblePoint.y}
            rx={bubbleRx}
            ry={TOTEM_BUBBLE_RY}
            fill="#FFFFFF"
            stroke={leftColor === rightColor ? leftColor : 'none'}
            strokeWidth={1.2}
          />
          {leftColor !== rightColor && (
            // Each half of the oval takes the colour of the cardinality inside it.
            <>
              <path
                d={`M ${ovalTop} A ${bubbleRx},${TOTEM_BUBBLE_RY} 0 0 0 ${ovalBottom}`}
                fill="none"
                stroke={leftColor}
                strokeWidth={1.2}
              />
              <path
                d={`M ${ovalTop} A ${bubbleRx},${TOTEM_BUBBLE_RY} 0 0 1 ${ovalBottom}`}
                fill="none"
                stroke={rightColor}
                strokeWidth={1.2}
              />
            </>
          )}
          <text
            x={bubblePoint.x}
            y={bubblePoint.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={TOTEM_BUBBLE_FONT_SIZE}
            fontFamily={TOTEM_FONT_FAMILY}
            fontWeight="600"
            fill={ovalColor}
            style={{ userSelect: 'none' }}
          >
            <tspan fill={leftColor}>{leftText}</tspan>
            <tspan fill={ovalColor}>|</tspan>
            <tspan fill={rightColor}>{rightText}</tspan>
          </text>
        </g>
      </g>
    </>
  );
});

export default TotemRelationEdge;
