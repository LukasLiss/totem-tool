import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  MARKER_DOT,
  MARKER_GROUP_PAD_V,
  MARKER_GROUP_W,
  MARKER_ROW_H,
  markerRowCenter,
  type OccnMarkerGroupNodeData,
} from '../utils/occnTransform';

/**
 * One AND marker group, rendered as a single node: the group's markers stacked
 * inside a rounded outline (the outline itself expresses the AND semantics),
 * each with a colored dot — circle for "exactly one" object, square for a
 * collection, mirroring OCCN-Miner's ObligationNode radius rule — and an
 * always-visible cardinality label (`1`, `2..7`, `1..∞`).
 *
 * Each marker row exposes its own Handle (id `m<i>`) on the activity-facing
 * side so the transform can draw one binding edge per marker.
 */
const OccnMarkerGroupNode = memo(function OccnMarkerGroupNode({
  data,
}: NodeProps<Node<OccnMarkerGroupNodeData>>) {
  const side = data?.side ?? 'input';
  const markers = data?.markers ?? [];
  const supportCount = data?.supportCount;
  const overflowCount = data?.overflowCount;
  const isAnd = markers.length > 1;
  const handlePosition = side === 'input' ? Position.Right : Position.Left;
  const handleType = side === 'input' ? 'source' : 'target';

  if (overflowCount) {
    return (
      <div
        title={`${overflowCount} additional ${side} marker groups are hidden. Raise the occurrence threshold to prune the net.`}
        style={{
          width: MARKER_GROUP_W,
          height: 26,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 10,
          background: '#F8FAFC',
          border: '1px dashed #94A3B8',
          fontSize: 10,
          fontWeight: 600,
          color: '#64748B',
          boxSizing: 'border-box',
        }}
      >
        +{overflowCount} more
      </div>
    );
  }

  return (
    <div
      style={{
        width: MARKER_GROUP_W,
        padding: `${MARKER_GROUP_PAD_V}px 8px`,
        borderRadius: 10,
        background: '#FFFFFF',
        border: isAnd ? '1.5px solid #64748B' : '1px solid #CBD5E1',
        boxShadow: '0 4px 10px rgba(15, 23, 42, 0.08)',
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      {isAnd && (
        <span
          style={{
            position: 'absolute',
            top: -8,
            left: 8,
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: '#475569',
            background: '#FFFFFF',
            padding: '0 4px',
            borderRadius: 4,
            border: '1px solid #CBD5E1',
            lineHeight: '12px',
          }}
        >
          AND
        </span>
      )}
      {supportCount !== null && supportCount !== undefined && (
        <span
          style={{
            position: 'absolute',
            bottom: -8,
            right: 8,
            fontSize: 8,
            fontWeight: 600,
            color: '#475569',
            background: '#F1F5F9',
            padding: '0 4px',
            borderRadius: 4,
            border: '1px solid #CBD5E1',
            lineHeight: '12px',
          }}
          title={`Support count: ${supportCount}`}
        >
          ×{supportCount}
        </span>
      )}
      {markers.map((marker, i) => (
        <div
          key={marker.handleId}
          title={`${marker.objectType} — related activity: ${marker.relatedActivity} (key: ${marker.markerKey})`}
          style={{
            height: MARKER_ROW_H,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <div
            style={{
              width: MARKER_DOT,
              height: MARKER_DOT,
              flexShrink: 0,
              borderRadius: marker.shape === 'circle' ? '50%' : 4,
              background: marker.color,
              border: '1px solid rgba(15, 23, 42, 0.25)',
            }}
          />
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: '#334155',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {marker.cardinality}
          </span>
          <Handle
            type={handleType}
            position={handlePosition}
            id={marker.handleId}
            style={{
              opacity: 0,
              background: 'transparent',
              border: 'none',
              width: 8,
              height: 8,
              top: markerRowCenter(i),
              pointerEvents: 'auto',
            }}
          />
        </div>
      ))}
    </div>
  );
});

export default OccnMarkerGroupNode;
