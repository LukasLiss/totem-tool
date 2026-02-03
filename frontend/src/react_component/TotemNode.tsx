import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { textColorForBackground } from '../utils/objectColors';

export type TotemNodeData = {
  label: string;
  color: string;
};

// Invisible centered handles - edges connect at boundary via custom calculation
const centerHandleStyle: React.CSSProperties = {
  opacity: 0,
  background: 'transparent',
  border: 'none',
  width: 1,
  height: 1,
  position: 'absolute',
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  pointerEvents: 'none',
};

function TotemNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as TotemNodeData;
  const textColor = textColorForBackground(nodeData.color, { minContrast: 3.8 });

  return (
    <div
      style={{
        background: nodeData.color,
        padding: '8px 16px',
        borderRadius: 6,
        border: selected ? '2px solid #2563eb' : '1px solid rgba(0,0,0,0.2)',
        fontSize: 13,
        fontWeight: 600,
        fontFamily: 'system-ui, sans-serif',
        color: textColor,
        minWidth: 80,
        textAlign: 'center',
        cursor: 'grab',
        boxShadow: selected
          ? '0 0 0 2px rgba(37, 99, 235, 0.3), 0 2px 4px rgba(0,0,0,0.15)'
          : '0 1px 3px rgba(0,0,0,0.12)',
      }}
    >
      <Handle type="target" position={Position.Top} style={centerHandleStyle} />
      {nodeData.label}
      <Handle type="source" position={Position.Bottom} style={centerHandleStyle} />
    </div>
  );
}

export const TotemNode = memo(TotemNodeComponent);
export default TotemNode;
