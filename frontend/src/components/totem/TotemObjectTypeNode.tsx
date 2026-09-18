import { memo, type CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import { cn } from '@/lib/utils';
import { textColorForBackground } from '@/utils/objectColors';

import {
  TOTEM_EDGE_SELECTED_COLOR,
  TOTEM_FONT_FAMILY,
  TOTEM_NODE_BORDER_COLOR,
  TOTEM_NODE_FONT_SIZE,
  TOTEM_NODE_FONT_WEIGHT,
  TOTEM_NODE_HEIGHT,
  TOTEM_NODE_MIN_WIDTH,
  TOTEM_NODE_PADDING_X,
  TOTEM_NODE_RADIUS,
} from './totemTheme';

export type TotemObjectTypeNodeData = {
  name: string;
  color: string;
};

export type TotemObjectTypeNodeType = Node<TotemObjectTypeNodeData>;

/** Sides a relation can be dragged from when the canvas is editable. */
const CONNECT_POSITIONS: Position[] = [
  Position.Top,
  Position.Right,
  Position.Bottom,
  Position.Left,
];

const visibleHandleStyle: CSSProperties = {
  width: 9,
  height: 9,
  background: '#94A3B8',
  border: '2px solid #FFFFFF',
  borderRadius: '50%',
};

const hiddenHandleStyle: CSSProperties = {
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  background: 'transparent',
  border: 'none',
  opacity: 0,
  pointerEvents: 'none',
};

/**
 * One object type of a TOTeM model: a solid box in the type's colour, drawn
 * like the Analysis TOTeM Miner draws it (see `totemTheme`).
 *
 * The handles exist in every view so React Flow can always resolve an edge's
 * endpoints, but they only become grabbable where the canvas is editable —
 * React Flow reports that through `isConnectable`.
 */
const TotemObjectTypeNode = memo(function TotemObjectTypeNode({
  data,
  selected,
  isConnectable,
}: NodeProps<TotemObjectTypeNodeType>) {
  const color = data.color || TOTEM_EDGE_SELECTED_COLOR;
  const textColor = textColorForBackground(color, {
    minContrast: 3.8,
    gradientSamples: [],
  });

  return (
    <div
      className="group"
      style={{
        position: 'relative',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: TOTEM_NODE_HEIGHT,
        minWidth: TOTEM_NODE_MIN_WIDTH,
        padding: `0 ${TOTEM_NODE_PADDING_X}px`,
        borderRadius: TOTEM_NODE_RADIUS,
        background: color,
        border: `1px solid ${selected ? TOTEM_EDGE_SELECTED_COLOR : TOTEM_NODE_BORDER_COLOR}`,
        boxShadow: selected ? `0 0 0 2px rgba(37, 99, 235, 0.35)` : undefined,
        color: textColor,
        fontFamily: TOTEM_FONT_FAMILY,
        fontSize: TOTEM_NODE_FONT_SIZE,
        fontWeight: TOTEM_NODE_FONT_WEIGHT,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      {CONNECT_POSITIONS.map((position) => (
        <Handle
          key={position}
          id={position}
          type="source"
          position={position}
          isConnectable={isConnectable}
          style={isConnectable ? visibleHandleStyle : hiddenHandleStyle}
          className={
            isConnectable
              ? cn(
                  'transition-opacity duration-150 hover:!bg-[#2563EB]',
                  selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )
              : undefined
          }
        />
      ))}
      {/* Endpoint of last resort: keeps edges resolvable on a strict canvas. */}
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        style={hiddenHandleStyle}
      />
      {data.name}
    </div>
  );
});

export default TotemObjectTypeNode;
