import { ReactFlowProvider } from '@xyflow/react';
import OCDFGVisualizer from './react_component/OCDFGVisualizer';

export function OCDFGDemo() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#F8FAFC' }}>
      <ReactFlowProvider>
        <OCDFGVisualizer height="100vh" />
      </ReactFlowProvider>
    </div>
  );
}
