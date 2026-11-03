import type {
  OcpnReplayObjectTypeResult,
  OcpnReplayPlaceStats,
} from "@/api/ocpnFlattenedReplayApi";
import type { TooltipRow } from "@/react_component/MetricTooltip";

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

/** Title and rows of the hover card of a place. */
export function placeTooltip(
  placeId: string,
  objectType: string,
  stats: OcpnReplayPlaceStats | undefined
): { title: string; rows: TooltipRow[] } {
  const title = `Place ${placeId} (${objectType})`;
  if (!stats) return { title, rows: [{ label: "Replay", value: "No data" }] };
  return {
    title,
    rows: [
      { label: "Produced", value: stats.produced.toLocaleString() },
      { label: "Consumed", value: stats.consumed.toLocaleString() },
      { label: "Missing", value: stats.missing.toLocaleString() },
      { label: "Remaining", value: stats.remaining.toLocaleString() },
      { label: "Deviation", value: formatPercent(stats.deviation) },
    ],
  };
}

/** Title and rows of the hover card of an object type's fitness chip. */
export function objectTypeTooltip(result: OcpnReplayObjectTypeResult): {
  title: string;
  rows: TooltipRow[];
} {
  const rows: TooltipRow[] = [
    { label: "Fitness", value: formatFitness(result.fitness) },
    { label: "Objects", value: result.num_objects.toLocaleString() },
    { label: "Variants", value: result.num_variants.toLocaleString() },
    { label: "Fitting objects", value: result.fitting_objects.toLocaleString() },
    { label: "Produced", value: result.produced.toLocaleString() },
    { label: "Consumed", value: result.consumed.toLocaleString() },
    { label: "Missing", value: result.missing.toLocaleString() },
    { label: "Remaining", value: result.remaining.toLocaleString() },
  ];
  const unmapped = Object.entries(result.unmapped_activities);
  if (unmapped.length > 0) {
    const listed = unmapped
      .slice(0, 5)
      .map(([activity, n]) => `${activity} (${n.toLocaleString()})`)
      .join(", ");
    rows.push({
      label: "Not in net (skipped)",
      value: unmapped.length > 5 ? `${listed}, …` : listed,
    });
  }
  result.warnings.forEach((warning, index) =>
    rows.push({ label: result.warnings.length > 1 ? `Note ${index + 1}` : "Note", value: warning })
  );
  return { title: result.object_type, rows };
}
