/**
 * The lock badge of the graph drafts (OCDFG, OCCN): shown while interactions
 * start locked, in the sketch's top right corner, always at the same size on
 * screen (22 px across) however large the sketch is drawn.
 */

import React from "react";

const RADIUS_PX = 11;
const INSET_PX = 4;

const SketchLockBadge: React.FC<{
  /** The sketch's top right corner, in viewBox units. */
  right: number;
  top: number;
  /** viewBox units per screen pixel (see useSvgUnitsPerPixel). */
  unitsPerPixel: number;
}> = ({ right, top, unitsPerPixel }) => {
  const offset = (RADIUS_PX + INSET_PX) * unitsPerPixel;
  return (
    <g transform={`translate(${right - offset} ${top + offset}) scale(${unitsPerPixel})`}>
      <circle r={RADIUS_PX} fill="#ffffff" stroke="#e2e8f0" strokeWidth={1} />
      <path d="M-2.6,-0.6 V-2.9 A2.6,2.6 0 0 1 2.6,-2.9 V-0.6" fill="none" stroke="#475569" strokeWidth={1.3} strokeLinecap="round" />
      <rect x={-4} y={-0.6} width={8} height={5.8} rx={1} fill="#475569" />
    </g>
  );
};

export default SketchLockBadge;
