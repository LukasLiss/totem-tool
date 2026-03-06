import React, { useEffect, useRef } from "react";
import { useGrid } from "./gridstackprovider"; // your provider hook

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
        } catch (err) {
          // defensive: if onResize not present for some reason, fallback to compact()
          // (but onResize is the documented method).
          // eslint-disable-next-line no-console
          console.warn("grid.onResize failed, trying compact() as fallback", err);
          try { 
            if (grid && grid.engine) {
              grid.compact(); 
            }
          } catch (_) {}
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
    } catch (err) {
      console.warn("Initial onResize failed:", err);
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
