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
  const colors = useMemo(
    () => ((data?.colors as Record<string, string> | undefined) ?? {}),
    [data?.colors],
  );
  const nodeTypes = useMemo(
    () => Array.isArray((data as any)?.types)
      ? ((data as any).types as unknown[])
        .filter((t): t is string => typeof t === 'string' && t.length > 0)
      : [],
    [data],
  );
  const typeOrder = useMemo(() => {
    const explicit = Array.isArray((data as any)?.typeOrder)
      ? ((data as any).typeOrder as unknown[])
        .filter((t): t is string => typeof t === 'string' && t.length > 0)
      : [];
    if (explicit.length > 0) return explicit;
    return Object.keys(colors).sort();
  }, [data, colors]);
  const visibleTypes = useMemo(() => {
    if (typeOrder.length === 0) return nodeTypes;
    return typeOrder.filter((t) => nodeTypes.includes(t));
  }, [typeOrder, nodeTypes]);
  const baseStyle = useMemo(
    () => ({
      ...(style ?? {}),
      position: 'relative' as const,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center' as const,
      flexDirection: 'column' as const,
      gap: 6,
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
      {visibleTypes.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
            zIndex: 1,
          }}
        >
          {visibleTypes.map((type) => {
            const isMember = nodeTypes.includes(type);
            const color = colors[type] ?? '#CBD5E1';
            const size = 14;
            const thickness = 2;
            return (
              <div
                key={type}
                title={type}
                style={{
                  width: size,
                  height: size,
                  borderRadius: '50%',
                  border: `${thickness}px solid ${color}`,
                  background: isMember ? color : 'transparent',
                  boxSizing: 'border-box',
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});

export default OcdfgDefaultNode;
