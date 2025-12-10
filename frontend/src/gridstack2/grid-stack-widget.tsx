import React from 'react';
import { createPortal } from 'react-dom';
import { ComponentMap } from './WidgetComponents';
import { WidgetProps } from './types';

interface GridStackWidgetProps {
  componentId: string;
  props: WidgetProps;
  contentContainer: HTMLElement | null;
}

const GridStackWidget: React.FC<GridStackWidgetProps> = ({ componentId, props, contentContainer }) => {
  // If the container isn't ready (GridStack hasn't created the DOM node yet), don't render
  if (!contentContainer) return null;

  // Find the component
  const mappedItem = ComponentMap[componentId];
  if (!mappedItem) {
    console.warn(`Component with id "${componentId}" not found in ComponentMap.`);
    return null;
  }

  const { Component } = mappedItem;

  // Use Portal to render the component inside the GridStack DOM element
  return createPortal(
    <Component {...props} />,
    contentContainer
  );
};

export default GridStackWidget;