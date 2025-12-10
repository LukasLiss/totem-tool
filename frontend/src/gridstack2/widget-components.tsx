import React from 'react';
import { CustomGridStackWidget, WidgetProps } from './types';

// --- Actual React Components ---

const SimpleWidget: React.FC<WidgetProps> = ({ text, color }) => (
  <div
    style={{
      backgroundColor: color || '#fff',
      padding: '10px',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
    }}
  >
    <h3>{text}</h3>
    <small>React Component</small>
  </div>
);

// --- Component Registry ---

interface ComponentMapItem {
  Component: React.FC<WidgetProps>;
}

export const ComponentMap: Record<string, ComponentMapItem> = {
  SimpleWidgetA: {
    Component: (props) => <SimpleWidget {...props} text={props.text || "Widget A"} color="#f7f7f7" />,
  },
  SimpleWidgetB: {
    Component: (props) => <SimpleWidget {...props} text={props.text || "Widget B"} color="#ffeaa7" />,
  },
};

// --- Initial Data ---

export const initialChildrenData: CustomGridStackWidget[] = [
  { x: 0, y: 0, w: 4, h: 2, componentId: 'SimpleWidgetA', props: { id: 1, text: 'Initial A' } },
  { x: 4, y: 0, w: 4, h: 4, locked: true, componentId: 'SimpleWidgetB', props: { id: 2, text: 'Locked B' } },
  { x: 8, y: 0, w: 2, h: 2, minW: 2, noResize: true, componentId: 'SimpleWidgetA', props: { id: 3, text: 'No Resize' } },
];

export const dragInOptions: CustomGridStackWidget = {
  h: 2,
  w: 2,
  componentId: 'SimpleWidgetB',
  props: { id: -1, text: 'New Dragged Item' }, // ID will be overwritten on drop
};