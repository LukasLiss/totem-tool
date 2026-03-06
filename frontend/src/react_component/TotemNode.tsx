import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

type TotemNodeData = {
  label: string;
  events?: string[];
  color?: string;
};

const handleStyle = {
  opacity: 0,
  background: 'transparent',
  border: 'none',
  width: 14,
  height: 14,
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  pointerEvents: 'auto',
} as const;

function lighten(hex: string, factor = 0.18) {
  const sanitized = hex.replace('#', '');
  if (sanitized.length !== 6) return hex;
  const clamp = (value: number) => Math.min(255, Math.max(0, value));
  const r = parseInt(sanitized.slice(0, 2), 16);
  const g = parseInt(sanitized.slice(2, 4), 16);
  const b = parseInt(sanitized.slice(4, 6), 16);
  const mix = (channel: number) => clamp(Math.round(channel + (255 - channel) * factor));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

const TotemNode = memo(function TotemNode({
  data,
  selected,
}: NodeProps<TotemNodeData>) {
  const label = data?.label ?? 'Unknown';
  const events = data?.events ?? [];
  const background = useMemo(() => {
    if (data?.color && /^#?[0-9a-f]{6}$/i.test(data.color)) {
      return lighten(data.color.startsWith('#') ? data.color : `#${data.color}`);
    }
    return '#F8FAFC';
  }, [data?.color]);
  const displayedEvents = events.slice(0, 4);
  const remainingCount = Math.max(0, events.length - displayedEvents.length);

  return (
    <div
      style={{
        position: 'relative',
        minWidth: 200,
        maxWidth: 240,
        padding: '18px 18px 16px',
        borderRadius: 18,
        background,
        color: '#0F172A',
        boxShadow: selected
          ? '0 0 0 3px rgba(37, 99, 235, 0.35), 0 16px 32px rgba(15, 23, 42, 0.2)'
          : '0 12px 28px rgba(15, 23, 42, 0.18)',
        border: selected ? '1px solid rgba(37, 99, 235, 0.6)' : '1px solid rgba(15, 23, 42, 0.05)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <Handle type="source" position={Position.Bottom} style={handleStyle} />

      {data?.color && (
        <div
          style={{
            position: 'absolute',
            inset: '0 0 auto 0',
            height: 6,
            borderRadius: '18px 18px 0 0',
            background: data.color,
            opacity: 0.65,
          }}
        />
      )}

      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          lineHeight: 1.2,
          letterSpacing: '-0.01em',
        }}
      >
        {label}
      </div>

      {displayedEvents.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'rgba(15, 23, 42, 0.65)',
            }}
          >
            Event Types
          </span>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {displayedEvents.map((eventType) => (
              <li
                key={eventType}
                style={{
                  background: 'rgba(15, 23, 42, 0.04)',
                  borderRadius: 10,
                  padding: '6px 10px',
                  fontSize: 13,
                  fontWeight: 500,
                  color: '#0F172A',
                }}
              >
                {eventType}
              </li>
            ))}
            {remainingCount > 0 && (
              <li
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'rgba(15, 23, 42, 0.55)',
                }}
              >
                +{remainingCount} more
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
});

export default TotemNode;
