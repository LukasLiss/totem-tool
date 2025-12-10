// GridStackProvider.tsx
import React, {
  createContext,
  useEffect,
  useRef,
  ReactNode,
  useState,
} from "react";
import { GridStack, GridStackWidget } from "gridstack";
import "gridstack/dist/gridstack.min.css";
import { createRoot, Root } from "react-dom/client";
import { GridItem } from "./types/GridItem";

interface GridContextValue {
  grid: React.MutableRefObject<GridStack | null>;
  containerRef: React.RefObject<HTMLDivElement>;
  addWidget: (item: GridItem) => void;
}

export const GridContext = createContext<GridContextValue | null>(null);

interface Props {
  children: ReactNode;
  initialItems: GridItem[];
  insertTemplate: Partial<GridItem>;
}

export function GridStackProvider({
  children,
  initialItems,
  insertTemplate,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<GridStack | null>(null);

  // Map<widgetId, ReactRoot>
  const widgetRoots = useRef<Map<string, Root>>(new Map());

  //
  // 1 — renderCB: mount widget.component into GridStack items
  //
  useEffect(() => {
    GridStack.renderCB = (el: HTMLElement, widget: GridStackWidget) => {
      const id = widget.id?.toString();
      if (!id) return;

      const item = initialItems.find((i) => i.id === id);
      if (!item) return;

      // Unmount previous React root if exists
      if (widgetRoots.current.has(id)) {
        widgetRoots.current.get(id)?.unmount();
      }

      const root = createRoot(el);
      widgetRoots.current.set(id, root);
      root.render(<>{item.component}</>);
    };
  }, [initialItems]);

  //
  // 2 — Initialize GridStack
  //
  useEffect(() => {
    if (!containerRef.current) return;

    const grid = GridStack.init(
      {
        acceptWidgets: true,
        removable: "#trash",
        cellHeight: 70,
        children: initialItems.map((item) => ({
          id: item.id,
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
        })),
      },
      containerRef.current
    );

    gridRef.current = grid;

    //
    // 3 — drag-in from sidebar
    //
    GridStack.setupDragIn(".sidepanel .grid-stack-item", undefined, {
      w: insertTemplate.w ?? 2,
      h: insertTemplate.h ?? 2,
      id: insertTemplate.id ?? "insert-" + Date.now(),
    });

    return () => {
      grid.destroy(false);
      widgetRoots.current.forEach((r) => r.unmount());
    };
  }, []);

  //
  // 4 — Add widget programmatically
  //
  const addWidget = (item: GridItem) => {
    if (!gridRef.current) return;

    gridRef.current.addWidget({
      id: item.id,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
    });
  };

  return (
    <GridContext.Provider
      value={{ grid: gridRef, containerRef, addWidget }}
    >
      {children}
    </GridContext.Provider>
  );
}
