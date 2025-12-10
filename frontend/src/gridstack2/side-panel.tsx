import React, { useEffect, useRef } from 'react';
import { GridStack } from 'gridstack'; 
// Note: We don't need useGridStack here because setupDragIn is static, 
// but if you wanted to drag programmatically, you would use it.

export default const SidePanel: React.FC = () => {
  const sidepanelItemRef = useRef<HTMLDivElement>(null);

  // We rely on GridStack.setupDragIn being called in the Provider
  // But we need to ensure this component renders elements with the class '.sidepanel-item'

  return (
    <div className="sidepanel col-md-2 d-none d-md-block" style={{ background: '#2c3e50', padding: '10px', color: 'white' }}>
      <div style={{ marginBottom: '20px', textAlign: 'center' }}>
        <h4>Side Panel</h4>
      </div>

      {/* Trash zone */}
      <div 
        id="trash" 
        className="sidepanel-item" 
        style={{ 
          background: 'rgba(255,0,0,0.4)', 
          padding: '15px', 
          marginBottom: '20px', 
          textAlign: 'center',
          cursor: 'pointer' 
        }}
      >
        <div>🗑️</div>
        <div>Drop here to remove!</div>
      </div>

      {/* Draggable item */}
      <div
        ref={sidepanelItemRef}
        className="grid-stack-item sidepanel-item"
        style={{ 
          background: '#18bc9c', 
          padding: '15px', 
          textAlign: 'center', 
          cursor: 'grab' 
        }}
      >
        <div>➕</div>
        <div>Drag me!</div>
      </div>
    </div>
  );
};

export default SidePanel;