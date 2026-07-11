import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';

type TotemAreaNodeData = {
  label: string;
  level: number;
  objectTypeCount: number;
};

const PROCESS_AREA_BACKGROUND = 'rgba(59, 130, 246, 0.16)';
const PROCESS_AREA_BORDER = 'rgba(37, 99, 235, 0.35)';
const PROCESS_AREA_INSET_SHADOW = 'inset 0 0 0 1px rgba(37, 99, 235, 0.12)';

const TotemAreaNode = memo(function TotemAreaNode({ data, selected, width, height }: NodeProps<TotemAreaNodeData>) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        width: width ?? '100%',
        height: height ?? '100%',
        background: PROCESS_AREA_BACKGROUND,
        border: `1.5px solid ${selected ? 'rgba(37, 99, 235, 0.8)' : PROCESS_AREA_BORDER}`,
        boxShadow: selected ? '0 0 0 4px rgba(37, 99, 235, 0.2)' : PROCESS_AREA_INSET_SHADOW,
        borderRadius: 28,
        pointerEvents: 'none', // Allow clicking through to the child nodes
        zIndex: -1,
      }}
    >
      {/* Legend rendered relative to the Area Node */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          right: -32,
          transform: 'translate(100%, -50%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          whiteSpace: 'nowrap',
          pointerEvents: 'auto',
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: '#1e293b',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          LEVEL {data.level}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: '#64748b',
          }}
        >
          {data.objectTypeCount} object type{data.objectTypeCount !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
});

export default TotemAreaNode;
