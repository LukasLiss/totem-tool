import type { NodeProps } from '@xyflow/react';

type DebugLayerData = {
  color?: string;
  label?: string;
  direction?: 'TB' | 'LR';
};

export function OcdfgDebugLayerNode({ data }: NodeProps<DebugLayerData>) {
  const color = data?.color ?? 'rgba(255, 232, 138, 0.45)';
  const label = data?.label ?? '';
  const isVertical = (data?.direction ?? 'TB') === 'TB';

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: color,
        borderRadius: 6,
        boxShadow: '0 1px 6px rgba(0, 0, 0, 0.12) inset',
        opacity: 0.85,
        pointerEvents: 'none',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {label && (
        <div
          style={{
            position: 'absolute',
            top: isVertical ? -16 : '50%',
            left: isVertical ? 12 : -16,
            transform: isVertical ? 'none' : 'translateY(-50%)',
            background: 'rgba(0, 0, 0, 0.72)',
            color: '#FFF8E1',
            padding: '2px 6px',
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 700,
            fontFamily: 'monospace',
            letterSpacing: 0.2,
            lineHeight: 1.1,
            pointerEvents: 'none',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.18)',
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

export default OcdfgDebugLayerNode;
