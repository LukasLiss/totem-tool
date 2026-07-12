import { memo, useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import { lightenHex } from '@/editors/shared/colors';

import {
  ACTIVITY_HEIGHT,
  ACTIVITY_WIDTH,
  OccnRenderContext,
  PSEUDO_WIDTH,
  type OccnNode,
} from './types';

const HANDLE_CLASS =
  '!size-2.5 !rounded-full !border-2 !border-white !bg-slate-400 hover:!bg-blue-600 transition-colors';

const selectedShadow =
  '0 0 0 3px rgba(37, 99, 235, 0.35), 0 12px 28px rgba(15, 23, 42, 0.18)';
const restShadow = '0 6px 18px rgba(15, 23, 42, 0.12)';

/** Horizontal-stripe fill, one stripe per incident object type (paper style). */
function stripeBackground(types: string[], colors: Record<string, string>): string {
  if (types.length === 0) return '#FFFFFF';
  const tones = types.map((type) => lightenHex(colors[type] ?? '#94A3B8', 0.45));
  if (tones.length === 1) return tones[0];
  const stops: string[] = [];
  const step = 100 / tones.length;
  tones.forEach((tone, index) => {
    stops.push(`${tone} ${(index * step).toFixed(2)}%`);
    stops.push(`${tone} ${((index + 1) * step).toFixed(2)}%`);
  });
  return `linear-gradient(to bottom, ${stops.join(', ')})`;
}

const OccnNodeComponent = memo(function OccnNodeComponent({
  id,
  data,
  selected,
}: NodeProps<OccnNode>) {
  const { typeColors, incidentTypes } = useContext(OccnRenderContext);

  if (data.kind !== 'activity') {
    const color = typeColors[data.objectType ?? ''] ?? '#64748B';
    const squareSize = 48;
    return (
      <div
        className="flex flex-col items-center gap-1"
        style={{ width: PSEUDO_WIDTH }}
      >
        <Handle
          type="target"
          position={Position.Left}
          className={HANDLE_CLASS}
          style={{ top: squareSize / 2, opacity: data.kind === 'start' ? 0 : 1 }}
          isConnectable={data.kind === 'end'}
        />
        <div
          style={{
            width: squareSize,
            height: squareSize,
            borderRadius: 12,
            background: color,
            border: selected
              ? '1.5px solid rgba(37, 99, 235, 0.8)'
              : '1.5px solid rgba(15, 23, 42, 0.55)',
            boxShadow: selected ? selectedShadow : restShadow,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {data.kind === 'start' ? (
            <svg width={16} height={16} viewBox="0 0 16 16">
              <polygon points="3,1.5 14,8 3,14.5" fill="#FFFFFF" />
            </svg>
          ) : (
            <svg width={16} height={16} viewBox="0 0 16 16">
              <rect x={2.5} y={2.5} width={11} height={11} fill="#FFFFFF" />
            </svg>
          )}
        </div>
        <div
          className="max-w-24 truncate text-center font-semibold"
          style={{ fontSize: 10, color, lineHeight: '12px' }}
          title={data.objectType}
        >
          {data.objectType}
        </div>
        <Handle
          type="source"
          position={Position.Right}
          className={HANDLE_CLASS}
          style={{ top: squareSize / 2, opacity: data.kind === 'end' ? 0 : 1 }}
          isConnectable={data.kind === 'start'}
        />
      </div>
    );
  }

  const types = incidentTypes[id] ?? [];
  return (
    <div
      style={{
        minWidth: ACTIVITY_WIDTH,
        minHeight: ACTIVITY_HEIGHT,
        borderRadius: 12,
        background: stripeBackground(types, typeColors),
        border: selected
          ? '1.5px solid rgba(37, 99, 235, 0.8)'
          : types.length === 0
            ? '1.5px solid #94A3B8'
            : '1.5px solid rgba(15, 23, 42, 0.45)',
        boxShadow: selected ? selectedShadow : restShadow,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px 14px',
      }}
    >
      <Handle type="target" position={Position.Left} className={HANDLE_CLASS} />
      <div className="text-center">
        <div
          className="font-semibold"
          style={{ color: '#0F172A', fontSize: 14, lineHeight: 1.2, maxWidth: 200 }}
        >
          {data.label}
        </div>
        {data.count != null && (
          <div style={{ color: '#0F172A', fontSize: 10, opacity: 0.75 }}>
            ×{data.count}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className={HANDLE_CLASS} />
    </div>
  );
});

export default OccnNodeComponent;
