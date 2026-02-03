import { memo } from 'react';
import { useReactFlow } from '@xyflow/react';
import { buildBufferRectsFromNodes, BUFFER_ZONE_MARGIN } from '../utils/edgeCurveGeneration';

interface BufferZoneDebugProps {
  enabled: boolean;
}

/**
 * Debug overlay that visualizes buffer zones used for edge collision detection.
 * Renders semi-transparent rectangles around nodes showing the buffer margin.
 */
export const BufferZoneDebug = memo(({ enabled }: BufferZoneDebugProps) => {
  const reactFlow = useReactFlow();

  if (!enabled) {
    return null;
  }

  const allNodes = reactFlow.getNodes();
  const buffers = buildBufferRectsFromNodes(allNodes, BUFFER_ZONE_MARGIN);

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1000,
      }}
    >
      {buffers.map((buffer) => (
        <rect
          key={buffer.id}
          x={buffer.left}
          y={buffer.top}
          width={buffer.right - buffer.left}
          height={buffer.bottom - buffer.top}
          fill="rgba(255, 232, 138, 0.25)"
          stroke="rgba(255, 180, 0, 0.8)"
          strokeWidth="2"
          strokeDasharray="6 3"
        />
      ))}
      <text
        x="10"
        y="30"
        fill="rgba(255, 180, 0, 1)"
        fontSize="12"
        fontWeight="bold"
        fontFamily="monospace"
      >
        Buffer Zones ({BUFFER_ZONE_MARGIN}px margin) - {buffers.length} nodes
      </text>
    </svg>
  );
});

BufferZoneDebug.displayName = 'BufferZoneDebug';
