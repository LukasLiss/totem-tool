/**
 * Object type color handling for the model editors. Uses the same palette as
 * the analysis views (see utils/objectColors) so object types look identical
 * across the whole tool.
 */

export const EDITOR_PALETTE = [
  '#2563EB',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#F43F5E',
  '#06B6D4',
  '#84CC16',
  '#F97316',
  '#EC4899',
  '#6366F1',
];

const isHex = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

/**
 * Assign a color to every named entry: explicit colors win, remaining entries
 * get stable palette colors that avoid the already used ones.
 */
export function assignTypeColors(
  types: Array<{ name: string; color?: string }>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const used = new Set<string>();
  for (const type of types) {
    if (isHex(type.color)) {
      result[type.name] = type.color;
      used.add(type.color.toUpperCase());
    }
  }
  let cursor = 0;
  for (const type of types) {
    if (result[type.name]) continue;
    while (
      cursor < EDITOR_PALETTE.length &&
      used.has(EDITOR_PALETTE[cursor].toUpperCase())
    ) {
      cursor += 1;
    }
    const color = EDITOR_PALETTE[cursor % EDITOR_PALETTE.length] ?? EDITOR_PALETTE[0];
    cursor += 1;
    result[type.name] = color;
    used.add(color.toUpperCase());
  }
  return result;
}

/** First palette color not used yet — for newly added object types. */
export function nextFreeColor(usedColors: Iterable<string>): string {
  const used = new Set(
    Array.from(usedColors, (color) => color.toUpperCase()),
  );
  for (const color of EDITOR_PALETTE) {
    if (!used.has(color.toUpperCase())) return color;
  }
  return EDITOR_PALETTE[Math.floor(Math.random() * EDITOR_PALETTE.length)];
}

/** Lighten a hex color towards white; used for soft node fills. */
export function lightenHex(hex: string, factor = 0.85): string {
  if (!isHex(hex)) return '#F8FAFC';
  const channel = (offset: number) =>
    Math.min(
      255,
      Math.round(
        parseInt(hex.slice(offset, offset + 2), 16) +
          (255 - parseInt(hex.slice(offset, offset + 2), 16)) * factor,
      ),
    );
  return `rgb(${channel(1)}, ${channel(3)}, ${channel(5)})`;
}

/** Black or white text depending on background luminance. */
export function contrastText(hex: string): string {
  if (!isHex(hex)) return '#0F172A';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#0F172A' : '#FFFFFF';
}
