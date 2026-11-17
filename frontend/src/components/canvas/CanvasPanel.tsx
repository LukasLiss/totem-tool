/**
 * A panel floating over a graph canvas, opened from a button of the control
 * pill (PillToggle): the frosted frame and the header of the object type
 * panel, with a "Hide" button. Controlled: the host keeps whether it is open, so the
 * pill button and the ✕ stay in step, and renders it only while it is.
 */
import type React from 'react';
import { CANVAS_PANEL_SHELL, PANEL_HEADER_CLASS, PANEL_TEXT_BUTTON_CLASS, PANEL_TITLE_CLASS } from './panelHeader';

export interface CanvasPanelProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Position and size on the canvas (absolute), e.g. top/right/maxHeight. */
  style?: React.CSSProperties;
  /** The panel element, e.g. to fit its content to the room it gets. */
  panelRef?: React.Ref<HTMLDivElement>;
}

export function CanvasPanel({ title, onClose, children, style, panelRef }: CanvasPanelProps) {
  return (
    <div
      ref={panelRef}
      // The canvas below pans on pointer drags; the panel is not part of it.
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ ...CANVAS_PANEL_SHELL, maxHeight: 'min(75%, 380px)', overflowY: 'auto', minWidth: 132, ...style }}
    >
      {/* The object type panel's header (same classes, 24 px buttons): the same height. */}
      <div className={PANEL_HEADER_CLASS}>
        <span className={PANEL_TITLE_CLASS}>{title}</span>
        {/* "Hide", not ✕: the panel only goes out of sight, what it shows (e.g. the animation) goes on. */}
        <button type="button" onClick={onClose} title={`Hide ${title}`} aria-label={`Hide ${title}`} className={PANEL_TEXT_BUTTON_CLASS}>
          Hide
        </button>
      </div>
      <div style={{ padding: '12px 14px 14px' }}>{children}</div>
    </div>
  );
}

export default CanvasPanel;
