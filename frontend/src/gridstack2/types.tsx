// types.ts
import { GridStackWidget } from 'gridstack';

// The shape of the props that any of our dynamic widgets might accept
export interface WidgetProps {
  id: string | number;
  text?: string;
  color?: string;
  [key: string]: any; // Allow flexibility for other props
}

// The internal state representation of a widget in our React app
export interface WidgetItem {
  id: string; // The GridStack Node ID (string)
  componentId: string; // The key in our ComponentMap
  props: WidgetProps;
}

// Extending GridStack's native widget interface to include our custom data
// This allows us to pass componentId/props into grid.addWidget()
export interface CustomGridStackWidget extends GridStackWidget {
  componentId?: string; // Optional because standard GS widgets might not have it
  props?: WidgetProps;
}