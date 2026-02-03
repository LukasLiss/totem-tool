import { memo } from 'react';
import { getStraightPath, type EdgeProps } from '@xyflow/react';

export type TotemEdgeData = {
  relation: 'D' | 'I' | 'P';
  logCardForward?: string; // source→target, shown near target
  logCardReverse?: string; // target→source, shown near source
  eventCardForward?: string; // source→target
  eventCardReverse?: string; // target→source
  // Node dimensions for boundary calculation
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  // Conformance fitness data
  fitness?: {
    temporal: number | null;
    logCardinality: number | null;
    eventCardinality: number | null;
  };
  // Click handlers for histogram panels
  onEllipseClick?: (source: string, target: string, position: { x: number; y: number }) => void;
  onArcClick?: (source: string, target: string, position: { x: number; y: number }) => void;
  onLogCardClick?: (source: string, target: string, side: 'source' | 'target', position: { x: number; y: number }) => void;
};

const EDGE_COLOR = '#000000';
const EDGE_WIDTH = 2.0;
const BOUNDARY_MARGIN = 8; // Pixels of margin around nodes

// Fitness color helpers
function getFitnessColor(fitness: number | null | undefined): string | undefined {
  if (fitness === null || fitness === undefined) return undefined;
  if (fitness < 0.75) return '#EF4444'; // Red
  if (fitness < 0.9) return '#F97316'; // Orange
  return undefined; // No highlight (good)
}

type Point = { x: number; y: number };

/**
 * Calculate the point where a line from otherPoint to nodeCenter
 * intersects the node's rectangular boundary (plus margin).
 */
function calculateBoundaryPoint(
  nodeCenter: Point,
  otherPoint: Point,
  nodeWidth: number,
  nodeHeight: number
): Point {
  const dx = otherPoint.x - nodeCenter.x;
  const dy = otherPoint.y - nodeCenter.y;

  // If points are the same, return center
  if (dx === 0 && dy === 0) return nodeCenter;

  // Add margin to effective dimensions
  const halfWidth = (nodeWidth / 2) + BOUNDARY_MARGIN;
  const halfHeight = (nodeHeight / 2) + BOUNDARY_MARGIN;

  // Calculate parameter t for intersection with each edge
  // We're going FROM nodeCenter TOWARD otherPoint
  const tX = dx !== 0 ? halfWidth / Math.abs(dx) : Infinity;
  const tY = dy !== 0 ? halfHeight / Math.abs(dy) : Infinity;
  const t = Math.min(tX, tY);

  return {
    x: nodeCenter.x + dx * t,
    y: nodeCenter.y + dy * t,
  };
}

