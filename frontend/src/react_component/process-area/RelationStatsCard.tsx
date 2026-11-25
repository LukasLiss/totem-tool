import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/**
 * Hover / click card of a relation arc in the Process Area Visualizer.
 *
 * Hovering shows the strict TOTeM (tau = 100%) of the connected pair in both
 * directions: the temporal relation, the event cardinality and the log
 * cardinality. Clicking pins the card and expands it to every possible value
 * of each relation family with the share of related object pairs that
 * satisfy it.
 */

import {
  relationStatsKey,
  type RelationFamily,
  type RelationStats,
  type RelationStatsIndex,
} from './relationStats';

const FAMILIES: Array<{ key: RelationFamily; label: string; values: string[] }> = [
  { key: 'temporal', label: 'Temporal', values: ['D', 'Di', 'I', 'Ii', 'P'] },
  { key: 'event_cardinality', label: 'Event cardinality', values: ['0', '1', '0...1', '1..*', '0...*'] },
  { key: 'log_cardinality', label: 'Log cardinality', values: ['0', '1', '0...1', '1..*', '0...*'] },
];

const TEMPORAL_LABELS: Record<string, string> = {
  D: 'During',
  Di: 'Contains (inverse during)',
  I: 'Precedes',
  Ii: 'Preceded by',
  P: 'Parallel',
};

const CARDINALITY_LABELS: Record<string, string> = {
  '0': '0',
  '1': '1',
  '0...1': '0..1',
  '1..*': '1..*',
  '0...*': '0..*',
};

function valueLabel(family: RelationFamily, value: string | undefined): string {
  if (!value || value === 'None') return 'none';
  if (value === 'ERROR 0') return 'no related pairs';
  if (family === 'temporal') return TEMPORAL_LABELS[value] ?? value;
  return CARDINALITY_LABELS[value] ?? value;
}

function share(stats: RelationStats, family: RelationFamily, value: string): number | null {
  const counts = stats.counts[family] ?? {};
  const total = counts.total ?? 0;
  if (total <= 0) return null;
  return (counts[value] ?? 0) / total;
}

function formatShare(value: number | null): string {
  if (value === null) return '–';
  if (value === 0 || value === 1) return `${value * 100}%`;
  if (value < 0.001) return '<0.1%';
  if (value > 0.999) return '>99.9%';
  return `${(value * 100).toFixed(1)}%`;
}

function DirectionSection({
  from,
  to,
  stats,
  expanded,
}: {
  from: string;
  to: string;
  stats: RelationStats | undefined;
  expanded: boolean;
}) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', marginBottom: 4 }}>
        {from} {'→'} {to}
      </div>
      {!stats ? (
        <div style={{ fontSize: 12, color: '#94a3b8' }}>No statistics available.</div>
      ) : (
        FAMILIES.map(({ key, label, values }) => {
          const strict = stats.strict[key];
          const total = stats.counts[key]?.total ?? 0;
          return (
            <div key={key} style={{ marginBottom: expanded ? 8 : 2 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 16,
                  fontSize: 12,
                  color: '#475569',
                }}
              >
                <span style={{ fontWeight: 500 }}>{label}:</span>
                <span style={{ color: '#0f172a', fontWeight: 600 }}>{valueLabel(key, strict)}</span>
              </div>
              {expanded && (
                <div style={{ marginTop: 3 }}>
                  {values.map((value) => {
                    const fraction = share(stats, key, value);
                    const isStrict = value === strict;
                    return (
                      <div
                        key={value}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '150px 1fr 48px',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 11,
                          color: isStrict ? '#0f172a' : '#64748b',
                          fontWeight: isStrict ? 600 : 400,
                          lineHeight: '17px',
                        }}
                      >
                        <span>{valueLabel(key, value)}</span>
                        <span
                          style={{
                            height: 6,
                            borderRadius: 3,
                            background: '#e2e8f0',
                            overflow: 'hidden',
                          }}
                        >
                          <span
                            style={{
                              display: 'block',
                              height: '100%',
                              width: `${(fraction ?? 0) * 100}%`,
                              background: isStrict ? '#2563eb' : '#94a3b8',
                            }}
                          />
                        </span>
                        <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatShare(fraction)}
                        </span>
                      </div>
                    );
                  })}
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                    {total.toLocaleString()}{' '}
                    {key === 'event_cardinality'
                      ? `events with ${from}`
                      : key === 'log_cardinality'
                        ? `${from} objects`
                        : 'related object pairs'}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

export function RelationStatsCard({
  x,
  y,
  from,
  to,
  relationLabel,
  stats,
  pinned,
  onClose,
}: {
  /** Pointer position in viewport coordinates. */
  x: number;
  y: number;
  from: string;
  to: string;
  /** The relation the arc is drawn for. */
  relationLabel: string;
  stats: RelationStatsIndex;
  pinned: boolean;
  onClose?: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: x + 15, y: y + 15 });

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x + 15;
    let top = y + 15;
    if (left + rect.width > window.innerWidth - 8) left = Math.max(8, x - rect.width - 15);
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - rect.height - 8);
    setPosition({ x: left, y: top });
  }, [x, y, pinned, from, to]);

  // A pinned card closes on Escape or a press anywhere outside it.
  useEffect(() => {
    if (!pinned || !onClose) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointerDown, true);
    };
  }, [pinned, onClose]);

  const forward = stats.get(relationStatsKey(from, to));
  const backward = stats.get(relationStatsKey(to, from));

  return (
    <div
      ref={cardRef}
      data-totem-control
      onMouseDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 9999,
        width: pinned ? 340 : 260,
        maxHeight: 'calc(100vh - 16px)',
        overflowY: 'auto',
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        padding: 12,
        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)',
        pointerEvents: pinned ? 'auto' : 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        cursor: 'default',
        userSelect: pinned ? 'text' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
            {from} {'↔'} {to}
          </div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            Arc: {relationLabel} · TOTeM at {'τ'} = 100%
          </div>
        </div>
        {pinned && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: 'none',
              background: 'transparent',
              color: '#64748b',
              cursor: 'pointer',
              padding: 2,
              borderRadius: 4,
              display: 'inline-flex',
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>
      <DirectionSection from={from} to={to} stats={forward} expanded={pinned} />
      <DirectionSection from={to} to={from} stats={backward} expanded={pinned} />
      {pinned ? (
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, lineHeight: 1.4 }}>
          Share of related pairs for which each value holds. Cardinality classes
          overlap (0..1 includes 0 and 1); the strict value is the most precise one
          that holds for all of them.
        </div>
      ) : (
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>
          Click the arc for the full distribution.
        </div>
      )}
    </div>
  );
}

export default RelationStatsCard;
