/**
 * SVG path of a pie slice of radius `r` from `startAngle` to `endAngle`
 * (radians, measured clockwise from the positive x axis, centred at 0,0).
 * Shared by the resource graph nodes and the resource tooltip.
 */
export function pieSlicePath(r: number, startAngle: number, endAngle: number): string {
  const x1 = r * Math.cos(startAngle), y1 = r * Math.sin(startAngle);
  const x2 = r * Math.cos(endAngle),   y2 = r * Math.sin(endAngle);
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M 0 0 L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}
