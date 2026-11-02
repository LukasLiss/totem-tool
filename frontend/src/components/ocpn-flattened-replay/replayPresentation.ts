import type {
  OcpnReplayObjectTypeResult,
  OcpnReplayPlaceStats,
} from "@/api/ocpnFlattenedReplayApi";

/** Deviation colour of a place halo (red-600). */
export const DEVIATION_RGB = "220, 38, 38";

/**
 * Highlight strength of a place, 0 (no highlight) .. 1 (strongest).
 *
 * Any deviation gets a visible minimum so that a single missing token in a
 * busy place is not lost; beyond that the strength grows linearly with the
 * place's deviation ratio ((missing + remaining) / (produced + missing)).
 */
export function highlightIntensity(stats: OcpnReplayPlaceStats | undefined): number {
  if (!stats) return 0;
  if (stats.missing === 0 && stats.remaining === 0) return 0;
  const ratio = Math.min(1, Math.max(0, stats.deviation));
  return 0.25 + 0.75 * ratio;
}

/** CSS box-shadow drawing the deviation halo around a place. */
export function highlightShadow(intensity: number): string | undefined {
  if (intensity <= 0) return undefined;
  const spread = Math.round(4 + 10 * intensity);
  const alpha = (0.2 + 0.6 * intensity).toFixed(2);
  return `0 0 0 ${spread}px rgba(${DEVIATION_RGB}, ${alpha})`;
}

export function formatFitness(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return `${(value * 100).toFixed(1)}%`;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Tailwind text colour class for a fitness value. */
export function fitnessTone(value: number | null | undefined): string {
  if (value === null || value === undefined) return "text-muted-foreground";
  if (value >= 0.95) return "text-emerald-600";
  if (value >= 0.8) return "text-amber-600";
  return "text-red-600";
}

/** Total number of events skipped because the type's net lacks the activity. */
export function unmappedEventCount(result: OcpnReplayObjectTypeResult): number {
  return Object.values(result.unmapped_activities).reduce((sum, n) => sum + n, 0);
}

export function placeStatsById(
  places: OcpnReplayPlaceStats[]
): Map<string, OcpnReplayPlaceStats> {
  return new Map(places.map((place) => [place.place_id, place]));
}
