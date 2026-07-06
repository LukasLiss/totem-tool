import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  ACTIVITY_H,
  ACTIVITY_W,
  HANDLE_DEPENDENCY_IN,
  HANDLE_DEPENDENCY_OUT,
  type OccnActivityNodeData,
} from '../utils/occnTransform';

const handleStyle = {
  opacity: 0,
  background: 'transparent',
  border: 'none',
  width: 10,
  height: 10,
  pointerEvents: 'auto',
} as const;

const OccnActivityNode = memo(function OccnActivityNode({
  data,
}: NodeProps<Node<OccnActivityNodeData>>) {
  const label = data?.label ?? 'Activity';
  const count = data?.count ?? 0;
  const background = data?.background ?? '#CBD5F5';
  const textColor = data?.textColor ?? '#0F172A';
  const types = data?.types ?? [];

  return (
    <div
      title={types.length > 0 ? `Object types: ${types.join(', ')}` : label}
      style={{
        width: ACTIVITY_W,
        height: ACTIVITY_H,
        borderRadius: 8,
        background,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        padding: '6px 10px',
        border: '1px solid rgba(15, 23, 42, 0.12)',
        boxShadow: '0 8px 18px rgba(15, 23, 42, 0.14)',
      }}
    >
      <Handle type="target" position={Position.Left} id={HANDLE_DEPENDENCY_IN} style={handleStyle} />
      <span
        style={{
          color: textColor,
          fontSize: 12,
          fontWeight: 600,
          textAlign: 'center',
          lineHeight: 1.25,
          maxWidth: '100%',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {label}
      </span>
      <span style={{ color: textColor, fontSize: 10, opacity: 0.85 }}>{count}</span>
      <Handle type="source" position={Position.Right} id={HANDLE_DEPENDENCY_OUT} style={handleStyle} />
    </div>
  );
});

export default OccnActivityNode;
