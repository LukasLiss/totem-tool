import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
} from "@xyflow/react";

import type { TotemConformanceEdgeType } from "./visualizationFlow";

type Point = { x: number; y: number };

const DEFAULT_EDGE_COLOR = "#334155";
const SELECTED_EDGE_COLOR = "#2563EB";

function nodeBounds(
  node: InternalNode
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

function rectangleBoundary(
  center: Point,
  halfWidth: number,
  halfHeight: number,
  toward: Point
): Point {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const horizontal = dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx);
  const vertical = dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy);
  const scale = Math.min(horizontal, vertical);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function SquareGlyph({ fill }: { fill: string }) {
  return <rect x={2} y={-4} width={8} height={8} rx={1} fill={fill} />;
}

function ArrowGlyph({ fill }: { fill: string }) {
  return <path d="M 0 0 L 10 -5 L 10 5 Z" fill={fill} />;
}

function ParallelGlyph({ stroke }: { stroke: string }) {
  return (
    <path
      d="M 7 -5 L 7 5 M 12 -5 L 12 5"
      stroke={stroke}
      strokeWidth={1.8}
      strokeLinecap="round"
    />
  );
}

const TotemConformanceEdge = memo(function TotemConformanceEdge({
  id,
  source,
  target,
  selected,
  data,
}: EdgeProps<TotemConformanceEdgeType>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode || !data) return null;

  const sourceBounds = nodeBounds(sourceNode);
  const targetBounds = nodeBounds(targetNode);
  if (!sourceBounds || !targetBounds) return null;

  const start = rectangleBoundary(
    sourceBounds.center,
    sourceBounds.halfWidth,
    sourceBounds.halfHeight,
    targetBounds.center
  );
  const end = rectangleBoundary(
    targetBounds.center,
    targetBounds.halfWidth,
    targetBounds.halfHeight,
    sourceBounds.center
  );
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 12) return null;

  const unitX = dx / length;
  const unitY = dy / length;
  const normalX = -unitY;
  const normalY = unitX;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const sourceTransform = `translate(${start.x}, ${start.y}) rotate(${angle})`;
  const targetTransform = `translate(${end.x}, ${end.y}) rotate(${angle + 180})`;
  const color = selected
    ? SELECTED_EDGE_COLOR
    : data.strokeColor ?? DEFAULT_EDGE_COLOR;
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const flipped = angle > 90 || angle < -90;
  const labelAngle = flipped ? angle + 180 : angle;
  const sourceLogPosition = {
    x: start.x + unitX * 28 + normalX * 13,
    y: start.y + unitY * 28 + normalY * 13,
  };
  const targetLogPosition = {
    x: end.x - unitX * 28 + normalX * 13,
    y: end.y - unitY * 28 + normalY * 13,
  };
  const eventLeft = flipped
    ? data.sourceToTarget.event
    : data.targetToSource.event;
  const eventRight = flipped
    ? data.targetToSource.event
    : data.sourceToTarget.event;

  return (
    <>
      <g>
        <BaseEdge
          id={id}
          path={`M ${start.x},${start.y} L ${end.x},${end.y}`}
          interactionWidth={18}
          style={{ stroke: color, strokeWidth: selected ? 2.4 : 1.8 }}
        />
        {data.temporal === "D" && (
          <g transform={targetTransform}>
            <SquareGlyph fill={color} />
          </g>
        )}
        {data.temporal === "Di" && (
          <g transform={sourceTransform}>
            <SquareGlyph fill={color} />
          </g>
        )}
        {data.temporal === "I" && (
          <g transform={targetTransform}>
            <ArrowGlyph fill={color} />
          </g>
        )}
        {data.temporal === "Ii" && (
          <g transform={sourceTransform}>
            <ArrowGlyph fill={color} />
          </g>
        )}
        {data.temporal === "P" && (
          <>
            <g transform={sourceTransform}>
              <ParallelGlyph stroke={color} />
            </g>
            <g transform={targetTransform}>
              <ParallelGlyph stroke={color} />
            </g>
          </>
        )}
      </g>

      <EdgeLabelRenderer>
        <CardinalityLabel
          value={data.targetToSource.log}
          position={sourceLogPosition}
        />
        <CardinalityLabel
          value={data.sourceToTarget.log}
          position={targetLogPosition}
        />
        <div
          className="nodrag nopan absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${midpoint.x}px, ${midpoint.y}px) rotate(${labelAngle}deg)`,
            pointerEvents: "none",
          }}
        >
          <span
            className="whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[10px] font-medium text-white"
            style={{ background: color }}
          >
            {displayCardinality(eventLeft)} / {displayCardinality(eventRight)}
          </span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

function CardinalityLabel({
  value,
  position,
}: {
  value: string | null;
  position: Point;
}) {
  return (
    <div
      className="nodrag nopan absolute rounded-sm bg-white/90 px-1 text-[10px] font-medium text-slate-700"
      style={{
        transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px)`,
        pointerEvents: "none",
      }}
    >
      {displayCardinality(value)}
    </div>
  );
}

function displayCardinality(value: string | null): string {
  return value ?? "-";
}

export default TotemConformanceEdge;
