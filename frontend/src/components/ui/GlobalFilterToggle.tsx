import React from 'react';
import { Filter, Globe2 } from 'lucide-react';

const BUTTON_BASE_STYLE = {
  display: 'inline-flex', alignItems: 'center', gap: 2,
  padding: '3px 7px', borderRadius: 9999,
  cursor: 'pointer',
  transition: 'background 120ms, border-color 120ms, color 120ms',
  position: 'relative' as const, overflow: 'hidden',
} as const;

const stopPointerDown = (e: React.PointerEvent) => e.stopPropagation();

interface GlobalFilterToggleProps {
  filterEnabled: boolean;
  onToggle: () => void;
  stopPropagation?: boolean;
}

export function GlobalFilterToggle({ filterEnabled, onToggle, stopPropagation = false }: GlobalFilterToggleProps) {
  return (
    <button
      onClick={onToggle}
      onPointerDown={stopPropagation ? stopPointerDown : undefined}
      title={filterEnabled ? 'Global filter active — click to disable' : 'Global filter off — click to enable'}
      style={{
        ...BUTTON_BASE_STYLE,
        background: filterEnabled ? '#111827' : 'transparent',
        border: `1px solid ${filterEnabled ? '#111827' : '#cbd5e1'}`,
        color: filterEnabled ? '#ffffff' : '#94a3b8',
      }}
    >
      <Filter size={12} strokeWidth={2.5} />
      <Globe2 size={10} strokeWidth={2} />
      {!filterEnabled && (
        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <line x1="10" y1="90" x2="90" y2="10" stroke="#94a3b8" strokeWidth="10" />
        </svg>
      )}
    </button>
  );
}
