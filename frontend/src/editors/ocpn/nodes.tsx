import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import {
  PLACE_SIZE,
  SILENT_HEIGHT,
  SILENT_WIDTH,
  TRANSITION_HEIGHT,
  TRANSITION_WIDTH,
  type PlaceFlowNode,
  type TransitionFlowNode,
} from './types';

const SOFT_SHADOW = '0 6px 16px rgba(15, 23, 42, 0.14)';
const SELECTED_SHADOW = '0 0 0 3px rgba(37, 99, 235, 0.35), 0 6px 16px rgba(15, 23, 42, 0.14)';

const HANDLE_CLASS =
  '!size-2.5 !rounded-full !border-2 !border-white !bg-slate-400 hover:!bg-blue-600';

/**
 * Four handles for STARTING arcs (loose connection mode: every handle is a
 * source), shown while hovering or when the node is selected — same flow as
 * the TOTeM editor. Pressing anywhere else on the node drags it. The drawn
 * arc itself floats: it attaches wherever the border faces the other node.
 */
function NodeHandles({ show }: { show: boolean }) {
  const className = cn(
    HANDLE_CLASS,
    'transition-opacity duration-150',
    show ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
  );
  return (
    <>
      <Handle id="top" type="source" position={Position.Top} className={className} />
      <Handle id="right" type="source" position={Position.Right} className={className} />
      <Handle id="bottom" type="source" position={Position.Bottom} className={className} />
      <Handle id="left" type="source" position={Position.Left} className={className} />
    </>
  );
}

function PlayGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <polygon points="4,2.5 14,8 4,13.5" fill="#FFFFFF" />
    </svg>
  );
}

function SquareGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <rect x={3.5} y={3.5} width={9} height={9} fill="#FFFFFF" />
    </svg>
  );
}

export const PlaceNode = memo(function PlaceNode({
  id,
  data,
  selected,
}: NodeProps<PlaceFlowNode>) {
  const marked = data.initial || data.final;
  return (
    <div
      className="group"
      style={{ position: 'relative', width: PLACE_SIZE, height: PLACE_SIZE }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: `2.5px solid ${data.color}`,
          background: marked ? data.color : '#FFFFFF',
          boxShadow: selected ? SELECTED_SHADOW : SOFT_SHADOW,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
        }}
      >
        {data.initial && data.final ? (
          <>
            <PlayGlyph size={11} />
            <SquareGlyph size={10} />
          </>
        ) : data.initial ? (
          <PlayGlyph size={16} />
        ) : data.final ? (
          <SquareGlyph size={15} />
        ) : null}
      </div>
      <NodeHandles show={selected === true} />
      <div
        style={{
          position: 'absolute',
          top: PLACE_SIZE + 5,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 10,
          fontWeight: 500,
          color: '#64748B',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        {id}
      </div>
    </div>
  );
});

export const TransitionNode = memo(function TransitionNode({
  data,
  selected,
}: NodeProps<TransitionFlowNode>) {
  if (data.silent) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="group"
            style={{ position: 'relative', width: SILENT_WIDTH, height: SILENT_HEIGHT }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 10,
                background: '#0F172A',
                border: selected
                  ? '1.5px solid rgba(37, 99, 235, 0.6)'
                  : '1.5px solid #0F172A',
                boxShadow: selected ? SELECTED_SHADOW : SOFT_SHADOW,
              }}
            />
            <NodeHandles show={selected === true} />
          </div>
        </TooltipTrigger>
        <TooltipContent>silent transition (τ)</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div
      className="group"
      style={{
        position: 'relative',
        minWidth: TRANSITION_WIDTH - 10,
        minHeight: TRANSITION_HEIGHT - 4,
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
          {data.typeDotColors.map((color) => (
            <span
              key={color}
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

export const nodeTypes = {
  place: PlaceNode,
  transition: TransitionNode,
};
