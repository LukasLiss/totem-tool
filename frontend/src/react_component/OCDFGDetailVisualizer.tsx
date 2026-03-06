import { ReactFlowProvider } from '@xyflow/react';
import { useId } from 'react';

import OCDFGVisualizer, { type OcdfgGraph } from './OCDFGVisualizer';

type OCDFGDetailVisualizerProps = {
  height?: string | number;
  data: OcdfgGraph;
  layoutDirection?: 'TB' | 'LR';
  instanceId?: string;
  typeColorOverrides?: Record<string, string>;
  onSizeChange?: (size: { width: number; height: number }) => void;
};

// Lightweight wrapper to keep the detail-node OCDFG isolated from the primary visualizer
// while still reusing the shared layout and rendering logic.
function OCDFGDetailVisualizer({
  height,
  data,
  layoutDirection,
  instanceId,
  typeColorOverrides,
  onSizeChange,
}: OCDFGDetailVisualizerProps) {
  const generatedId = useId();
  const providerId = instanceId ?? `detail-flow-${generatedId}`;

  return (
    <ReactFlowProvider id={providerId}>
      <OCDFGVisualizer
        height={height}
        data={data}
        variant="detail"
        instanceId={providerId}
        layoutDirection={layoutDirection ?? 'LR'}
        typeColorOverrides={typeColorOverrides}
        onSizeChange={onSizeChange}
      />
    </ReactFlowProvider>
  );
}

export default OCDFGDetailVisualizer;
