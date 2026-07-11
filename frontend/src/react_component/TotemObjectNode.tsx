import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

type TotemObjectNodeData = {
  label: string;
  color?: string;
  isExpanded?: boolean;
};

const TotemObjectNode = memo(function TotemObjectNode({ data, selected }: NodeProps<TotemObjectNodeData>) {
  const label = data?.label ?? 'Unknown';
  
  const background = useMemo(() => {
    if (data?.color && /^#?[0-9a-f]{6}$/i.test(data.color)) {
      return data.color.startsWith('#') ? data.color : `#${data.color}`;
    }
    return '#3B82F6';
  }, [data?.color]);

  return (
    <div
      style={{
        position: 'relative',
        minWidth: 180,
        minHeight: 80,
        padding: '16px 20px',
        borderRadius: 18,
        background,
        color: '#FFFFFF',
        boxShadow: selected
          ? '0 0 0 3px rgba(37, 99, 235, 0.35), 0 16px 32px rgba(15, 23, 42, 0.2)'
          : '0 8px 16px rgba(15, 23, 42, 0.12)',
        border: selected ? '1px solid rgba(255, 255, 255, 0.8)' : '1px solid rgba(0, 0, 0, 0.05)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left} id="left" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} id="right" style={{ opacity: 0 }} />

      <div
        style={{
          fontSize: 18,
          fontWeight: 600,
          lineHeight: 1.2,
          letterSpacing: '-0.01em',
          textAlign: 'center',
          textShadow: '0 1px 2px rgba(0,0,0,0.1)',
        }}
      >
        {label}
      </div>
    </div>
  );
});

export default TotemObjectNode;
