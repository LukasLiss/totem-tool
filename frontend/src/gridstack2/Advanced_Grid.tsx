import React from 'react';
import { GridStackProvider, GridContainer } from './GridStackContext';
import SidePanel from '.';

const AdvancedGrid: React.FC = () => {
  return (
    <GridStackProvider>
      <div className="container-fluid" style={{ marginTop: '20px' }}>
        <h1 className="text-center mb-4">Advanced GridStack Demo (TSX)</h1>
        
        <div className="row">
          <SidePanel />

          <div className="col-sm-12 col-md-10">
             {/* Render the grid container exactly where we want it */}
             <GridContainer />
          </div>
        </div>
      </div>
    </GridStackProvider>
  );
};

export default AdvancedGrid;