function TotemEdgeComponent({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}: EdgeProps) {
  const edgeData = data as TotemEdgeData | undefined;
  const relation = edgeData?.relation ?? 'P';

  // Default dimensions if not provided
  const sourceWidth = edgeData?.sourceWidth ?? 120;
  const sourceHeight = edgeData?.sourceHeight ?? 36;
  const targetWidth = edgeData?.targetWidth ?? 120;
  const targetHeight = edgeData?.targetHeight ?? 36;

  // Calculate actual boundary connection points
  const sourcePoint = calculateBoundaryPoint(
    { x: sourceX, y: sourceY },
    { x: targetX, y: targetY },
    sourceWidth,
    sourceHeight
  );

  const targetPoint = calculateBoundaryPoint(
    { x: targetX, y: targetY },
    { x: sourceX, y: sourceY },
    targetWidth,
    targetHeight
  );

  // Calculate midpoint for label
  const labelX = (sourcePoint.x + targetPoint.x) / 2;
  const labelY = (sourcePoint.y + targetPoint.y) / 2;

  // Position for P relation bars (12% from each end)
  const barPosition = 0.12;
  const nearSourceX = sourcePoint.x + (targetPoint.x - sourcePoint.x) * barPosition;
  const nearSourceY = sourcePoint.y + (targetPoint.y - sourcePoint.y) * barPosition;
  const nearTargetX = sourcePoint.x + (targetPoint.x - sourcePoint.x) * (1 - barPosition);
  const nearTargetY = sourcePoint.y + (targetPoint.y - sourcePoint.y) * (1 - barPosition);

  // Edge direction for perpendicular calculations
  const edgeDx = targetPoint.x - sourcePoint.x;
  const edgeDy = targetPoint.y - sourcePoint.y;
  const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy) || 1;

  // Get edge paths - for P relation, we split the path to stop at the bars
  const [fullEdgePath] = getStraightPath({
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
  });

  // For P relation: single segment between the two parallel bars
  const [middleSegmentPath] = getStraightPath({
    sourceX: nearSourceX,
    sourceY: nearSourceY,
    targetX: nearTargetX,
    targetY: nearTargetY,
  });

  // Build decorations based on relation type
  const renderMarkers = () => {
    switch (relation) {
      case 'D':
        // Square at target end
        return (
          <rect
            x={targetPoint.x - 6}
            y={targetPoint.y - 6}
            width={12}
            height={12}
            fill={strokeColor}
          />
        );
      case 'I':
        // Arrow pointing toward target
        // Calculate arrow direction
        const arrowSize = 12;
        const dirX = edgeDx / edgeLen;
        const dirY = edgeDy / edgeLen;
        const perpX = -dirY;
        const perpY = dirX;

        // Arrow tip at target boundary point
        const tipX = targetPoint.x;
        const tipY = targetPoint.y;
        // Arrow base points
        const baseX = tipX - dirX * arrowSize;
        const baseY = tipY - dirY * arrowSize;
        const leftX = baseX + perpX * 7;
        const leftY = baseY + perpY * 7;
        const rightX = baseX - perpX * 7;
        const rightY = baseY - perpY * 7;

        return (
          <polygon
            points={`${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`}
            fill={strokeColor}
          />
        );
      case 'P':
        // Parallel bars at both ends
        const barLength = 10;
        const barSpacing = 4;
        // Perpendicular direction
        const pDirX = edgeDx / edgeLen;
        const pDirY = edgeDy / edgeLen;
        const pPerpX = (-pDirY) * barLength;
        const pPerpY = (pDirX) * barLength;

        return (
          <>
            {/* Bars near source */}
            <line
              x1={nearSourceX + pPerpX - barSpacing * pDirX}
              y1={nearSourceY + pPerpY - barSpacing * pDirY}
              x2={nearSourceX - pPerpX - barSpacing * pDirX}
              y2={nearSourceY - pPerpY - barSpacing * pDirY}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <line
              x1={nearSourceX + pPerpX + barSpacing * pDirX}
              y1={nearSourceY + pPerpY + barSpacing * pDirY}
              x2={nearSourceX - pPerpX + barSpacing * pDirX}
              y2={nearSourceY - pPerpY + barSpacing * pDirY}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            {/* Bars near target */}
            <line
              x1={nearTargetX + pPerpX - barSpacing * pDirX}
              y1={nearTargetY + pPerpY - barSpacing * pDirY}
              x2={nearTargetX - pPerpX - barSpacing * pDirX}
              y2={nearTargetY - pPerpY - barSpacing * pDirY}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
            <line
              x1={nearTargetX + pPerpX + barSpacing * pDirX}
              y1={nearTargetY + pPerpY + barSpacing * pDirY}
              x2={nearTargetX - pPerpX + barSpacing * pDirX}
              y2={nearTargetY - pPerpY + barSpacing * pDirY}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
            />
          </>
        );
      default:
        return null;
    }
  };

  // Render cardinality labels
  const hasEventCards = edgeData?.eventCardForward || edgeData?.eventCardReverse;

  // Calculate offset direction for labels (perpendicular to edge)
  const labelOffsetX = (-edgeDy / edgeLen) * 18;
  const labelOffsetY = (edgeDx / edgeLen) * 18;

  // Dynamic event cardinality direction based on visual position (left-to-right)
  const sourceIsLeft = sourcePoint.x <= targetPoint.x;
  const leftEventCard = sourceIsLeft ? edgeData?.eventCardReverse : edgeData?.eventCardForward;
  const rightEventCard = sourceIsLeft ? edgeData?.eventCardForward : edgeData?.eventCardReverse;

  // Get fitness-based colors
  const arcFitnessColor = getFitnessColor(edgeData?.fitness?.temporal);
  const ellipseFitnessColor = getFitnessColor(edgeData?.fitness?.eventCardinality);
  const logCardFitnessColor = getFitnessColor(edgeData?.fitness?.logCardinality);

  const strokeColor = selected ? '#2563eb' : (arcFitnessColor ?? EDGE_COLOR);
  const strokeWidth = selected ? EDGE_WIDTH + 1 : (arcFitnessColor ? EDGE_WIDTH + 0.5 : EDGE_WIDTH);

  return (
    <>
      {/* Main edge path - for P relation, line is between the parallel bars */}
      {relation === 'P' ? (
        <g
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            edgeData?.onArcClick?.(source, target, { x: e.clientX, y: e.clientY });
          }}
        >
          {/* Invisible wider path for easier clicking */}
          <path
            d={middleSegmentPath}
            fill="none"
            stroke="transparent"
            strokeWidth={12}
          />
          <path
            id={id}
            d={middleSegmentPath}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        </g>
      ) : (
        <g
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            edgeData?.onArcClick?.(source, target, { x: e.clientX, y: e.clientY });
          }}
        >
          {/* Invisible wider path for easier clicking */}
          <path
            d={fullEdgePath}
            fill="none"
            stroke="transparent"
            strokeWidth={12}
          />
          <path
            id={id}
            d={fullEdgePath}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        </g>
      )}

      {/* Relation-specific markers */}
      {renderMarkers()}

      {/* Log cardinality near source (reverse direction) */}
      {edgeData?.logCardReverse && (
        <g
          transform={`translate(${nearSourceX + labelOffsetX}, ${nearSourceY + labelOffsetY})`}
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            edgeData?.onLogCardClick?.(source, target, 'source', { x: e.clientX, y: e.clientY });
          }}
        >
          <text
            fontSize={12}
            fontWeight={logCardFitnessColor ? 600 : 500}
            fill={logCardFitnessColor ?? '#374151'}
            fontFamily="system-ui, sans-serif"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {edgeData.logCardReverse}
          </text>
        </g>
      )}

      {/* Log cardinality near target (forward direction) */}
      {edgeData?.logCardForward && (
        <g
          transform={`translate(${nearTargetX + labelOffsetX}, ${nearTargetY + labelOffsetY})`}
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            edgeData?.onLogCardClick?.(source, target, 'target', { x: e.clientX, y: e.clientY });
          }}
        >
          <text
            fontSize={12}
            fontWeight={logCardFitnessColor ? 600 : 500}
            fill={logCardFitnessColor ?? '#374151'}
            fontFamily="system-ui, sans-serif"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {edgeData.logCardForward}
          </text>
        </g>
      )}

      {/* Event cardinality ellipse in middle - direction based on visual position */}
      {hasEventCards && (
        <g
          transform={`translate(${labelX}, ${labelY})`}
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            edgeData?.onEllipseClick?.(source, target, { x: e.clientX, y: e.clientY });
          }}
        >
          {/* Ellipse background */}
          <ellipse
            cx={0}
            cy={0}
            rx={34}
            ry={14}
            fill="white"
            stroke={ellipseFitnessColor ?? '#d1d5db'}
            strokeWidth={ellipseFitnessColor ? 2 : 1}
          />
          {/* Event cardinality text - shows (left | right) based on visual position */}
          <text
            x={0}
            y={4}
            fontSize={11}
            fontWeight={ellipseFitnessColor ? 600 : 500}
            fill={ellipseFitnessColor ?? '#374151'}
            fontFamily="system-ui, sans-serif"
            textAnchor="middle"
          >
            {leftEventCard || '-'} | {rightEventCard || '-'}
          </text>
        </g>
      )}
    </>
  );
}

export const TotemEdge = memo(TotemEdgeComponent);
export default TotemEdge;
