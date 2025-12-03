import { Panel } from '@xyflow/react';
import type { Node } from '@xyflow/react';

export interface DebugLayerInfo {
  layerIndex: number;
  axisPosition: number;
  nodeIds: string[];
  dummyNodeIds: string[];
  bundleGroups: Array<{
    segmentKey: string;
    dummyIds: string[];
    bundleSize: number;
  }>;
}

export interface DebugNodeInfo {
  id: string;
  isDummy: boolean;
  layer: number;
  pos: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isInBundle?: boolean;
  bundleIndex?: number;
  segmentKey?: string;
  belongsToEdge?: string;
}

export interface OCDFGDebugData {
  layers?: DebugLayerInfo[];
  nodes?: DebugNodeInfo[];
  direction?: 'TB' | 'LR';
  layerSep?: number;
  vertexSep?: number;
}

interface OCDFGDebugOverlayProps {
  debugData: OCDFGDebugData | null;
  nodes: Node[];
  enabled: boolean;
}

const BUNDLE_COLORS = [
  '#3B82F6', // Blue
  '#10B981', // Green
  '#F59E0B', // Amber
  '#EC4899', // Pink
  '#8B5CF6', // Violet
  '#14B8A6', // Teal
  '#F97316', // Orange
  '#06B6D4', // Cyan
];

