import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { GridStack, GridStackOptions, GridStackNode } from 'gridstack';
import 'gridstack/dist/gridstack.min.css';

import GridStackWidget from './GridStackWidget';
import { initialChildrenData, dragInOptions } from './WidgetComponents';
import { CustomGridStackWidget, WidgetItem } from './types';

// --- Context Definition ---

interface GridStackContextType {
  gridRef: React.RefObject<HTMLDivElement>;
  gridInstance: GridStack | null;
}

const GridStackContext = createContext<GridStackContextType | null>(null);

export const useGridStack = () => {
  const context = useContext(GridStackContext);
  if (!context) {
    throw new Error('useGridStack must be used within a GridStackProvider');
  }
  return context;
};

// --- Global Config ---

// Disable GridStack's internal HTML rendering because React Portals handle it.
GridStack.renderCB = (el: HTMLElement, w: GridStackNode) => {
  // NO-OP
};

const gridOptions: GridStackOptions = {
  cellHeight: 70,
  acceptWidgets: true,
  removable: '#trash',
  float: true,
  margin: 5,
};

// --- Provider Component ---

interface GridStackProviderProps {
  children: ReactNode;
}

export const GridStackProvider: React.FC<GridStackProviderProps> = ({ children }) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridInstance, setGridInstance] = useState<GridStack | null>(null);
  const [widgets, setWidgets] = useState<WidgetItem[]>([]);

  // Helper: Find the DOM element inside a GridStack item where we should mount our React Portal
  const getContentContainer = (id: string): HTMLElement | null => {
    if (!gridRef.current) return null;
    const item = gridRef.current.querySelector(`.grid-stack-item[data-gs-id="${id}"]`);
    return item ? item.querySelector('.grid-stack-item-content') as HTMLElement : null;
  };

  useEffect(() => {
    if (!gridRef.current) return;

    // 1. Initialize GridStack
    const grid = GridStack.init(gridOptions, gridRef.current);
    setGridInstance(grid);

    // 2. Load Initial Widgets Manually
    // We do this manually to ensure we capture the returned IDs and sync state immediately
    const initialWidgets: WidgetItem[] = initialChildrenData.map((w) => {
      // addWidget updates the DOM immediately
      const el = grid.addWidget(w); 
      return {
        id: el.getAttribute('data-gs-id') || 'unknown',
        componentId: w.componentId!,
        props: w.props!,
      };
    });
    setWidgets(initialWidgets);

    // 3. Event Listener: Added / Removed
    const handleChange = (e: Event, items: GridStackNode[]) => {
      if (e.type === 'added') {
        const newItems: WidgetItem[] = items.map((node) => {
          // In GridStack, when dragging in from outside, the `node` object 
          // contains the data we attached in `setupDragIn` (or the element's data attributes).
          // We need to cast `node` to access our custom CustomGridStackWidget properties.
          const customNode = node as unknown as CustomGridStackWidget;

          return {
            id: node.el?.getAttribute('data-gs-id') || 'unknown',
            componentId: customNode.componentId || 'SimpleWidgetA', // Fallback
            props: customNode.props || { id: Date.now(), text: 'New Item' },
          };
        });
        setWidgets((prev) => [...prev, ...newItems]);
      } 
      
      if (e.type === 'removed') {
        const removedIds = new Set(items.map((node) => node.el?.getAttribute('data-gs-id')));
        setWidgets((prev) => prev.filter((w) => !removedIds.has(w.id)));
      }
    };

    grid.on('added removed', handleChange);

    // 4. Setup Drag In
    // We attach the data generator to the class name
    GridStack.setupDragIn('.sidepanel-item', (el: HTMLElement) => {
      // Return the data object that will become the Widget node
      return {
        ...dragInOptions,
        // Generate a unique ID for the new widget's props
        props: { ...dragInOptions.props, id: Date.now(), text: 'Dragged In!' } 
      } as CustomGridStackWidget; 
    });

    return () => {
      grid.off('added removed', handleChange);
      grid.destroy(false); // false = don't remove DOM elements (React handles that, mostly)
      setGridInstance(null);
    };
  }, []);

  return (
    <GridStackContext.Provider value={{ gridRef, gridInstance }}>
      {/* The Container for GridStack */}
      <div ref={gridRef} className="grid-stack">
        {/* GridStack manages the DOM nodes here, we don't put children here directly */}
      </div>

      {/* The Portals: Render the React components into the GridStack DOM nodes */}
      {widgets.map((w) => (
        <GridStackWidget
          key={w.id}
          componentId={w.componentId}
          props={w.props}
          contentContainer={getContentContainer(w.id)}
        />
      ))}

      {/* Render the rest of the app (SidePanel, etc) */}
      {children}
    </GridStackContext.Provider>
  );
};