import { Handle, Position } from '@xyflow/react';

import { cn } from '@/lib/utils';

/**
 * Node presentation primitives shared by the OCPN and OC-DFG editors so
 * nodes look and behave identically on both canvases: soft/selected drop
 * shadows, the four arc-start handles, and the play/square marker glyphs.
 */

export const SOFT_SHADOW = '0 6px 16px rgba(15, 23, 42, 0.14)';
export const SELECTED_SHADOW =
  '0 0 0 3px rgba(37, 99, 235, 0.35), 0 6px 16px rgba(15, 23, 42, 0.14)';

const HANDLE_CLASS =
  '!size-2.5 !rounded-full !border-2 !border-white !bg-slate-400 hover:!bg-blue-600';

/**
 * Four handles for STARTING arcs (loose connection mode: every handle is a
 * source), shown while hovering or when the node is selected. Pressing
 * anywhere else on the node drags it. The drawn arc itself floats: it
 * attaches wherever the border faces the other node.
 */
export function NodeHandles({ show }: { show: boolean }) {
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

/** ▶ marker (initial places, START nodes). */
export function PlayGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <polygon points="4,2.5 14,8 4,13.5" fill="#FFFFFF" />
    </svg>
  );
}

/** ■ marker (final places, END nodes). */
export function SquareGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <rect x={3.5} y={3.5} width={9} height={9} fill="#FFFFFF" />
    </svg>
  );
}
