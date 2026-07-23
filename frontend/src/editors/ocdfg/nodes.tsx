import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';

import { contrastText } from '@/editors/shared/colors';
import {
  NodeHandles,
  SELECTED_SHADOW,
  SOFT_SHADOW,
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

/**
 * START (▶) / END (●) marker node of one object type — the same visual
 * language as the analysis views' OC-DFG terminal nodes
 * (react_component/OcdfgTerminalNode.tsx): a rounded square filled with the
 * type color, a triangle (start) or dot (end) in the readable contrast
 * color, and the object type name inside the tile.
 */
export const ControlNode = memo(function ControlNode({
  data,
  selected,
}: NodeProps<ControlFlowNode>) {
  const textColor = contrastText(data.color);
  return (
    <div
      className="group"
      style={{
        position: 'relative',
        width: CONTROL_SIZE,
        height: CONTROL_SIZE,
        borderRadius: 18,
        background: data.color,
        border: selected
          ? '1.5px solid rgba(37, 99, 235, 0.6)'
          : '1px solid rgba(15, 23, 42, 0.08)',
        boxShadow: selected ? SELECTED_SHADOW : SOFT_SHADOW,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: 8,
      }}
    >
      {data.kind === 'start' ? (
        <div
          aria-hidden
          style={{
            width: 0,
            height: 0,
            borderTop: '12px solid transparent',
            borderBottom: '12px solid transparent',
            borderLeft: `18px solid ${textColor}`,
            filter: 'drop-shadow(0 3px 6px rgba(15, 23, 42, 0.18))',
          }}
        />
      ) : (
        <div
          aria-hidden
          style={{
            width: 24,
            height: 24,
            borderRadius: 10,
            background: textColor,
            boxShadow: '0 3px 6px rgba(15, 23, 42, 0.18)',
          }}
        />
      )}
      <span
        style={{
          color: textColor,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '-0.015em',
          textAlign: 'center',
          lineHeight: 1.2,
          maxWidth: '100%',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
        title={`${data.objectType} ${data.kind}`}
      >
        {data.objectType}
      </span>
      <NodeHandles show={selected === true} />
    </div>
  );
});

export const nodeTypes = {
  activity: ActivityNode,
  control: ControlNode,
};
