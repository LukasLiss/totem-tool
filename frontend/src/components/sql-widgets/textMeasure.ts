/**
 * Measuring text in the page's font without rendering it, for fitting chart
 * labels and sizing axes (a canvas 2D context, created once).
 */

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Width of `text` in px at `fontSize`, in the page's font. */
export function textWidth(text: string, fontSize: number): number {
  if (measureContext === undefined) {
    measureContext = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  }
  if (!measureContext) return text.length * fontSize * 0.6;
  const family = getComputedStyle(document.body).fontFamily || "sans-serif";
  measureContext.font = `${fontSize}px ${family}`;
  return measureContext.measureText(text).width;
}

/** `text` cut with "…" so that it fits into `maxWidth` px. */
export function fitText(text: string, fontSize: number, maxWidth: number): string {
  if (textWidth(text, fontSize) <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (textWidth(`${text.slice(0, mid).trimEnd()}…`, fontSize) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low > 0 ? `${text.slice(0, low).trimEnd()}…` : "…";
}
