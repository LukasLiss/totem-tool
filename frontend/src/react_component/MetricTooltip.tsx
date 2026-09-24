import React, { useEffect, useState, useRef } from 'react';

/** One "label: value" line of a hover tooltip. */
export interface TooltipRow {
  label: string;
  value: string;
}

interface HoverTooltipProps {
  /** Pointer position in viewport coordinates (clientX / clientY). */
  x: number;
  y: number;
  title?: string;
  rows: TooltipRow[];
}

/**
 * The tooltip surface every hover in the tool shares: a small card that
 * follows the pointer and flips at the window edges so it never leaves the
 * viewport.
 *
 * Rendered `position: fixed`, so a caller inside an SVG (a React Flow edge,
 * say) has to portal it into the body — a div is not valid SVG content.
 */
export function HoverTooltip({ x, y, title, rows }: HoverTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState({ x, y });

  useEffect(() => {
    if (!tooltipRef.current) return;
    const rect = tooltipRef.current.getBoundingClientRect();
    let newX = x + 15;
    let newY = y + 15;

    // Adjust for right edge
    if (newX + rect.width > window.innerWidth) {
      newX = x - rect.width - 15;
    }

    // Adjust for bottom edge
    if (newY + rect.height > window.innerHeight) {
      newY = y - rect.height - 15;
    }

    setAdjustedPos({ x: newX, y: newY });
  }, [x, y, title, rows]);

  if (rows.length === 0 && !title) return null;

  return (
    <div
      ref={tooltipRef}
      style={{
        position: 'fixed',
        left: adjustedPos.x,
        top: adjustedPos.y,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        border: '1px solid #e2e8f0',
        borderRadius: '6px',
        padding: '12px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        zIndex: 9999,
        pointerEvents: 'none',
        minWidth: '150px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {title && (
        <div style={{ fontWeight: 600, marginBottom: '8px', fontSize: '13px', color: '#1e293b' }}>
          {title}
        </div>
      )}
      {rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: '12px', color: '#475569' }}>
          {rows.map((row) => (
            <React.Fragment key={row.label}>
              <div style={{ fontWeight: 500 }}>{row.label}:</div>
              <div style={{ textAlign: 'right' }}>{row.value}</div>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

interface MetricTooltipProps {
  x: number;
  y: number;
  metrics: { frequency?: number; avg_lead_time?: number } | null;
  label?: string;
}

const formatDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds === null || seconds < 0) return 'N/A';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86400).toFixed(1)} days`;
};

/** Frequency and average lead time of a discovered edge. */
export function MetricTooltip({ x, y, metrics, label }: MetricTooltipProps) {
  if (!metrics) return null;

  const rows: TooltipRow[] = [
    {
      label: 'Frequency',
      value: metrics.frequency !== undefined ? metrics.frequency.toLocaleString() : 'N/A',
    },
  ];
  if (metrics.avg_lead_time !== undefined && metrics.avg_lead_time !== null) {
    rows.push({ label: 'Avg Time', value: formatDuration(metrics.avg_lead_time) });
  }

  return <HoverTooltip x={x} y={y} title={label} rows={rows} />;
}
