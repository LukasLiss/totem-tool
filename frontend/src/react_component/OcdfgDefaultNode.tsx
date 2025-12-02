import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

type NodeVariant = 'center' | 'start' | 'end';

type DefaultNodeData = {
  label?: string;
  nodeVariant?: NodeVariant;
};

const handleStyle = {
  opacity: 0,
  background: 'transparent',
  border: 'none',
  width: 14,
  height: 14,
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  pointerEvents: 'auto',
} as const;

const OcdfgDefaultNode = memo(function OcdfgDefaultNode({
  data,
  style,
}: NodeProps<DefaultNodeData>) {
  const label = useMemo(() => (data?.label ?? '').trim(), [data?.label]);
  const baseStyle = useMemo(
    () => ({
      ...(style ?? {}),
      position: 'relative' as const,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center' as const,
    }),
    [style],
  );

  return (
    <div style={baseStyle}>
      <Handle
        type="target"
        position={Position.Top}
        style={handleStyle}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={handleStyle}
      />
      <span
        style={{
          position: 'relative',
          zIndex: 1,
          overflow: 'hidden',
          textAlign: 'center',
          lineHeight: 1.25,
        }}
      >
        {label}
      </span>
    </div>
  );
});

export default OcdfgDefaultNode;
