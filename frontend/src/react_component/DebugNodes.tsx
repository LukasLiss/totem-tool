import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';

// Debug Dummy Node - shows dummy node markers
export const DebugDummyNode = memo(({ data }: NodeProps) => {
  const color = data.color || '#EF4444';
  const isInBundle = data.isInBundle || false;
  const bundleIndex = data.bundleIndex;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: color,
        border: '2px solid rgba(0, 0, 0, 0.3)',
        borderRadius: isInBundle ? 4 : '50%',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
        position: 'relative',
      }}
    >
      {isInBundle && bundleIndex !== undefined && (
        <div
          style={{
            position: 'absolute',
            top: -20,
            left: '50%',
            transform: 'translateX(-50%)',
            background: color,
            color: 'white',
            fontSize: 9,
            fontWeight: 700,
            padding: '2px 5px',
            borderRadius: 3,
            whiteSpace: 'nowrap',
            fontFamily: 'monospace',
          }}
        >
          B{bundleIndex}
        </div>
      )}
    </div>
  );
});

DebugDummyNode.displayName = 'DebugDummyNode';

// Debug Buffer Zone - shows routing buffers around nodes
export const DebugBufferNode = memo(({ data, width, height }: NodeProps) => {
  return (
    <div
      style={{
        width: width || '100%',
        height: height || '100%',
        background: 'rgba(255, 235, 59, 0.15)',
        border: '1px dashed rgba(255, 193, 7, 0.4)',
        borderRadius: 4,
        pointerEvents: 'none',
      }}
    />
  );
});

DebugBufferNode.displayName = 'DebugBufferNode';

// Debug Layer Line - shows layer boundaries
export const DebugLayerNode = memo(({ data }: NodeProps) => {
  const direction = data.direction || 'TB';
  const layerIndex = data.layerIndex || 0;
  const nodeCount = data.nodeCount || 0;
  const dummyCount = data.dummyCount || 0;

  if (direction === 'TB') {
    // Horizontal line for top-to-bottom layout
    return (
      <div style={{ position: 'relative', width: 1, height: 1 }}>
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: -5000,
            width: 10000,
            height: 40,
            overflow: 'visible',
            pointerEvents: 'none',
          }}
        >
          <line
            x1="0"
            y1="0"
            x2="10000"
            y2="0"
            stroke="rgba(147, 51, 234, 0.35)"
            strokeWidth={2}
            strokeDasharray="10 5"
          />
          <text
            x="20"
            y="-8"
            fill="rgba(147, 51, 234, 0.9)"
            fontSize={12}
            fontFamily="monospace"
            fontWeight="600"
          >
            L{layerIndex} ({nodeCount}n, {dummyCount}d)
          </text>
        </svg>
      </div>
    );
  } else {
    // Vertical line for left-to-right layout
    return (
      <div style={{ position: 'relative', width: 1, height: 1 }}>
        <svg
          style={{
            position: 'absolute',
            top: -5000,
            left: 0,
            width: 40,
            height: 10000,
            overflow: 'visible',
            pointerEvents: 'none',
          }}
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="10000"
            stroke="rgba(147, 51, 234, 0.35)"
            strokeWidth={2}
            strokeDasharray="10 5"
          />
          <text
            x="8"
            y="20"
            fill="rgba(147, 51, 234, 0.9)"
            fontSize={12}
            fontFamily="monospace"
            fontWeight="600"
          >
            L{layerIndex}
          </text>
        </svg>
      </div>
    );
  }
});

DebugLayerNode.displayName = 'DebugLayerNode';
