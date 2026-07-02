import { memo, type CSSProperties } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import { lightenHex } from '@/editors/shared/colors';
import { cn } from '@/lib/utils';

import type { TotemTypeNodeType } from './types';

const HANDLE_POSITIONS: Position[] = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];

const handleStyle: CSSProperties = {
  width: 9,
  height: 9,
  background: '#94A3B8',
  border: '2px solid #FFFFFF',
  borderRadius: '50%',
};

/**
 * Object type node: rounded rectangle with a colored accent bar, matching the
 * design of the tool's analysis TotemNode. Four subtle source handles
 * (top/right/bottom/left) become visible on hover/selection; with
 * ConnectionMode.Loose they also accept incoming connections.
 */
const TotemTypeNode = memo(function TotemTypeNode({
  data,
  selected,
}: NodeProps<TotemTypeNodeType>) {
  const color = data.color || '#2563EB';
  return (
    <div
      className="group"
      style={{
        position: 'relative',
        minWidth: 120,
        padding: '16px 18px 14px',
        borderRadius: 14,
        background: lightenHex(color, 0.9),
        color: '#0F172A',
        boxShadow: selected
          ? '0 0 0 3px rgba(37, 99, 235, 0.35), 0 14px 30px rgba(15, 23, 42, 0.18)'
          : '0 12px 28px rgba(15, 23, 42, 0.14)',
        border: selected
          ? '1px solid rgba(37, 99, 235, 0.6)'
          : '1px solid rgba(15, 23, 42, 0.08)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: '0 0 auto 0',
          height: 5,
          borderRadius: '14px 14px 0 0',
          background: color,
          opacity: 0.75,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          lineHeight: 1.2,
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap',
          textAlign: 'center',
        }}
      >
        {data.name}
      </div>
      {HANDLE_POSITIONS.map((position) => (
        <Handle
          key={position}
          id={position}
          type="source"
          position={position}
          style={handleStyle}
          className={cn(
            'transition-opacity duration-150 hover:!bg-[#2563EB]',
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        />
      ))}
    </div>
  );
});

export default TotemTypeNode;