export function OCDFGDebugOverlay({ debugData, nodes, enabled }: OCDFGDebugOverlayProps) {
  if (!enabled || !debugData) return null;

  const { layers, nodes: debugNodes, direction = 'TB' } = debugData;
  const isVertical = direction === 'TB';

  // Calculate bounds for the SVG viewport
  const allX = nodes.map(n => (n.position?.x || 0) + (n.width || 180) / 2);
  const allY = nodes.map(n => (n.position?.y || 0) + (n.height || 72) / 2);
  const minX = Math.min(...allX, 0) - 500;
  const maxX = Math.max(...allX, 1000) + 500;
  const minY = Math.min(...allY, 0) - 500;
  const maxY = Math.max(...allY, 1000) + 500;

  const dummyNodes = debugNodes?.filter(n => n.isDummy) || [];

  // Group bundles for info display
  const bundleGroups = new Map<number, DebugNodeInfo[]>();
  dummyNodes.forEach(node => {
    if (node.isInBundle && node.bundleIndex !== undefined) {
      const existing = bundleGroups.get(node.bundleIndex) || [];
      existing.push(node);
      bundleGroups.set(node.bundleIndex, existing);
    }
  });

  const highwayGroups = layers
    ? layers.flatMap(layer =>
      layer.bundleGroups.map(group => ({
        ...group,
        layerIndex: layer.layerIndex,
      })),
    )
    : [];

  return (
    <>
      {/* Layer Lines using SVG positioned absolutely behind the graph */}
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${maxX - minX}px`,
          height: `${maxY - minY}px`,
          pointerEvents: 'none',
          zIndex: 0,
          transform: `translate(${minX}px, ${minY}px)`,
        }}
      >
        {layers?.map((layer, index) => {
          if (isVertical) {
            const y = layer.axisPosition - minY;
            return (
              <g key={`layer-${index}`}>
                <line
                  x1={0}
                  y1={y}
                  x2={maxX - minX}
                  y2={y}
                  stroke="rgba(147, 51, 234, 0.3)"
                  strokeWidth={2}
                  strokeDasharray="10 5"
                />
                <text
                  x={20}
                  y={y - 8}
                  fill="rgba(147, 51, 234, 0.9)"
                  fontSize={12}
                  fontFamily="monospace"
                  fontWeight="600"
                >
                  L{layer.layerIndex} ({layer.nodeIds.length}n, {layer.dummyNodeIds.length}d)
                </text>
              </g>
            );
          } else {
            const x = layer.axisPosition - minX;
            return (
              <g key={`layer-${index}`}>
                <line
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={maxY - minY}
                  stroke="rgba(147, 51, 234, 0.3)"
                  strokeWidth={2}
                  strokeDasharray="10 5"
                />
                <text
                  x={x + 8}
                  y={20}
                  fill="rgba(147, 51, 234, 0.9)"
                  fontSize={12}
                  fontFamily="monospace"
                  fontWeight="600"
                >
                  L{layer.layerIndex}
                </text>
              </g>
            );
          }
        })}
      </svg>

      {/* Buffer Zones - semi-transparent overlays around nodes */}
      {nodes.map(node => {
        if (!node.position) return null;
        const x = node.position.x;
        const y = node.position.y;
        const width = node.width || 180;
        const height = node.height || 72;
        const bufferSize = 20;

        return (
          <div
            key={`buffer-${node.id}`}
            style={{
              position: 'absolute',
              left: x - bufferSize,
              top: y - bufferSize,
              width: width + 2 * bufferSize,
              height: height + 2 * bufferSize,
              background: 'rgba(255, 235, 59, 0.15)', // Yellow highlight
              border: '1px dashed rgba(255, 193, 7, 0.4)',
              borderRadius: 4,
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
        );
      })}

      {/* Dummy Node Markers - visible circles/squares */}
      {dummyNodes.map((node, idx) => {
        const color = node.isInBundle
          ? BUNDLE_COLORS[(node.bundleIndex || 0) % BUNDLE_COLORS.length]
          : '#EF4444'; // Red for unbundled

        const size = 16;

        return (
          <div
            key={`dummy-${node.id}-${idx}`}
            style={{
              position: 'absolute',
              left: node.x - size / 2,
              top: node.y - size / 2,
              width: size,
              height: size,
              background: color,
              border: '2px solid rgba(0, 0, 0, 0.3)',
              borderRadius: node.isInBundle ? 4 : '50%',
              pointerEvents: 'none',
              zIndex: 1000,
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
            }}
          >
            {node.isInBundle && (
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
                B{node.bundleIndex}
              </div>
            )}
          </div>
        );
      })}

      {/* Debug Info Panel - Top Right */}
      <Panel position="top-right" style={{ margin: 16 }}>
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.95)',
            border: '1px solid rgba(0, 0, 0, 0.1)',
            borderRadius: 8,
            padding: 12,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
            fontFamily: 'monospace',
            fontSize: 11,
            minWidth: 200,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8, color: '#1e293b', fontSize: 13 }}>
            🐛 Debug Info
          </div>

          <div style={{ marginBottom: 8 }}>
            <div style={{ color: '#64748b', fontSize: 10, marginBottom: 2 }}>Layout</div>
            <div style={{ color: '#1e293b' }}>
              <strong>{layers?.length || 0}</strong> layers, <strong>{debugNodes?.length || 0}</strong> nodes
            </div>
            <div style={{ color: '#1e293b' }}>
              Direction: <strong>{direction}</strong>
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            <div style={{ color: '#64748b', fontSize: 10, marginBottom: 2 }}>Dummy Nodes</div>
            <div style={{ color: '#1e293b' }}>
              <strong>{dummyNodes.length}</strong> total
            </div>
            <div style={{ color: '#1e293b' }}>
              <strong>{dummyNodes.filter(n => n.isInBundle).length}</strong> in bundles
            </div>
            <div style={{ color: '#1e293b' }}>
              <strong>{bundleGroups.size}</strong> bundle groups
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            <div style={{ color: '#64748b', fontSize: 10, marginBottom: 2 }}>Highways</div>
            <div style={{ color: '#1e293b' }}>
              <strong>{highwayGroups.length}</strong> segments
            </div>
            <div style={{ color: '#1e293b' }}>
              <strong>{highwayGroups.reduce((sum, group) => sum + group.bundleSize, 0)}</strong> lanes
            </div>
          </div>

          {bundleGroups.size > 0 && (
            <div>
              <div style={{ color: '#64748b', fontSize: 10, marginBottom: 4 }}>Bundles</div>
              {Array.from(bundleGroups.entries()).map(([bundleIndex, bundleNodes]) => {
                const color = BUNDLE_COLORS[bundleIndex % BUNDLE_COLORS.length];
                return (
                  <div
                    key={`bundle-info-${bundleIndex}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginBottom: 3,
                    }}
                  >
                    <div
                      style={{
                        width: 12,
                        height: 12,
                        background: color,
                        borderRadius: 2,
                        border: '1px solid rgba(0,0,0,0.2)',
                      }}
                    />
                    <span style={{ color: '#1e293b' }}>
                      B{bundleIndex}: <strong>{bundleNodes.length}</strong> edges
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {highwayGroups.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ color: '#64748b', fontSize: 10, marginBottom: 4 }}>Highway lanes</div>
              {highwayGroups.map((group, idx) => (
                <div
                  key={`highway-${group.layerIndex}-${group.segmentKey}-${idx}`}
                  style={{
                    marginBottom: 4,
                    padding: '4px 6px',
                    borderRadius: 6,
                    background: 'rgba(236, 72, 153, 0.12)',
                    border: '1px solid rgba(236, 72, 153, 0.4)',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#9d174d' }}>
                    Layer {group.layerIndex}: {group.segmentKey}
                  </div>
                  <div style={{ fontSize: 11, color: '#4c1d95' }}>
                    {group.bundleSize} lane{group.bundleSize === 1 ? '' : 's'}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.1)' }}>
            <div style={{ color: '#64748b', fontSize: 9 }}>
              🔴 Red = unbundled | 🟦 Colored = bundled
            </div>
            <div style={{ color: '#64748b', fontSize: 9 }}>
              🟡 Yellow = buffer zones
            </div>
          </div>
        </div>
      </Panel>
    </>
  );
}
