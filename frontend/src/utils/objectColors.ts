const ACTOR_COLORS = ['#2563EB', '#10B981', '#F59E0B', '#8B5CF6', '#F43F5E'];
const EXTENDED_PALETTE = ['#06B6D4', '#84CC16', '#F97316', '#EC4899', '#6366F1'];
const TYPE_PALETTE = [...ACTOR_COLORS, ...EXTENDED_PALETTE];

const FALLBACK_COLOR = '#CBD5F5';
const DARK_TEXT = '#0F172A';
const LIGHT_TEXT = '#FFFFFF';

export function mapTypesToColors(types: string[], overrides?: Record<string, string>) {
  const uniqueTypes = Array.from(
    new Set(types.filter((t): t is string => typeof t === 'string' && t.length > 0)),
  ).sort((a, b) => a.localeCompare(b));
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

type RGB = { r: number; g: number; b: number };

function parseColor(input: string): RGB | null {
  const value = input.trim();

  if (/^#([a-f0-9]{3}|[a-f0-9]{6})$/i.test(value)) {
    const hex = value.slice(1);
    const normalized = hex.length === 3
      ? hex.split('').map((c) => c + c).join('')
      : hex;
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return { r, g, b };
  }

  const rgbMatch = value.match(/^rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*(0|0?\.\d+|1(?:\.0+)?))?\s*\)$/i);
  if (rgbMatch) {
    const r = Math.min(255, parseInt(rgbMatch[1], 10));
    const g = Math.min(255, parseInt(rgbMatch[2], 10));
    const b = Math.min(255, parseInt(rgbMatch[3], 10));
    return { r, g, b };
  }

  return null;
}

function relativeLuminance({ r, g, b }: RGB): number {
  const toLinear = (channel: number) => {
    const srgb = channel / 255;
    return srgb <= 0.03928
      ? srgb / 12.92
      : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };

  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);

  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(foreground: RGB, background: RGB): number {
  const L1 = relativeLuminance(foreground);
  const L2 = relativeLuminance(background);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

function interpolateColor(a: RGB, b: RGB, t: number): RGB {
  const clampT = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(a.r + (b.r - a.r) * clampT),
    g: Math.round(a.g + (b.g - a.g) * clampT),
    b: Math.round(a.b + (b.b - a.b) * clampT),
  };
}

type RawGradientStop = {
  color: RGB;
  position: number | null;
};

function parseGradientStops(gradient: string): RawGradientStop[] {
  const stopRegex = /(rgba?\([^()]+\)|#(?:[0-9a-f]{3}){1,2})(?:\s+(\d+(?:\.\d+)?)%)?/gi;
  const matches: RawGradientStop[] = [];
  let match: RegExpExecArray | null;

  while ((match = stopRegex.exec(gradient))) {
    const color = parseColor(match[1]);
    if (!color) continue;
    const position = match[2] !== undefined ? Math.max(0, Math.min(1, parseFloat(match[2]) / 100)) : null;
    matches.push({ color, position });
  }

  return matches;
}

type GradientStop = {
  color: RGB;
  position: number;
};

function normaliseStops(rawStops: RawGradientStop[]): GradientStop[] {
  if (rawStops.length === 0) return [];
  if (rawStops.length === 1) return [{ color: rawStops[0].color, position: rawStops[0].position ?? 0 }];

  const defaultSpacing = rawStops.length > 1 ? 1 / (rawStops.length - 1) : 0;
  const stops = rawStops.map((stop, index) => ({
    color: stop.color,
    position: stop.position ?? Math.max(0, Math.min(1, index * defaultSpacing)),
  }));

  return stops.sort((a, b) => a.position - b.position);
}

function sampleGradientColor(gradient: string, position: number): RGB | null {
  const rawStops = parseGradientStops(gradient);
  const stops = normaliseStops(rawStops);
  if (stops.length === 0) return null;
  if (stops.length === 1) return stops[0].color;

  const target = Math.max(0, Math.min(1, position));

  if (target <= stops[0].position) return stops[0].color;
  if (target >= stops[stops.length - 1].position) return stops[stops.length - 1].color;

  for (let i = 0; i < stops.length - 1; i++) {
    const current = stops[i];
    const next = stops[i + 1];
    if (target >= current.position && target <= next.position) {
      const span = next.position - current.position || 1;
      const t = (target - current.position) / span;
      return interpolateColor(current.color, next.color, t);
    }
  }

  return stops[stops.length - 1].color;
}

export function textColorForBackground(
  background: string,
  options?: {
    dark?: string;
    light?: string;
    minContrast?: number;
    gradientSamples?: number[];
  },
): string {
  const {
    dark = DARK_TEXT,
    light = LIGHT_TEXT,
    minContrast = 2.1,
    gradientSamples = [0.3, 0.5, 0.7],
  } = options ?? {};

  const evaluationColors: RGB[] = [];

  if (background.includes('gradient')) {
    const uniqueSamples = Array.from(new Set(
      gradientSamples
        .map((v) => (Number.isFinite(v) ? Number(v) : 0.5))
        .concat(0.5),
    ));
    uniqueSamples.forEach((position) => {
      const sample = sampleGradientColor(background, position);
      if (sample) evaluationColors.push(sample);
    });
  } else {
    const parsed = parseColor(background);
    if (parsed) evaluationColors.push(parsed);
  }

  const safeBackgroundColors = evaluationColors.length > 0
    ? evaluationColors
    : [parseColor(FALLBACK_COLOR) ?? { r: 203, g: 213, b: 245 }];

  const darkRgb = parseColor(dark) ?? parseColor(DARK_TEXT) ?? { r: 15, g: 23, b: 42 };
  const lightRgb = parseColor(light) ?? parseColor(LIGHT_TEXT) ?? { r: 255, g: 255, b: 255 };

  const contrastForCandidate = (candidate: RGB) =>
    safeBackgroundColors.reduce((minContrastForCandidate, bg) => {
      const ratio = contrastRatio(candidate, bg);
      return Math.min(minContrastForCandidate, ratio);
    }, Infinity);

  const darkContrast = contrastForCandidate(darkRgb);
  const lightContrast = contrastForCandidate(lightRgb);
  const lightScore = lightContrast * 2.5;
  const darkScore = darkContrast;

  if (lightScore >= minContrast && lightScore >= darkScore) {
    return light;
  }
  if (darkScore >= minContrast && darkScore >= lightScore) {
    return dark;
  }

  return lightScore > darkScore ? light : dark;
}
