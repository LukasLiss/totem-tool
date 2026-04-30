import React, { useEffect, useRef } from "react";
import { GridStackNode } from "gridstack";
import { useGrid } from "./gridstackprovider";

interface DashboardGridProps {
  initialChildren?: GridStackNode[];
}

const DashboardGrid: React.FC<DashboardGridProps> = ({ initialChildren = [] }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { grid } = useGrid();

  useEffect(() => {
    // Only load if we have actual children to load and grid is ready
    if (grid && initialChildren && initialChildren.length > 0) {
      try {
        grid.load(initialChildren);
      } catch (error) {
        console.warn("Error loading initial children:", error);
      }
    }
  }, [grid, initialChildren]);

  return <div className="grid-stack flex" ref={containerRef} />;
};

export default DashboardGrid;
