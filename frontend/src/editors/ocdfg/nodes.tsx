import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';

import {
  NodeHandles,
  PlayGlyph,
  SELECTED_SHADOW,
  SOFT_SHADOW,
  SquareGlyph,
} from '@/editors/shared/node-chrome';

import {
  ACTIVITY_HEIGHT,
  ACTIVITY_WIDTH,
  CONTROL_SIZE,
  type ActivityFlowNode,
  type ControlFlowNode,
} from './types';

/** Activity node — same look as an OCPN transition (label + type dots). */
export const ActivityNode = memo(function ActivityNode({
  data,
  selected,
}: NodeProps<ActivityFlowNode>) {
  return (
    <div
      className="group"
      style={{
        position: 'relative',
        minWidth: ACTIVITY_WIDTH - 10,
        minHeight: ACTIVITY_HEIGHT - 4,
        borderRadius: 10,
        background: '#FFFFFF',
        border: selected ? '1.5px solid rgba(37, 99, 235, 0.6)' : '1.5px solid #CBD5E1',
        boxShadow: selected ? SELECTED_SHADOW : SOFT_SHADOW,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: '8px 14px',
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: '#0F172A',
          lineHeight: 1.2,
          textAlign: 'center',
          whiteSpace: 'nowrap',
        }}
      >
        {data.label || 'unnamed'}
      </div>
      {data.typeDotColors.length > 0 && (
        <div style={{ display: 'flex', gap: 4 }}>
          {/* Index keys: two types may share a color, and the list is a
              stable projection of the object-type order. */}
          {data.typeDotColors.map((color, index) => (
            <span
              key={index}
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: color,
                display: 'inline-block',
              }}
            />
          ))}
        </div>
      )}
      <NodeHandles show={selected === true} />
    </div>
  );
});

/** START (▶) / END (■) marker node of one object type — a filled circle. */
export const ControlNode = memo(function ControlNode({
  data,
  selected,
}: NodeProps<ControlFlowNode>) {
  return (
    <div
      className="group"
      style={{ position: 'relative', width: CONTROL_SIZE, height: CONTROL_SIZE }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: `2.5px solid ${data.color}`,
          background: data.color,
          boxShadow: selected ? SELECTED_SHADOW : SOFT_SHADOW,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {data.kind === 'start' ? <PlayGlyph size={16} /> : <SquareGlyph size={15} />}
      </div>
      <NodeHandles show={selected === true} />
      <div
        style={{
          position: 'absolute',
          top: CONTROL_SIZE + 5,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 10,
          fontWeight: 500,
          color: '#64748B',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        {data.kind === 'start' ? 'start' : 'end'} · {data.objectType}
      </div>
    </div>
  );
});

export const nodeTypes = {
  activity: ActivityNode,
  control: ControlNode,
};
