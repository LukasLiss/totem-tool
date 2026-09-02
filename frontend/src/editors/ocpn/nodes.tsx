import { memo } from 'react';
import { type NodeProps } from '@xyflow/react';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  NodeHandles,
  PlayGlyph,
  SELECTED_SHADOW,
  SOFT_SHADOW,
  SquareGlyph,
} from '@/editors/shared/node-chrome';

import {
  PLACE_SIZE,
  SILENT_HEIGHT,
  SILENT_WIDTH,
  TRANSITION_HEIGHT,
  TRANSITION_WIDTH,
  type PlaceFlowNode,
  type TransitionFlowNode,
} from './types';

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
