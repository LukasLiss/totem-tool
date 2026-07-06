import { memo, useMemo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { textColorForBackground } from '../utils/objectColors';
import {
  ACTIVITY_H,
  ACTIVITY_W,
  HANDLE_BINDING_IN,
  HANDLE_BINDING_OUT,
  HANDLE_DEPENDENCY_IN,
  HANDLE_DEPENDENCY_OUT,
  type OccnTerminalNodeData,
} from '../utils/occnTransform';

const handleStyle = {
  opacity: 0,
  background: 'transparent',
  border: 'none',
  width: 10,
  height: 10,
  pointerEvents: 'auto',
} as const;

/**
 * START_<type> / END_<type> terminal activity, ported from OCCN-Miner's
 * StartNode/EndNode (▶ / ⏹ glyph boxes) but styled like OcdfgTerminalNode so
 * the two components read consistently in the dashboard.
 */
const OccnTerminalNode = memo(function OccnTerminalNode({
  data,
}: NodeProps<Node<OccnTerminalNodeData>>) {
  const terminal = data?.terminal === 'end' ? 'end' : 'start';
  const objectType = data?.objectType ?? '';
  const fillColor = data?.fillColor ?? '#1D4ED8';
  const label = data?.label ?? objectType;
  const textColor = useMemo(() => textColorForBackground(fillColor), [fillColor]);
  // Dependency handles follow the layout direction; binding handles stay
  // left/right to face the marker columns inside the group.
  const depIn = data?.direction === 'TB' ? Position.Top : Position.Left;
  const depOut = data?.direction === 'TB' ? Position.Bottom : Position.Right;

  const glyph = terminal === 'end' ? (
    <div
      aria-hidden
      style={{ width: 14, height: 14, borderRadius: 3, background: textColor }}
    />
  ) : (
    <div
      aria-hidden
      style={{
        width: 0,
        height: 0,
        borderTop: '8px solid transparent',
        borderBottom: '8px solid transparent',
        borderLeft: `13px solid ${textColor}`,
      }}
    />
  );

  return (
    <div
      title={label}
      style={{
        width: ACTIVITY_W,
        height: ACTIVITY_H,
        borderRadius: 18,
        background: fillColor,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: '6px 10px',
        border: '1px solid rgba(15, 23, 42, 0.12)',
        boxShadow: '0 8px 18px rgba(15, 23, 42, 0.18)',
      }}
    >
      <Handle type="target" position={depIn} id={HANDLE_DEPENDENCY_IN} style={handleStyle} />
      <Handle type="target" position={Position.Left} id={HANDLE_BINDING_IN} style={handleStyle} />
      {glyph}
      <span
        style={{
          color: textColor,
          fontSize: 11,
          fontWeight: 600,
          textAlign: 'center',
          lineHeight: 1.2,
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {terminal === 'start' ? 'Start' : 'End'} · {objectType}
      </span>
      <Handle type="source" position={depOut} id={HANDLE_DEPENDENCY_OUT} style={handleStyle} />
      <Handle type="source" position={Position.Right} id={HANDLE_BINDING_OUT} style={handleStyle} />
    </div>
  );
});

export default OccnTerminalNode;
