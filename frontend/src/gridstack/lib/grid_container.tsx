import React, { useEffect, useRef } from "react";
import { useGrid } from "./gridContext"; // your provider hook

/** Wrap your DashboardGrid with this so GridStack will reflow when container width changes. */
const GridContainer: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const { grid } = useGrid(); // GridStack instance from your provider

  useEffect(() => {
    if (!wrapperRef.current || !grid) return;

    // ResizeObserver callback — pass the new clientWidth to GridStack
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Use contentRect.width for precise measurement (falls back to clientWidth)
        const width = entry.contentRect?.width ?? (wrapperRef.current?.clientWidth ?? 0);
        // Tell GridStack it was resized so it can recompute columns/oneCol mode/etc.
        // onResize accepts an optional clientWidth number.
        try {
          if (grid && grid.engine) { // Check if grid engine is initialized
            grid.onResize(Math.floor(width));
          }
        } catch {
          // Defensive: onResize is the documented method, but fall back to
          // compact() if this GridStack build does not have it.
          try {
            if (grid && grid.engine) {
              grid.compact();
            }
          } catch {
            // Both paths failed; the next resize gets another go.
          }
        }
      }
    });

    ro.observe(wrapperRef.current);

    // Also trigger once immediately so initial layout correct
    const initialWidth = wrapperRef.current.clientWidth;
    try {
      if (grid && grid.engine) {
        grid.onResize(Math.floor(initialWidth));
      }
    } catch {
      // The observer above re-runs this on the next resize.
    }

    return () => ro.disconnect();
  }, [grid]);

  return (
    <div ref={wrapperRef} className={className ?? "flex-grow overflow-auto"}>
      {children}
    </div>
  );
};

export default GridContainer;
