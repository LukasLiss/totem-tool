import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';

type TerminalVariant = 'start' | 'end';

type TerminalNodeData = {
  label: string;
  fillColor: string;
  nodeVariant: TerminalVariant;
  types?: string[];
};

const BASE_SIZE = 80;

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

function resolveNumericDimension(value?: CSSProperties['width']): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const numeric = parseFloat(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return undefined;
}

const OcdfgTerminalNode = memo(function OcdfgTerminalNode({
  data,
  style,
  width: nodeWidth,
  height: nodeHeight,
}: NodeProps<TerminalNodeData>) {
  const label = data?.label ?? 'Terminal';
  const fillColor = data?.fillColor ?? '#1D4ED8';
  const variant: TerminalVariant = data?.nodeVariant === 'end' ? 'end' : 'start';

  const textColor = useMemo(() => getReadableColor(fillColor), [fillColor]);
  const {
    width: rawWidth,
    height: rawHeight,
    ...styleRest
  } = (style ?? {}) as CSSProperties;
  const resolvedWidth = (typeof nodeWidth === 'number' && Number.isFinite(nodeWidth))
    ? nodeWidth
    : resolveNumericDimension(rawWidth) ?? BASE_SIZE;
  const resolvedHeight = (typeof nodeHeight === 'number' && Number.isFinite(nodeHeight))
    ? nodeHeight
    : resolveNumericDimension(rawHeight) ?? BASE_SIZE;
  const effectiveSize = Math.max(4, Math.min(resolvedWidth, resolvedHeight));
  const scale = Math.max(0.2, Math.min(effectiveSize / BASE_SIZE, 2));
  const paddingY = Math.max(4, 14 * scale);
  const paddingX = Math.max(4, 10 * scale);
  const gap = Math.max(2, 8 * scale);
  const borderRadius = Math.max(6, 18 * scale);
  const indicatorSize = Math.max(6, 18 * scale);
  const indicatorRadius = Math.max(3, 6 * scale);
  const triangleHeight = Math.max(5, 11 * scale);
  const triangleWidth = Math.max(6, 18 * scale);
  const fontSize = Math.max(9, 11 * scale);
  const boxShadowY = 14 * scale;
  const boxShadowBlur = 24 * Math.max(scale, 0.35);
  const borderWidth = Math.max(1, 1.1 * scale);

  const containerStyle: CSSProperties = {
    width: resolvedWidth,
    height: resolvedHeight,
    ...styleRest,
    position: 'relative',
    borderRadius,
    background: fillColor,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap,
    padding: `${paddingY}px ${paddingX}px`,
    boxShadow: `0 ${boxShadowY}px ${boxShadowBlur}px rgba(15, 23, 42, 0.22)`,
    border: `${borderWidth}px solid rgba(15, 23, 42, 0.08)`,
  };

  const indicator =
    variant === 'end'
      ? (
        <div
          aria-hidden
          style={{
            width: indicatorSize,
            height: indicatorSize,
            borderRadius: indicatorRadius,
            background: textColor,
            boxShadow: `0 ${3 * scale}px ${6 * scale}px rgba(15, 23, 42, 0.18)`,
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
            borderTop: `${triangleHeight}px solid transparent`,
            borderBottom: `${triangleHeight}px solid transparent`,
            borderLeft: `${triangleWidth}px solid ${textColor}`,
            filter: `drop-shadow(0 ${3 * scale}px ${6 * scale}px rgba(15, 23, 42, 0.18))`,
            position: 'relative',
            zIndex: 1,
          }}
        />
      );

  return (
    <div
      aria-label={label}
      title={label}
      style={containerStyle}
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
          fontSize,
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
