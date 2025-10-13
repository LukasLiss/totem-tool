const ACTOR_COLORS = ['#2563EB', '#10B981', '#F59E0B', '#8B5CF6', '#F43F5E'];
const EXTENDED_PALETTE = ['#06B6D4', '#84CC16', '#F97316', '#EC4899', '#6366F1'];
const TYPE_PALETTE = [...ACTOR_COLORS, ...EXTENDED_PALETTE];

const FALLBACK_COLOR = '#CBD5F5';

export function mapTypesToColors(types: string[], overrides?: Record<string, string>) {
  const uniqueTypes = Array.from(new Set(types));
  const colorMap: Record<string, string> = {};
  uniqueTypes.forEach((type, index) => {
    colorMap[type] = overrides?.[type] ?? TYPE_PALETTE[index % TYPE_PALETTE.length];
  });
  return colorMap;
}

function lighten(hex: string, factor = 0.12) {
  const stripped = hex.replace('#', '');
  const r = parseInt(stripped.slice(0, 2), 16);
  const g = parseInt(stripped.slice(2, 4), 16);
  const b = parseInt(stripped.slice(4, 6), 16);
  const mix = (channel: number) => Math.min(255, Math.round(channel + (255 - channel) * factor));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export function backgroundForTypes(types: string[], colorMap: Record<string, string>) {
  if (!types || types.length === 0) return FALLBACK_COLOR;
  const unique = Array.from(new Set(types));
  const colors = unique.map((type, idx) => {
    const base = colorMap[type] ?? FALLBACK_COLOR;
    return lighten(base, 0.1 * (idx % 4));
  });
  if (colors.length === 1) return colors[0];
  const step = 100 / (colors.length - 1);
  return `linear-gradient(135deg, ${colors
    .map((color, idx) => `${color} ${Math.round(idx * step)}%`)
    .join(', ')})`;
}
