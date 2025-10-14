import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

type TerminalVariant = 'start' | 'end';

type TerminalNodeData = {
  label: string;
  fillColor: string;
  nodeVariant: TerminalVariant;
  types?: string[];
};

function sanitizeHex(color: string): string | null {
  if (!color || typeof color !== 'string') return null;
  const hex = color.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return hex.toLowerCase();
  }
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return hex
      .split('')
      .map(char => char + char)
      .join('')
      .toLowerCase();
  }
  return null;
}

function getReadableColor(color: string): string {
  const sanitized = sanitizeHex(color);
  if (!sanitized) {
    return '#0F172A';
  }
  const r = parseInt(sanitized.slice(0, 2), 16);
  const g = parseInt(sanitized.slice(2, 4), 16);
  const b = parseInt(sanitized.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#0F172A' : '#F8FAFC';
}

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

const OcdfgTerminalNode = memo(function OcdfgTerminalNode({
  data,
}: NodeProps<TerminalNodeData>) {
  const label = data?.label ?? 'Terminal';
  const fillColor = data?.fillColor ?? '#1D4ED8';
  const variant: TerminalVariant = data?.nodeVariant === 'end' ? 'end' : 'start';

  const textColor = useMemo(() => getReadableColor(fillColor), [fillColor]);

  const indicator =
    variant === 'end'
      ? (
        <div
          aria-hidden
          style={{
            width: 18,
            height: 18,
            borderRadius: 6,
            background: textColor,
            boxShadow: '0 3px 6px rgba(15, 23, 42, 0.18)',
            position: 'relative',
            zIndex: 1,
          }}
        />
      )
      : (
        <div
          aria-hidden
          style={{
            width: 0,
            height: 0,
            borderTop: '11px solid transparent',
            borderBottom: '11px solid transparent',
            borderLeft: `18px solid ${textColor}`,
            filter: 'drop-shadow(0 3px 6px rgba(15, 23, 42, 0.18))',
            position: 'relative',
            zIndex: 1,
          }}
        />
      );

  return (
    <div
      aria-label={label}
      title={label}
      style={{
        width: 80,
        height: 80,
        position: 'relative',
        borderRadius: 18,
        background: fillColor,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '14px 10px',
        boxShadow: '0 14px 24px rgba(15, 23, 42, 0.22)',
        border: '1px solid rgba(15, 23, 42, 0.08)',
      }}
    >
      {variant !== 'start' && (
        <Handle
          type="target"
          position={Position.Top}
          style={handleStyle}
        />
      )}
      {variant !== 'end' && (
        <Handle
          type="source"
          position={Position.Bottom}
          style={handleStyle}
        />
      )}
      {indicator}
      <span
        style={{
          color: textColor,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '-0.015em',
          textAlign: 'center',
          lineHeight: 1.2,
          maxWidth: '100%',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {label}
      </span>
    </div>
  );
});

export default OcdfgTerminalNode;
